using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.People;

/// <summary>People as everyone sees them (D-28): today's people and joiners, with what any colleague may read.</summary>
public sealed record PeopleDirectoryQuery(Guid? ViewerEmployeeId) : IQuery<Result<PeopleDirectoryDto>>;

public sealed record PeopleDirectoryPersonDto(
    string EmployeeKey,
    string DisplayName,
    string? PhotoUrl,
    string? JobTitle,
    Guid? UnitId,
    string? UnitName,
    Guid? PlaceId,
    string? Place,
    Guid? JobId,
    PeopleManagerDto? Manager,
    string? WorkEmail,
    /// <summary>Added before their first day; colleagues don't see the date.</summary>
    bool StartingSoon,
    /// <summary>Values of the company's Tags fields that everyone sees (skills, languages), for search.</summary>
    IReadOnlyList<string> Tags,
    /// <summary>Leave they are on, or their next; colleagues don't see the type.</summary>
    Changes.PersonLeaveDto? Leave = null);

public sealed record PeopleDirectoryDto(string? ViewerEmployeeKey, IReadOnlyList<PeopleDirectoryPersonDto> People);

public sealed class PeopleDirectoryQueryHandler(ISender sender, CoreHRDbContext dbContext)
    : IQueryHandler<PeopleDirectoryQuery, Result<PeopleDirectoryDto>>
{
    public async Task<Result<PeopleDirectoryDto>> Handle(PeopleDirectoryQuery request, CancellationToken cancellationToken)
    {
        var listed = await sender.Send(new PeopleQuery(View: PeopleView.Everyone, Unpaged: true), cancellationToken);
        if (listed.IsFailure) return Result.Failure<PeopleDirectoryDto>(listed.Error);

        var rows = listed.Value.Items;
        var keys = rows.Select(row => row.EmployeeKey).ToList();
        var ids = await dbContext.Employees.AsNoTracking()
            .Where(employee => keys.Contains(employee.StableEmployeeKey))
            .Select(employee => new { employee.Id, employee.StableEmployeeKey })
            .ToDictionaryAsync(item => item.StableEmployeeKey, item => item.Id, cancellationToken);
        var tags = await EveryoneTagsAsync(ids.Values.ToList(), cancellationToken);
        var viewerKey = request.ViewerEmployeeId is { } viewer
            ? ids.FirstOrDefault(pair => pair.Value == viewer).Key
            : null;

        var people = rows.Select(row => new PeopleDirectoryPersonDto(
            row.EmployeeKey,
            row.DisplayName,
            row.PhotoUrl,
            row.Work?.JobTitle,
            row.Work?.OrgUnitId,
            row.Work?.OrganizationName,
            row.Work?.PlaceId,
            row.Work?.Location,
            row.Work?.JobId,
            row.PrimaryManager,
            row.WorkEmail,
            row.EmploymentState == PeopleEmploymentState.Scheduled,
            ids.TryGetValue(row.EmployeeKey, out var id) && tags.TryGetValue(id, out var held) ? held : [],
            row.Leave))
            .OrderBy(person => person.DisplayName, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
        return Result.Success(new PeopleDirectoryDto(viewerKey, people));
    }

    /// <summary>Only fields the company shows to everyone; a field HR or managers alone see never reaches a colleague.</summary>
    private async Task<Dictionary<Guid, IReadOnlyList<string>>> EveryoneTagsAsync(List<Guid> employeeIds, CancellationToken cancellationToken)
    {
        var fieldIds = await dbContext.EmployeeFieldDefinitions.AsNoTracking()
            .Where(item => item.IsActive && item.Visible && item.VisibleToEmployee && item.VisibleToManager
                && item.SourceKey == null && item.Type == EmployeeFieldType.Tags)
            .Select(item => item.Id)
            .ToListAsync(cancellationToken);
        if (fieldIds.Count == 0) return [];
        var values = await dbContext.EmployeeFieldValues.AsNoTracking()
            .Where(item => fieldIds.Contains(item.FieldId) && employeeIds.Contains(item.EmployeeId))
            .Select(item => new { item.EmployeeId, item.ValueJson })
            .ToListAsync(cancellationToken);
        return values.GroupBy(item => item.EmployeeId)
            .ToDictionary(group => group.Key,
                group => (IReadOnlyList<string>)group.SelectMany(item => PeopleQueryHandler.TagsOf(item.ValueJson))
                    .Distinct(StringComparer.OrdinalIgnoreCase).ToList());
    }
}

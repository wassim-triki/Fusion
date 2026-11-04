using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.People;

/// <summary>
/// The joiner's Home card only: the manager as any colleague sees them in the directory (name, job, unit, place,
/// photo, the key their page opens with), never contact details or workforce records.
/// </summary>
public sealed record MyManagerCardDto(string EmployeeKey, string DisplayName, string? JobTitle, string? PhotoUrl, string? Unit, string? Place);
/// <summary>Someone else whose primary manager today is the caller's: name, job and photo only.</summary>
public sealed record MyTeammateDto(string EmployeeKey, string DisplayName, string? JobTitle, string? PhotoUrl);
/// <summary>Teammates are filled only during the first week, the only time Home shows them; up to three, plus the count.</summary>
public sealed record MyManagerDto(MyManagerCardDto? Manager, bool IsFirstWeek, IReadOnlyList<MyTeammateDto> Teammates, int TeammateCount);

/// <summary>Employee id comes exclusively from the authenticated caller, never the request.</summary>
public sealed record MyManagerQuery(Guid EmployeeId, DateTime AsOf) : IQuery<Result<MyManagerDto>>;

public sealed class MyManagerQueryHandler(CoreHRDbContext dbContext, IWorkforceCanonicalResolver resolver)
    : IQueryHandler<MyManagerQuery, Result<MyManagerDto>>
{
    private const int TeammatesShown = 3;

    public async Task<Result<MyManagerDto>> Handle(MyManagerQuery request, CancellationToken cancellationToken)
    {
        // All reads retain the fail-closed tenant filter, including the manager and teammate lookups.
        if (!await dbContext.Employees.AnyAsync(item => item.Id == request.EmployeeId, cancellationToken))
            return Result.Failure<MyManagerDto>(new Error("Employee.NotFound", "Employee was not found."));

        var employment = await resolver.GetCurrentEmploymentAsync(request.EmployeeId, request.AsOf, cancellationToken);
        var days = employment is null ? -1 : (request.AsOf.Date - employment.EffectiveFrom.Date).Days;
        var firstWeek = days >= 0 && days < 7;
        var none = new MyManagerDto(null, firstWeek, [], 0);
        var relationship = await resolver.GetPrimaryManagerAsync(request.EmployeeId, request.AsOf, cancellationToken);
        if (relationship is null) return Result.Success(none);
        var manager = await dbContext.Employees.AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == relationship.ManagerEmployeeId, cancellationToken);
        if (manager is null) return Result.Success(none);

        var assignment = await resolver.GetPrimaryWorkAssignmentAsync(manager.Id, request.AsOf, cancellationToken);
        var on = DateOnly.FromDateTime(request.AsOf);
        var unit = assignment is null ? null : await dbContext.OrgUnitEffectiveStates.AsNoTracking()
            .Where(item => item.OrgUnitId == assignment.OrgUnitId && item.EffectiveFrom <= on && (item.EffectiveTo == null || on < item.EffectiveTo))
            .Select(item => item.Name).FirstOrDefaultAsync(cancellationToken);
        var card = new MyManagerCardDto(manager.StableEmployeeKey, manager.DisplayName, Blank(assignment?.JobTitle),
            EmployeePhotos.UrlFor(manager.StableEmployeeKey, manager.PhotoKey), unit, Blank(assignment?.WorkLocation));
        if (!firstWeek) return Result.Success(new MyManagerDto(card, false, [], 0));

        var at = request.AsOf;
        var peerIds = await dbContext.ManagerRelationships.AsNoTracking()
            .Where(item => item.Type == ReportingRelationshipType.PrimaryManager && item.ManagerEmployeeId == manager.Id
                && item.SubjectEmployeeId != request.EmployeeId
                && item.EffectiveFrom <= at && (item.EffectiveTo == null || at < item.EffectiveTo))
            .Select(item => item.SubjectEmployeeId).Distinct().ToListAsync(cancellationToken);
        // Only people employed today: a line can outlive an ended employment.
        var employed = await dbContext.Employments.AsNoTracking()
            .Where(item => peerIds.Contains(item.EmployeeId) && item.EffectiveFrom <= at && (item.EffectiveTo == null || at < item.EffectiveTo))
            .Select(item => item.EmployeeId).Distinct().ToListAsync(cancellationToken);
        var peers = await dbContext.Employees.AsNoTracking().Where(item => employed.Contains(item.Id)).ToListAsync(cancellationToken);
        var shown = new List<MyTeammateDto>();
        foreach (var peer in peers.OrderBy(item => item.DisplayName).Take(TeammatesShown))
        {
            var work = await resolver.GetPrimaryWorkAssignmentAsync(peer.Id, at, cancellationToken);
            shown.Add(new(peer.StableEmployeeKey, peer.DisplayName, Blank(work?.JobTitle), EmployeePhotos.UrlFor(peer.StableEmployeeKey, peer.PhotoKey)));
        }
        return Result.Success(new MyManagerDto(card, true, shown, peers.Count));
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;
}

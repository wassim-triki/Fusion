using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.People;

public sealed record ManagerOptionsQuery(
    DateTime EffectiveDate,
    string? Q = null,
    Guid? ExcludeEmployeeId = null,
    int Limit = 30,
    /// <summary>The person who would report to the option: they, their branch and their manager are left out.</summary>
    Guid? ForEmployeeId = null) : IQuery<Result<IReadOnlyList<ManagerOptionDto>>>;

public sealed record ManagerOptionDto(
    Guid EmployeeId,
    string EmployeeKey,
    string EmployeeNumber,
    string DisplayName,
    string JobTitle,
    string OrganizationName,
    string OrganizationPath,
    string Availability,
    /// <summary>How many open roles report to them: they're hiring.</summary>
    int OpenRoles = 0);

public sealed class ManagerOptionsQueryHandler(
    CoreHRDbContext dbContext,
    IOrganizationService organizationService)
    : IQueryHandler<ManagerOptionsQuery, Result<IReadOnlyList<ManagerOptionDto>>>
{
    public async Task<Result<IReadOnlyList<ManagerOptionDto>>> Handle(
        ManagerOptionsQuery request,
        CancellationToken cancellationToken)
    {
        var at = DateTime.SpecifyKind(request.EffectiveDate.Date, DateTimeKind.Utc);
        var q = request.Q?.Trim().ToLowerInvariant();
        var limit = Math.Clamp(request.Limit, 1, 50);
        var excluded = request.ForEmployeeId is { } subjectId
            ? await ExcludedForAsync(subjectId, at, cancellationToken)
            : [];
        var rows = await (
            from employee in dbContext.Employees.AsNoTracking()
            join employment in dbContext.Employments.AsNoTracking()
                on employee.Id equals employment.EmployeeId
            join assignment in dbContext.WorkAssignments.AsNoTracking()
                on new { EmployeeId = employee.Id, EmploymentId = employment.Id }
                equals new { assignment.EmployeeId, assignment.EmploymentId }
            where employment.EffectiveFrom <= at
                && (employment.EffectiveTo == null || at < employment.EffectiveTo)
                && assignment.IsPrimary
                && assignment.EffectiveFrom <= at
                && (assignment.EffectiveTo == null || at < assignment.EffectiveTo)
                && (!request.ExcludeEmployeeId.HasValue || employee.Id != request.ExcludeEmployeeId.Value)
                && !excluded.Contains(employee.Id)
                && (q == null
                    || employee.FirstName.ToLower().Contains(q)
                    || employee.LastName.ToLower().Contains(q)
                    || employee.EmployeeNumber.ToLower().Contains(q)
                    || employee.StableEmployeeKey == request.Q!.Trim())
            orderby employee.LastName, employee.FirstName, employee.Id
            select new
            {
                employee.Id,
                employee.StableEmployeeKey,
                employee.EmployeeNumber,
                DisplayName = (employee.PreferredName ?? employee.FirstName) + " " + employee.LastName,
                assignment.JobTitle,
                assignment.OrgUnitId,
                employment.EffectiveFrom
            })
            .Take(limit)
            .ToListAsync(cancellationToken);

        var hierarchy = await organizationService.GetHierarchyAsync(
            DateOnly.FromDateTime(at),
            cancellationToken);
        var organizationById = Flatten(hierarchy.Roots)
            .ToDictionary(node => node.Unit.Id, node => node.Unit);
        var today = DateTime.UtcNow.Date;
        var ids = rows.Select(row => row.Id).ToList();
        var hiring = await dbContext.OpenRoles.AsNoTracking()
            .Where(role => ids.Contains(role.ManagerEmployeeId) && role.Status == Domain.Entities.OpenRoleStatus.Open)
            .GroupBy(role => role.ManagerEmployeeId)
            .Select(group => new { group.Key, Count = group.Count() })
            .ToDictionaryAsync(item => item.Key, item => item.Count, cancellationToken);
        IReadOnlyList<ManagerOptionDto> result = rows.Select(row =>
        {
            organizationById.TryGetValue(row.OrgUnitId, out var organization);
            return new ManagerOptionDto(
                row.Id,
                row.StableEmployeeKey,
                row.EmployeeNumber,
                row.DisplayName,
                row.JobTitle,
                organization?.Name ?? "Organization unavailable",
                organization?.Path ?? "Organization unavailable",
                row.EffectiveFrom > today ? "Scheduled" : "Available",
                hiring.GetValueOrDefault(row.Id));
        }).ToList();
        return Result.Success(result);
    }

    /// <summary>The person, everyone below them (a cycle) and their current manager, on the date.</summary>
    private async Task<List<Guid>> ExcludedForAsync(Guid subjectId, DateTime at, CancellationToken cancellationToken)
    {
        var lines = await dbContext.ManagerRelationships.AsNoTracking()
            .Where(line => line.Type == ReportingRelationshipType.PrimaryManager
                && line.EffectiveFrom <= at && (line.EffectiveTo == null || at < line.EffectiveTo))
            .Select(line => new { line.SubjectEmployeeId, line.ManagerEmployeeId })
            .ToListAsync(cancellationToken);
        var byManager = lines.ToLookup(line => line.ManagerEmployeeId, line => line.SubjectEmployeeId);
        var excluded = new HashSet<Guid> { subjectId };
        var queue = new Queue<Guid>([subjectId]);
        while (queue.Count > 0)
            foreach (var report in byManager[queue.Dequeue()])
                if (excluded.Add(report))
                    queue.Enqueue(report);
        foreach (var line in lines.Where(line => line.SubjectEmployeeId == subjectId))
            excluded.Add(line.ManagerEmployeeId);
        return [.. excluded];
    }

    private static IEnumerable<OrganizationHierarchyNodeDto> Flatten(
        IEnumerable<OrganizationHierarchyNodeDto> nodes)
        => nodes.SelectMany(node => new[] { node }.Concat(Flatten(node.Children)));
}

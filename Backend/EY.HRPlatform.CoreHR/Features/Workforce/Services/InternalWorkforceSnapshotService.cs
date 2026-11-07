using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Workforce.Dtos;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Workforce.Services;

public interface IInternalWorkforceSnapshotService
{
    Task<IReadOnlyList<InternalOrgUnitSnapshotDto>> ResolveOrgUnitsAsync(
        DateTime asOf,
        IReadOnlyCollection<Guid> orgUnitIds,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<InternalWorkforceEmployeeSnapshotDto>> ResolveEmployeesAsync(
        DateTime asOf,
        IReadOnlyCollection<Guid> employeeIds,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<InternalWorkforceEmployeeSnapshotDto>> GetEmployeesByScopeAsync(
        DateTime asOf,
        IReadOnlyCollection<Guid> orgUnitIds,
        bool includeDescendants,
        bool includeInactive,
        CancellationToken cancellationToken);

    /// <summary>
    /// All employees with active employment for the tenant as-of a date. Assignment and reviewer
    /// state are reported per employee but do not gate membership: an active employee with a
    /// broken or missing primary assignment is still returned (with a null org unit) so the
    /// consumer can surface the gap as a readiness issue rather than silently receiving a smaller
    /// population. Additive convenience so Performance can resolve an "all active" population
    /// entirely through the snapshot contract.
    /// </summary>
    Task<IReadOnlyList<InternalWorkforceEmployeeSnapshotDto>> GetAllActiveAsOfAsync(
        DateTime asOf,
        bool includeInactive,
        CancellationToken cancellationToken);

    /// <summary>Active employees whose primary manager as of the date is one of the listed managers.</summary>
    Task<IReadOnlyList<InternalWorkforceEmployeeSnapshotDto>> GetDirectReportsAsync(
        DateTime asOf,
        IReadOnlyCollection<Guid> managerEmployeeIds,
        CancellationToken cancellationToken);

    /// <summary>
    /// Active employees whose first, last, preferred or full name contains the term, ordered by display
    /// name, at most <c>limit</c> (capped at <see cref="InternalWorkforceSnapshotService.MaxSearchResults"/>).
    /// For pickers in other modules; it doesn't apply a caller's view scope because the caller is a service.
    /// </summary>
    Task<IReadOnlyList<InternalWorkforceEmployeeSnapshotDto>> SearchActiveAsync(
        DateTime asOf,
        string term,
        int limit,
        CancellationToken cancellationToken);
}

public sealed class InternalWorkforceSnapshotService(CoreHRDbContext dbContext) : IInternalWorkforceSnapshotService
{
    public async Task<IReadOnlyList<InternalOrgUnitSnapshotDto>> ResolveOrgUnitsAsync(
        DateTime asOf,
        IReadOnlyCollection<Guid> orgUnitIds,
        CancellationToken cancellationToken)
    {
        if (orgUnitIds.Count == 0)
        {
            return [];
        }

        var at = DateOnly.FromDateTime(Normalize(asOf));
        var states = await dbContext.OrgUnitEffectiveStates
            .AsNoTracking()
            .Where(state => state.EffectiveFrom <= at
                && (state.EffectiveTo == null || at < state.EffectiveTo))
            .Select(state => new
            {
                state.OrgUnitId,
                state.Name,
                state.ParentOrgUnitId,
                state.LifecycleState,
            })
            .ToListAsync(cancellationToken);

        var byId = states.ToDictionary(state => state.OrgUnitId);
        var requested = orgUnitIds.ToHashSet();
        var result = new List<InternalOrgUnitSnapshotDto>();

        foreach (var state in states.Where(state => requested.Contains(state.OrgUnitId)))
        {
            var ancestors = new List<Guid>();
            var guard = new HashSet<Guid> { state.OrgUnitId };
            var parentId = state.ParentOrgUnitId;
            while (parentId is Guid id && guard.Add(id) && byId.TryGetValue(id, out var parent))
            {
                ancestors.Add(id);
                parentId = parent.ParentOrgUnitId;
            }
            ancestors.Reverse();

            result.Add(new InternalOrgUnitSnapshotDto(
                state.OrgUnitId,
                state.Name,
                state.ParentOrgUnitId,
                state.LifecycleState == OrgUnitLifecycleState.Active,
                ancestors));
        }

        return result;
    }

    public async Task<IReadOnlyList<InternalWorkforceEmployeeSnapshotDto>> ResolveEmployeesAsync(
        DateTime asOf,
        IReadOnlyCollection<Guid> employeeIds,
        CancellationToken cancellationToken)
    {
        if (employeeIds.Count == 0)
        {
            return [];
        }

        return await BuildSnapshotsAsync(Normalize(asOf), employeeIds, cancellationToken);
    }

    public async Task<IReadOnlyList<InternalWorkforceEmployeeSnapshotDto>> GetEmployeesByScopeAsync(
        DateTime asOf,
        IReadOnlyCollection<Guid> orgUnitIds,
        bool includeDescendants,
        bool includeInactive,
        CancellationToken cancellationToken)
    {
        if (orgUnitIds.Count == 0)
        {
            return [];
        }

        var at = Normalize(asOf);
        var targetOrgUnitIds = await ResolveOrgUnitScopeAsync(orgUnitIds, includeDescendants, cancellationToken);
        if (targetOrgUnitIds.Count == 0)
        {
            return [];
        }

        var activeEmploymentIds = dbContext.Employments
            .AsNoTracking()
            .Where(e => e.Status == EmploymentStatus.Active
                && e.EffectiveFrom <= at
                && (e.EffectiveTo == null || at < e.EffectiveTo))
            .Select(e => e.Id);

        var employeeIds = await dbContext.WorkAssignments
            .AsNoTracking()
            .Where(w => targetOrgUnitIds.Contains(w.OrgUnitId)
                && w.IsPrimary
                && activeEmploymentIds.Contains(w.EmploymentId)
                && w.EffectiveFrom <= at
                && (w.EffectiveTo == null || at < w.EffectiveTo))
            .Select(w => w.EmployeeId)
            .Distinct()
            .ToListAsync(cancellationToken);

        if (employeeIds.Count == 0)
        {
            return [];
        }

        var snapshots = await BuildSnapshotsAsync(at, employeeIds, cancellationToken);
        return includeInactive
            ? snapshots
            : snapshots.Where(snapshot => snapshot.IsActive).ToList();
    }

    public async Task<IReadOnlyList<InternalWorkforceEmployeeSnapshotDto>> GetAllActiveAsOfAsync(
        DateTime asOf,
        bool includeInactive,
        CancellationToken cancellationToken)
    {
        var at = Normalize(asOf);

        // Membership = active employment on the as-of date. Assignment readiness is evaluated by
        // BuildSnapshotsAsync (org unit is null when there is no active primary assignment), so
        // an active worker with a broken assignment stays visible instead of dropping out of the
        // population. The query filter scopes every set to the caller's tenant — no leaks.
        var employeeIds = await dbContext.Employments
            .AsNoTracking()
            .Where(e => e.Status == EmploymentStatus.Active
                && e.EffectiveFrom <= at
                && (e.EffectiveTo == null || at < e.EffectiveTo))
            .Select(e => e.EmployeeId)
            .Distinct()
            .ToListAsync(cancellationToken);

        if (employeeIds.Count == 0)
        {
            return [];
        }

        var snapshots = await BuildSnapshotsAsync(at, employeeIds, cancellationToken);
        return includeInactive
            ? snapshots
            : snapshots.Where(snapshot => snapshot.IsActive).ToList();
    }

    public const int MaxSearchResults = 20;

    public async Task<IReadOnlyList<InternalWorkforceEmployeeSnapshotDto>> GetDirectReportsAsync(
        DateTime asOf,
        IReadOnlyCollection<Guid> managerEmployeeIds,
        CancellationToken cancellationToken)
    {
        if (managerEmployeeIds.Count == 0)
        {
            return [];
        }

        var at = Normalize(asOf);
        var managers = managerEmployeeIds.ToHashSet();
        var subjectIds = await dbContext.ManagerRelationships
            .AsNoTracking()
            .Where(relationship => managers.Contains(relationship.ManagerEmployeeId)
                && relationship.Type == ReportingRelationshipType.PrimaryManager
                && relationship.EffectiveFrom <= at
                && (relationship.EffectiveTo == null || at < relationship.EffectiveTo))
            .Select(relationship => relationship.SubjectEmployeeId)
            .Distinct()
            .ToListAsync(cancellationToken);

        if (subjectIds.Count == 0)
        {
            return [];
        }

        // The snapshot's manager is the subject's current primary manager; re-checking it drops anyone
        // whose overlapping older link still names the manager.
        var snapshots = await BuildSnapshotsAsync(at, subjectIds, cancellationToken);
        return snapshots
            .Where(snapshot => snapshot.IsActive
                && snapshot.Manager is not null
                && managers.Contains(snapshot.Manager.EmployeeId))
            .ToList();
    }

    public async Task<IReadOnlyList<InternalWorkforceEmployeeSnapshotDto>> SearchActiveAsync(
        DateTime asOf,
        string term,
        int limit,
        CancellationToken cancellationToken)
    {
        var needle = term?.Trim().ToLowerInvariant() ?? string.Empty;
        if (needle.Length < 2)
        {
            return [];
        }

        var at = Normalize(asOf);
        var take = Math.Clamp(limit, 1, MaxSearchResults);
        var activeEmployeeIds = dbContext.Employments
            .AsNoTracking()
            .Where(e => e.Status == EmploymentStatus.Active
                && e.EffectiveFrom <= at
                && (e.EffectiveTo == null || at < e.EffectiveTo))
            .Select(e => e.EmployeeId);

        var matches = await dbContext.Employees
            .AsNoTracking()
            .Where(employee => activeEmployeeIds.Contains(employee.Id)
                && (employee.FirstName.ToLower().Contains(needle)
                    || employee.LastName.ToLower().Contains(needle)
                    || (employee.PreferredName != null && employee.PreferredName.ToLower().Contains(needle))
                    || (employee.FirstName + " " + employee.LastName).ToLower().Contains(needle)))
            .OrderBy(employee => employee.FirstName)
            .ThenBy(employee => employee.LastName)
            .Select(employee => employee.Id)
            .Take(take)
            .ToListAsync(cancellationToken);

        if (matches.Count == 0)
        {
            return [];
        }

        var snapshots = await BuildSnapshotsAsync(at, matches, cancellationToken);
        return snapshots
            .Where(snapshot => snapshot.IsActive)
            .OrderBy(snapshot => snapshot.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private async Task<IReadOnlyList<InternalWorkforceEmployeeSnapshotDto>> BuildSnapshotsAsync(
        DateTime asOf,
        IReadOnlyCollection<Guid> employeeIds,
        CancellationToken cancellationToken)
    {
        var employees = await dbContext.Employees
            .AsNoTracking()
            .Where(employee => employeeIds.Contains(employee.Id))
            .OrderBy(employee => employee.LastName)
            .ThenBy(employee => employee.FirstName)
            .ToListAsync(cancellationToken);

        if (employees.Count == 0)
        {
            return [];
        }

        // The current employment's start, so consumers can say when someone joined (e.g. after a population was set).
        var employmentStartByEmployee = (await dbContext.Employments
                .AsNoTracking()
                .Where(employment => employeeIds.Contains(employment.EmployeeId)
                    && employment.Status == EmploymentStatus.Active
                    && employment.EffectiveFrom <= asOf
                    && (employment.EffectiveTo == null || asOf < employment.EffectiveTo))
                .Select(employment => new { employment.EmployeeId, employment.EffectiveFrom })
                .ToListAsync(cancellationToken))
            .GroupBy(employment => employment.EmployeeId)
            .ToDictionary(group => group.Key, group => group.Max(employment => employment.EffectiveFrom));
        var activeEmployeeIds = employmentStartByEmployee.Keys.ToHashSet();

        var assignments = await dbContext.WorkAssignments
            .AsNoTracking()
            .Where(assignment => employeeIds.Contains(assignment.EmployeeId)
                && assignment.IsPrimary
                && assignment.EffectiveFrom <= asOf
                && (assignment.EffectiveTo == null || asOf < assignment.EffectiveTo))
            .OrderByDescending(assignment => assignment.EffectiveFrom)
            .Select(assignment => new
            {
                assignment.EmployeeId,
                assignment.OrgUnitId,
                assignment.JobTitle
            })
            .ToListAsync(cancellationToken);
        var assignmentByEmployee = assignments
            .GroupBy(assignment => assignment.EmployeeId)
            .ToDictionary(group => group.Key, group => group.First());

        var managerLinks = await dbContext.ManagerRelationships
            .AsNoTracking()
            .Where(relationship => employeeIds.Contains(relationship.SubjectEmployeeId)
                && relationship.Type == ReportingRelationshipType.PrimaryManager
                && relationship.EffectiveFrom <= asOf
                && (relationship.EffectiveTo == null || asOf < relationship.EffectiveTo))
            .OrderByDescending(relationship => relationship.EffectiveFrom)
            .Select(relationship => new
            {
                relationship.SubjectEmployeeId,
                relationship.ManagerEmployeeId
            })
            .ToListAsync(cancellationToken);
        var managerIdByEmployee = managerLinks
            .GroupBy(relationship => relationship.SubjectEmployeeId)
            .ToDictionary(group => group.Key, group => group.First().ManagerEmployeeId);

        var managerIds = managerIdByEmployee.Values.Distinct().ToList();
        var managers = managerIds.Count == 0
            ? new Dictionary<Guid, Employee>()
            : await dbContext.Employees
                .AsNoTracking()
                .Where(employee => managerIds.Contains(employee.Id))
                .ToDictionaryAsync(employee => employee.Id, cancellationToken);
        var activeManagerIds = managerIds.Count == 0
            ? new HashSet<Guid>()
            : (await dbContext.Employments
                .AsNoTracking()
                .Where(employment => managerIds.Contains(employment.EmployeeId)
                    && employment.Status == EmploymentStatus.Active
                    && employment.EffectiveFrom <= asOf
                    && (employment.EffectiveTo == null || asOf < employment.EffectiveTo))
                .Select(employment => employment.EmployeeId)
                .Distinct()
                .ToListAsync(cancellationToken))
                .ToHashSet();

        var orgUnitIds = assignmentByEmployee.Values
            .Select(assignment => assignment.OrgUnitId)
            .Distinct()
            .ToList();
        var orgLookup = orgUnitIds.Count == 0
            ? new Dictionary<Guid, OrgUnit>()
            : await dbContext.OrgUnits
                .AsNoTracking()
                .Where(orgUnit => orgUnitIds.Contains(orgUnit.Id))
                .ToDictionaryAsync(orgUnit => orgUnit.Id, cancellationToken);

        var leaves = await EY.HRPlatform.CoreHR.Features.People.Changes.LeaveReader.CurrentAsync(
            dbContext, employees.Select(employee => employee.Id).ToList(), DateOnly.FromDateTime(DateTime.UtcNow), cancellationToken);
        return employees
            .Select(employee =>
            {
                assignmentByEmployee.TryGetValue(employee.Id, out var assignment);
                managerIdByEmployee.TryGetValue(employee.Id, out var managerId);
                managers.TryGetValue(managerId, out var manager);

                var isActive = activeEmployeeIds.Contains(employee.Id);
                return new InternalWorkforceEmployeeSnapshotDto(
                    employee.Id,
                    employee.StableEmployeeKey,
                    employee.FullName,
                    BuildDisplayName(employee),
                    employee.Email,
                    isActive ? assignment?.JobTitle : null,
                    isActive,
                    isActive
                        && assignment is not null
                        && orgLookup.TryGetValue(assignment.OrgUnitId, out var orgUnit)
                            ? new InternalWorkforceOrgSnapshotDto(orgUnit.Id, orgUnit.Name)
                            : null,
                    isActive
                        && manager is not null
                            ? new InternalWorkforceManagerSnapshotDto(
                                manager.Id,
                                BuildDisplayName(manager),
                                activeManagerIds.Contains(manager.Id))
                            : null,
                    employmentStartByEmployee.TryGetValue(employee.Id, out var started) ? DateOnly.FromDateTime(started) : null,
                    EY.HRPlatform.CoreHR.Features.People.EmployeePhotos.UrlFor(employee.StableEmployeeKey, employee.PhotoKey),
                    leaves.TryGetValue(employee.Id, out var leave) ? leave.WithoutType() : null);
            })
            .ToList();
    }

    private async Task<HashSet<Guid>> ResolveOrgUnitScopeAsync(
        IReadOnlyCollection<Guid> orgUnitIds,
        bool includeDescendants,
        CancellationToken cancellationToken)
    {
        var result = new HashSet<Guid>(orgUnitIds);
        if (!includeDescendants)
        {
            return result;
        }

        var units = await dbContext.OrgUnits
            .AsNoTracking()
            .Select(unit => new { unit.Id, unit.ParentId })
            .ToListAsync(cancellationToken);
        var childrenByParentId = units.ToLookup(unit => unit.ParentId, unit => unit.Id);

        var queue = new Queue<Guid>(orgUnitIds);
        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            foreach (var childId in childrenByParentId[current])
            {
                if (result.Add(childId))
                {
                    queue.Enqueue(childId);
                }
            }
        }

        return result;
    }

    private static string BuildDisplayName(Employee employee)
        => !string.IsNullOrWhiteSpace(employee.PreferredName)
            ? $"{employee.PreferredName} {employee.LastName}"
            : employee.FullName;

    private static DateTime Normalize(DateTime asOf)
        => asOf.Kind switch
        {
            DateTimeKind.Utc => asOf,
            DateTimeKind.Local => asOf.ToUniversalTime(),
            _ => DateTime.SpecifyKind(asOf, DateTimeKind.Utc)
        };
}

using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Workforce.Services;

/// <summary>Core-owned facts resolved for an employee's primary work assignment as of a date.</summary>
public sealed record PrimaryWorkAssignmentSnapshot(
    Guid WorkAssignmentId,
    Guid EmploymentId,
    Guid OrgUnitId,
    string JobTitle,
    string? WorkLocation,
    DateTime EffectiveFrom,
    DateTime? EffectiveTo,
    Guid? JobId = null,
    Guid? PlaceId = null);

/// <summary>Core-owned primary manager fact resolved for an employee as of a date.</summary>
public sealed record PrimaryManagerSnapshot(
    Guid RelationshipId,
    Guid ManagerEmployeeId,
    Guid SubjectWorkAssignmentId,
    Guid ManagerWorkAssignmentId,
    DateTime EffectiveFrom,
    DateTime? EffectiveTo);

/// <summary>
/// Canonical "as of date" resolver over <c>Employment</c>, <c>WorkAssignment</c>, and
/// <c>ManagerRelationship</c>. This is the single read path business decisions use for an
/// employee's employment state, organization, job title, and manager — there is no fallback to
/// legacy <c>Employee</c> fields. All queries run inside the fail-closed tenant query filter.
/// </summary>
public interface IWorkforceCanonicalResolver
{
    Task<Employment?> GetCurrentEmploymentAsync(Guid employeeId, DateTime? asOf, CancellationToken cancellationToken);

    Task<PrimaryWorkAssignmentSnapshot?> GetPrimaryWorkAssignmentAsync(Guid employeeId, DateTime? asOf, CancellationToken cancellationToken);

    Task<PrimaryManagerSnapshot?> GetPrimaryManagerAsync(Guid employeeId, DateTime? asOf, CancellationToken cancellationToken);

    /// <summary>Primary management chain (nearest manager first), cycle-guarded.</summary>
    Task<IReadOnlyList<Guid>> GetManagerChainAsync(Guid employeeId, DateTime? asOf, int maxDepth, CancellationToken cancellationToken);

    /// <summary>Employee ids whose active primary work assignment is in the given org unit.</summary>
    Task<IReadOnlyList<Guid>> GetEmployeeIdsInOrgUnitAsync(Guid orgUnitId, DateTime? asOf, CancellationToken cancellationToken);
}

public sealed class WorkforceCanonicalResolver(
    CoreHRDbContext dbContext,
    WorkforceResolutionScope? resolutionScope = null) : IWorkforceCanonicalResolver
{
    private const int DefaultMaxChainDepth = 50;
    private readonly WorkforceResolutionScope _resolutionScope = resolutionScope ?? new WorkforceResolutionScope();

    public async Task<Employment?> GetCurrentEmploymentAsync(Guid employeeId, DateTime? asOf, CancellationToken cancellationToken)
    {
        var at = Normalize(asOf);
        return await dbContext.Employments
            .AsNoTracking()
            .Where(e => e.EmployeeId == employeeId
                && e.EffectiveFrom <= at
                && (e.EffectiveTo == null || at < e.EffectiveTo))
            .OrderByDescending(e => e.EffectiveFrom)
            .FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<PrimaryWorkAssignmentSnapshot?> GetPrimaryWorkAssignmentAsync(Guid employeeId, DateTime? asOf, CancellationToken cancellationToken)
    {
        var at = Normalize(asOf);
        return await dbContext.WorkAssignments
            .AsNoTracking()
            .Where(w => w.EmployeeId == employeeId
                && w.IsPrimary
                && w.EffectiveFrom <= at
                && (w.EffectiveTo == null || at < w.EffectiveTo))
            .OrderByDescending(w => w.EffectiveFrom)
            .Select(w => new PrimaryWorkAssignmentSnapshot(
                w.Id, w.EmploymentId, w.OrgUnitId, w.JobTitle, w.WorkLocation, w.EffectiveFrom, w.EffectiveTo, w.JobId, w.PlaceId))
            .FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<PrimaryManagerSnapshot?> GetPrimaryManagerAsync(Guid employeeId, DateTime? asOf, CancellationToken cancellationToken)
    {
        var at = Normalize(asOf);
        return await dbContext.ManagerRelationships
            .AsNoTracking()
            .Where(m => m.SubjectEmployeeId == employeeId
                && m.Type == ReportingRelationshipType.PrimaryManager
                && m.EffectiveFrom <= at
                && (m.EffectiveTo == null || at < m.EffectiveTo))
            .OrderByDescending(m => m.EffectiveFrom)
            .Select(m => new PrimaryManagerSnapshot(
                m.Id, m.ManagerEmployeeId, m.SubjectWorkAssignmentId, m.ManagerWorkAssignmentId, m.EffectiveFrom, m.EffectiveTo))
            .FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Guid>> GetManagerChainAsync(Guid employeeId, DateTime? asOf, int maxDepth, CancellationToken cancellationToken)
    {
        // In a preloaded bulk run the tracked graph is authoritative and also holds relationships
        // staged earlier in the same run, so walk it in memory instead of one DB query per level.
        if (_resolutionScope.TrackedGraphOnly)
            return _resolutionScope.GetManagerChain(
                employeeId,
                Normalize(asOf),
                maxDepth > 0 ? maxDepth : DefaultMaxChainDepth);

        var depthLimit = maxDepth > 0 ? maxDepth : DefaultMaxChainDepth;
        var chain = new List<Guid>();
        var visited = new HashSet<Guid> { employeeId };
        var current = employeeId;

        while (chain.Count < depthLimit)
        {
            var manager = await GetPrimaryManagerAsync(current, asOf, cancellationToken);
            if (manager is null)
                break;

            // Cycle guard: stop if a manager has already been seen in this walk.
            if (!visited.Add(manager.ManagerEmployeeId))
                break;

            chain.Add(manager.ManagerEmployeeId);
            current = manager.ManagerEmployeeId;
        }

        return chain;
    }
    public async Task<IReadOnlyList<Guid>> GetEmployeeIdsInOrgUnitAsync(Guid orgUnitId, DateTime? asOf, CancellationToken cancellationToken)
    {
        var at = Normalize(asOf);
        return await dbContext.WorkAssignments
            .AsNoTracking()
            .Where(w => w.OrgUnitId == orgUnitId
                && w.IsPrimary
                && w.EffectiveFrom <= at
                && (w.EffectiveTo == null || at < w.EffectiveTo))
            .Select(w => w.EmployeeId)
            .Distinct()
            .ToListAsync(cancellationToken);
    }

    private static DateTime Normalize(DateTime? asOf)
    {
        if (asOf is null)
            return DateTime.UtcNow;

        return asOf.Value.Kind switch
        {
            DateTimeKind.Utc => asOf.Value,
            DateTimeKind.Local => asOf.Value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(asOf.Value, DateTimeKind.Utc)
        };
    }
}

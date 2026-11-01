using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.CompanyImport;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Setup;

/// <summary>The foundational workforce facts downstream modules depend on, as of today.</summary>
public sealed record CoreHRWorkforceReadinessDto(
    int ActiveEmployees,
    int WithoutCurrentAssignment,
    int AssignedToInactiveUnit,
    int WithInvalidManager,
    int InManagerCycle,
    bool ImportInProgress);

/// <summary>
/// Whether CoreHR holds a trustworthy foundation: a published organization and an active workforce
/// whose assignments and reporting lines are canonical and valid. Derived from live CoreHR only;
/// no setup state is stored anywhere, least of all in an import.
/// </summary>
public sealed record CoreHRReadinessDto(
    bool IsReady,
    OrganizationReadinessDto Organization,
    CoreHRWorkforceReadinessDto Workforce);

public interface ICoreHRReadinessService
{
    Task<CoreHRReadinessDto> GetAsync(CancellationToken cancellationToken);
}

public sealed class CoreHRReadinessService(CoreHRDbContext context, IOrganizationService organization) : ICoreHRReadinessService
{
    public async Task<CoreHRReadinessDto> GetAsync(CancellationToken cancellationToken)
    {
        var organizationReadiness = await organization.GetReadinessAsync(cancellationToken);
        var now = DateTime.UtcNow;
        var today = DateOnly.FromDateTime(now);

        var activeEmployeeIds = (await context.Employments.AsNoTracking()
                .Where(e => e.Status == EmploymentStatus.Active && e.EffectiveFrom <= now && (e.EffectiveTo == null || now < e.EffectiveTo))
                .Select(e => e.EmployeeId)
                .Distinct()
                .ToListAsync(cancellationToken))
            .ToHashSet();

        var assignments = await context.WorkAssignments.AsNoTracking()
            .Where(a => a.IsPrimary && a.EffectiveFrom <= now && (a.EffectiveTo == null || now < a.EffectiveTo))
            .Select(a => new { a.EmployeeId, a.OrgUnitId })
            .ToListAsync(cancellationToken);
        var unitByEmployee = assignments.GroupBy(a => a.EmployeeId).ToDictionary(g => g.Key, g => g.First().OrgUnitId);
        var activeUnitIds = Flatten((await organization.GetHierarchyAsync(today, cancellationToken)).Roots)
            .Select(node => node.Unit.Id).ToHashSet();

        var managerEdges = (await context.ManagerRelationships.AsNoTracking()
                .Where(r => r.Type == ReportingRelationshipType.PrimaryManager && r.EffectiveFrom <= now && (r.EffectiveTo == null || now < r.EffectiveTo))
                .Select(r => new { r.SubjectEmployeeId, r.ManagerEmployeeId })
                .ToListAsync(cancellationToken))
            .Where(r => activeEmployeeIds.Contains(r.SubjectEmployeeId))
            .GroupBy(r => r.SubjectEmployeeId)
            .ToDictionary(g => g.Key, g => g.First().ManagerEmployeeId);

        var withoutAssignment = activeEmployeeIds.Count(id => !unitByEmployee.ContainsKey(id));
        var inactiveUnit = activeEmployeeIds.Count(id => unitByEmployee.TryGetValue(id, out var unit) && !activeUnitIds.Contains(unit));
        var invalidManager = managerEdges.Count(edge => edge.Value == edge.Key || !activeEmployeeIds.Contains(edge.Value));
        var inCycle = CountInCycles(managerEdges);
        var importInProgress = await context.CompanyImportSessions.AsNoTracking()
            .AnyAsync(s => s.Status == CompanyImportStatus.Open || s.Status == CompanyImportStatus.BringingIn, cancellationToken);

        var workforce = new CoreHRWorkforceReadinessDto(
            activeEmployeeIds.Count, withoutAssignment, inactiveUnit, invalidManager, inCycle, importInProgress);
        var isReady = organizationReadiness.IsReady
            && workforce.ActiveEmployees > 0
            && withoutAssignment == 0
            && inactiveUnit == 0
            && invalidManager == 0
            && inCycle == 0;
        return new CoreHRReadinessDto(isReady, organizationReadiness, workforce);
    }

    /// <summary>How many people sit on a reporting loop (each follows manager links back to themselves).</summary>
    private static int CountInCycles(IReadOnlyDictionary<Guid, Guid> managerOf)
    {
        var onCycle = new HashSet<Guid>();
        foreach (var start in managerOf.Keys)
        {
            if (onCycle.Contains(start)) continue;
            var path = new List<Guid>();
            var seen = new HashSet<Guid>();
            var current = start;
            while (managerOf.TryGetValue(current, out var next) && seen.Add(current))
            {
                path.Add(current);
                current = next;
            }
            var loopStart = path.IndexOf(current);
            if (loopStart >= 0)
                foreach (var member in path.Skip(loopStart)) onCycle.Add(member);
        }
        return onCycle.Count;
    }

    private static IEnumerable<OrganizationHierarchyNodeDto> Flatten(IEnumerable<OrganizationHierarchyNodeDto> nodes)
    {
        foreach (var node in nodes)
        {
            yield return node;
            foreach (var child in Flatten(node.Children)) yield return child;
        }
    }
}

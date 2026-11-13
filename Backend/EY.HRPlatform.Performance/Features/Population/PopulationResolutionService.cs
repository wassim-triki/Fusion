using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Infrastructure.Core;

namespace EY.HRPlatform.Performance.Features.Population;

/// <summary>
/// Resolves a Cycle's population authoritatively on the backend: it reads Core workforce truth
/// through the signed internal snapshot contract (all-active-as-of / by-scope / resolve),
/// applies the stored rule's inclusions/exclusions, and derives readiness. The frontend only
/// sends selected OrgUnit ids and descendant intent — it never computes eligibility or builds
/// the roster.
/// </summary>
public sealed class PopulationResolutionService(ICoreWorkforceClient workforceClient)
{
    public async Task<PopulationResolution> ResolveAsync(
        PerformanceCycle cycle,
        PopulationDefinition definition,
        CancellationToken cancellationToken)
    {
        var asOf = cycle.StartDate.ToDateTime(TimeOnly.MinValue);

        var baseSnapshots = definition.Mode switch
        {
            PopulationMode.AllActive => await workforceClient.GetAllActiveAsOfAsync(asOf, cancellationToken),
            PopulationMode.ByScope => await ResolveByScopeAsync(asOf, definition, cancellationToken),
            _ => [],
        };

        var byEmployee = baseSnapshots.ToDictionary(snapshot => snapshot.EmployeeId);

        // Explicit inclusions may reference employees outside the base scope (or ineligible
        // ones). Resolve them by id so eligibility is judged from real Core truth, letting an
        // inclusion add someone in scope while still rejecting invalid employment/assignment.
        var inclusionIds = definition.Inclusions
            .Select(inclusion => inclusion.EmployeeId)
            .Where(id => !byEmployee.ContainsKey(id))
            .ToList();

        if (inclusionIds.Count > 0)
        {
            foreach (var snapshot in await workforceClient.ResolveAsync(asOf, inclusionIds, cancellationToken))
            {
                byEmployee[snapshot.EmployeeId] = snapshot;
            }
        }

        // A unit rule covers the units under it, so the people's units are read with their ancestors.
        var rules = definition.Rules;
        var ruledUnits = rules.Where(rule => rule.UnitId is not null).Select(rule => rule.UnitId!.Value).ToHashSet();
        var ancestors = new Dictionary<Guid, IReadOnlyList<Guid>>();
        if (ruledUnits.Count > 0)
        {
            var units = byEmployee.Values.Where(s => s.OrgUnit is not null).Select(s => s.OrgUnit!.OrgUnitId).Distinct().ToList();
            foreach (var context in await workforceClient.ResolveOrgUnitsAsync(asOf, units, cancellationToken))
                ancestors[context.OrgUnitId] = context.AncestorOrgUnitIds;
        }
        bool Within(Guid? unit, Guid ruled) => unit is { } own && (own == ruled || (ancestors.GetValueOrDefault(own)?.Contains(ruled) ?? false));

        var candidates = byEmployee.Values
            .Select(snapshot => ToCandidate(snapshot, definition, cycle.StartDate, rules, Within))
            .OrderByDescending(candidate => candidate.CountsToRoster)
            .ThenBy(candidate => candidate.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new PopulationResolution(definition.Mode, definition.EligibilityDate, definition.IsConfirmed, candidates);
    }

    private async Task<IReadOnlyList<WorkforceSnapshot>> ResolveByScopeAsync(
        DateTime asOf,
        PopulationDefinition definition,
        CancellationToken cancellationToken)
    {
        // Core's by-scope takes one descendant flag per call, so group the selected units by
        // their descendant intent and merge (a unit resolved with descendants supersedes the
        // same unit resolved without).
        var withDescendants = definition.OrgUnitSelections
            .Where(selection => selection.IncludeDescendants)
            .Select(selection => selection.OrgUnitId)
            .ToList();
        var withoutDescendants = definition.OrgUnitSelections
            .Where(selection => !selection.IncludeDescendants)
            .Select(selection => selection.OrgUnitId)
            .ToList();

        var merged = new Dictionary<Guid, WorkforceSnapshot>();

        if (withDescendants.Count > 0)
        {
            foreach (var snapshot in await workforceClient.GetByScopeAsync(asOf, withDescendants, includeDescendants: true, cancellationToken))
                merged[snapshot.EmployeeId] = snapshot;
        }

        if (withoutDescendants.Count > 0)
        {
            foreach (var snapshot in await workforceClient.GetByScopeAsync(asOf, withoutDescendants, includeDescendants: false, cancellationToken))
                merged.TryAdd(snapshot.EmployeeId, snapshot);
        }

        return merged.Values.ToList();
    }

    private static PopulationCandidate ToCandidate(WorkforceSnapshot snapshot, PopulationDefinition definition, DateOnly dayOne,
        IReadOnlyList<LeaveOutRule> rules, Func<Guid?, Guid, bool> within)
    {
        var issues = new List<ReadinessIssueCode>();
        if (!snapshot.IsActive) issues.Add(ReadinessIssueCode.InactiveEmployment);
        if (snapshot.OrgUnit is null) issues.Add(ReadinessIssueCode.NoPrimaryAssignment);

        // Reviewer readiness is more than "a manager row exists": the manager must be a real,
        // active person other than the employee themselves. A missing or self-referential
        // manager is treated as no eligible reviewer; an inactive manager is a distinct issue so
        // the surface can name it. Only a valid reviewer's identity is carried on the candidate.
        var manager = snapshot.Manager;
        var isSelfManager = manager is not null && manager.EmployeeId == snapshot.EmployeeId;
        Guid? reviewerId = null;
        string? reviewerName = null;
        var reviewerActive = false;

        if (manager is null || isSelfManager)
        {
            issues.Add(ReadinessIssueCode.MissingManager);
        }
        else
        {
            reviewerId = manager.EmployeeId;
            reviewerName = manager.DisplayName;
            reviewerActive = manager.IsActive;
            if (!manager.IsActive) issues.Add(ReadinessIssueCode.InactiveManager);
        }

        var excluded = definition.IsExcluded(snapshot.EmployeeId);
        var leave = snapshot.Leave;
        var onLeave = leave is not null && leave.From <= dayOne && (leave.Until is null || leave.Until >= dayOne);
        var ruledOut = rules.FirstOrDefault(rule => rule.Kind switch
        {
            LeaveOutRule.EmploymentType => string.Equals(rule.Value, snapshot.EmploymentType, StringComparison.OrdinalIgnoreCase),
            LeaveOutRule.Unit => within(snapshot.OrgUnit?.OrgUnitId, rule.UnitId!.Value),
            LeaveOutRule.StartedAfter => snapshot.EmploymentStart > rule.Date,
            LeaveOutRule.OnLeave => onLeave,
            _ => false,
        });

        return new PopulationCandidate(
            snapshot.EmployeeId,
            snapshot.DisplayName,
            snapshot.JobTitle,
            snapshot.OrgUnit?.OrgUnitId,
            snapshot.OrgUnit?.Name,
            reviewerId,
            reviewerName,
            reviewerActive,
            snapshot.IsActive,
            definition.IsExplicitlyIncluded(snapshot.EmployeeId),
            excluded,
            excluded ? definition.ExclusionReason(snapshot.EmployeeId) : null,
            issues)
        {
            EmploymentType = snapshot.EmploymentType,
            StartedOn = snapshot.EmploymentStart,
            OnLeaveOnDayOne = onLeave,
            LeaveUntil = onLeave ? leave!.Until : null,
            PhotoUrl = snapshot.PhotoUrl,
            RuledOutBy = ruledOut?.ToString(),
            InclusionReason = definition.InclusionReason(snapshot.EmployeeId),
        };
    }
}

using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Progress;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.Progress;
using EY.HRPlatform.Performance.Features.Security;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Goals;

public sealed record GetAlignmentMapQuery(Guid CycleId, GoalActorContext Actor) : IQuery<Result<AlignmentMapDto>>;

/// <summary>
/// The alignment map (D-06): Published company and unit objectives that connect to a company root,
/// with owner-reported status and progress; under each, a count of personal objectives from plans
/// that were put forward, by status. Personal objectives become nodes only through plan visibility
/// (P6), filtered before anything is built. The counts come from a grouped query that never
/// materializes a title, owner or id.
/// </summary>
public sealed class GetAlignmentMapHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, PerformanceViewer? caller = null)
    : IQueryHandler<GetAlignmentMapQuery, Result<AlignmentMapDto>>
{
    public async Task<Result<AlignmentMapDto>> Handle(GetAlignmentMapQuery request, CancellationToken cancellationToken)
    {
        var cycle = await db.Cycles.AsNoTracking().FirstOrDefaultAsync(c => c.Id == request.CycleId, cancellationToken);
        if (cycle is null) return Result.Failure<AlignmentMapDto>(PerformanceErrors.NotFound("Cycle", request.CycleId));

        var viewer = await (caller ?? new PerformanceViewer(db, workforce)).ForCycleAsync(cycle, request.Actor, cancellationToken);
        var graph = await GoalsComposer.LoadGraphAsync(db, workforce, cycle, cancellationToken, viewer);

        var direction = graph.All
            .Where(objective => objective.OwnershipScope != ObjectiveOwnershipScope.Employee && IsMappedDirection(objective, graph))
            .ToList();
        var directionIds = direction.Select(objective => objective.Id).ToHashSet();

        // Every put-forward personal objective under the map, whoever owns it: counts by parent and status.
        var counts = await db.Objectives.AsNoTracking()
            .Where(objective => objective.CycleId == cycle.Id
                && objective.OwnershipScope == ObjectiveOwnershipScope.Employee
                && objective.State != ObjectiveLifecycleState.Archived
                && objective.ParentObjectiveId != null
                && directionIds.Contains(objective.ParentObjectiveId.Value)
                && db.EmployeePlans.Any(plan => plan.Id == objective.EmployeePlanId
                    && (plan.State == PlanLifecycleState.Submitted || plan.State == PlanLifecycleState.Approved)))
            .GroupBy(objective => new { Parent = objective.ParentObjectiveId!.Value, objective.CurrentStatus })
            .Select(group => new { group.Key.Parent, group.Key.CurrentStatus, Count = group.Count() })
            .ToListAsync(cancellationToken);

        // The ones this viewer may read: the graph already holds only readable personal objectives.
        var personal = graph.All
            .Where(objective => objective.OwnershipScope == ObjectiveOwnershipScope.Employee
                && objective.State != ObjectiveLifecycleState.Archived
                && objective.ParentObjectiveId is Guid parentId && directionIds.Contains(parentId)
                && objective.EmployeePlanId is Guid planId
                && graph.EmployeePlansById.TryGetValue(planId, out var plan)
                && plan.State is PlanLifecycleState.Submitted or PlanLifecycleState.Approved)
            .ToList();
        var readableByParent = personal.GroupBy(objective => objective.ParentObjectiveId!.Value)
            .ToDictionary(group => group.Key, group => group.Count());
        var countsByParent = counts.GroupBy(row => row.Parent).ToDictionary(group => group.Key, group => group.ToList());

        // A company goal reads as the mean of the goals straight under it: its units' goals on the map and every
        // put-forward personal goal under it, whoever may read them (only the figure leaves the server).
        var companyIds = direction.Where(o => o.OwnershipScope == ObjectiveOwnershipScope.Company).Select(o => o.Id).ToHashSet();
        var personalUnderCompany = companyIds.Count == 0 ? [] : await db.Objectives.AsNoTracking()
            .Where(objective => objective.CycleId == cycle.Id
                && objective.OwnershipScope == ObjectiveOwnershipScope.Employee
                && objective.State != ObjectiveLifecycleState.Archived
                && objective.ParentObjectiveId != null
                && companyIds.Contains(objective.ParentObjectiveId.Value)
                && db.EmployeePlans.Any(plan => plan.Id == objective.EmployeePlanId
                    && (plan.State == PlanLifecycleState.Submitted || plan.State == PlanLifecycleState.Approved)))
            .ToListAsync(cancellationToken);
        var underCompany = direction.Where(o => o.ParentObjectiveId is Guid p && companyIds.Contains(p))
            .Concat(personalUnderCompany)
            .ToLookup(o => o.ParentObjectiveId!.Value);

        var lined = direction.Concat(personal).Concat(personalUnderCompany).DistinctBy(o => o.Id).ToList();
        var lines = await ProgressComposer.LinesAsync(db, lined, cancellationToken);

        var nodes = new List<AlignmentMapNodeDto>(direction.Count + personal.Count);
        foreach (var objective in direction
            .OrderBy(o => o.OwnershipScope)
            .ThenBy(o => o.OrgUnitName)
            .ThenBy(o => o.Title))
        {
            var reported = ProgressCalc.For(objective, graph);
            var line = lines[objective.Id];
            var children = underCompany[objective.Id].ToList();
            if (children.Count > 0)
            {
                var progress = children.Select(child => Math.Min(ProgressCalc.For(child, graph).Progress, 100m)).Average();
                reported = new ProgressCalc.Reported(children.Any(child => ProgressCalc.For(child, graph).HasProgress), decimal.Round(progress, 2), null);
                line = MeanLine(children.Select(child => lines[child.Id]).ToList());
            }
            var rows = countsByParent.GetValueOrDefault(objective.Id) ?? [];
            int Count(ObjectiveStatus? status) => rows.Where(row => row.CurrentStatus == status).Sum(row => row.Count);
            var total = rows.Sum(row => row.Count);
            nodes.Add(new AlignmentMapNodeDto(
                objective.Id,
                objective.OwnershipScope == ObjectiveOwnershipScope.Company ? AlignmentMapNodeKind.Company : AlignmentMapNodeKind.OrgUnit,
                objective.ParentObjectiveId is Guid parentId && directionIds.Contains(parentId) ? parentId : null,
                objective.Title,
                objective.OrgUnitName,
                graph.Names.GetValueOrDefault(objective.AccountablePersonId),
                IsOwn(objective, request.Actor),
                objective.CurrentStatus,
                objective.StatusSince,
                reported.HasProgress,
                reported.Progress,
                new PersonalAlignmentDto(
                    total,
                    Count(ObjectiveStatus.OnTrack),
                    Count(ObjectiveStatus.AtRisk),
                    Count(ObjectiveStatus.OffTrack),
                    Count(null),
                    Math.Min(total, readableByParent.GetValueOrDefault(objective.Id))),
                PerformanceMappers.MeasurementSummary(objective),
                objective.OrgUnitId) { Line = line });
        }

        foreach (var objective in personal.OrderByDescending(o => IsOwn(o, request.Actor)).ThenBy(o => o.Title))
        {
            var reported = ProgressCalc.For(objective, graph);
            var plan = objective.EmployeePlanId is Guid planId ? graph.EmployeePlansById.GetValueOrDefault(planId) : null;
            nodes.Add(new AlignmentMapNodeDto(
                objective.Id,
                AlignmentMapNodeKind.Personal,
                objective.ParentObjectiveId,
                objective.Title,
                null,
                graph.Names.GetValueOrDefault(objective.AccountablePersonId),
                IsOwn(objective, request.Actor),
                objective.CurrentStatus,
                objective.StatusSince,
                reported.HasProgress,
                reported.Progress,
                null,
                PerformanceMappers.MeasurementSummary(objective))
            {
                // Someone's history is theirs, their reviewer's and administrators' (named detail).
                Line = ObjectivePolicy.CanReadProgressHistory(viewer, objective, plan) ? lines[objective.Id] : [],
            });
        }

        return Result.Success(new AlignmentMapDto(cycle.Id, nodes));
    }

    /// <summary>The mean of several lines: at each of their updates, every line's latest value so far (0 before its first).</summary>
    private static IReadOnlyList<ProgressPointDto> MeanLine(IReadOnlyList<IReadOnlyList<ProgressPointDto>> children)
    {
        var at = children.SelectMany(line => line).Select(point => point.At).Distinct().Order().ToList();
        return at.Select(day => new ProgressPointDto(day, decimal.Round(children
                .Select(line => Math.Min(line.LastOrDefault(point => point.At <= day)?.Progress ?? 0m, 100m))
                .Average(), 2)))
            .ToList();
    }

    /// <summary>Published, and every ancestor up to a company root is Published and on the map too.</summary>
    private static bool IsMappedDirection(Objective objective, GoalsComposer.Graph graph)
    {
        var current = objective;
        var guard = new HashSet<Guid>();
        while (guard.Add(current.Id))
        {
            if (current.State != ObjectiveLifecycleState.Published || current.OwnershipScope == ObjectiveOwnershipScope.Employee)
                return false;
            if (current.OwnershipScope == ObjectiveOwnershipScope.Company) return true;
            if (current.ParentObjectiveId is not Guid parentId || !graph.ById.TryGetValue(parentId, out current!))
                return false;
        }
        return false;
    }

    private static bool IsOwn(Objective objective, GoalActorContext actor)
        => actor.CallerEmployeeId != Guid.Empty && objective.AccountablePersonId == actor.CallerEmployeeId;
}

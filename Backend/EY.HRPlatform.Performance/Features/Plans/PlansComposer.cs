using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Security;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Features.Goals;
using EY.HRPlatform.Performance.Features.Progress;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Plans;

/// <summary>
/// The caller's contextual authorization inputs for plan actions, resolved once by the controller
/// from the token. Self-identity gates authoring; the responsible-manager relationship gates review
/// and approval; tenant administration gates the governed exceptional approval (design Decision 2).
/// </summary>
/// <summary>One participant's plan standing; see <see cref="PlansComposer.Classify"/>.</summary>
public sealed record PlanStanding(RosterPlanStatus Status, bool HasProgress, int OverdueObjectiveCount);

public sealed record PlanActorContext(Guid CallerEmployeeId, bool IsAdmin, bool CanReviewReports)
{
    /// <summary>The same caller as objective and plan visibility decisions see them.</summary>
    public GoalActorContext ToGoalActor() => new(CallerEmployeeId, IsAdmin, HasOrgManageGrant: false, CanReviewReports);
}

/// <summary>
/// Builds the employee-plan surfaces from the cycle's objective graph and the plan aggregate, and
/// holds the plan authorization + submission-fact helpers. The objective graph is loaded once so the
/// plan objectives, their upstream direction paths, and the alignable targets read from consistent
/// in-memory state. Alignment (a support relationship up to strategic direction) is resolved from the
/// objective graph; the plan aggregate owns only lifecycle, weights invariant, and the agreement trail.
/// </summary>
public static class PlansComposer
{
    public static async Task<EmployeePlanDto> BuildPlanAsync(
        PerformanceDbContext db,
        ICoreWorkforceClient workforce,
        PerformanceCycle cycle,
        EmployeePlan plan,
        PlanAlignmentPolicy alignmentPolicy,
        PlanActorContext actor,
        CancellationToken cancellationToken)
    {
        var graph = await GoalsComposer.LoadGraphAsync(db, workforce, cycle, cancellationToken, new CycleViewer(actor.ToGoalActor(), null));
        var dto = BuildPlan(cycle, plan, graph, alignmentPolicy, actor);
        if (plan.ResponsibleManagerId is null) return dto;

        var reviewer = await db.Participants.AsNoTracking()
            .Where(p => p.Id == plan.ParticipantId)
            .Select(p => new { p.ReviewerBasis, p.ReviewerAsOf })
            .FirstOrDefaultAsync(cancellationToken);
        return reviewer is null
            ? dto
            : dto with { ResponsibleReviewerBasis = reviewer.ReviewerBasis, ResponsibleReviewerAsOf = reviewer.ReviewerAsOf };
    }

    public static EmployeePlanDto BuildPlan(
        PerformanceCycle cycle,
        EmployeePlan plan,
        GoalsComposer.Graph graph,
        PlanAlignmentPolicy alignmentPolicy,
        PlanActorContext actor)
    {
        var planObjectiveEntities = graph.All.Where(o => o.EmployeePlanId == plan.Id).ToList();
        var isSelf0 = plan.EmployeeId == actor.CallerEmployeeId;
        var canUpdateProgress = plan.State == PlanLifecycleState.Approved && isSelf0 && cycle.IsActive;

        var objectives = planObjectiveEntities
            .OrderBy(o => o.IsAligned ? 0 : 1)
            .ThenBy(o => o.Title)
            .Select(o => ToPlanObjective(o, graph, canUpdateProgress))
            .ToList();

        var planProgress = ProgressCalc.PlanProgress(planObjectiveEntities);

        var readiness = BuildReadiness(plan, graph, alignmentPolicy);

        var history = plan.Decisions
            .OrderBy(d => d.DecidedAt)
            .Select(d => new PlanDecisionDto(d.Kind, d.ActorEmployeeId, ActorName(plan, graph, d.ActorEmployeeId), d.Feedback, d.DecidedAt)
            {
                ChangeRequests = d.ChangeRequests.OrderBy(r => r.ObjectiveTitle).Select(r =>
                {
                    var objective = planObjectiveEntities.FirstOrDefault(o => o.Id == r.ObjectiveId);
                    return new PlanChangeRequestDto(r.Id, r.ObjectiveId, objective?.Title ?? r.ObjectiveTitle, r.Text, r.State, r.Reply,
                        r.AddressedAt, objective is null ? null : objective.UpdatedAt > d.DecidedAt);
                }).ToList(),
            })
            .ToList();

        var isSelf = plan.EmployeeId == actor.CallerEmployeeId;
        var cycleOpen = cycle.IsActive;
        var canAuthor = PlanPolicy.CanAuthor(plan, actor) && cycleOpen;
        var canDecide = plan.State == PlanLifecycleState.Submitted && cycleOpen && PlanPolicy.CanDecide(plan, actor);
        var canApproveExceptionally = plan.State == PlanLifecycleState.Submitted && cycleOpen && PlanPolicy.CanApproveExceptionally(actor);

        return new EmployeePlanDto(
            plan.Id,
            cycle.Id,
            cycle.Name,
            cycle.State,
            new PersonRefDto(plan.EmployeeId, plan.EmployeeDisplayName),
            plan.OrgUnitName,
            plan.ResponsibleManagerId is null ? null : new PersonRefDto(plan.ResponsibleManagerId.Value, plan.ResponsibleManagerName),
            plan.State,
            plan.SubmittedAt,
            plan.UpdatedAt ?? plan.CreatedAt,
            plan.ApprovedAt,
            plan.ApprovalKind,
            plan.IsLocked,
            planProgress,
            objectives,
            readiness,
            history,
            CanAuthor: canAuthor,
            CanSubmit: canAuthor && readiness.CanSubmit,
            CanDecide: canDecide,
            CanApproveExceptionally: canApproveExceptionally)
{ Version = plan.Version, IsOwner = isSelf, CanRequestUpdate = PlanPolicy.CanRequestUpdate(actor.ToGoalActor(), plan, cycle),
    Grade = GoalGrades.Plan(planObjectiveEntities),
    ChangesSinceReturn = plan.AnsweredReturn is { } answered
        ? PlanChanges.Since(answered.GoalsSnapshot, planObjectiveEntities.Select(Snapshot).ToList())
            .Select(change => new PlanGoalChangeDto(change.ObjectiveId, change.Title, change.Kind,
                change.Fields.Select(field => new PlanGoalFieldChangeDto(field.Field, field.Before, field.After)).ToList()))
            .ToList()
        : null };
    }

    /// <summary>A goal as a returned plan's snapshot keeps it: what its reviewer reads to see what changed since.</summary>
    public static PlanGoalSnapshot Snapshot(Objective objective)
        => new(objective.Id, objective.Title, PerformanceMappers.MeasurementSummary(objective), objective.PlanWeight);

    /// <summary>Who acted on the plan: from the cycle's names, else the plan's own recorded reviewer and employee.</summary>
    private static string? ActorName(EmployeePlan plan, GoalsComposer.Graph graph, Guid actorId)
        => graph.Names.GetValueOrDefault(actorId)
           ?? (actorId == plan.ResponsibleManagerId ? plan.ResponsibleManagerName
               : actorId == plan.EmployeeId ? plan.EmployeeDisplayName : null);

    public static PlanReadinessDto BuildReadiness(EmployeePlan plan, GoalsComposer.Graph graph, PlanAlignmentPolicy alignmentPolicy)
    {
        var facts = FactsFor(plan, graph, alignmentPolicy);
        var remaining = 100m - facts.WeightTotal;

        var blockers = new List<string>();
        if (facts.ObjectiveCount == 0) blockers.Add("Add at least one objective.");
        if (facts.ObjectiveCount > 0 && !facts.EveryObjectiveHasWeight) blockers.Add("Give every objective a weight.");
        if (facts.ObjectiveCount > 0 && facts.WeightTotal != 100m)
            blockers.Add(remaining > 0 ? $"Assign {Trim(remaining)}% more." : $"Reduce weights by {Trim(-remaining)}%.");
        var openRequests = plan.OpenChangeRequests.Count;
        if (openRequests > 0)
            blockers.Add(openRequests == 1 ? "Address 1 change request." : $"Address {openRequests} change requests.");
        if (facts.ObjectiveCount > 0 && !facts.AlignmentSatisfied)
            blockers.Add(alignmentPolicy == PlanAlignmentPolicy.EveryObjectiveConnected
                ? "Connect every objective to strategic direction."
                : "Connect at least one objective to strategic direction.");

        return new PlanReadinessDto(
            facts.ObjectiveCount,
            facts.WeightTotal,
            remaining,
            facts.EveryObjectiveHasWeight,
            facts.ConnectsToStrategicDirection,
            facts.HasStandaloneObjective,
            facts.StandaloneAllowed,
            CanSubmit: blockers.Count == 0 && facts.ObjectiveCount > 0,
            blockers)
        {
            AlignmentPolicy = alignmentPolicy,
            EveryObjectiveConnectsToStrategicDirection = facts.EveryObjectiveConnectsToStrategicDirection,
            OpenChangeRequests = openRequests,
        };
    }

    /// <summary>The whole-plan submission facts drawn from the plan's objective rows in the graph.</summary>
    public static PlanSubmissionFacts FactsFor(EmployeePlan plan, GoalsComposer.Graph graph, PlanAlignmentPolicy alignmentPolicy)
    {
        var objectives = graph.All.Where(o => o.EmployeePlanId == plan.Id).ToList();
        var weightTotal = objectives.Sum(o => o.PlanWeight ?? 0m);
        return new PlanSubmissionFacts(
            ObjectiveCount: objectives.Count,
            EveryObjectiveHasWeight: objectives.Count > 0 && objectives.All(o => o.PlanWeight is > 0m),
            WeightTotal: weightTotal,
            ConnectsToStrategicDirection: objectives.Any(o => ConnectsToStrategic(o, graph)),
            HasStandaloneObjective: objectives.Any(o => !o.IsAligned),
            AlignmentPolicy: alignmentPolicy,
            EveryObjectiveConnectsToStrategicDirection: objectives.Count > 0 && objectives.All(o => ConnectsToStrategic(o, graph)));
    }

    /// <summary>Published strategic and published organizational objectives an employee objective may align to.</summary>
    public static IReadOnlyList<AlignmentTargetDto> AlignmentTargets(GoalsComposer.Graph graph)
        => graph.All
            .Where(o => (o.OwnershipScope == ObjectiveOwnershipScope.Company || o.OwnershipScope == ObjectiveOwnershipScope.OrgUnit)
                && o.State == ObjectiveLifecycleState.Published)
            .OrderBy(o => o.OwnershipScope)
            .ThenBy(o => o.Title)
            .Select(o => new AlignmentTargetDto(
                o.Id,
                o.OwnershipScope,
                o.Title,
                o.OrgUnitName,
                o.AccountablePersonId,
                graph.Names.GetValueOrDefault(o.AccountablePersonId),
                o.StartDate,
                o.EndDate,
                DirectionPathTo(o, graph)))
            .ToList();

    /// <summary>
    /// One people-roster row: a Cycle participant enriched with their plan's real lifecycle, execution
    /// facts, latest activity, and the caller's actual action authority. A participant with no plan reads
    /// as Not started (never a fabricated Draft); a returned Draft is distinguished from a fresh Draft by
    /// the plan's most recent decision. Decision authority (<c>CanReview</c>) is the responsible-manager
    /// relationship, never the mere fact of roster membership.
    /// </summary>
    public static TeamRosterMemberDto ToRosterMember(
        Participant participant, EmployeePlan? plan, GoalsComposer.Graph graph, PlanActorContext actor, bool cycleOpen,
        DateOnly today)
    {
        if (plan is null)
            return new TeamRosterMemberDto(
                participant.EmployeeId, participant.DisplayName, participant.JobTitle, participant.OrgUnitName,
                PlanId: null, RosterPlanStatus.NotStarted,
                HasProgress: false, PlanProgress: 0m, ObjectiveProgress: [],
                OverdueObjectiveCount: 0, RosterActivityKind.None, ActivityAt: null, CanReview: false, CanView: false);

        var objectives = graph.All.Where(o => o.EmployeePlanId == plan.Id).ToList();
        var standing = Classify(plan, objectives, today);
        var status = standing.Status;
        var hasProgress = standing.HasProgress;

        var (activityKind, activityAt) = ResolveRosterActivity(plan, objectives, status, hasProgress);

        IReadOnlyList<RosterObjectiveProgressDto> objectiveProgress = status == RosterPlanStatus.Approved
            ? objectives
                // The plan's own reading order (aligned first, then by title), so segments line up with it.
                .OrderBy(o => o.IsAligned ? 0 : 1)
                .ThenBy(o => o.Title)
                .Select(o => new RosterObjectiveProgressDto(
                    o.PlanWeight ?? 0m,
                    o.HasProgress ? Math.Min(o.DerivedProgress, 100m) : 0m,
                    o.HasProgress,
                    o.IsAligned,
                    o.Measurement?.Method == MeasurementMethod.WeightedMilestones
                        ? o.Measurement.Milestones
                            .Select(m => new RosterMilestoneSliceDto(
                                m.Weight, m.IsCompleted, !m.IsCompleted && m.DueDate is { } due && due < today))
                            .ToList()
                        : []))
                .ToList()
            : [];

        var overdueObjectives = standing.OverdueObjectiveCount;
        var now = PerformanceClock.UtcNow;
        var withoutRecentUpdate = status == RosterPlanStatus.Approved
            ? objectives.Count(o => o.DerivedProgress < 100m && ExecutionFacts.LacksRecentUpdate(o, plan.ApprovedAt ?? now, now))
            : 0;

        var isResponsibleManager = actor.CanReviewReports
            && plan.ResponsibleManagerId is not null
            && plan.ResponsibleManagerId == actor.CallerEmployeeId;
        var canReview = cycleOpen && plan.State == PlanLifecycleState.Submitted && (isResponsibleManager || actor.IsAdmin);
        // A manager can inspect a plan only once it has been put forward — Submitted, Approved, or returned
        // for changes (a Draft that carries decision history). A never-submitted Draft is the employee's
        // private workspace: there is nothing for the manager to review yet, and the canonical review
        // surface only speaks the submitted/returned/approved states, so exposing it there would mislabel it.
        var canView = PlanPolicy.HasBeenPutForward(plan) && PlanPolicy.CanRead(actor.ToGoalActor(), plan);

        return new TeamRosterMemberDto(
            participant.EmployeeId, participant.DisplayName, participant.JobTitle, participant.OrgUnitName,
            plan.Id, status,
            hasProgress,
            ProgressCalc.PlanProgress(objectives), objectiveProgress, overdueObjectives,
            activityKind, activityAt, canReview, canView, ObjectivesWithoutRecentUpdate: withoutRecentUpdate);
    }

    /// <summary>
    /// Where one participant's plan stands: the single classification the manager roster and the cycle-wide
    /// summary share, so a plan never counts differently on two surfaces. No plan is Not started (never a
    /// fabricated Draft); a returned Draft is told apart by its most recent decision; overdue is only
    /// meaningful once the plan is being executed, and is counted per objective (<see cref="ExecutionFacts"/>).
    /// </summary>
    public static PlanStanding Classify(EmployeePlan? plan, IReadOnlyList<Objective> objectives, DateOnly today)
    {
        if (plan is null)
            return new PlanStanding(RosterPlanStatus.NotStarted, HasProgress: false, OverdueObjectiveCount: 0);

        var isReturnedDraft = plan.State == PlanLifecycleState.Draft
            && plan.Decisions.OrderBy(d => d.DecidedAt).LastOrDefault()?.Kind == PlanDecisionKind.Returned;
        var status = plan.State switch
        {
            PlanLifecycleState.Approved => RosterPlanStatus.Approved,
            PlanLifecycleState.Submitted => RosterPlanStatus.Submitted,
            _ => isReturnedDraft ? RosterPlanStatus.ReturnedForChanges : RosterPlanStatus.Draft,
        };
        var overdue = status == RosterPlanStatus.Approved ? ExecutionFacts.OverdueObjectiveCount(objectives, today) : 0;
        return new PlanStanding(status, objectives.Any(o => o.HasProgress), overdue);
    }

    /// <summary>
    /// The single most-recent meaningful event for the roster's "Latest activity" column, kept as the
    /// distinct concept it is (a submission date is not a progress-update date). An approved plan's
    /// activity is its execution; until progress is first reported, the approval itself is the latest
    /// event. A submission after a return reads as a resubmission.
    /// </summary>
    private static (RosterActivityKind Kind, DateTime? At) ResolveRosterActivity(
        EmployeePlan plan, IReadOnlyList<Objective> objectives, RosterPlanStatus status, bool hasProgress)
        => status switch
        {
            RosterPlanStatus.Submitted => (
                plan.Decisions.Any(d => d.Kind == PlanDecisionKind.Returned)
                    ? RosterActivityKind.Resubmitted
                    : RosterActivityKind.Submitted,
                plan.SubmittedAt),
            RosterPlanStatus.ReturnedForChanges => (RosterActivityKind.Returned, plan.Decisions
                .Where(d => d.Kind == PlanDecisionKind.Returned)
                .OrderBy(d => d.DecidedAt)
                .Select(d => (DateTime?)d.DecidedAt)
                .LastOrDefault()),
            RosterPlanStatus.Approved => hasProgress
                ? (RosterActivityKind.ProgressUpdated, objectives.Where(o => o.LastCheckInAt is not null).Max(o => o.LastCheckInAt))
                : (RosterActivityKind.Approved, plan.Decisions
                    .Where(d => d.Kind is PlanDecisionKind.Approved or PlanDecisionKind.ApprovedExceptionally)
                    .Select(d => (DateTime?)d.DecidedAt)
                    .Max()),
            _ => (RosterActivityKind.DraftUpdated, plan.UpdatedAt ?? plan.CreatedAt),
        };

    // ── Authorization helpers ────────────────────────────────────────────────

    /// <summary>Authoring is the plan's own employee while the plan is Draft.</summary>
    public static bool CanAuthor(EmployeePlan plan, PlanActorContext actor) => PlanPolicy.CanAuthor(plan, actor);
    public static bool CanDecide(EmployeePlan plan, PlanActorContext actor) => PlanPolicy.CanDecide(plan, actor);

    private static PlanObjectiveDto ToPlanObjective(Objective objective, GoalsComposer.Graph graph, bool canUpdateProgress)
        => new(
            objective.Id,
            objective.Title,
            objective.Description,
            objective.ParentObjectiveId is Guid parent && graph.ById.ContainsKey(parent) ? parent : null,
            DirectionPathTo(objective, graph, includeSelf: false),
            objective.IsAligned,
            objective.StartDate,
            objective.EndDate,
            objective.ProgressSource,
            PerformanceMappers.MeasurementSummary(objective),
            PerformanceMappers.ToDtoOrNull(objective.Measurement),
            objective.PlanWeight,
            objective.HasProgress,
            decimal.Round(objective.DerivedProgress, 2),
            objective.CurrentPercentage,
            objective.CurrentActual,
            objective.LastProgressAt,
            canUpdateProgress)
        {
            Version = objective.Version,
            Status = objective.CurrentStatus,
            StatusReportedAt = objective.StatusReportedAt,
            PlanWeightIsSet = objective.PlanWeightIsSet,
            Grade = GoalGrades.Of(objective),
        };

    private static bool ConnectsToStrategic(Objective objective, GoalsComposer.Graph graph)
    {
        var current = objective.ParentObjectiveId;
        var guard = 0;
        while (current is not null && guard++ < 100)
        {
            if (!graph.ById.TryGetValue(current.Value, out var ancestor)) return false;
            if (ancestor.OwnershipScope == ObjectiveOwnershipScope.Company) return true;
            current = ancestor.ParentObjectiveId;
        }
        return false;
    }

    /// <summary>Readable direction labels from the top strategic objective down to the objective's parent (or itself).</summary>
    private static IReadOnlyList<string> DirectionPathTo(Objective objective, GoalsComposer.Graph graph, bool includeSelf = true)
    {
        var chain = new List<string>();
        var current = includeSelf ? (Guid?)objective.Id : objective.ParentObjectiveId;
        var guard = 0;
        while (current is not null && guard++ < 100)
        {
            if (!graph.ById.TryGetValue(current.Value, out var node)) break;
            chain.Add(node.Title);
            current = node.ParentObjectiveId;
        }
        chain.Reverse();
        return chain;
    }

    private static string Trim(decimal value)
        => value.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture);
}

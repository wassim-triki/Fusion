using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Progress;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Features.Work;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Identity;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Plans;

/// <summary>A goal on the Team page's tree: whose it is, how it's measured, where it stands.</summary>
public sealed record TeamYearGoalDto(Guid ObjectiveId, Guid OwnerEmployeeId, string OwnerName, string Title, string Measure,
    decimal? Current, decimal Progress, ObjectiveStatus? Status);

/// <summary>
/// One of the manager's goals (a unit goal they're accountable for, or their own plan's) with the team's goals under it,
/// and the goal it supports in turn.
/// </summary>
public sealed record TeamYearBranchDto(TeamYearGoalDto Goal, string? Supports, IReadOnlyList<TeamYearGoalDto> Team);

/// <summary>One goal of a person's plan as their bar draws it: its share of the plan, how far along, its state.</summary>
public sealed record TeamYearPersonGoalDto(decimal Weight, decimal Progress, ObjectiveStatus? Status);

/// <summary>
/// One report's year: their plan's goals once put forward, the one thing they need from the viewer (the viewer's own Home
/// work item about them, answered the same way), and their next 1:1 with the viewer.
/// </summary>
public sealed record TeamYearPersonDto(Guid EmployeeId, string Name, string? JobTitle, string StableEmployeeKey, string? PhotoUrl,
    RosterPlanStatus PlanStatus, IReadOnlyList<TeamYearPersonGoalDto> Goals, FusionWorkItemDto? Due, DateTime? NextOneOnOneAt)
{
    /// <summary>The latest progress update on any of their goals once the plan runs.</summary>
    public DateTime? LastUpdateAt { get; init; }
}

/// <summary>
/// The Team page's Performance tab (D-79): the manager's goals with the team's under each, then each person's year.
/// <see cref="Elsewhere"/> names the people whose goals support other goals than the manager's.
/// </summary>
public sealed record TeamYearDto(Guid CycleId, IReadOnlyList<TeamYearBranchDto> Branches, IReadOnlyList<string> Elsewhere,
    IReadOnlyList<TeamYearPersonDto> People);

public sealed record GetTeamYearQuery(Guid CycleId, WorkActor Actor) : IQuery<Result<TeamYearDto>>;

/// <summary>
/// The caller's team is Core HR's: their direct reports today (B-383: never "no one reports to you" while people do).
/// A plan shows once its owner put it forward; a private draft stays the owner's.
/// </summary>
public sealed class GetTeamYearHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, INotificationAudienceClient? audience = null)
    : IQueryHandler<GetTeamYearQuery, Result<TeamYearDto>>
{
    /// <summary>Which of the viewer's work items about a person comes first, when there are several.</summary>
    private static readonly string[] DueOrder = ["plan-decision", "goals-off-track", "manager-assessment", "one-on-one-book"];

    public async Task<Result<TeamYearDto>> Handle(GetTeamYearQuery query, CancellationToken token)
    {
        var cycle = await db.Cycles.AsNoTracking().FirstOrDefaultAsync(c => c.Id == query.CycleId && c.State != Domain.Cycles.CycleLifecycleState.Draft, token);
        if (cycle is null) return Result.Failure<TeamYearDto>(PerformanceErrors.NotFound("Cycle", query.CycleId));
        var me = query.Actor.EmployeeId;
        var empty = new TeamYearDto(cycle.Id, [], [], []);
        if (me == Guid.Empty) return Result.Success(empty);

        IReadOnlyList<WorkforceSnapshot> reports;
        try { reports = (await workforce.GetDirectReportsAsync(PerformanceClock.UtcNow, [me], token)).Where(r => r.IsActive && r.EmployeeId != me).ToList(); }
        catch (HttpRequestException) { return Result.Failure<TeamYearDto>(PerformanceErrors.CoreUnavailable()); }
        if (reports.Count == 0) return Result.Success(empty);

        var ids = reports.Select(r => r.EmployeeId).ToList();
        var plans = await db.EmployeePlans.AsNoTracking().Include(p => p.Decisions)
            .Where(p => p.CycleId == cycle.Id && (p.EmployeeId == me || ids.Contains(p.EmployeeId))).ToListAsync(token);
        // A never-submitted draft is the owner's alone.
        var visible = plans.Where(p => p.EmployeeId == me || PlanPolicy.HasBeenPutForward(p)).ToList();
        var planIds = visible.Select(p => p.Id).ToList();
        var goals = await db.Objectives.AsNoTracking().Include(o => o.Measurement)
            .Where(o => o.EmployeePlanId != null && planIds.Contains(o.EmployeePlanId.Value) && o.State != ObjectiveLifecycleState.Archived)
            .ToListAsync(token);
        var byPlan = goals.GroupBy(o => o.EmployeePlanId!.Value).ToDictionary(g => g.Key, g => g.OrderBy(o => o.CreatedAt).ToList());
        var names = reports.ToDictionary(r => r.EmployeeId, r => r.DisplayName);

        // The tree: the manager's goals (the unit goals they're accountable for, then their own plan's), each with the
        // team's goals that support it.
        var mine = visible.FirstOrDefault(p => p.EmployeeId == me);
        var accountable = await db.Objectives.AsNoTracking().Include(o => o.Measurement)
            .Where(o => o.CycleId == cycle.Id && o.EmployeePlanId == null && o.AccountablePersonId == me
                && o.State == ObjectiveLifecycleState.Published)
            .OrderBy(o => o.Title).ToListAsync(token);
        var mineGoals = accountable.Concat(mine is null ? [] : byPlan.GetValueOrDefault(mine.Id) ?? []).ToList();
        var parentIds = mineGoals.Where(g => g.ParentObjectiveId != null).Select(g => g.ParentObjectiveId!.Value).ToList();
        var parents = await db.Objectives.AsNoTracking().Where(o => parentIds.Contains(o.Id)).ToDictionaryAsync(o => o.Id, o => o.Title, token);
        var teamGoals = visible.Where(p => p.EmployeeId != me)
            .SelectMany(p => (byPlan.GetValueOrDefault(p.Id) ?? []).Select(goal => (Goal: goal, Owner: p.EmployeeId))).ToList();
        var branches = mineGoals
            .Select(goal => new TeamYearBranchDto(Goal(goal, me, "You"),
                goal.ParentObjectiveId is Guid parent ? parents.GetValueOrDefault(parent) : null,
                teamGoals.Where(g => g.Goal.ParentObjectiveId == goal.Id)
                    .Select(g => Goal(g.Goal, g.Owner, names.GetValueOrDefault(g.Owner) ?? "")).OrderBy(g => g.OwnerName).ToList()))
            .Where(branch => branch.Team.Count > 0).ToList();
        var under = branches.SelectMany(b => b.Team).Select(g => g.OwnerEmployeeId).ToHashSet();
        var elsewhere = reports.Where(r => !under.Contains(r.EmployeeId) && teamGoals.Any(g => g.Owner == r.EmployeeId))
            .Select(r => r.DisplayName).OrderBy(n => n).ToList();

        // Each person's one thing due is the viewer's own Home work about them.
        var work = await new GetWorkItemsHandler(db, workforce, audience).Handle(new GetWorkItemsQuery(query.Actor), token);
        var due = (work.IsSuccess ? work.Value : [])
            .Where(item => item.Subject?.EmployeeId is not null)
            .GroupBy(item => item.Subject!.EmployeeId!.Value)
            .ToDictionary(g => g.Key, g => g.OrderBy(item => Array.IndexOf(DueOrder, item.Kind) is var at && at < 0 ? DueOrder.Length : at).First());
        var next = (await (from meeting in db.OneOnOneMeetings.AsNoTracking()
                           join series in db.OneOnOneSeries.AsNoTracking() on meeting.SeriesId equals series.Id
                           where series.ManagerEmployeeId == me && series.EndedAt == null && ids.Contains(series.ReportEmployeeId)
                                 && meeting.State == OneOnOneMeetingState.Upcoming
                           select new { series.ReportEmployeeId, meeting.ScheduledAt }).ToListAsync(token))
            .GroupBy(m => m.ReportEmployeeId).ToDictionary(g => g.Key, g => g.Min(m => m.ScheduledAt));

        var people = reports.Select(report =>
            {
                var plan = visible.FirstOrDefault(p => p.EmployeeId == report.EmployeeId);
                var own = plan is null ? [] : byPlan.GetValueOrDefault(plan.Id) ?? [];
                var approved = plan?.State == PlanLifecycleState.Approved;
                var even = own.Count == 0 ? 0m : 100m / own.Count;
                return new TeamYearPersonDto(report.EmployeeId, report.DisplayName, report.JobTitle, report.StableEmployeeKey, report.PhotoUrl,
                    Status(plan),
                    own.Select(g => new TeamYearPersonGoalDto(g.PlanWeight ?? even, approved ? Math.Min(g.DerivedProgress, 100m) : 0m,
                        approved ? g.CurrentStatus : null)).ToList(),
                    due.GetValueOrDefault(report.EmployeeId),
                    next.TryGetValue(report.EmployeeId, out var at) ? at : null)
                {
                    LastUpdateAt = approved ? own.Max(g => g.LastProgressAt) : null,
                };
            })
            .OrderBy(p => p.Due is null).ThenBy(p => p.Name).ToList();
        return Result.Success(new TeamYearDto(cycle.Id, branches, elsewhere, people));
    }

    private static TeamYearGoalDto Goal(Objective goal, Guid owner, string ownerName)
        => new(goal.Id, owner, ownerName, goal.Title, PerformanceMappers.MeasurementSummary(goal), goal.CurrentActual,
            Math.Min(goal.DerivedProgress, 100m), goal.CurrentStatus);

    private static RosterPlanStatus Status(EmployeePlan? plan) => plan?.State switch
    {
        null => RosterPlanStatus.NotStarted,
        PlanLifecycleState.Approved => RosterPlanStatus.Approved,
        PlanLifecycleState.Submitted => RosterPlanStatus.Submitted,
        _ => plan.Decisions.Any(d => d.Kind == PlanDecisionKind.Returned) ? RosterPlanStatus.ReturnedForChanges : RosterPlanStatus.Draft,
    };
}

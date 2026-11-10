using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.Goals;
using EY.HRPlatform.Performance.Features.Security;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Plans;

public sealed record GetYourPeopleQuery(
    Guid CycleId, PlanActorContext Actor, YourPeopleFilter Filter, string? Search, int Page, int PageSize)
    : IQuery<Result<YourPeoplePageDto>>;

/// <summary>
/// Your People as a server projection (performance-team-workspace): the server owns responsibility,
/// standing, execution facts, ordering, filtering and paging, so every view and count agrees.
/// </summary>
public static class YourPeople
{
    public const int DefaultPageSize = 25;
    public const int MaxPageSize = 100;

    // Action required first, then plans in execution, then everyone still planning.
    private static int Rank(TeamRosterMemberDto m) => m.CanReview ? 0 : m.Status switch
    {
        RosterPlanStatus.Submitted => 1,
        RosterPlanStatus.Approved => 2,
        RosterPlanStatus.ReturnedForChanges => 3,
        RosterPlanStatus.Draft => 4,
        _ => 5,
    };

    public static TeamStandingDto Standing(IReadOnlyCollection<TeamRosterMemberDto> members, DateTime now)
    {
        var approved = members.Where(m => m.Status == RosterPlanStatus.Approved).ToArray();
        return new TeamStandingDto(
            members.Count,
            members.Count(m => m.Status == RosterPlanStatus.NotStarted),
            members.Count(m => m.Status == RosterPlanStatus.Draft),
            members.Count(m => m.Status == RosterPlanStatus.ReturnedForChanges),
            members.Count(m => m.Status == RosterPlanStatus.Submitted),
            approved.Length,
            approved.Count(m => m.HasProgress),
            approved.Count(m => m.OverdueObjectiveCount > 0),
            approved.Count(m => m.ObjectivesWithoutRecentUpdate > 0),
            members.Count(m => m.ActivityKind != RosterActivityKind.None && m.ActivityAt >= now.AddDays(-7)));
    }

    public static bool Matches(TeamRosterMemberDto m, YourPeopleFilter filter) => filter switch
    {
        YourPeopleFilter.NeedsReview => m.CanReview,
        YourPeopleFilter.Planning => m.Status is RosterPlanStatus.NotStarted or RosterPlanStatus.Draft or RosterPlanStatus.ReturnedForChanges,
        YourPeopleFilter.Approved => m.Status == RosterPlanStatus.Approved,
        YourPeopleFilter.NoProgress => m.Status == RosterPlanStatus.Approved && !m.HasProgress,
        _ => true,
    };

    public static IOrderedEnumerable<TeamRosterMemberDto> Ordered(IEnumerable<TeamRosterMemberDto> members)
        => members.OrderBy(Rank).ThenBy(m => m.EmployeeName, StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Everyone the caller is responsible for in the Cycle: participants who report to them, plus anyone
    /// whose plan they are the recorded reviewer of (a reorg after submission must not drop a review they
    /// own). Administration does not widen it. A never-submitted Draft stays private: its standing and
    /// allocated weight are scalar projections, never its content.
    /// </summary>
    public static async Task<List<TeamRosterMemberDto>> LoadMembersAsync(
        PerformanceDbContext db, ICoreWorkforceClient workforce, PerformanceCycle cycle, PlanActorContext actor,
        CancellationToken cancellationToken, Guid? activeReviewRoundId = null)
    {
        var caller = actor.CallerEmployeeId;
        var plans = await PlanPolicy.Readable(db.EmployeePlans.AsNoTracking().Include(p => p.Decisions)
            .Where(p => p.CycleId == cycle.Id && p.ResponsibleManagerId == caller), actor.ToGoalActor())
            .ToListAsync(cancellationToken);
        var privateDrafts = await db.EmployeePlans.AsNoTracking()
            .Where(p => p.CycleId == cycle.Id && p.ResponsibleManagerId == caller
                && p.State == PlanLifecycleState.Draft && !p.Decisions.Any())
            .Select(p => new { p.EmployeeId, p.Id, ActivityAt = p.UpdatedAt ?? p.CreatedAt })
            .ToListAsync(cancellationToken);
        var draftByEmployee = privateDrafts.ToDictionary(p => p.EmployeeId);
        var planByEmployee = plans.GroupBy(p => p.EmployeeId).ToDictionary(g => g.Key, g => g.First());

        var planIds = plans.Select(p => p.Id).Concat(privateDrafts.Select(p => p.Id)).ToList();
        var allocated = await db.Objectives.AsNoTracking()
            .Where(o => o.EmployeePlanId != null && planIds.Contains(o.EmployeePlanId.Value)
                && o.State != ObjectiveLifecycleState.Archived)
            .GroupBy(o => o.EmployeePlanId!.Value)
            .Select(g => new { PlanId = g.Key, Weight = g.Sum(o => o.PlanWeight ?? 0m) })
            .ToDictionaryAsync(x => x.PlanId, x => x.Weight, cancellationToken);

        var reviewedEmployees = plans.Select(p => p.EmployeeId).Concat(privateDrafts.Select(p => p.EmployeeId)).Distinct().ToList();
        var participants = await db.Participants.AsNoTracking()
            .Where(p => p.CycleId == cycle.Id
                && (p.ManagerEmployeeId == caller || reviewedEmployees.Contains(p.EmployeeId)))
            .ToListAsync(cancellationToken);

        var graph = await GoalsComposer.LoadGraphAsync(db, workforce, cycle, cancellationToken, new CycleViewer(actor.ToGoalActor(), null));
        var today = PerformanceClock.Today;

        var requests = await (from request in db.UpdateRequests.AsNoTracking()
                              where request.CycleId == cycle.Id && request.RequestedByEmployeeId == caller
                              join objective in db.Objectives.AsNoTracking() on request.ObjectiveId equals objective.Id into targets
                              from objective in targets.DefaultIfEmpty()
                              select new { request.PlanId, Dto = new RosterUpdateRequestDto(request.Id, request.State,
                                  objective == null ? null : objective.Title, request.RequestedAt, request.SatisfiedAt, request.Version) })
            .ToListAsync(cancellationToken);
        var latestRequest = requests.GroupBy(item => item.PlanId)
            .ToDictionary(group => group.Key, group => group.OrderByDescending(item => item.Dto.RequestedAt).First().Dto);

        var roster = participants
            .Select(p => PlansComposer.ToRosterMember(
                p, planByEmployee.GetValueOrDefault(p.EmployeeId), graph, actor, cycle.IsActive, today))
            .Select(member => member.Status == RosterPlanStatus.NotStarted && draftByEmployee.TryGetValue(member.EmployeeId, out var draft)
                ? member with { PlanId = draft.Id, Status = RosterPlanStatus.Draft, ActivityKind = RosterActivityKind.DraftUpdated, ActivityAt = draft.ActivityAt }
                : member)
            .Select(member => member.PlanId is { } planId && member.Status != RosterPlanStatus.Approved
                ? member with { AllocatedWeight = allocated.GetValueOrDefault(planId) }
                : member)
            .Select(member => member.PlanId is { } planId && latestRequest.TryGetValue(planId, out var request)
                ? member with { UpdateRequest = request }
                : member)
            .Select(member => planByEmployee.GetValueOrDefault(member.EmployeeId) is { } approved
                && PlanPolicy.CanRequestUpdate(actor.ToGoalActor(), approved, cycle)
                ? member with { CanRequestUpdate = true }
                : member)
            .ToList();

        if (activeReviewRoundId is { } roundId && caller != Guid.Empty)
        {
            var reviewByEmployee = await ReviewPolicy.Readable(db.PerformanceReviews.AsNoTracking(),
                    new ReviewActor(caller, actor.IsAdmin, CanReviewReports: actor.CanReviewReports))
                .Where(review => review.ReviewRoundId == roundId && review.ReviewerEmployeeId == caller)
                .Select(review => new { review.SubjectEmployeeId, Dto = new RosterReviewDto(review.Id, review.State, review.CurrentStageDueDate) })
                .ToDictionaryAsync(item => item.SubjectEmployeeId, item => item.Dto, cancellationToken);
            roster = roster.Select(member => reviewByEmployee.TryGetValue(member.EmployeeId, out var review)
                ? member with { Review = review }
                : member).ToList();
        }

        // Leave shows beside the plan; Performance pauses nothing for it.
        var leave = (await workforce.ResolveAsync(PerformanceClock.UtcNow, roster.Select(member => member.EmployeeId).ToList(), cancellationToken))
            .Where(snapshot => snapshot.Leave is not null)
            .ToDictionary(snapshot => snapshot.EmployeeId, snapshot => snapshot.Leave);
        return roster.Select(member => leave.TryGetValue(member.EmployeeId, out var away) ? member with { Leave = away } : member).ToList();
    }
}

public sealed class GetYourPeopleHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, ITenantContext tenant)
    : PlanHandlerBase(db, workforce, tenant), IQueryHandler<GetYourPeopleQuery, Result<YourPeoplePageDto>>
{
    public async Task<Result<YourPeoplePageDto>> Handle(GetYourPeopleQuery request, CancellationToken cancellationToken)
    {
        var cycle = await Db.Cycles.AsNoTracking().FirstOrDefaultAsync(c => c.Id == request.CycleId, cancellationToken);
        if (cycle is null) return Result.Failure<YourPeoplePageDto>(PerformanceErrors.NotFound("Cycle", request.CycleId));

        var activeRound = await Db.ReviewRounds.AsNoTracking()
            .Where(round => round.CycleId == cycle.Id && round.State == ReviewRoundState.Active)
            .FirstOrDefaultAsync(cancellationToken);
        var me = request.Actor.CallerEmployeeId;
        // Recorded responsibility only, and never the caller themselves, even when someone else reviews them.
        var loaded = (await YourPeople.LoadMembersAsync(Db, Workforce, cycle, request.Actor, cancellationToken, activeRound?.Id))
            .Where(m => m.EmployeeId != me).ToList();
        var phase = TeamPhaseFacts.PhaseOf(await Cycles.YearPhases.ComputeAsync(Db, cycle, cancellationToken), activeRound);
        var composed = await TeamPhaseFacts.ComposeAsync(Db, cycle, me, phase, activeRound, loaded, cancellationToken);
        var members = composed.Members;
        var groups = TeamPhaseFacts.Groups[phase];

        var search = request.Search?.Trim();
        var searched = string.IsNullOrEmpty(search)
            ? members
            : members.Where(m => $"{m.EmployeeName} {m.JobTitle}".Contains(search, StringComparison.OrdinalIgnoreCase)).ToList();

        var matching = searched.Where(m => YourPeople.Matches(m, request.Filter))
            .OrderBy(m => Array.IndexOf(groups, m.Group))
            .ThenBy(m => phase == TeamPhaseFacts.Execution ? TeamPhaseFacts.Severity(m) : 0)
            // Waiting plans: the oldest submission first; everyone else by name.
            .ThenBy(m => phase == TeamPhaseFacts.Planning && m.Group == "waiting" ? m.ActivityAt ?? DateTime.MaxValue : DateTime.MinValue)
            .ThenBy(m => m.EmployeeName, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var pageSize = Math.Clamp(request.PageSize, 1, YourPeople.MaxPageSize);
        var page = Math.Max(1, request.Page);
        var items = matching.Skip((page - 1) * pageSize).Take(pageSize).ToList();

        int Count(YourPeopleFilter f) => searched.Count(m => YourPeople.Matches(m, f));
        return Result.Success(new YourPeoplePageDto(
            cycle.Id, activeRound is not null, items, page, pageSize, matching.Count, members.Count,
            new YourPeopleCountsDto(
                Count(YourPeopleFilter.NeedsReview), Count(YourPeopleFilter.Planning),
                Count(YourPeopleFilter.Approved), Count(YourPeopleFilter.NoProgress)),
            YourPeople.Standing(members, PerformanceClock.UtcNow),
            phase,
            groups.Select(g => new RosterGroupCountDto(g, members.Count(m => m.Group == g))).Where(g => g.Count > 0).ToList(),
            composed.Summary));
    }
}

public sealed record GetTeamResultsQuery(Guid CycleId, PlanActorContext Actor) : IQuery<Result<TeamResultsDto>>;

/// <summary>
/// The released results of the caller's own recorded team (performance-team-workspace, D-R2): final levels with the
/// people at each, acknowledgement, calibration changes and open development goals. Only reviews the caller is the
/// recorded reviewer of, only once released, never the caller's own; empty before release. No averages.
/// </summary>
public sealed class GetTeamResultsHandler(PerformanceDbContext db) : IQueryHandler<GetTeamResultsQuery, Result<TeamResultsDto>>
{
    public async Task<Result<TeamResultsDto>> Handle(GetTeamResultsQuery request, CancellationToken cancellationToken)
    {
        if (!await db.Cycles.AsNoTracking().AnyAsync(c => c.Id == request.CycleId, cancellationToken))
            return Result.Failure<TeamResultsDto>(PerformanceErrors.NotFound("Cycle", request.CycleId));
        var me = request.Actor.CallerEmployeeId;
        if (me == Guid.Empty)
            return Result.Success(new TeamResultsDto(request.CycleId, 0, null, [], 0, [], [], 0));

        var released = await TeamPhaseFacts.ReleasedAsync(db, request.CycleId, me, cancellationToken);
        if (released.Count == 0)
            return Result.Success(new TeamResultsDto(request.CycleId, 0, null, [], 0, [], [], 0));

        var scale = released.OrderByDescending(r => r.FinalizedAt).First().Scale;
        var values = scale.Select(l => (l.Value, l.Label))
            .Concat(released.Select(r => (Value: r.FinalRating, r.Label))).DistinctBy(l => l.Value).OrderBy(l => l.Value);
        var openGoals = await TeamPhaseFacts.OpenGoalsAsync(db, request.CycleId, released.Select(r => r.SubjectEmployeeId).ToList(), cancellationToken);
        return Result.Success(new TeamResultsDto(
            request.CycleId,
            released.Count,
            released.Max(r => r.FinalizedAt),
            values.Select(level =>
            {
                var people = released.Where(r => r.FinalRating == level.Value).OrderBy(r => r.SubjectDisplayName)
                    .Select(r => new TeamResultPersonDto(r.SubjectEmployeeId, r.SubjectDisplayName)).ToList();
                return new TeamResultLevelDto(level.Value, level.Label, people.Count, people);
            }).ToList(),
            released.Count(r => r.AcknowledgedAt is not null),
            released.Where(r => r.AcknowledgedAt is null).Select(r => r.SubjectDisplayName).OrderBy(n => n).ToList(),
            released.Where(r => r.CalibrationChangedRating && r.ManagerRating is int from && from != r.FinalRating)
                .OrderBy(r => r.SubjectDisplayName)
                .Select(r => new TeamCalibrationChangeDto(r.SubjectEmployeeId, r.SubjectDisplayName, r.ManagerRating!.Value, r.FinalRating)).ToList(),
            openGoals.Values.Sum()));
    }
}

using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.Reviews;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Infrastructure.Audit;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Cycles;

/// <summary>The year for one viewer: administrators see the company, a manager their people, anyone else themselves.</summary>
public sealed record GetYearQuery(Guid CycleId, CycleVisibilityActor Actor) : IQuery<Result<YearDto>>;

/// <summary>The dry run (D-58): what moving the year on would do, for whom. Administrators only.</summary>
public sealed record PreviewYearMoveQuery(Guid CycleId, CycleVisibilityActor Actor) : IQuery<Result<YearDto>>;

/// <summary>Moves the year on to <see cref="To"/> as previewed. Administrators only.</summary>
public sealed record MoveYearOnCommand(Guid CycleId, CyclePhase To, uint ExpectedVersion, CycleVisibilityActor Actor) : ICommand<Result<YearDto>>;

/// <summary>Nudges people toward their next step in the year (D-49): administrators anyone, a manager their own people.</summary>
public sealed record NudgeCommand(Guid CycleId, IReadOnlyList<Guid> EmployeeIds, CycleVisibilityActor Actor) : ICommand<Result<NudgeResultDto>>;

/// <summary>Where each person stands in the year, read from their plan, updates and review.</summary>
public static class YearStandings
{
    public const string NotStarted = "notStarted";
    public const string Drafting = "drafting";
    public const string Submitted = "submitted";
    public const string Returned = "returned";
    public const string Updated = "updated";
    public const string Quiet = "quiet";
    public const string SelfReview = "selfReview";
    public const string WithManager = "withManager";
    public const string Calibration = "calibration";
    public const string Released = "released";
    public const string Acknowledged = "acknowledged";
    public const string Closed = "closed";

    public const int RecentDays = 30;
    public const int CompanyFaces = 12;

    public sealed record Person(Guid EmployeeId, string Name, string? UnitName, Guid? ManagerEmployeeId, string? ManagerName,
        CyclePhase Step, string Standing, DateTime? Since, Guid? ReviewId);

    /// <summary>Every participant's step and standing: the furthest step they reached, whatever the year's phase.</summary>
    public static async Task<List<Person>> LoadAsync(PerformanceDbContext db, Guid cycleId, DateTime now, CancellationToken token)
    {
        var participants = await db.Participants.AsNoTracking().Where(p => p.CycleId == cycleId)
            .OrderBy(p => p.DisplayName)
            .Select(p => new { p.EmployeeId, p.DisplayName, p.OrgUnitName, p.ManagerEmployeeId, p.ManagerDisplayName })
            .ToListAsync(token);
        var plans = await db.EmployeePlans.AsNoTracking().Where(p => p.CycleId == cycleId)
            .Select(p => new
            {
                p.EmployeeId, p.State, p.SubmittedAt, p.ApprovedAt, p.UpdatedAt,
                Returned = p.Decisions.OrderByDescending(d => d.DecidedAt).Select(d => (PlanDecisionKind?)d.Kind).FirstOrDefault() == PlanDecisionKind.Returned,
            })
            .ToDictionaryAsync(p => p.EmployeeId, token);
        var recent = now.AddDays(-RecentDays);
        var updates = await db.ProgressUpdates.AsNoTracking().Where(u => u.CycleId == cycleId)
            .GroupBy(u => u.AuthorEmployeeId)
            .Select(g => new { EmployeeId = g.Key, Last = g.Max(u => u.RecordedAt) })
            .ToDictionaryAsync(g => g.EmployeeId, g => g.Last, token);
        var reviews = await db.PerformanceReviews.AsNoTracking().Where(r => r.CycleId == cycleId)
            .Select(r => new { r.Id, r.SubjectEmployeeId, r.State, r.UpdatedAt, r.FinalizedAt, r.AcknowledgedAt, r.OpenedAt })
            .ToListAsync(token);
        var reviewBySubject = reviews.GroupBy(r => r.SubjectEmployeeId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.OpenedAt).First());

        var people = new List<Person>(participants.Count);
        foreach (var p in participants)
        {
            CyclePhase step; string standing; DateTime? since = null; Guid? reviewId = null;
            if (reviewBySubject.TryGetValue(p.EmployeeId, out var review))
            {
                reviewId = review.Id;
                switch (review.State)
                {
                    case PerformanceReviewState.Finalized:
                        step = CyclePhase.ResultsOut;
                        standing = review.AcknowledgedAt is null ? Released : Acknowledged;
                        since = review.AcknowledgedAt ?? review.FinalizedAt;
                        break;
                    case PerformanceReviewState.Closed:
                        step = CyclePhase.ResultsOut; standing = Closed; since = review.UpdatedAt; break;
                    case PerformanceReviewState.SelfAssessment:
                        step = CyclePhase.Review; standing = SelfReview; since = review.OpenedAt; break;
                    case PerformanceReviewState.ManagerAssessment:
                        step = CyclePhase.Review; standing = WithManager; since = review.UpdatedAt; break;
                    default:
                        step = CyclePhase.Review; standing = Calibration; since = review.UpdatedAt; break;
                }
            }
            else if (plans.TryGetValue(p.EmployeeId, out var plan) && plan.State == PlanLifecycleState.Approved)
            {
                step = CyclePhase.Execution;
                var last = updates.GetValueOrDefault(p.EmployeeId);
                standing = last >= recent ? Updated : Quiet;
                since = last == default ? plan.ApprovedAt : last;
            }
            else
            {
                step = CyclePhase.Planning;
                if (plan is null) { standing = NotStarted; }
                else if (plan.State == PlanLifecycleState.Submitted) { standing = Submitted; since = plan.SubmittedAt; }
                else if (plan.Returned) { standing = Returned; since = plan.UpdatedAt; }
                else { standing = Drafting; since = plan.UpdatedAt; }
            }
            people.Add(new Person(p.EmployeeId, p.DisplayName, p.OrgUnitName, p.ManagerEmployeeId, p.ManagerDisplayName, step, standing, since, reviewId));
        }
        return people;
    }

    public static YearPersonDto ToDto(Person person) => new(person.EmployeeId, person.Name, person.UnitName, person.Standing, person.Since);
}

/// <summary>Builds <see cref="YearDto"/>: the steps on their dates, the people in each within the viewer's scope, HR's next move.</summary>
public static class YearComposer
{
    public const string ScopeCompany = "Company";
    public const string ScopeTeam = "Team";
    public const string ScopeYou = "You";

    public const string MoveClosePlanning = "closePlanning";
    public const string MoveLaunchRound = "launchRound";
    public const string MoveRelease = "release";

    public const string BlockerNotStarted = "yearNotStarted";
    public const string BlockerNoDraftRound = "noDraftRound";
    public const string BlockerNothingReady = "nothingReady";

    public static async Task<YearDto> ComposeAsync(PerformanceDbContext db, PerformanceCycle cycle, CycleVisibilityActor actor,
        CancellationToken token)
    {
        var today = PerformanceClock.Today;
        var now = PerformanceClock.UtcNow;
        var evidence = await YearPhases.EvidenceAsync(db, cycle.Id, token);
        var phase = YearPhase.Of(cycle, today, evidence);
        var everyone = await YearStandings.LoadAsync(db, cycle.Id, now, token);

        var (scope, people) = actor.IsAdministrator ? (ScopeCompany, everyone)
            : everyone.Any(p => p.ManagerEmployeeId == actor.EmployeeId)
                ? (ScopeTeam, everyone.Where(p => p.ManagerEmployeeId == actor.EmployeeId || p.EmployeeId == actor.EmployeeId).ToList())
                : (ScopeYou, everyone.Where(p => p.EmployeeId == actor.EmployeeId).ToList());

        var rounds = await db.ReviewRounds.AsNoTracking().Where(r => r.CycleId == cycle.Id && r.LaunchedAt != null)
            .Select(r => r.LaunchedAt!.Value).ToListAsync(token);
        var firstRelease = await db.PerformanceReviews.AsNoTracking()
            .Where(r => r.CycleId == cycle.Id && r.State == PerformanceReviewState.Finalized)
            .MinAsync(r => (DateTime?)r.FinalizedAt, token);
        var steps = Steps(cycle, phase, today, rounds.Count == 0 ? null : DateOnly.FromDateTime(rounds.Min()),
            firstRelease is null ? null : DateOnly.FromDateTime(firstRelease.Value), people, scope == ScopeCompany);

        var move = actor.IsAdministrator && phase is not null ? await NextMoveAsync(db, cycle, phase.Value, today, everyone, token) : null;
        return new YearDto(cycle.Id, cycle.Name, cycle.StartDate, cycle.EndDate, today, cycle.State, phase, cycle.PlanningClosedOn,
            scope, people.Count, steps, move, cycle.Version);
    }

    /// <summary>
    /// The four steps on the calendar: Planning to the deadline; Execution to the day before the round launched (estimated:
    /// the last month before the year's end); Review to the day before results went out (estimated: the last week);
    /// Results out to the year's end.
    /// </summary>
    public static IReadOnlyList<YearStepDto> Steps(PerformanceCycle cycle, CyclePhase? phase, DateOnly today, DateOnly? launched,
        DateOnly? released, IReadOnlyList<YearStandings.Person> people, bool capFaces)
    {
        var planningEnd = Clamp(cycle.PlanningDeadline, cycle.StartDate, cycle.EndDate);
        var reviewStart = Clamp(launched ?? cycle.EndDate.AddDays(-29), planningEnd.AddDays(1), cycle.EndDate);
        var resultsStart = Clamp(released ?? cycle.EndDate.AddDays(-6), reviewStart.AddDays(1), cycle.EndDate);
        var spans = new (CyclePhase Phase, DateOnly Start, DateOnly End, bool Estimated)[]
        {
            (CyclePhase.Planning, cycle.StartDate, planningEnd, false),
            (CyclePhase.Execution, planningEnd.AddDays(1), reviewStart.AddDays(-1), launched is null),
            (CyclePhase.Review, reviewStart, resultsStart.AddDays(-1), released is null),
            (CyclePhase.ResultsOut, resultsStart, cycle.EndDate, released is null),
        };
        return spans.Select(s =>
        {
            var inStep = people.Where(p => p.Step == s.Phase).ToList();
            var faces = capFaces ? inStep.Take(YearStandings.CompanyFaces) : inStep;
            var standings = inStep.GroupBy(p => p.Standing).Select(g => new YearStandingCountDto(g.Key, g.Count())).ToList();
            var state = phase is null ? (cycle.IsClosed ? YearStepState.Done : YearStepState.Ahead)
                : s.Phase < phase ? YearStepState.Done : s.Phase == phase ? YearStepState.Current : YearStepState.Ahead;
            return new YearStepDto(s.Phase, s.Start, s.End < s.Start ? s.Start : s.End, s.Estimated, state, inStep.Count,
                faces.Select(YearStandings.ToDto).ToList(), standings);
        }).ToList();
    }

    private static DateOnly Clamp(DateOnly value, DateOnly min, DateOnly max) => value < min ? min : value > max ? max : value;

    /// <summary>What HR's next move is from this phase, and who it changes for.</summary>
    public static async Task<YearMoveDto?> NextMoveAsync(PerformanceDbContext db, PerformanceCycle cycle, CyclePhase phase, DateOnly today,
        IReadOnlyList<YearStandings.Person> everyone, CancellationToken token)
    {
        switch (phase)
        {
            case CyclePhase.Planning:
            {
                // Planning closes for whoever has no approved plan yet; their drafts stay theirs to finish.
                var affected = everyone.Where(p => p.Step == CyclePhase.Planning).Select(YearStandings.ToDto).ToList();
                var canMove = today >= cycle.StartDate;
                return new YearMoveDto(phase, CyclePhase.Execution, MoveClosePlanning, canMove, canMove ? null : BlockerNotStarted,
                    null, today, affected.Count, affected);
            }
            case CyclePhase.Execution:
            {
                // The year moves to Review by launching the round drafted for it; the self-review opens for its people.
                var draft = await db.ReviewRounds.AsNoTracking()
                    .Where(r => r.CycleId == cycle.Id && r.State == ReviewRoundState.Draft)
                    .OrderByDescending(r => r.CreatedAt).FirstOrDefaultAsync(token);
                var affected = everyone.Where(p => p.Step <= CyclePhase.Execution).Select(YearStandings.ToDto).ToList();
                return new YearMoveDto(phase, CyclePhase.Review, MoveLaunchRound, draft is not null, draft is null ? BlockerNoDraftRound : null,
                    draft?.Id, null, affected.Count, affected);
            }
            case CyclePhase.Review:
            {
                // Results go out for whatever is ready (D-35); reviews still being written are left for later.
                var round = await db.ReviewRounds.AsNoTracking()
                    .FirstOrDefaultAsync(r => r.CycleId == cycle.Id && r.State == ReviewRoundState.Active, token);
                var readyIds = round is null ? []
                    : await db.PerformanceReviews.AsNoTracking()
                        .Where(r => r.ReviewRoundId == round.Id && r.State == PerformanceReviewState.ReadyToFinalize)
                        .Select(r => r.SubjectEmployeeId).ToListAsync(token);
                var affected = everyone.Where(p => readyIds.Contains(p.EmployeeId)).Select(YearStandings.ToDto).ToList();
                var canMove = round is not null && affected.Count > 0;
                return new YearMoveDto(phase, CyclePhase.ResultsOut, MoveRelease, canMove, canMove ? null : BlockerNothingReady,
                    round?.Id, null, affected.Count, affected);
            }
            default:
                return null;
        }
    }
}

public sealed class GetYearHandler(PerformanceDbContext db) : IQueryHandler<GetYearQuery, Result<YearDto>>
{
    public async Task<Result<YearDto>> Handle(GetYearQuery request, CancellationToken token)
    {
        var cycle = await CyclePolicy.Visible(db.Cycles.AsNoTracking(), db.Participants.AsNoTracking(), db.PerformanceReviews.AsNoTracking(), request.Actor)
            .FirstOrDefaultAsync(c => c.Id == request.CycleId, token);
        if (cycle is null) return Result.Failure<YearDto>(PerformanceErrors.NotFound("Cycle", request.CycleId));
        return await YearComposer.ComposeAsync(db, cycle, request.Actor, token);
    }
}

public sealed class PreviewYearMoveHandler(PerformanceDbContext db) : IQueryHandler<PreviewYearMoveQuery, Result<YearDto>>
{
    public async Task<Result<YearDto>> Handle(PreviewYearMoveQuery request, CancellationToken token)
    {
        var cycle = await db.Cycles.AsNoTracking().FirstOrDefaultAsync(c => c.Id == request.CycleId, token);
        if (cycle is null) return Result.Failure<YearDto>(PerformanceErrors.NotFound("Cycle", request.CycleId));
        if (!cycle.IsActive)
            return Result.Failure<YearDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.CycleNotActive, "Only an Active year moves on."));
        return await YearComposer.ComposeAsync(db, cycle, request.Actor, token);
    }
}

/// <summary>
/// Moves the year on as previewed: closing planning is the year's own move; Review and Results out go through the
/// round's launch and release, so the year never says something the round didn't do.
/// </summary>
public sealed class MoveYearOnHandler(PerformanceDbContext db, IPerformanceAudit audit, ISender sender)
    : ICommandHandler<MoveYearOnCommand, Result<YearDto>>
{
    public async Task<Result<YearDto>> Handle(MoveYearOnCommand command, CancellationToken token)
    {
        var cycle = await db.Cycles.FirstOrDefaultAsync(c => c.Id == command.CycleId, token);
        if (cycle is null) return Result.Failure<YearDto>(PerformanceErrors.NotFound("Cycle", command.CycleId));
        if (!cycle.IsActive)
            return Result.Failure<YearDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.CycleNotActive, "Only an Active year moves on."));
        if (VersionGuard.Check(cycle, command.ExpectedVersion) is { } stale)
            return Result.Failure<YearDto>(stale);

        var today = PerformanceClock.Today;
        var phase = YearPhase.Of(cycle, today, await YearPhases.EvidenceAsync(db, cycle.Id, token))!.Value;
        var everyone = await YearStandings.LoadAsync(db, cycle.Id, PerformanceClock.UtcNow, token);
        var move = await YearComposer.NextMoveAsync(db, cycle, phase, today, everyone, token);
        if (move is null || move.To != command.To)
            return Result.Failure<YearDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.CycleNotMovable,
                move is null ? "The year is at its last step." : $"The year is in {phase}; its next step is {move.To}."));
        if (!move.CanMove)
            return Result.Failure<YearDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.CycleNotMovable, Reason(move.Blocker!)));

        switch (move.Kind)
        {
            case YearComposer.MoveClosePlanning:
                var before = cycle.PlanningDeadline;
                cycle.ClosePlanning(today);
                audit.Record(cycle.TenantId, "Cycle", cycle.Id, cycle.Id, PerformanceAuditActions.CyclePlanningClosed,
                    new { before = new { planningDeadline = before }, after = new { planningDeadline = cycle.PlanningDeadline, cycle.PlanningClosedOn }, affected = move.Affected });
                await db.SaveChangesAsync(token);
                break;
            case YearComposer.MoveLaunchRound:
                var launched = await sender.Send(new LaunchReviewRoundCommand(move.RoundId!.Value, await RoundVersionAsync(move.RoundId.Value, token)), token);
                if (launched.IsFailure) return Result.Failure<YearDto>(launched.Error);
                break;
            default:
                var released = await sender.Send(new FinalizeReviewRoundCommand(move.RoundId!.Value, await RoundVersionAsync(move.RoundId.Value, token),
                    null, command.Actor.EmployeeId), token);
                if (released.IsFailure) return Result.Failure<YearDto>(released.Error);
                break;
        }

        var moved = await db.Cycles.AsNoTracking().FirstAsync(c => c.Id == cycle.Id, token);
        return await YearComposer.ComposeAsync(db, moved, command.Actor, token);
    }

    private Task<uint> RoundVersionAsync(Guid roundId, CancellationToken token)
        => db.ReviewRounds.AsNoTracking().Where(r => r.Id == roundId).Select(r => r.Version).FirstAsync(token);

    private static string Reason(string blocker) => blocker switch
    {
        YearComposer.BlockerNotStarted => "The year has not started yet.",
        YearComposer.BlockerNoDraftRound => "Draft a review round first; launching it moves the year to Review.",
        _ => "No review is ready to release yet.",
    };
}

/// <summary>
/// A nudge tells one person what the year waits on from them, opening where to act. Whoever holds the step gets it: the
/// person for their plan, update, self-review or acknowledgement; their manager for a plan or review waiting on them.
/// </summary>
public sealed class NudgeHandler(PerformanceDbContext db, IPerformanceAudit audit, IPerformanceNotifications notifications)
    : ICommandHandler<NudgeCommand, Result<NudgeResultDto>>
{
    public async Task<Result<NudgeResultDto>> Handle(NudgeCommand command, CancellationToken token)
    {
        var cycle = await CyclePolicy.Visible(db.Cycles.AsNoTracking(), db.Participants.AsNoTracking(), db.PerformanceReviews.AsNoTracking(), command.Actor)
            .FirstOrDefaultAsync(c => c.Id == command.CycleId, token);
        if (cycle is null) return Result.Failure<NudgeResultDto>(PerformanceErrors.NotFound("Cycle", command.CycleId));
        if (command.EmployeeIds is not { Count: > 0 and <= 200 })
            return Result.Failure<NudgeResultDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.CycleInvalid, "Choose up to 200 people to nudge."));

        var everyone = await YearStandings.LoadAsync(db, cycle.Id, PerformanceClock.UtcNow, token);
        var reach = everyone.Where(p => command.Actor.IsAdministrator || p.ManagerEmployeeId == command.Actor.EmployeeId)
            .ToDictionary(p => p.EmployeeId);
        var me = command.Actor.EmployeeId;
        var actorName = everyone.FirstOrDefault(p => p.EmployeeId == me)?.Name
            ?? everyone.FirstOrDefault(p => p.ManagerEmployeeId == me)?.ManagerName
            ?? "HR";

        var nudged = 0;
        var skipped = new List<Guid>();
        var nudgeId = Guid.NewGuid();
        foreach (var employeeId in command.EmployeeIds.Distinct())
        {
            if (employeeId == me || !reach.TryGetValue(employeeId, out var person) || Target(cycle.Id, person) is not { } target
                || target.Recipient == me)
            {
                skipped.Add(employeeId);
                continue;
            }
            notifications.EnqueueYearNudge(cycle.TenantId, cycle.Id, target.Recipient, me, actorName, target.StepKey, target.Path, nudgeId);
            audit.Record(cycle.TenantId, "Cycle", cycle.Id, cycle.Id, PerformanceAuditActions.YearNudged,
                new { about = person.EmployeeId, to = target.Recipient, step = target.StepKey, person.Standing });
            nudged++;
        }
        await db.SaveChangesAsync(token);
        return new NudgeResultDto(nudged, skipped);
    }

    private sealed record NudgeTarget(Guid Recipient, string StepKey, string Path);

    private static NudgeTarget? Target(Guid cycleId, YearStandings.Person person) => person.Standing switch
    {
        YearStandings.NotStarted or YearStandings.Drafting or YearStandings.Returned
            => new(person.EmployeeId, "plan", $"/performance/plan?cycle={cycleId}"),
        YearStandings.Submitted when person.ManagerEmployeeId is Guid manager
            => new(manager, "approve", PerformanceNotificationTemplates.TeamPath),
        YearStandings.Quiet => new(person.EmployeeId, "progress", $"/performance/plan?cycle={cycleId}"),
        YearStandings.SelfReview => new(person.EmployeeId, "selfReview", PerformanceNotificationTemplates.ReviewPath(person.ReviewId!.Value)),
        YearStandings.WithManager when person.ManagerEmployeeId is Guid manager
            => new(manager, "review", PerformanceNotificationTemplates.ReviewPath(person.ReviewId!.Value)),
        YearStandings.Released => new(person.EmployeeId, "acknowledge", PerformanceNotificationTemplates.ReviewPath(person.ReviewId!.Value)),
        _ => null,
    };
}

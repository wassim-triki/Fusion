using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Calibration;
using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.Reviews;
using EY.HRPlatform.Performance.Infrastructure.Audit;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Calibration;

// ----- Contracts -----

public sealed record CalibrationLevelDto(int Value, string Label);
public sealed record CalibrationFaceDto(Guid EmployeeId, string Name);
public sealed record CalibrationGroupDto(int Count, IReadOnlyList<CalibrationFaceDto> People);
/// <summary>Why a review is flagged, as facts: the goals' grade; the manager's and everyone's averages; or last year's rating.</summary>
public sealed record CalibrationFlagDto(string Kind, decimal? Grade, decimal? ManagerAverage, int? ManagerReviews, decimal? EveryoneAverage,
    int? EveryoneReviews, int? LastRating, string? LastCycle);
public sealed record CalibrationDecisionDto(int Rating, bool Kept, string? Reason, DateTime At);
/// <summary>A flagged review (D-70): who, who reviewed them, the manager's rating and words, why it's flagged, the decision if any.</summary>
public sealed record CalibrationCardDto(Guid ReviewId, Guid EmployeeId, string Name, string? JobTitle, Guid ReviewerEmployeeId, string ReviewerName,
    int Rating, CalibrationFlagDto Flag, string? Words, CalibrationDecisionDto? Decision, uint Version);
/// <summary>
/// The round's calibration as a calibrator sees it: reviews still being written, ready (as rated or looked at), to look
/// at, released; and the flagged ones not yet released. A calibrator's own review is never in it.
/// </summary>
public sealed record CalibrationDto(Guid RoundId, Guid CycleId, string RoundName, string CycleName, IReadOnlyList<CalibrationLevelDto> Scale,
    int BandLowTop, int BandMidTop, CalibrationGroupDto Writing, CalibrationGroupDto Ready, CalibrationGroupDto ToLookAt, int Released,
    IReadOnlyList<CalibrationCardDto> Flagged, bool CanRelease);

/// <summary>One person in the full view (D-71): their rating now, the manager's, their goals' grade (null without an approved plan).</summary>
public sealed record CalibrationPersonDto(Guid ReviewId, Guid EmployeeId, string Name, string ReviewerName, int Rating, int OriginalRating,
    decimal? Grade, bool Flagged, bool Decided, bool Released, uint Version);
public sealed record CalibrationSpreadDto(int Value, int Count, int LastYear);
public sealed record CalibrationEveryoneDto(IReadOnlyList<CalibrationPersonDto> People, IReadOnlyList<CalibrationSpreadDto> Spread, string? LastCycleName);

public sealed record CalibrationSubjectDto(Guid ReviewId, int Rating, CalibrationDecisionDto? Decision, bool Released, uint Version);

public sealed record GetCalibrationQuery(Guid RoundId, CalibratorIdentity Actor, bool HasGrant, bool CanRelease) : IQuery<Result<CalibrationDto>>;
public sealed record GetCalibrationEveryoneQuery(Guid RoundId, CalibratorIdentity Actor, bool HasGrant) : IQuery<Result<CalibrationEveryoneDto>>;
public sealed record DecideCalibrationCommand(Guid RoundId, Guid ReviewId, CalibratorIdentity Actor, int Rating, string? Reason, uint ExpectedVersion,
    bool HasGrant) : ICommand<Result<CalibrationSubjectDto>>;
public sealed record UndoCalibrationDecisionCommand(Guid RoundId, Guid ReviewId, CalibratorIdentity Actor, uint ExpectedVersion, bool HasGrant)
    : ICommand<Result<CalibrationSubjectDto>>;
public sealed record CalibrationDecisionRequest(int Rating, string? Reason, uint ExpectedVersion);

// ----- The round's calibration state -----

/// <summary>
/// Everything calibration knows about a round, loaded once: its reviews, their subjects, the goals' grades, last results
/// and the flags. Ready means released as is: no flag, or a decision taken (D-35). Shared by calibration, release and the
/// Year page, so they never disagree about what is ready.
/// </summary>
internal sealed class CalibrationState
{
    public required ReviewRound Round { get; init; }
    public required CalibrationSession? Session { get; init; }
    public required IReadOnlyList<RatingScaleLevel> Levels { get; init; }
    public required NineBoxBands Bands { get; init; }
    public required IReadOnlyList<PerformanceReview> Reviews { get; init; }
    public required IReadOnlyDictionary<Guid, CalibrationSubject> Subjects { get; init; }
    public required IReadOnlyDictionary<Guid, CalibrationFlag> Flags { get; init; }
    public required IReadOnlyDictionary<Guid, decimal?> Grades { get; init; }

    /// <summary>Results have gone out in this round: whatever becomes ready from now on is released straight away.</summary>
    public bool Released => Reviews.Any(r => r.State == PerformanceReviewState.Finalized);

    public static bool Writing(PerformanceReview r) => r.State is PerformanceReviewState.SelfAssessment or PerformanceReviewState.ManagerAssessment;
    public CalibrationSubject? Subject(PerformanceReview r) => Subjects.GetValueOrDefault(r.Id);
    public bool Flagged(PerformanceReview r) => Flags.ContainsKey(r.Id);
    public bool Decided(PerformanceReview r) => Subject(r)?.IsDecided == true;
    public bool ToLookAt(PerformanceReview r) => r.State == PerformanceReviewState.Calibration && Flagged(r) && !Decided(r);
    public bool Ready(PerformanceReview r) => r.State == PerformanceReviewState.ReadyToFinalize
        || r.State == PerformanceReviewState.Calibration && !ToLookAt(r);
    public int Original(PerformanceReview r) => Subject(r)?.OriginalRating ?? r.ManagerAssessment.OverallRating ?? 0;
    public int Rating(PerformanceReview r) => r.State == PerformanceReviewState.Finalized && r.FinalRating is int final ? final
        : Subject(r)?.CurrentRating ?? Original(r);

    /// <summary>
    /// Loads the round's calibration. <paramref name="reviews"/> are the round's reviews when the caller already holds
    /// them (tracked, about to change); otherwise they are read untracked.
    /// </summary>
    public static async Task<CalibrationState> LoadAsync(PerformanceDbContext db, ReviewRound round, IReadOnlyList<PerformanceReview>? reviews,
        CancellationToken token)
    {
        reviews ??= await db.PerformanceReviews.AsNoTracking().Where(r => r.ReviewRoundId == round.Id).ToListAsync(token);
        var levels = await CalibrationSessions.LevelsAsync(db, round, token);
        var session = await db.CalibrationSessions.AsNoTracking().FirstOrDefaultAsync(s => s.ReviewRoundId == round.Id, token);
        var bands = session?.Bands ?? CalibrationSessions.BandsFor(await db.CycleSettings.AsNoTracking().FirstOrDefaultAsync(token),
            levels.Select(l => l.Value).ToArray());
        var subjects = session is null ? new Dictionary<Guid, CalibrationSubject>()
            : await db.CalibrationSubjects.Where(s => s.SessionId == session.Id).ToDictionaryAsync(s => s.ReviewId, token);
        var arrived = reviews.Where(r => r.ManagerAssessment.OverallRating is not null && !Writing(r) && r.State != PerformanceReviewState.Closed).ToList();
        var employees = arrived.Select(r => r.SubjectEmployeeId).Distinct().ToArray();
        var grades = await GradesAsync(db, round.CycleId, employees, token);
        var last = round.CalibrationEnabled ? await LastResultsAsync(db, round.CycleId, employees, token) : [];
        var flags = !round.CalibrationEnabled || levels.Count < 3 ? new Dictionary<Guid, CalibrationFlag>()
            : CalibrationFlags.Compute(arrived.Select(r => new FlagInput(r.Id, r.ReviewerEmployeeId, r.ReviewerDisplayName,
                subjects.GetValueOrDefault(r.Id)?.OriginalRating ?? r.ManagerAssessment.OverallRating!.Value,
                grades.GetValueOrDefault(r.SubjectEmployeeId), last.GetValueOrDefault(r.SubjectEmployeeId))).ToArray(), bands, levels.Count);
        return new CalibrationState
        {
            Round = round, Session = session, Levels = levels, Bands = bands, Reviews = reviews, Subjects = subjects, Flags = flags,
            Grades = grades,
        };
    }

    /// <summary>The plan's grade from its goals' measures (D-38), per person with an approved plan whose goals carry weight.</summary>
    private static async Task<Dictionary<Guid, decimal?>> GradesAsync(PerformanceDbContext db, Guid cycleId, Guid[] employees, CancellationToken token)
    {
        var plans = await db.EmployeePlans.AsNoTracking()
            .Where(p => p.CycleId == cycleId && employees.Contains(p.EmployeeId) && p.State == PlanLifecycleState.Approved)
            .Select(p => new { p.Id, p.EmployeeId }).ToListAsync(token);
        var planIds = plans.Select(p => p.Id).ToArray();
        var objectives = await db.Objectives.AsNoTracking()
            .Where(o => o.EmployeePlanId != null && planIds.Contains(o.EmployeePlanId.Value) && o.State != ObjectiveLifecycleState.Archived)
            .ToListAsync(token);
        return plans.ToDictionary(p => p.EmployeeId, p =>
        {
            var goals = objectives.Where(o => o.EmployeePlanId == p.Id).ToArray();
            return goals.Sum(o => o.PlanWeight ?? 0m) > 0m ? GoalGrades.Plan(goals) : (decimal?)null;
        });
    }

    /// <summary>The most recent released result per person in a cycle that started before this one.</summary>
    private static async Task<Dictionary<Guid, InsightLastResult?>> LastResultsAsync(PerformanceDbContext db, Guid cycleId, Guid[] employees,
        CancellationToken token)
    {
        var start = await db.Cycles.AsNoTracking().Where(c => c.Id == cycleId).Select(c => c.StartDate).SingleAsync(token);
        var earlier = await db.Cycles.AsNoTracking().Where(c => c.StartDate < start).ToDictionaryAsync(c => c.Id, c => c.Name, token);
        var cycleIds = earlier.Keys.ToArray();
        var released = await db.PerformanceReviews.AsNoTracking()
            .Where(r => cycleIds.Contains(r.CycleId) && employees.Contains(r.SubjectEmployeeId)
                && r.State == PerformanceReviewState.Finalized && r.FinalRating != null)
            .Select(r => new { r.SubjectEmployeeId, r.CycleId, r.FinalRating, r.FinalizedAt, r.RatingScaleSnapshotJson })
            .ToListAsync(token);
        return released.GroupBy(r => r.SubjectEmployeeId).ToDictionary(g => g.Key, g =>
        {
            var latest = g.OrderByDescending(r => r.FinalizedAt).First();
            var levels = JsonSerializer.Deserialize<RatingScaleLevel[]>(latest.RatingScaleSnapshotJson)?.Length ?? 0;
            return (InsightLastResult?)new InsightLastResult(latest.FinalRating!.Value, levels, earlier[latest.CycleId]);
        });
    }
}

/// <summary>Session upkeep and lookups shared by the handlers and the review workflow.</summary>
internal static class CalibrationSessions
{
    public static Error NotCalibrator() => PerformanceErrors.Forbidden(PerformanceErrors.Codes.CalibrationForbidden,
        "You do not have calibration permission.");

    public static bool IsOwn(PerformanceReview review, CalibratorIdentity actor)
        => actor.EmployeeId is Guid employeeId && employeeId != Guid.Empty && review.SubjectEmployeeId == employeeId;

    /// <summary>The round's session, opened on first use with the tenant's bands for its scale (tracked).</summary>
    public static async Task<CalibrationSession> EnsureAsync(PerformanceDbContext db, ReviewRound round, CancellationToken token,
        IReadOnlyList<int>? scale = null)
    {
        var session = db.CalibrationSessions.Local.FirstOrDefault(s => s.ReviewRoundId == round.Id)
            ?? await db.CalibrationSessions.FirstOrDefaultAsync(s => s.ReviewRoundId == round.Id, token);
        if (session is not null) return session;
        scale ??= (await LevelsAsync(db, round, token)).Select(l => l.Value).ToArray();
        var settings = await db.CycleSettings.AsNoTracking().FirstOrDefaultAsync(token);
        session = CalibrationSession.Open(round.TenantId, round, BandsFor(settings, scale), PerformanceClock.UtcNow);
        db.CalibrationSessions.Add(session);
        return session;
    }

    /// <summary>A review that just reached calibration becomes a subject of its round's session, which opens if it must.</summary>
    public static async Task JoinAsync(PerformanceDbContext db, PerformanceReview review, CancellationToken token)
    {
        if (review.State != PerformanceReviewState.Calibration) return;
        var round = await db.ReviewRounds.AsNoTracking().SingleAsync(r => r.Id == review.ReviewRoundId, token);
        var session = await EnsureAsync(db, round, token);
        if (!await db.CalibrationSubjects.AnyAsync(s => s.SessionId == session.Id && s.ReviewId == review.Id, token))
            db.CalibrationSubjects.Add(session.AddSubject(review));
    }

    /// <summary>The tenant's bands for this scale; bands set for an earlier scale that no longer fit fall back to the default.</summary>
    public static NineBoxBands BandsFor(CycleSettings? settings, IReadOnlyList<int> scale)
    {
        if (scale.Count < 3) return new NineBoxBands(0, 0);
        try { return NineBoxBands.Resolve(settings?.NineBoxLowTop, settings?.NineBoxMidTop, scale); }
        catch (ArgumentException) { return NineBoxBands.Default(scale); }
    }

    public static async Task<IReadOnlyList<RatingScaleLevel>> LevelsAsync(PerformanceDbContext db, ReviewRound round, CancellationToken token)
    {
        if (round.RatingScaleVersionId is not Guid versionId) return [];
        var version = await db.RatingScaleVersions.AsNoTracking().FirstOrDefaultAsync(item => item.Id == versionId, token);
        return version?.Levels ?? [];
    }

    public static CalibrationDecisionDto? Decision(CalibrationSubject? subject) => subject is { DecidedAt: DateTime at }
        ? new(subject.CurrentRating, !subject.IsAdjusted, subject.Rationale, at) : null;

    public static CalibrationFlagDto Flag(CalibrationFlag flag) => new(flag.Kind switch
    {
        CalibrationFlagKind.Goals => "goals",
        CalibrationFlagKind.Moved => "moved",
        CalibrationFlagKind.RatesHigh => "ratesHigh",
        _ => "ratesLow",
    }, flag.Grade, flag.ManagerAverage, flag.ManagerReviews, flag.EveryoneAverage, flag.EveryoneReviews, flag.LastRating, flag.LastCycle);

    /// <summary>The round, readable only by a calibrator of a calibration-enabled round in the caller's tenant.</summary>
    public static async Task<Result<ReviewRound>> RoundAsync(PerformanceDbContext db, Guid roundId, bool hasGrant, CancellationToken token)
    {
        if (!hasGrant) return Result.Failure<ReviewRound>(NotCalibrator());
        var round = await db.ReviewRounds.AsNoTracking().FirstOrDefaultAsync(r => r.Id == roundId, token);
        if (round is null) return Result.Failure<ReviewRound>(PerformanceErrors.NotFound("ReviewRound", roundId));
        if (!round.CalibrationEnabled || round.State == ReviewRoundState.Draft)
            return Result.Failure<ReviewRound>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.CalibrationNotAvailable,
                "This review round has no calibration."));
        return Result.Success(round);
    }
}

// ----- Reads -----

public sealed class GetCalibrationHandler(PerformanceDbContext db) : IQueryHandler<GetCalibrationQuery, Result<CalibrationDto>>
{
    public const int Faces = 8;

    public async Task<Result<CalibrationDto>> Handle(GetCalibrationQuery query, CancellationToken token)
    {
        var found = await CalibrationSessions.RoundAsync(db, query.RoundId, query.HasGrant, token);
        if (found.IsFailure) return Result.Failure<CalibrationDto>(found.Error);
        var round = found.Value;
        var state = await CalibrationState.LoadAsync(db, round, null, token);
        var cycleName = await db.Cycles.AsNoTracking().Where(c => c.Id == round.CycleId).Select(c => c.Name).SingleAsync(token);
        // A calibrator's own review stays out of everything they see.
        var mine = state.Reviews.Where(r => r.State != PerformanceReviewState.Closed && !CalibrationSessions.IsOwn(r, query.Actor)).ToList();
        static CalibrationGroupDto Group(IEnumerable<PerformanceReview> reviews)
        {
            var list = reviews.OrderBy(r => r.SubjectDisplayName, StringComparer.OrdinalIgnoreCase).ToList();
            return new(list.Count, list.Take(Faces).Select(r => new CalibrationFaceDto(r.SubjectEmployeeId, r.SubjectDisplayName)).ToList());
        }
        var flagged = mine.Where(r => r.State == PerformanceReviewState.Calibration && state.Flagged(r)).ToList();
        var words = await WordsAsync(flagged.Select(r => r.Id).ToArray(), round.Id, token);
        var cards = flagged.OrderBy(r => state.Decided(r)).ThenBy(r => r.SubjectDisplayName, StringComparer.OrdinalIgnoreCase)
            .Select(r => new CalibrationCardDto(r.Id, r.SubjectEmployeeId, r.SubjectDisplayName, r.SubjectJobTitle, r.ReviewerEmployeeId,
                r.ReviewerDisplayName, state.Original(r), Shown(state.Flags[r.Id], r, state, mine), words.GetValueOrDefault(r.Id),
                CalibrationSessions.Decision(state.Subject(r)), state.Subject(r)?.Version ?? 0))
            .ToList();
        return Result.Success(new CalibrationDto(round.Id, round.CycleId, round.Name, cycleName,
            state.Levels.Select(l => new CalibrationLevelDto(l.Value, l.Label)).ToList(), state.Bands.LowTop, state.Bands.MidTop,
            Group(mine.Where(CalibrationState.Writing)), Group(mine.Where(state.Ready)), Group(mine.Where(state.ToLookAt)),
            mine.Count(r => r.State == PerformanceReviewState.Finalized), cards, query.CanRelease));
    }

    /// <summary>
    /// A manager's lean is shown with averages over the reviews this calibrator may see, so their own rating can't be
    /// worked back from them.
    /// </summary>
    private static CalibrationFlagDto Shown(CalibrationFlag flag, PerformanceReview review, CalibrationState state, IReadOnlyList<PerformanceReview> mine)
    {
        if (flag.Kind is not (CalibrationFlagKind.RatesHigh or CalibrationFlagKind.RatesLow)) return CalibrationSessions.Flag(flag);
        var arrived = mine.Where(r => r.ManagerAssessment.OverallRating is not null && !CalibrationState.Writing(r)).ToList();
        var team = arrived.Where(r => r.ReviewerEmployeeId == review.ReviewerEmployeeId).ToList();
        return CalibrationSessions.Flag(flag with
        {
            ManagerAverage = decimal.Round(team.Average(r => (decimal)state.Original(r)), 2), ManagerReviews = team.Count,
            EveryoneAverage = decimal.Round(arrived.Average(r => (decimal)state.Original(r)), 2), EveryoneReviews = arrived.Count,
        });
    }

    /// <summary>The manager's first answer in the round's question order: their words beside the flag.</summary>
    private async Task<Dictionary<Guid, string>> WordsAsync(Guid[] reviewIds, Guid roundId, CancellationToken token)
    {
        var answers = await (from answer in db.ReviewQuestionAnswers.AsNoTracking()
                             join question in db.ReviewQuestionSnapshots.AsNoTracking() on answer.QuestionSnapshotId equals question.Id
                             where reviewIds.Contains(answer.ReviewId) && answer.Author == ReviewQuestionAuthor.Manager && question.ReviewRoundId == roundId
                             select new { answer.ReviewId, answer.Text, question.SortOrder }).ToListAsync(token);
        return answers.Where(a => !string.IsNullOrWhiteSpace(a.Text)).GroupBy(a => a.ReviewId)
            .ToDictionary(g => g.Key, g => g.OrderBy(a => a.SortOrder).First().Text.Trim());
    }
}

public sealed class GetCalibrationEveryoneHandler(PerformanceDbContext db) : IQueryHandler<GetCalibrationEveryoneQuery, Result<CalibrationEveryoneDto>>
{
    public async Task<Result<CalibrationEveryoneDto>> Handle(GetCalibrationEveryoneQuery query, CancellationToken token)
    {
        var found = await CalibrationSessions.RoundAsync(db, query.RoundId, query.HasGrant, token);
        if (found.IsFailure) return Result.Failure<CalibrationEveryoneDto>(found.Error);
        var round = found.Value;
        var state = await CalibrationState.LoadAsync(db, round, null, token);
        var people = state.Reviews
            .Where(r => r.ManagerAssessment.OverallRating is not null && !CalibrationState.Writing(r) && r.State != PerformanceReviewState.Closed
                && !CalibrationSessions.IsOwn(r, query.Actor))
            .OrderBy(r => r.SubjectDisplayName, StringComparer.OrdinalIgnoreCase)
            .Select(r => new CalibrationPersonDto(r.Id, r.SubjectEmployeeId, r.SubjectDisplayName, r.ReviewerDisplayName, state.Rating(r), state.Original(r),
                state.Grades.GetValueOrDefault(r.SubjectEmployeeId), state.Flagged(r), state.Decided(r), r.State == PerformanceReviewState.Finalized,
                state.Subject(r)?.Version ?? 0))
            .ToList();

        // Last year: the previous cycle's released results on a scale of the same size.
        var start = await db.Cycles.AsNoTracking().Where(c => c.Id == round.CycleId).Select(c => c.StartDate).SingleAsync(token);
        var previous = await db.Cycles.AsNoTracking().Where(c => c.StartDate < start).OrderByDescending(c => c.StartDate)
            .Select(c => new { c.Id, c.Name }).FirstOrDefaultAsync(token);
        var lastYear = previous is null ? [] : await db.PerformanceReviews.AsNoTracking()
            .Where(r => r.CycleId == previous.Id && r.State == PerformanceReviewState.Finalized && r.FinalRating != null)
            .Select(r => new { r.FinalRating, r.RatingScaleSnapshotJson }).ToListAsync(token);
        var comparable = lastYear.Where(r => (JsonSerializer.Deserialize<RatingScaleLevel[]>(r.RatingScaleSnapshotJson)?.Length ?? 0) == state.Levels.Count)
            .Select(r => r.FinalRating!.Value).ToList();
        var spread = state.Levels.Select(l => new CalibrationSpreadDto(l.Value, people.Count(p => p.Rating == l.Value), comparable.Count(v => v == l.Value)))
            .ToList();
        return Result.Success(new CalibrationEveryoneDto(people, spread, comparable.Count > 0 ? previous!.Name : null));
    }
}

// ----- Decisions -----

/// <summary>Keeps or changes a rating (D-35): the manager's level needs no reason, another one does. The manager is told.</summary>
public sealed class DecideCalibrationHandler(PerformanceDbContext db, IPerformanceAudit audit, IPerformanceNotifications notifications)
    : ICommandHandler<DecideCalibrationCommand, Result<CalibrationSubjectDto>>
{
    public async Task<Result<CalibrationSubjectDto>> Handle(DecideCalibrationCommand command, CancellationToken token)
    {
        var target = await CalibrationDecisions.LoadAsync(db, command.RoundId, command.ReviewId, command.Actor, command.ExpectedVersion, command.HasGrant, token);
        if (target.IsFailure) return Result.Failure<CalibrationSubjectDto>(target.Error);
        var (round, review, subject) = target.Value;
        var scale = (await CalibrationSessions.LevelsAsync(db, round, token)).ToList();
        var before = subject.CurrentRating;
        CalibrationAdjustment? adjustment;
        try { adjustment = subject.Decide(command.Rating, command.Reason, scale.Select(l => l.Value).ToArray(), command.Actor, PerformanceClock.UtcNow); }
        catch (ArgumentException ex)
        {
            return Result.Failure<CalibrationSubjectDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.CalibrationInvalid, ex.Message));
        }
        if (adjustment is not null) db.CalibrationAdjustments.Add(adjustment);
        audit.Record(round.TenantId, "CalibrationSubject", subject.Id, round.CycleId, PerformanceAuditActions.CalibrationDecided,
            new { reviewId = review.Id, before, after = subject.CurrentRating, kept = !subject.IsAdjusted, reason = subject.Rationale });
        var level = scale.FirstOrDefault(l => l.Value == subject.CurrentRating)?.Label ?? subject.CurrentRating.ToString();
        notifications.EnqueueReviewWork(review, PerformanceNotificationKind.CalibrationDecided, review.ReviewerEmployeeId, "CalibrationSubject", subject.Id,
            $"{PerformanceNotificationKind.CalibrationDecided}:{subject.Id:N}:{subject.DecidedAt!.Value.Ticks}",
            new ReviewWorkNotificationPayload(round.CycleId, round.Id, review.Id, round.Name, PerformanceNotificationTemplates.ReviewPath(review.Id),
                command.Actor.DisplayName, review.SubjectDisplayName),
            PerformanceNotificationTemplates.ForCalibrationDecided(review.SubjectDisplayName, level, subject.IsAdjusted, round.Name, review.Id));
        await db.SaveChangesAsync(token);

        // Once results are out, a review looked at afterwards goes out with its decision.
        var released = await CalibrationRelease.ReleaseIfDueAsync(db, review.Id, audit, notifications, token);
        return Result.Success(new CalibrationSubjectDto(review.Id, subject.CurrentRating, CalibrationSessions.Decision(subject), released, subject.Version));
    }
}

public sealed class UndoCalibrationDecisionHandler(PerformanceDbContext db, IPerformanceAudit audit)
    : ICommandHandler<UndoCalibrationDecisionCommand, Result<CalibrationSubjectDto>>
{
    public async Task<Result<CalibrationSubjectDto>> Handle(UndoCalibrationDecisionCommand command, CancellationToken token)
    {
        var target = await CalibrationDecisions.LoadAsync(db, command.RoundId, command.ReviewId, command.Actor, command.ExpectedVersion, command.HasGrant, token);
        if (target.IsFailure) return Result.Failure<CalibrationSubjectDto>(target.Error);
        var (round, review, subject) = target.Value;
        var before = subject.CurrentRating;
        var adjustment = subject.Undo(command.Actor, PerformanceClock.UtcNow);
        if (adjustment is not null) db.CalibrationAdjustments.Add(adjustment);
        audit.Record(round.TenantId, "CalibrationSubject", subject.Id, round.CycleId, PerformanceAuditActions.CalibrationUndone,
            new { reviewId = review.Id, before, after = subject.CurrentRating });
        await db.SaveChangesAsync(token);
        return Result.Success(new CalibrationSubjectDto(review.Id, subject.CurrentRating, null, false, subject.Version));
    }
}

internal static class CalibrationDecisions
{
    /// <summary>The review a calibrator decides on: in the round, never their own, still in calibration, its subject at the version they read.</summary>
    public static async Task<Result<(ReviewRound Round, PerformanceReview Review, CalibrationSubject Subject)>> LoadAsync(PerformanceDbContext db,
        Guid roundId, Guid reviewId, CalibratorIdentity actor, uint expectedVersion, bool hasGrant, CancellationToken token)
    {
        var found = await CalibrationSessions.RoundAsync(db, roundId, hasGrant, token);
        if (found.IsFailure) return Result.Failure<(ReviewRound, PerformanceReview, CalibrationSubject)>(found.Error);
        var round = found.Value;
        var review = await db.PerformanceReviews.FirstOrDefaultAsync(r => r.Id == reviewId && r.ReviewRoundId == round.Id, token);
        if (review is null) return Result.Failure<(ReviewRound, PerformanceReview, CalibrationSubject)>(PerformanceErrors.NotFound("PerformanceReview", reviewId));
        if (CalibrationSessions.IsOwn(review, actor))
            return Result.Failure<(ReviewRound, PerformanceReview, CalibrationSubject)>(PerformanceErrors.Forbidden(PerformanceErrors.Codes.CalibrationForbidden,
                "You cannot calibrate your own review."));
        if (review.State != PerformanceReviewState.Calibration)
            return Result.Failure<(ReviewRound, PerformanceReview, CalibrationSubject)>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.CalibrationInvalid,
                review.State == PerformanceReviewState.Finalized ? "This result is already out." : "This review hasn't reached calibration."));
        var session = await CalibrationSessions.EnsureAsync(db, round, token);
        var subject = await db.CalibrationSubjects.FirstOrDefaultAsync(s => s.SessionId == session.Id && s.ReviewId == review.Id, token);
        if ((subject?.Version ?? 0) != expectedVersion)
            return Result.Failure<(ReviewRound, PerformanceReview, CalibrationSubject)>(PerformanceErrors.Create(PerformanceErrors.Codes.CalibrationConflict,
                "Someone decided on this person since you opened the page.", FailureKind.Stale));
        if (subject is null)
        {
            subject = session.AddSubject(review);
            db.CalibrationSubjects.Add(subject);
        }
        return Result.Success((round, review, subject));
    }
}

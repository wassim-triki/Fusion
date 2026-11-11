using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Reviews;

/// <summary>
/// The round page's one projection (D11, boards 04–07): the Draft's setup and readiness, the running round's
/// stage totals, teams, reminders and activity, or the closed round's outcome. Round administrators only.
/// </summary>
internal static class ReviewRoundComposer
{
    public static async Task<ReviewRoundDto> ComposeAsync(PerformanceDbContext db, ICoreWorkforceClient? workforce, ReviewRound round,
        IReadOnlyList<ReviewRoundSubject> subjects, ReviewReadinessResolver.Resolution? readiness, DateOnly today, CancellationToken token)
    {
        var cycle = await db.Cycles.AsNoTracking().SingleAsync(c => c.Id == round.CycleId, token);
        var issues = readiness?.Issues ?? new Dictionary<Guid, IReadOnlyList<ReviewReadinessIssueDto>>();
        var detail = ReviewRoundProjection.Detail(round, subjects, issues);
        var launchDay = round.LaunchedAt is DateTime launched ? DateOnly.FromDateTime(launched) : today;
        var schedule = round.ScheduleFor(launchDay);
        var draft = round.State == ReviewRoundState.Draft;
        var questions = await QuestionsAsync(db, round, token);
        var dto = detail with
        {
            PeerInputEnabled = round.PeerInputEnabled,
            QuestionsEnabled = round.QuestionsEnabled,
            PotentialEnabled = round.PotentialEnabled,
            PeerInputDueDate = round.PeerInputDueDate,
            CycleName = cycle.Name,
            CycleStart = cycle.StartDate,
            CycleEnd = cycle.EndDate,
            LaunchedAt = round.LaunchedAt,
            OpensOn = round.OpensOn,
            Schedule = new ReviewRoundScheduleDto(launchDay,
                new(schedule.SelfAssessment, draft && round.SelfAssessmentDueDate is null, round.SelfAssessmentDueDays),
                new(schedule.PeerInput, draft && round.PeerInputDueDate is null, round.PeerInputDueDays),
                new(schedule.ManagerAssessment, draft && round.ManagerAssessmentDueDate is null, round.ManagerAssessmentDueDays),
                round.AcknowledgementReminderDays),
            Questions = questions,
        };
        if (draft)
            return dto with { Readiness = readiness is null ? null : await ReadinessAsync(db, round, cycle, subjects, readiness, questions, today, token) };

        var reviews = await db.PerformanceReviews.AsNoTracking().Where(r => r.ReviewRoundId == round.Id).ToListAsync(token);
        var requests = await db.PeerRequests.AsNoTracking().Where(r => r.ReviewRoundId == round.Id).ToListAsync(token);
        dto = dto with
        {
            Configuration = Configuration(round),
            Activity = await ActivityAsync(db, workforce, round, reviews, token),
        };
        return round.State == ReviewRoundState.Active
            ? dto with { Progress = Progress(round, reviews, requests, today) }
            : dto with { Outcome = await OutcomeAsync(db, round, reviews, today, token) };
    }

    /// <summary>Draft: the picks, in library text, without archived questions. Launched: the frozen snapshot.</summary>
    private static async Task<IReadOnlyList<ReviewRoundQuestionDto>> QuestionsAsync(PerformanceDbContext db, ReviewRound round, CancellationToken token)
    {
        if (round.State != ReviewRoundState.Draft)
            return (await db.ReviewQuestionSnapshots.AsNoTracking().Where(q => q.ReviewRoundId == round.Id).ToListAsync(token))
                .OrderBy(q => q.Audience).ThenBy(q => q.SortOrder)
                .Select(q => new ReviewRoundQuestionDto(q.Id, q.QuestionId, q.Audience, q.SortOrder, q.Text)).ToArray();
        var picks = await db.ReviewRoundQuestions.AsNoTracking().Where(q => q.ReviewRoundId == round.Id).ToListAsync(token);
        var ids = picks.Select(p => p.QuestionId).ToArray();
        var library = await db.ReviewQuestions.AsNoTracking().Where(q => ids.Contains(q.Id) && q.State == ReviewQuestionState.Active)
            .ToDictionaryAsync(q => q.Id, token);
        return picks.Where(p => library.ContainsKey(p.QuestionId)).OrderBy(p => p.Audience).ThenBy(p => p.SortOrder)
            .Select(p => new ReviewRoundQuestionDto(p.Id, p.QuestionId, p.Audience, p.SortOrder, library[p.QuestionId].Text)).ToArray();
    }

    /// <summary>Round-level readiness codes for a Draft about to launch on <paramref name="launchDay"/>.</summary>
    public static IReadOnlyList<string> RoundIssues(ReviewRound round, PerformanceCycle cycle, int includedCount,
        IReadOnlyList<ReviewRoundQuestionDto> questions, bool otherRoundRunning, DateOnly launchDay)
    {
        var issues = new List<string>();
        if (includedCount == 0) issues.Add(ReviewRoundIssueCodes.NoSubjects);
        if (round.QuestionsEnabled && !questions.Any(q => q.Audience is ReviewQuestionAudience.Person or ReviewQuestionAudience.Manager))
            issues.Add(ReviewRoundIssueCodes.NoQuestions);
        if (round.PeerInputEnabled && questions.All(q => q.Audience != ReviewQuestionAudience.Peer))
            issues.Add(ReviewRoundIssueCodes.NoPeerQuestions);
        issues.AddRange(round.ScheduleIssues(cycle, launchDay));
        if (otherRoundRunning) issues.Add(ReviewRoundIssueCodes.RoundRunning);
        return issues;
    }

    public static async Task<RunningReviewRoundDto?> RunningRoundAsync(PerformanceDbContext db, ReviewRound round, CancellationToken token)
    {
        var running = await db.ReviewRounds.AsNoTracking()
            .FirstOrDefaultAsync(r => r.CycleId == round.CycleId && r.Id != round.Id && r.State == ReviewRoundState.Active, token);
        if (running is null) return null;
        var reviews = await db.PerformanceReviews.AsNoTracking().Where(r => r.ReviewRoundId == running.Id && r.State != PerformanceReviewState.Closed)
            .Select(r => new { r.SelfAssessmentEnabled, SelfDone = r.SelfAssessment.SubmittedAt != null, ManagerDone = r.ManagerAssessment.SubmittedAt != null })
            .ToListAsync(token);
        return new RunningReviewRoundDto(running.Id, running.Name, running.LaunchedAt, reviews.Count,
            reviews.Count(r => r.SelfAssessmentEnabled && r.SelfDone), reviews.Count(r => r.SelfAssessmentEnabled),
            reviews.Count(r => r.ManagerDone), reviews.Count);
    }

    private static async Task<ReviewRoundReadinessDto> ReadinessAsync(PerformanceDbContext db, ReviewRound round, PerformanceCycle cycle,
        IReadOnlyList<ReviewRoundSubject> subjects, ReviewReadinessResolver.Resolution readiness, IReadOnlyList<ReviewRoundQuestionDto> questions,
        DateOnly today, CancellationToken token)
    {
        var running = await RunningRoundAsync(db, round, token);
        var included = subjects.Count(s => !s.IsExcluded);
        var issues = RoundIssues(round, cycle, included, questions, running is not null, today);
        var subjectIssues = readiness.Issues.Values.Sum(values => values.Count);
        return new ReviewRoundReadinessDto(issues.Count == 0 && subjectIssues == 0, included, subjectIssues, issues, running);
    }

    private static ReviewRoundFrozenConfigurationDto Configuration(ReviewRound round)
    {
        var competencies = Array.Empty<string>();
        var version = 0;
        if (!string.IsNullOrWhiteSpace(round.ConfigSnapshotJson))
        {
            try
            {
                using var snapshot = JsonDocument.Parse(round.ConfigSnapshotJson);
                if (snapshot.RootElement.TryGetProperty("competencies", out var values) && values.ValueKind == JsonValueKind.Array)
                    competencies = values.EnumerateArray()
                        .Select(v => v.TryGetProperty("name", out var name) ? name.GetString() : null)
                        .OfType<string>().ToArray();
                if (snapshot.RootElement.TryGetProperty("ratingScaleVersion", out var number) && number.TryGetInt32(out var parsed)) version = parsed;
            }
            catch (JsonException) { }
        }
        return new(round.SelfAssessmentEnabled, round.PeerInputEnabled, round.ObjectiveRatingsEnabled, round.QuestionsEnabled,
            round.PotentialEnabled, round.CalibrationEnabled, competencies, version);
    }

    internal static ReviewRoundProgressDto Progress(ReviewRound round, IReadOnlyList<PerformanceReview> reviews,
        IReadOnlyList<PeerRequest> requests, DateOnly today)
    {
        var open = reviews.Where(r => r.State != PerformanceReviewState.Closed).ToList();
        var stages = new List<ReviewStageProgressDto>();
        if (round.SelfAssessmentEnabled)
        {
            var self = open.Where(r => r.SelfAssessmentEnabled).ToList();
            var waiting = self.Where(r => !r.SelfAssessment.IsSubmitted).ToList();
            stages.Add(new("SelfAssessment", self.Count - waiting.Count, self.Count, round.SelfAssessmentDueDate, waiting.Count,
                waiting.Count(r => r.SelfAssessmentDueDate < today)));
        }
        if (round.PeerInputEnabled)
        {
            var waiting = requests.Where(r => r.State == PeerRequestState.Open).ToList();
            stages.Add(new("PeerInput", requests.Count(r => r.State == PeerRequestState.Answered), requests.Count, round.PeerInputDueDate,
                waiting.Count, waiting.Count(r => r.DueDate < today), Declined: requests.Count(r => r.State == PeerRequestState.Declined)));
        }
        var managerWaiting = open.Where(r => !r.ManagerAssessment.IsSubmitted).ToList();
        stages.Add(new("ManagerAssessment", open.Count - managerWaiting.Count, open.Count, round.ManagerAssessmentDueDate, managerWaiting.Count,
            managerWaiting.Count(r => r.State == PerformanceReviewState.ManagerAssessment && r.ManagerAssessmentDueDate < today),
            ReadyToWrite: managerWaiting.Count(r => r.State == PerformanceReviewState.ManagerAssessment)));
        stages.Add(new("Released", open.Count(r => r.State == PerformanceReviewState.Finalized), open.Count, null,
            open.Count(r => r.State != PerformanceReviewState.Finalized), 0));

        var teams = open.GroupBy(r => r.ReviewerEmployeeId).Select(team =>
        {
            var ids = team.Select(r => r.Id).ToHashSet();
            var teamRequests = requests.Where(r => ids.Contains(r.ReviewId)).ToList();
            var unit = team.Where(r => r.SubjectOrgUnitName is not null).GroupBy(r => r.SubjectOrgUnitName)
                .OrderByDescending(g => g.Count()).Select(g => g.Key).FirstOrDefault();
            return new ReviewTeamProgressDto(team.Key, team.First().ReviewerDisplayName, unit, team.Count(),
                new(team.Count(r => r.SelfAssessmentEnabled && r.SelfAssessment.IsSubmitted), team.Count(r => r.SelfAssessmentEnabled)),
                new(teamRequests.Count(r => r.State == PeerRequestState.Answered), teamRequests.Count),
                new(team.Count(r => r.ManagerAssessment.IsSubmitted), team.Count()));
        })
        // Furthest behind first: the earliest stage decides, then the next.
        .OrderBy(t => Fraction(t.Self)).ThenBy(t => Fraction(t.Peers)).ThenBy(t => Fraction(t.Manager))
        .ThenBy(t => t.ReviewerDisplayName, StringComparer.OrdinalIgnoreCase).ToArray();

        return new ReviewRoundProgressDto(stages, teams, NextReminder(round, open, requests, today),
            open.Count(r => r.State == PerformanceReviewState.ReadyToFinalize), open.Count(r => r.State == PerformanceReviewState.Finalized),
            reviews.Count(r => r.State == PerformanceReviewState.Closed));
    }

    private static double Fraction(ReviewRatioDto ratio) => ratio.Total == 0 ? 1 : (double)ratio.Done / ratio.Total;

    /// <summary>The next day any open task of the round is reminded, and how many of each.</summary>
    private static ReviewReminderForecastDto? NextReminder(ReviewRound round, IReadOnlyList<PerformanceReview> open,
        IReadOnlyList<PeerRequest> requests, DateOnly today)
    {
        var tasks = ReviewReminderTasks.For(round, open, requests).ToList();
        if (tasks.Count == 0) return null;
        var next = tasks.Min(task => ReviewReminderSchedule.NextTaskReminder(task.Due, today));
        var due = tasks.Where(task => ReviewReminderSchedule.IsTaskReminderDay(task.Due, next)).ToList();
        return new(next, due.Count(t => t.Kind == ReviewReminderKind.SelfAssessment),
            due.Count(t => t.Kind == ReviewReminderKind.PeerInput), due.Count(t => t.Kind == ReviewReminderKind.ManagerAssessment));
    }

    private static async Task<IReadOnlyList<ReviewRoundActivityDto>> ActivityAsync(PerformanceDbContext db, ICoreWorkforceClient? workforce,
        ReviewRound round, IReadOnlyList<PerformanceReview> reviews, CancellationToken token)
    {
        var activity = new List<ReviewRoundActivityDto>();
        var launch = await db.AuditEntries.AsNoTracking()
            .Where(a => a.ResourceType == "ReviewRound" && a.ResourceId == round.Id && a.Action == PerformanceAuditActions.ReviewRoundLaunched)
            .Select(a => new { a.ActorEmployeeId, a.OccurredAt }).FirstOrDefaultAsync(token);
        if (round.LaunchedAt is DateTime launchedAt)
        {
            string? actor = null;
            if (launch?.ActorEmployeeId is Guid actorId && workforce is not null)
            {
                try { actor = (await workforce.ResolveAsync(launchedAt, [actorId], token)).FirstOrDefault()?.DisplayName; }
                catch (HttpRequestException) { }
            }
            activity.Add(new("Launched", launchedAt, actor, $"Launched · {reviews.Count} {(reviews.Count == 1 ? "review" : "reviews")} opened"));
        }
        foreach (var move in await db.ReviewDueDateMoves.AsNoTracking().Where(m => m.ReviewRoundId == round.Id).ToListAsync(token))
            activity.Add(new("DueDateMoved", move.MovedAt, move.ActorName,
                move.ReviewId is null
                    ? $"{StageLabel(move.Stage)} moved to {move.ToDate:ddd d MMM}"
                    : $"{move.SubjectDisplayName}'s {StageLabel(move.Stage).ToLowerInvariant()} moved to {move.ToDate:ddd d MMM}",
                move.Reason));
        foreach (var closed in reviews.Where(r => r.State == PerformanceReviewState.Closed && r.ClosedAt is not null))
            activity.Add(new("ReviewClosed", closed.ClosedAt!.Value, null, $"{closed.SubjectDisplayName}'s review closed without a result", closed.CloseReason));
        foreach (var day in reviews.Where(r => r.FinalizedAt is not null).GroupBy(r => DateOnly.FromDateTime(r.FinalizedAt!.Value)))
            activity.Add(new("Released", day.Max(r => r.FinalizedAt!.Value), null,
                $"{day.Count()} {(day.Count() == 1 ? "review" : "reviews")} released"));
        if (round.State == ReviewRoundState.Closed)
            activity.Add(new("Closed", round.UpdatedAt ?? round.CreatedAt, null, "Round closed"));
        return activity.OrderByDescending(a => a.At).ToArray();
    }

    internal static string StageLabel(ReviewStage stage) => stage switch
    {
        ReviewStage.SelfAssessment => "Self-assessment",
        ReviewStage.PeerInput => "Peer input",
        _ => "Manager assessment",
    };

    private static async Task<ReviewRoundOutcomeDto> OutcomeAsync(PerformanceDbContext db, ReviewRound round,
        IReadOnlyList<PerformanceReview> reviews, DateOnly today, CancellationToken token)
    {
        var released = reviews.Where(r => r.State == PerformanceReviewState.Finalized).ToList();
        var session = await db.CalibrationSessions.AsNoTracking().FirstOrDefaultAsync(s => s.ReviewRoundId == round.Id, token);
        var calibrated = session is null ? [] : await db.CalibrationSubjects.AsNoTracking()
            .Where(s => s.SessionId == session.Id && s.CalibratedRating != null && s.CalibratedRating != s.OriginalRating)
            .Select(s => new { s.OriginalRating, s.CalibratedRating }).ToListAsync(token);
        var levels = round.RatingScaleVersionId is Guid versionId
            ? (await db.RatingScaleVersions.AsNoTracking().FirstOrDefaultAsync(v => v.Id == versionId, token))?.Levels ?? []
            : [];
        var unacknowledged = released.Where(r => r.AcknowledgedAt is null).OrderBy(r => r.SubjectDisplayName, StringComparer.OrdinalIgnoreCase).ToList();
        return new ReviewRoundOutcomeDto(released.Count, reviews.Count, released.Count(r => r.AcknowledgedAt is not null),
            calibrated.Count, calibrated.Count(c => c.CalibratedRating < c.OriginalRating), calibrated.Count(c => c.CalibratedRating > c.OriginalRating),
            reviews.Where(r => r.State == PerformanceReviewState.Closed).OrderBy(r => r.SubjectDisplayName, StringComparer.OrdinalIgnoreCase)
                .Select(r => new ReviewClosedWithoutResultDto(r.Id, r.SubjectDisplayName, r.CloseReason ?? string.Empty, r.ClosedAt)).ToArray(),
            levels.Select(level => new ReviewRatingBucketDto(level.Value, level.Label, released.Count(r => r.FinalRating == level.Value))).ToArray(),
            unacknowledged.Select(r => new ReviewPersonRefDto(r.Id, r.SubjectDisplayName)).ToArray(),
            unacknowledged.Count == 0 ? null : unacknowledged.Min(r => ReviewReminderSchedule.NextAcknowledgementReminder(
                DateOnly.FromDateTime(r.FinalizedAt!.Value), round.AcknowledgementReminderDays, today)),
            released.Count == 0 ? null : released.Max(r => r.FinalizedAt));
    }
}

public enum ReviewReminderKind { SelfAssessment, PeerInput, ManagerAssessment }

/// <summary>One open review task that reminders are about: who acts, by when, and where.</summary>
public sealed record ReviewReminderTask(ReviewReminderKind Kind, Guid ResourceId, Guid RecipientEmployeeId, DateOnly Due,
    PerformanceReview Review, PeerRequest? Request = null);

/// <summary>The open tasks of a running round, shared by the reminder scan and the round's next-reminder forecast.</summary>
public static class ReviewReminderTasks
{
    public static IEnumerable<ReviewReminderTask> For(ReviewRound round, IEnumerable<PerformanceReview> reviews, IEnumerable<PeerRequest> requests)
    {
        if (round.State != ReviewRoundState.Active) yield break;
        var byId = new Dictionary<Guid, PerformanceReview>();
        foreach (var review in reviews)
        {
            byId[review.Id] = review;
            if (review.State == PerformanceReviewState.SelfAssessment && review.SelfAssessmentEnabled && !review.SelfAssessment.IsSubmitted
                && review.SelfAssessmentDueDate is DateOnly selfDue)
                yield return new(ReviewReminderKind.SelfAssessment, review.Id, review.SubjectEmployeeId, selfDue, review);
            if (review.State == PerformanceReviewState.ManagerAssessment && !review.ManagerAssessment.IsSubmitted
                && review.ManagerAssessmentDueDate is DateOnly managerDue)
                yield return new(ReviewReminderKind.ManagerAssessment, review.Id, review.ReviewerEmployeeId, managerDue, review);
        }
        foreach (var request in requests)
            if (request.State == PeerRequestState.Open && request.DueDate is DateOnly peerDue && byId.TryGetValue(request.ReviewId, out var review)
                && review.State is not (PerformanceReviewState.Finalized or PerformanceReviewState.Closed))
                yield return new(ReviewReminderKind.PeerInput, request.Id, request.PeerEmployeeId, peerDue, review, request);
    }
}

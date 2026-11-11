using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Progress;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.Progress;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Reviews;

public sealed record ReviewsWorkspaceViewer(Guid EmployeeId, bool Participates, bool ReviewsReports, bool Administers,
    Guid UserId = default, bool Calibrates = false);
public sealed record GetReviewsWorkspaceQuery(Guid? CycleId, ReviewsWorkspaceViewer Viewer) : IQuery<Result<ReviewsWorkspaceDto>>;

/// <summary>
/// The Reviews landing (boards 01–03, 18), composed per viewer from what they hold: their own review, reviews they write
/// as a run of steps, input asked of them, rounds they run and past results.
/// </summary>
public sealed record ReviewsWorkspaceDto(Guid? CycleId, string? CycleName, DateOnly? CycleEnd, bool CanAdminister,
    ReviewsWorkspaceOwnDto? Own, ReviewsWorkspaceNotIncludedDto? NotIncluded, ReviewsWorkspaceYearDto? Year,
    IReadOnlyList<ReviewsWorkspaceTeamRowDto> ToWrite,
    IReadOnlyList<ReviewsWorkspacePeerRequestDto> AskedOfYou, IReadOnlyList<ReviewsWorkspaceRoundDto> Rounds,
    ReviewsWorkspaceCycleFactsDto? CycleFacts, IReadOnlyList<ReviewsWorkspacePastResultDto> PastResults)
{
    /// <summary>Open calibration sessions the viewer facilitates, counted without their own review (board 11).</summary>
    public IReadOnlyList<ReviewsWorkspaceSessionDto> Sessions { get; init; } = [];
}

public sealed record ReviewsWorkspaceSessionDto(Guid RoundId, string RoundName, int People, int Discussed, int Flags, int Outstanding);

public sealed record ReviewsWorkspaceOwnDto(Guid ReviewId, Guid RoundId, string RoundName, PerformanceReviewState State, string ReviewerName,
    DateOnly PeriodStart, DateOnly PeriodEnd, DateOnly? DueDate, int DaysLate, DateOnly? SelfAssessmentDue, DateOnly? ManagerAssessmentDue,
    bool SelfAssessmentEnabled, bool CalibrationEnabled, DateTime? SelfSubmittedAt, ReviewsWorkspaceSectionsDto Sections,
    ReviewsWorkspaceOwnPeersDto? Peers, int? FinalRating, string? FinalRatingLabel, DateTime? FinalizedAt, DateTime? AcknowledgedAt);
public sealed record ReviewsWorkspaceSectionsDto(int ObjectivesDone, int Objectives, int CompetenciesDone, int Competencies,
    int QuestionsDone, int Questions);
public sealed record ReviewsWorkspaceOwnPeersDto(IReadOnlyList<string> Asked);
public sealed record ReviewsWorkspaceNotIncludedDto(Guid RoundId, string RoundName, string? Reason);
public sealed record ReviewsWorkspaceYearDto(decimal? PlanProgress, int Objectives, int Feedback, int Praise, int OneOnOnes);

/// <summary>One person whose review the viewer writes, as a run of steps: peers, self-assessment, peer input, the review.</summary>
public sealed record ReviewsWorkspaceTeamRowDto(Guid ReviewId, Guid SubjectEmployeeId, string SubjectDisplayName, string? JobTitle,
    string RoundName, PerformanceReviewState State, string PeerStep, int PeerCount, string SelfStep, DateTime? SelfSubmittedAt,
    int PeerAnswered, int PeerTotal, int PeerDeclined, string ReviewStep, DateOnly? DueDate, int DaysLate, string NextAction,
    int? SelfOverallRating, string? SelfOverallLabel)
{
    public IReadOnlyList<string> PeerNames { get; init; } = [];
    /// <summary>The person's year as the reviewer may see it: approved-plan progress, risky objectives, feedback and praise in the period.</summary>
    public decimal? PlanProgress { get; init; }
    public int AtRisk { get; init; }
    public int Feedback { get; init; }
    public int Praise { get; init; }
    /// <summary>The reviewer's own submitted rating and potential; after calibration, the outcome and whether the rating changed.</summary>
    public int? ManagerRating { get; init; }
    public ReviewPotential? ManagerPotential { get; init; }
    public int? FinalRating { get; init; }
    public ReviewPotential? FinalPotential { get; init; }
    public bool CalibrationChanged { get; init; }
    public bool SummaryToCheck { get; init; }
}
public sealed record ReviewsWorkspacePeerRequestDto(Guid RequestId, string SubjectDisplayName, string RoundName, int Questions,
    DateOnly? DueDate, int DaysLate, PeerRequestState State, DateTime? RespondedAt);
public sealed record ReviewsWorkspaceRoundDto(Guid RoundId, string Name, ReviewRoundState State, DateTime? LaunchedAt, DateOnly PeriodStart,
    DateOnly PeriodEnd, int People, int Components, bool CalibrationEnabled, DateOnly? SelfAssessmentDue, DateOnly? PeerInputDue,
    DateOnly? ManagerAssessmentDue, IReadOnlyList<ReviewStageProgressDto> Stages, int Released, int Acknowledged,
    DateTime? ClosedAt);
public sealed record ReviewsWorkspaceCycleFactsDto(int Participants, int ApprovedPlans);
public sealed record ReviewsWorkspacePastResultDto(Guid ReviewId, string CycleName, string RoundName, int? FinalRating, string? Label,
    DateTime? FinalizedAt, DateTime? AcknowledgedAt);

public sealed class GetReviewsWorkspaceHandler(PerformanceDbContext db) : IQueryHandler<GetReviewsWorkspaceQuery, Result<ReviewsWorkspaceDto>>
{
    public async Task<Result<ReviewsWorkspaceDto>> Handle(GetReviewsWorkspaceQuery query, CancellationToken token)
    {
        var viewer = query.Viewer;
        var me = viewer.EmployeeId;
        PerformanceCycle? cycle;
        if (query.CycleId is Guid cycleId)
        {
            cycle = await db.Cycles.AsNoTracking().FirstOrDefaultAsync(c => c.Id == cycleId, token);
            if (cycle is null) return Result.Failure<ReviewsWorkspaceDto>(PerformanceErrors.NotFound("Cycle", cycleId));
        }
        else cycle = await db.Cycles.AsNoTracking().Where(c => c.State != CycleLifecycleState.Draft)
            .OrderByDescending(c => c.State == CycleLifecycleState.Active).ThenByDescending(c => c.StartDate).FirstOrDefaultAsync(token);
        var today = PerformanceClock.Today;
        var rounds = cycle is null ? [] : await db.ReviewRounds.AsNoTracking().Where(r => r.CycleId == cycle.Id).OrderBy(r => r.CreatedAt).ToListAsync(token);
        var launched = rounds.Where(r => r.State != ReviewRoundState.Draft).ToDictionary(r => r.Id);
        var cycleReviews = cycle is null ? [] : await db.PerformanceReviews.AsNoTracking().Where(r => r.CycleId == cycle.Id).ToListAsync(token);

        var own = me == Guid.Empty ? null : cycleReviews.Where(r => r.SubjectEmployeeId == me && r.State != PerformanceReviewState.Closed)
            .OrderByDescending(r => r.OpenedAt).FirstOrDefault();
        var toWrite = !viewer.ReviewsReports || me == Guid.Empty ? [] : cycleReviews
            .Where(r => r.ReviewerEmployeeId == me && r.SubjectEmployeeId != me && launched.ContainsKey(r.ReviewRoundId)
                && launched[r.ReviewRoundId].State == ReviewRoundState.Active)
            .OrderBy(r => r.SubjectDisplayName, StringComparer.OrdinalIgnoreCase).ToList();
        var reviewIds = toWrite.Select(r => r.Id).Concat(own is null ? [] : [own.Id]).ToArray();
        var requests = reviewIds.Length == 0 ? [] : await db.PeerRequests.AsNoTracking().Where(r => reviewIds.Contains(r.ReviewId)).ToListAsync(token);
        var nominations = reviewIds.Length == 0 ? [] : await db.PeerNominations.AsNoTracking().Where(n => reviewIds.Contains(n.ReviewId)).ToListAsync(token);

        var sessions = viewer.Calibrates && viewer.UserId != Guid.Empty ? await SessionsAsync(launched.Keys.ToArray(), viewer, token) : [];
        return Result.Success(new ReviewsWorkspaceDto(cycle?.Id, cycle?.Name, cycle?.EndDate, viewer.Administers,
            own is null ? null : await OwnAsync(own, launched[own.ReviewRoundId], nominations, today, token),
            own is null && cycle is not null && viewer.Participates ? await NotIncludedAsync(me, rounds, token) : null,
            cycle is null || !viewer.Participates ? null : await YearAsync(cycle, own is null ? null : launched[own.ReviewRoundId], me, token),
            (await TeamFactsAsync(toWrite, launched, me, token)).Zip(toWrite)
                .Select(pair => TeamRow(pair.Second, launched[pair.Second.ReviewRoundId], requests, nominations, today) with
                {
                    PeerNames = nominations.Where(n => n.ReviewId == pair.Second.Id).OrderBy(n => n.NominatedAt).Select(n => n.DisplayName).ToArray(),
                    PlanProgress = pair.First.PlanProgress, AtRisk = pair.First.AtRisk, Feedback = pair.First.Feedback, Praise = pair.First.Praise,
                    ManagerRating = pair.Second.ManagerAssessment.IsSubmitted ? pair.Second.ManagerAssessment.OverallRating : null,
                    ManagerPotential = pair.Second.ManagerAssessment.IsSubmitted ? pair.Second.Potential : null,
                    FinalRating = pair.Second.State == PerformanceReviewState.ReadyToFinalize ? pair.Second.FinalRating : null,
                    FinalPotential = pair.Second.State == PerformanceReviewState.ReadyToFinalize ? pair.Second.FinalPotential : null,
                    CalibrationChanged = pair.Second.CalibrationChangedRating,
                    SummaryToCheck = pair.Second.State == PerformanceReviewState.ReadyToFinalize && pair.Second.CalibrationChangedRating
                        && pair.Second.SummaryRevisedAt is null && pair.Second.SummaryCheckedAt is null,
                })
                .OrderBy(row => row.NextAction switch { "WriteReview" => 0, "Wait" => 1, _ => 2 })
                .ThenBy(row => row.SubjectDisplayName, StringComparer.OrdinalIgnoreCase).ToArray(),
            cycle is null || me == Guid.Empty || !viewer.Participates ? [] : await AskedOfYouAsync(cycle.Id, me, today, token),
            viewer.Administers ? await RoundsAsync(rounds, cycleReviews, today, token) : [],
            viewer.Administers && cycle is not null ? new ReviewsWorkspaceCycleFactsDto(
                await db.Participants.AsNoTracking().CountAsync(p => p.CycleId == cycle.Id, token),
                await db.EmployeePlans.AsNoTracking().CountAsync(p => p.CycleId == cycle.Id && p.State == PlanLifecycleState.Approved, token)) : null,
            me == Guid.Empty ? [] : await PastResultsAsync(me, token)) { Sessions = sessions });
    }

    private async Task<IReadOnlyList<ReviewsWorkspaceSessionDto>> SessionsAsync(Guid[] roundIds, ReviewsWorkspaceViewer viewer, CancellationToken token)
    {
        var open = await db.CalibrationSessions.AsNoTracking()
            .Where(session => roundIds.Contains(session.ReviewRoundId) && session.State == Domain.Calibration.CalibrationSessionState.Open)
            .ToListAsync(token);
        var identity = new Domain.Calibration.FacilitatorIdentity(viewer.UserId, viewer.EmployeeId == Guid.Empty ? null : viewer.EmployeeId, string.Empty);
        var result = new List<ReviewsWorkspaceSessionDto>();
        foreach (var session in open.Where(session => session.IsFacilitator(viewer.UserId)))
        {
            var model = await Calibration.CalibrationReadModel.LoadAsync(db, session.ReviewRoundId, identity, viewer.Calibrates, token);
            if (model.IsFailure) continue;
            var header = model.Value.Header();
            result.Add(new(session.ReviewRoundId, model.Value.Round.Name, header.People, header.Discussed, header.Flags, header.Outstanding));
        }
        return result;
    }

    private async Task<ReviewsWorkspaceOwnDto> OwnAsync(PerformanceReview review, ReviewRound round, IReadOnlyList<PeerNomination> nominations,
        DateOnly today, CancellationToken token)
    {
        var responses = await db.ReviewItemResponses.AsNoTracking().Where(r => r.ReviewId == review.Id).ToListAsync(token);
        var plan = await db.EmployeePlans.AsNoTracking().FirstOrDefaultAsync(p => p.CycleId == review.CycleId
            && p.EmployeeId == review.SubjectEmployeeId && p.State == PlanLifecycleState.Approved, token);
        var objectives = plan is null ? 0 : await db.Objectives.AsNoTracking()
            .CountAsync(o => o.EmployeePlanId == plan.Id && o.State != ObjectiveLifecycleState.Archived, token);
        var competencies = ReviewRoundComposerReads.CompetencyCount(round.ConfigSnapshotJson);
        var questions = !review.QuestionsEnabled || !review.SelfAssessmentEnabled ? 0 : await db.ReviewQuestionSnapshots.AsNoTracking()
            .CountAsync(q => q.ReviewRoundId == round.Id && q.Audience == ReviewQuestionAudience.Person, token);
        var answered = await db.ReviewQuestionAnswers.AsNoTracking().CountAsync(a => a.ReviewId == review.Id && a.Author == ReviewQuestionAuthor.Self, token);
        var released = review.State == PerformanceReviewState.Finalized;
        var open = review.State == PerformanceReviewState.SelfAssessment && !review.SelfAssessment.IsSubmitted;
        return new ReviewsWorkspaceOwnDto(review.Id, round.Id, round.Name, review.State, review.ReviewerDisplayName, round.PeriodStart, round.PeriodEnd,
            review.CurrentStageDueDate, open ? ReviewReminderSchedule.DaysLate(review.CurrentStageDueDate, today) : 0,
            review.SelfAssessmentDueDate, review.ManagerAssessmentDueDate, review.SelfAssessmentEnabled, review.CalibrationEnabled,
            review.SelfAssessment.SubmittedAt,
            new ReviewsWorkspaceSectionsDto(
                responses.Count(r => r.Kind == ReviewItemKind.Objective && (r.SelfReflection is not null || r.SelfRating is not null)), objectives,
                responses.Count(r => r.Kind == ReviewItemKind.Competency && r.SelfRating is not null), competencies, answered, questions),
            review.PeerInputEnabled ? new ReviewsWorkspaceOwnPeersDto(
                nominations.Where(n => n.ReviewId == review.Id).OrderBy(n => n.NominatedAt).Select(n => n.DisplayName).ToArray()) : null,
            released ? review.FinalRating : null,
            released ? ReviewHistoryRating.Label(review.FinalizedSnapshotJson, review.FinalRating) : null,
            review.FinalizedAt, review.AcknowledgedAt);
    }

    /// <summary>The viewer was left out of a running round: name it and HR's reason (board 18).</summary>
    private async Task<ReviewsWorkspaceNotIncludedDto?> NotIncludedAsync(Guid me, IReadOnlyList<ReviewRound> rounds, CancellationToken token)
    {
        var active = rounds.FirstOrDefault(r => r.State == ReviewRoundState.Active);
        if (active is null) return null;
        var subject = await db.ReviewRoundSubjects.AsNoTracking()
            .FirstOrDefaultAsync(s => s.ReviewRoundId == active.Id && s.SubjectEmployeeId == me && s.IsExcluded, token);
        return subject is null ? null : new ReviewsWorkspaceNotIncludedDto(active.Id, active.Name, subject.ExclusionReason);
    }

    private async Task<ReviewsWorkspaceYearDto> YearAsync(PerformanceCycle cycle, ReviewRound? round, Guid me, CancellationToken token)
    {
        var periodFrom = (round?.PeriodStart ?? cycle.StartDate).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var periodTo = (round?.PeriodEnd ?? cycle.EndDate).AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        // The plan's objectives in any state; progress only once it's approved, weighted like everywhere else.
        var plan = await db.EmployeePlans.AsNoTracking().FirstOrDefaultAsync(p => p.CycleId == cycle.Id && p.EmployeeId == me, token);
        var objectives = plan is null ? [] : await db.Objectives.AsNoTracking()
            .Where(o => o.EmployeePlanId == plan.Id && o.State != ObjectiveLifecycleState.Archived).ToListAsync(token);
        var progress = plan?.State == PlanLifecycleState.Approved && objectives.Any(o => o.HasProgress)
            ? ProgressCalc.PlanProgress(objectives) : (decimal?)null;
        return new ReviewsWorkspaceYearDto(progress, objectives.Count,
            await db.Feedback.AsNoTracking().CountAsync(f => f.ReceiverEmployeeId == me && f.Visibility == FeedbackVisibility.Shared
                && f.SentAt >= periodFrom && f.SentAt < periodTo, token),
            await (from recipient in db.PraiseRecipients.AsNoTracking()
                   join praise in db.Praise.AsNoTracking() on recipient.PraiseId equals praise.Id
                   where recipient.EmployeeId == me && praise.DeletedAt == null && praise.GivenAt >= periodFrom && praise.GivenAt < periodTo
                   select praise.Id).CountAsync(token),
            await (from meeting in db.OneOnOneMeetings.AsNoTracking()
                   join series in db.OneOnOneSeries.AsNoTracking() on meeting.SeriesId equals series.Id
                   where series.ReportEmployeeId == me && meeting.State == OneOnOneMeetingState.Completed
                         && meeting.ScheduledAt >= periodFrom && meeting.ScheduledAt < periodTo
                   select meeting.Id).CountAsync(token));
    }

    private sealed record TeamFacts(decimal? PlanProgress, int AtRisk, int Feedback, int Praise);

    /// <summary>Per person written about: plan progress and risk from approved plans, feedback the reviewer may see and praise, in the round period.</summary>
    private async Task<IReadOnlyList<TeamFacts>> TeamFactsAsync(IReadOnlyList<PerformanceReview> reviews, IReadOnlyDictionary<Guid, ReviewRound> rounds,
        Guid me, CancellationToken token)
    {
        if (reviews.Count == 0) return [];
        var subjects = reviews.Select(r => r.SubjectEmployeeId).Distinct().ToArray();
        var cycleIds = reviews.Select(r => r.CycleId).Distinct().ToArray();
        var objectives = await (from objective in db.Objectives.AsNoTracking()
                                join plan in db.EmployeePlans.AsNoTracking() on objective.EmployeePlanId equals plan.Id
                                where cycleIds.Contains(plan.CycleId) && subjects.Contains(plan.EmployeeId) && plan.State == PlanLifecycleState.Approved
                                      && objective.State != ObjectiveLifecycleState.Archived
                                select new { plan.EmployeeId, objective }).ToListAsync(token);
        var earliest = rounds.Values.Min(r => r.PeriodStart).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var feedback = await db.Feedback.AsNoTracking().Where(f => subjects.Contains(f.ReceiverEmployeeId) && f.SentAt >= earliest
                && (f.Visibility == FeedbackVisibility.Shared || f.Visibility == FeedbackVisibility.ManagerOnly && f.AddressedManagerEmployeeId == me))
            .Select(f => new { f.ReceiverEmployeeId, f.SentAt }).ToListAsync(token);
        var praise = await (from recipient in db.PraiseRecipients.AsNoTracking()
                            join item in db.Praise.AsNoTracking() on recipient.PraiseId equals item.Id
                            where subjects.Contains(recipient.EmployeeId) && item.DeletedAt == null && item.GivenAt >= earliest
                            select new { recipient.EmployeeId, item.GivenAt }).ToListAsync(token);
        return reviews.Select(review =>
        {
            var round = rounds[review.ReviewRoundId];
            var from = round.PeriodStart.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            var to = round.PeriodEnd.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            var mine = objectives.Where(o => o.EmployeeId == review.SubjectEmployeeId).Select(o => o.objective).ToList();
            var withProgress = mine.Where(o => o.HasProgress).ToList();
            return new TeamFacts(withProgress.Count == 0 ? null : decimal.Round(withProgress.Average(o => o.DerivedProgress), 2),
                mine.Count(o => ObjectiveStatuses.IsRisky(o.CurrentStatus)),
                feedback.Count(f => f.ReceiverEmployeeId == review.SubjectEmployeeId && f.SentAt >= from && f.SentAt < to),
                praise.Count(p => p.EmployeeId == review.SubjectEmployeeId && p.GivenAt >= from && p.GivenAt < to));
        }).ToArray();
    }

    private static ReviewsWorkspaceTeamRowDto TeamRow(PerformanceReview review, ReviewRound round, IReadOnlyList<PeerRequest> requests,
        IReadOnlyList<PeerNomination> nominations, DateOnly today)
    {
        var mine = requests.Where(r => r.ReviewId == review.Id).ToList();
        var peerCount = nominations.Count(n => n.ReviewId == review.Id);
        var peerStep = !review.PeerInputEnabled ? "Off" : "Asked";
        var selfStep = !review.SelfAssessmentEnabled ? "Off"
            : review.SelfAssessment.IsSubmitted ? "Submitted"
            : review.SelfAssessment.SavedAt is not null ? "Writing" : "NotStarted";
        var reviewStep = review.State switch
        {
            PerformanceReviewState.SelfAssessment => "Waiting",
            PerformanceReviewState.ManagerAssessment => review.ManagerAssessment.SavedAt is not null ? "Writing" : "ReadyToWrite",
            PerformanceReviewState.Finalized => "Released",
            PerformanceReviewState.Closed => "Closed",
            _ => "Submitted",
        };
        var next = review.State == PerformanceReviewState.ManagerAssessment ? "WriteReview"
            : review.State == PerformanceReviewState.SelfAssessment ? "Wait" : "Done";
        var levels = System.Text.Json.JsonSerializer.Deserialize<RatingScaleLevel[]>(review.RatingScaleSnapshotJson) ?? [];
        var selfRating = review.SelfAssessment.IsSubmitted ? review.SelfAssessment.OverallRating : null;
        return new ReviewsWorkspaceTeamRowDto(review.Id, review.SubjectEmployeeId, review.SubjectDisplayName, review.SubjectJobTitle, round.Name,
            review.State, peerStep, peerCount, selfStep, review.SelfAssessment.SubmittedAt,
            mine.Count(r => r.State == PeerRequestState.Answered), mine.Count, mine.Count(r => r.State == PeerRequestState.Declined),
            reviewStep, review.CurrentStageDueDate,
            review.State is PerformanceReviewState.SelfAssessment or PerformanceReviewState.ManagerAssessment
                ? ReviewReminderSchedule.DaysLate(review.CurrentStageDueDate, today) : 0,
            next, selfRating, levels.FirstOrDefault(l => l.Value == selfRating)?.Label);
    }

    private async Task<IReadOnlyList<ReviewsWorkspacePeerRequestDto>> AskedOfYouAsync(Guid cycleId, Guid me, DateOnly today, CancellationToken token)
    {
        var mine = await db.PeerRequests.AsNoTracking().Where(r => r.CycleId == cycleId && r.PeerEmployeeId == me).ToListAsync(token);
        if (mine.Count == 0) return [];
        var roundIds = mine.Select(r => r.ReviewRoundId).Distinct().ToArray();
        var names = await db.ReviewRounds.AsNoTracking().Where(r => roundIds.Contains(r.Id)).ToDictionaryAsync(r => r.Id, r => r.Name, token);
        var counts = await db.ReviewQuestionSnapshots.AsNoTracking()
            .Where(q => roundIds.Contains(q.ReviewRoundId) && q.Audience == ReviewQuestionAudience.Peer)
            .GroupBy(q => q.ReviewRoundId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count, token);
        return mine.OrderBy(r => r.State != PeerRequestState.Open).ThenBy(r => r.DueDate).ThenBy(r => r.SubjectDisplayName)
            .Select(r => new ReviewsWorkspacePeerRequestDto(r.Id, r.SubjectDisplayName, names.GetValueOrDefault(r.ReviewRoundId, ""),
                counts.GetValueOrDefault(r.ReviewRoundId), r.DueDate,
                r.State == PeerRequestState.Open ? ReviewReminderSchedule.DaysLate(r.DueDate, today) : 0, r.State, r.RespondedAt)).ToArray();
    }

    private async Task<IReadOnlyList<ReviewsWorkspaceRoundDto>> RoundsAsync(IReadOnlyList<ReviewRound> rounds, IReadOnlyList<PerformanceReview> reviews,
        DateOnly today, CancellationToken token)
    {
        var ids = rounds.Select(r => r.Id).ToArray();
        var requests = await db.PeerRequests.AsNoTracking().Where(r => ids.Contains(r.ReviewRoundId)).ToListAsync(token);
        var subjects = await db.ReviewRoundSubjects.AsNoTracking().Where(s => ids.Contains(s.ReviewRoundId) && !s.IsExcluded)
            .GroupBy(s => s.ReviewRoundId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count, token);
        return rounds.Select(round =>
        {
            var mine = reviews.Where(r => r.ReviewRoundId == round.Id).ToList();
            var progress = round.State == ReviewRoundState.Draft ? null
                : ReviewRoundComposer.Progress(round, mine, requests.Where(r => r.ReviewRoundId == round.Id).ToList(), today);
            var components = new[] { round.SelfAssessmentEnabled, round.PeerInputEnabled, round.ObjectiveRatingsEnabled, round.QuestionsEnabled,
                round.PotentialEnabled, round.CalibrationEnabled, ReviewRoundComposerReads.CompetencyIdCount(round.CompetencyIdsJson) > 0 }.Count(on => on);
            var schedule = round.ScheduleFor(round.LaunchedAt is DateTime launched ? DateOnly.FromDateTime(launched) : today);
            return new ReviewsWorkspaceRoundDto(round.Id, round.Name, round.State, round.LaunchedAt, round.PeriodStart, round.PeriodEnd,
                round.State == ReviewRoundState.Draft ? subjects.GetValueOrDefault(round.Id) : mine.Count, components, round.CalibrationEnabled,
                round.SelfAssessmentEnabled ? schedule.SelfAssessment : null, round.PeerInputEnabled ? schedule.PeerInput : null, schedule.ManagerAssessment,
                progress?.Stages ?? [],
                mine.Count(r => r.State == PerformanceReviewState.Finalized),
                mine.Count(r => r.State == PerformanceReviewState.Finalized && r.AcknowledgedAt is not null),
                round.State == ReviewRoundState.Closed ? round.UpdatedAt : null);
        }).OrderBy(r => r.State switch { ReviewRoundState.Active => 0, ReviewRoundState.Draft => 1, _ => 2 }).ThenByDescending(r => r.LaunchedAt).ToArray();
    }

    private async Task<IReadOnlyList<ReviewsWorkspacePastResultDto>> PastResultsAsync(Guid me, CancellationToken token)
    {
        var rows = await (from review in db.PerformanceReviews.AsNoTracking()
                          join round in db.ReviewRounds.AsNoTracking() on review.ReviewRoundId equals round.Id
                          join cycle in db.Cycles.AsNoTracking() on review.CycleId equals cycle.Id
                          where review.SubjectEmployeeId == me && review.State == PerformanceReviewState.Finalized
                          orderby review.FinalizedAt descending
                          select new { review.Id, CycleName = cycle.Name, RoundName = round.Name, review.FinalRating, review.FinalizedSnapshotJson,
                              review.FinalizedAt, review.AcknowledgedAt }).ToListAsync(token);
        return rows.Select(r => new ReviewsWorkspacePastResultDto(r.Id, r.CycleName, r.RoundName, r.FinalRating,
            ReviewHistoryRating.Label(r.FinalizedSnapshotJson, r.FinalRating), r.FinalizedAt, r.AcknowledgedAt)).ToArray();
    }
}

internal static class ReviewRoundComposerReads
{
    public static int CompetencyCount(string? snapshotJson)
    {
        if (string.IsNullOrWhiteSpace(snapshotJson)) return 0;
        try
        {
            using var snapshot = System.Text.Json.JsonDocument.Parse(snapshotJson);
            return snapshot.RootElement.TryGetProperty("competencies", out var values) && values.ValueKind == System.Text.Json.JsonValueKind.Array
                ? values.GetArrayLength() : 0;
        }
        catch (System.Text.Json.JsonException) { return 0; }
    }

    public static int CompetencyIdCount(string json)
    {
        try { return (System.Text.Json.JsonSerializer.Deserialize<Guid[]>(json) ?? []).Length; }
        catch (System.Text.Json.JsonException) { return 0; }
    }
}

using EY.HRPlatform.Performance.Domain.Calibration;
using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Progress;
using EY.HRPlatform.Performance.Features;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Reviews;

public sealed record GetPerformanceReviewQuery(Guid ReviewId, ReviewActor Actor) : IQuery<Result<PerformanceReviewDto>>;
public sealed record ReviewAssessmentDto(string Summary, int? OverallRating, DateTime? SavedAt, DateTime? SubmittedAt);
public sealed record ReviewRatingLevelDto(int Value, string Label, string? Description);
public sealed record ReviewItemAssessmentDto(ReviewItemKind Kind, Guid ItemId, string Title, string? Description,
    IReadOnlyList<string> Behaviors, MeasurementDto? Measurement, bool HasProgress, decimal? Progress,
    int EvidenceCount, IReadOnlyList<ReviewEvidenceRefDto> EvidenceSummary, string? SelfReflection, int? SelfRating, string? SelfComment,
    string? ManagerAssessment, int? ManagerRating, string? LegacyMeasurementSummary = null)
{
    /// <summary>The objective's latest reported status.</summary>
    public ObjectiveStatus? Status { get; init; }
    /// <summary>Recent feedback about the objective the reader may see (shared, or addressed to them as manager).</summary>
    public IReadOnlyList<ReviewObjectiveFeedbackDto> Feedback { get; init; } = [];
    /// <summary>A goal's grade read from its measure (D-38) and its plan weight; each side may change the grade with a reason.</summary>
    public decimal? Grade { get; init; }
    public decimal? Weight { get; init; }
    /// <summary>The measure in one line ("20 → 85 %") and its current value, for the grade's words (D-51).</summary>
    public string? MeasurementSummary { get; init; }
    public decimal? CurrentActual { get; init; }
    public decimal? SelfGrade { get; init; }
    public string? SelfGradeReason { get; init; }
    public decimal? ManagerGrade { get; init; }
    public string? ManagerGradeReason { get; init; }
}
public sealed record ReviewEvidenceRefDto(Guid? EvidenceId, EvidenceKind? Kind, string Label, DateTime? RecordedAt);
public sealed record ReviewObjectiveFeedbackDto(string AuthorName, string Message, DateTime SentAt);

public sealed record PerformanceReviewDto(Guid Id, Guid ReviewRoundId, Guid CycleId, string ReviewRoundName,
    DateOnly PeriodStart, DateOnly PeriodEnd, string SubjectDisplayName, string ReviewerDisplayName,
    PerformanceReviewState State, DateOnly? DueDate, bool SelfAssessmentEnabled, bool CalibrationEnabled, bool CanEditSelfAssessment,
    bool CanEditManagerAssessment, uint Version, Guid RatingScaleVersionId, int RatingScaleVersion, IReadOnlyList<ReviewRatingLevelDto> RatingScale,
    ReviewAssessmentDto? SelfAssessment, ReviewAssessmentDto? ManagerAssessment,
    bool HasApprovedPlan, bool ObjectiveRatingsEnabled, IReadOnlyList<ReviewItemAssessmentDto> Items,
    int? FinalRating, string? FinalRatingSource, DateTime? FinalizedAt, ReviewCalibrationDto? Calibration = null)
{
    /// <summary>Who is reading: Subject, Reviewer, Administrator or Facilitator. Decides which parts are present.</summary>
    public string Lens { get; init; } = "Subject";
    public Guid SubjectEmployeeId { get; init; }
    public Guid ReviewerEmployeeId { get; init; }
    public string? SubjectJobTitle { get; init; }
    public string? SubjectOrgUnitName { get; init; }
    public ReviewRoundState RoundState { get; init; }
    public bool PeerInputEnabled { get; init; }
    public bool QuestionsEnabled { get; init; }
    public bool PotentialEnabled { get; init; }
    /// <summary>The person's and manager's questions, each answer present only when its side is visible.</summary>
    public IReadOnlyList<ReviewQuestionAnswerDto> Questions { get; init; } = [];
    /// <summary>Never for the person (D-24).</summary>
    public ReviewPotential? Potential { get; init; }
    /// <summary>The person sees who was asked; the reviewer and HR also see each request's state and attributed answers.</summary>
    public ReviewPeersDto? Peers { get; init; }
    public ReviewAcknowledgementDto? Acknowledgement { get; init; }
    public ReviewScheduleStateDto? Schedule { get; init; }
    public ReviewYearContextDto? Year { get; init; }
    /// <summary>Round administrators only.</summary>
    public IReadOnlyList<ReviewActivityDto> Activity { get; init; } = [];
    public string? CloseReason { get; init; }
    public bool CanAcknowledge { get; init; }
    public bool CanDownloadPdf { get; init; }
    /// <summary>The manager may change who is asked until their review is in (D-40).</summary>
    public bool CanChangePeers { get; init; }
    /// <summary>The person may take their sent self-review back while the manager hasn't sent theirs.</summary>
    public bool CanTakeBack { get; init; }
    /// <summary>When the released review is on the agenda of the person's next 1:1 with their manager.</summary>
    public DateTime? TalkItOverAt { get; init; }
    public bool CanMoveDueDate { get; init; }
    public bool CanClose { get; init; }
}

public sealed record ReviewQuestionAnswerDto(Guid QuestionId, ReviewQuestionAudience Audience, int SortOrder, string Text,
    string? SelfAnswer, string? ManagerAnswer)
{
    /// <summary>Each drafted sentence and the key of its source in the review's year (H3), while the answer is the draft as written.</summary>
    public IReadOnlyList<ReviewCitation> SelfCitations { get; init; } = [];
    public IReadOnlyList<ReviewCitation> ManagerCitations { get; init; } = [];
}
public sealed record ReviewPeerAnswerDto(Guid QuestionId, string Question, string Text);
/// <summary>A colleague asked. Before results the person sees only who; after, the answers with the name (D-69).</summary>
public sealed record ReviewPeerDto(Guid EmployeeId, string DisplayName, string? Source = null, Guid? RequestId = null,
    PeerRequestState? State = null, string? DeclineNote = null, DateTime? RespondedAt = null, IReadOnlyList<ReviewPeerAnswerDto>? Answers = null);
public sealed record ReviewPeersDto(DateTime? NominatedAt, IReadOnlyList<ReviewPeerDto> People, IReadOnlyList<string> Questions);
public sealed record ReviewAcknowledgementDto(DateTime At, string? Comment);
public sealed record ReviewScheduleStateDto(DateOnly? SelfAssessmentDue, DateOnly? PeerInputDue, DateOnly? ManagerAssessmentDue, int DaysLate,
    bool SelfOverridden, bool ManagerOverridden, DateOnly? NextReminder, IReadOnlyList<DateTime> RemindersSent);
/// <summary>The person's year in the review period, as the reader may see it (D11).</summary>
public sealed record ReviewYearContextDto(Guid SubjectEmployeeId, int Feedback, int Praise, int OneOnOnesHeld, int ActionsDone,
    int DevelopmentGoals, ReviewLastResultDto? LastResult);
public sealed record ReviewLastResultDto(Guid ReviewId, string RoundName, int? Rating, string? Label, DateTime? FinalizedAt);
public sealed record ReviewActivityDto(string Kind, DateTime At, string Text, string? Detail = null);

/// <summary>Why a rating or potential changed in calibration, and who changed it. Never projected to the review's subject.</summary>
public sealed record ReviewCalibrationDto(bool SessionFinalized, int OriginalRating, int? CalibratedRating, string? Rationale)
{
    public ReviewPotential? OriginalPotential { get; init; }
    public ReviewPotential? CalibratedPotential { get; init; }
    public string? ChangedBy { get; init; }
    public DateTime? ChangedAt { get; init; }
    /// <summary>The reviewer may rewrite the summary until release because calibration changed the rating.</summary>
    public bool CanReviseSummary { get; init; }
    public DateTime? SummaryRevisedAt { get; init; }
    public DateTime? SummaryCheckedAt { get; init; }
}

/// <summary>The live questions, potential and peer list before visibility; finalization freezes them.</summary>
public sealed record ReviewExtras(IReadOnlyList<ReviewQuestionAnswerDto> Questions, ReviewPotential? Potential, ReviewPeersDto? Peers);

public static class ReviewComposer
{
    public static PerformanceReviewDto Compose(PerformanceReview review, ReviewRound round, ReviewActor actor,
        bool hasApprovedPlan, IReadOnlyList<ReviewItemAssessmentDto> items, ReviewCalibrationDto? calibration = null,
        int ratingScaleVersion = 0, ReviewExtras? extras = null)
    {
        var visibility = ReviewPolicy.Visibility(actor, review, calibration?.SessionFinalized == true);
        if (!visibility.CanRead) throw new UnauthorizedAccessException("This review is not available to this user.");
        var released = review.State == PerformanceReviewState.Finalized;
        var frozen = released ? ReadFinalizedSnapshot(review.FinalizedSnapshotJson) : null;
        var scale = frozen?.RatingScale ?? (System.Text.Json.JsonSerializer.Deserialize<RatingScaleLevel[]>(review.RatingScaleSnapshotJson) ?? [])
            .Select(level => new ReviewRatingLevelDto(level.Value, level.Label, level.Description)).ToArray();
        var content = frozen?.Items ?? items;
        var questions = frozen?.Questions ?? extras?.Questions ?? [];
        var peers = frozen?.Peers ?? extras?.Peers;
        var showInput = visibility.ShowPeerInputAndPotential;
        var dto = new PerformanceReviewDto(review.Id, review.ReviewRoundId, review.CycleId, frozen?.Review.Name ?? round.Name,
            frozen?.Review.PeriodStart ?? round.PeriodStart, frozen?.Review.PeriodEnd ?? round.PeriodEnd,
            frozen?.Review.SubjectDisplayName ?? review.SubjectDisplayName, frozen?.Review.ReviewerDisplayName ?? review.ReviewerDisplayName,
            review.State, review.CurrentStageDueDate,
            review.SelfAssessmentEnabled, review.CalibrationEnabled, visibility.CanEditSelfAssessment, visibility.CanEditManagerAssessment,
            review.Version, frozen?.RatingScaleVersionId ?? review.RatingScaleVersionId,
            frozen?.RatingScaleVersion ?? ratingScaleVersion, scale,
            frozen?.SelfAssessment ?? (visibility.ShowSelfAssessment ? Assessment(review.SelfAssessment) : null),
            SubjectSafeManagerAssessment(visibility, frozen?.ManagerAssessment)
                ?? (visibility.ShowManagerAssessment ? Assessment(review.ManagerAssessment, visibility.IsSubject) : null),
            frozen?.Review.HasApprovedPlan ?? hasApprovedPlan, review.ObjectiveRatingsEnabled,
            content.Select(item => item with
            {
                SelfReflection = frozen is not null || visibility.ShowSelfAssessment ? item.SelfReflection : null,
                SelfRating = frozen is not null || visibility.ShowSelfAssessment ? item.SelfRating : null,
                SelfComment = frozen is not null || visibility.ShowSelfAssessment ? item.SelfComment : null,
                ManagerAssessment = frozen is not null || visibility.ShowManagerAssessment ? item.ManagerAssessment : null,
                ManagerRating = frozen is not null || visibility.ShowManagerAssessment ? item.ManagerRating : null,
                SelfGrade = frozen is not null || visibility.ShowSelfAssessment ? item.SelfGrade : null,
                SelfGradeReason = frozen is not null || visibility.ShowSelfAssessment ? item.SelfGradeReason : null,
                ManagerGrade = frozen is not null || visibility.ShowManagerAssessment ? item.ManagerGrade : null,
                ManagerGradeReason = frozen is not null || visibility.ShowManagerAssessment ? item.ManagerGradeReason : null,
                // Feedback shown live is filtered to the reader; frozen feedback was the administrator's view, so it stays out.
                Feedback = frozen is not null ? [] : item.Feedback,
            }).ToArray(),
            // A calibrated outcome is set before release; nobody reads it through the review until finalization.
            // The subject gets the final rating but not where it came from: that would be calibration detail.
            released ? review.FinalRating : null, released && !visibility.IsSubject ? review.FinalRatingSource : null, review.FinalizedAt,
            visibility.ShowCalibration ? calibration : null)
        {
            Lens = visibility.IsSubject ? "Subject" : visibility.IsReviewer ? "Reviewer" : visibility.IsAdministrator ? "Administrator" : "Facilitator",
            SubjectEmployeeId = review.SubjectEmployeeId,
            ReviewerEmployeeId = review.ReviewerEmployeeId,
            SubjectJobTitle = review.SubjectJobTitle,
            SubjectOrgUnitName = review.SubjectOrgUnitName,
            RoundState = round.State,
            PeerInputEnabled = review.PeerInputEnabled,
            QuestionsEnabled = review.QuestionsEnabled,
            PotentialEnabled = review.PotentialEnabled && !visibility.IsSubject,
            Questions = questions.Select(question => question with
            {
                SelfAnswer = frozen is not null || visibility.ShowSelfAssessment ? question.SelfAnswer : null,
                ManagerAnswer = frozen is not null || visibility.ShowManagerAssessment ? question.ManagerAnswer : null,
                // Citations point into the writer's year; the person reads the manager's words without them.
                SelfCitations = frozen is null && visibility.ShowSelfAssessment ? question.SelfCitations : [],
                ManagerCitations = frozen is null && visibility.ShowManagerAssessment && !visibility.IsSubject ? question.ManagerCitations : [],
            }).ToArray(),
            Potential = showInput ? frozen?.Potential ?? extras?.Potential : null,
            Peers = peers is null ? null
                : showInput ? peers
                // Once results are out the person reads what peers answered, with their names (D-69); before, only who was asked.
                : visibility.IsSubject && released ? peers with
                {
                    People = peers.People.Where(peer => peer.Answers is { Count: > 0 })
                        .Select(peer => new ReviewPeerDto(peer.EmployeeId, peer.DisplayName, Answers: peer.Answers)).ToArray(),
                }
                : visibility.IsSubject ? peers with
                {
                    People = peers.People.Select(peer => new ReviewPeerDto(peer.EmployeeId, peer.DisplayName)).ToArray(),
                    Questions = [],
                }
                : null,
            Acknowledgement = review.AcknowledgedAt is DateTime at && (visibility.IsSubject || visibility.IsReviewer || visibility.IsAdministrator)
                ? new(at, review.AcknowledgementComment) : null,
            CloseReason = review.State == PerformanceReviewState.Closed && !visibility.IsSubject ? review.CloseReason : null,
            CanAcknowledge = visibility.IsSubject && released && review.AcknowledgedAt is null,
            CanDownloadPdf = released && (visibility.IsSubject || visibility.IsReviewer || visibility.IsAdministrator),
            CanChangePeers = visibility.IsReviewer && review.PeerInputEnabled
                && review.State is PerformanceReviewState.SelfAssessment or PerformanceReviewState.ManagerAssessment
                && !review.ManagerAssessment.IsSubmitted,
            CanTakeBack = visibility.IsSubject && review.SelfAssessment.IsSubmitted && review.State == PerformanceReviewState.ManagerAssessment
                && !review.ManagerAssessment.IsSubmitted,
            CanMoveDueDate = actor.IsAdministrator && !visibility.IsSubject && round.State == ReviewRoundState.Active
                && (review.State == PerformanceReviewState.SelfAssessment && review.SelfAssessmentEnabled
                    || review.State == PerformanceReviewState.ManagerAssessment && !review.ManagerAssessment.IsSubmitted),
            CanClose = actor.IsAdministrator && !visibility.IsSubject && round.State == ReviewRoundState.Active
                && review.State is not (PerformanceReviewState.Finalized or PerformanceReviewState.Closed),
        };
        return dto;
    }

    private static ReviewFinalizedSnapshot? ReadFinalizedSnapshot(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            var options = new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true };
            options.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
            using var document = System.Text.Json.JsonDocument.Parse(json);
            var legacyShape = document.RootElement.TryGetProperty("items", out var items)
                && items.ValueKind == System.Text.Json.JsonValueKind.Array
                && items.EnumerateArray().Any(item => item.TryGetProperty("measurementSummary", out _)
                    || item.TryGetProperty("evidenceSummary", out var evidence) && evidence.ValueKind == System.Text.Json.JsonValueKind.Array
                    && evidence.EnumerateArray().Any(value => value.ValueKind == System.Text.Json.JsonValueKind.String));
            if (!legacyShape) return System.Text.Json.JsonSerializer.Deserialize<ReviewFinalizedSnapshot>(json, options);
            var legacy = System.Text.Json.JsonSerializer.Deserialize<LegacyReviewFinalizedSnapshot>(json, options);
            if (legacy is null) return null;
            var converted = legacy.Items.Select(item => new ReviewItemAssessmentDto(item.Kind, item.ItemId, item.Title,
                item.Description, item.Behaviors, null, item.HasProgress, item.Progress, item.EvidenceSummary.Count,
                item.EvidenceSummary.Select(label => new ReviewEvidenceRefDto(null, null, label, null)).ToArray(),
                item.SelfReflection, item.SelfRating, item.SelfComment, item.ManagerAssessment, item.ManagerRating,
                item.MeasurementSummary)).ToArray();
            return new ReviewFinalizedSnapshot(legacy.Review, legacy.RatingScale, legacy.SelfAssessment, legacy.ManagerAssessment,
                converted, legacy.RatingScaleVersionId, legacy.RatingScaleVersion);
        }
        catch (System.Text.Json.JsonException) { return null; }
    }

    /// <summary>What a finalized review froze. Questions, potential and peers exist only in snapshots taken since slice 4.</summary>
    internal sealed record ReviewFinalizedSnapshot(ReviewSnapshotFacts Review, IReadOnlyList<ReviewRatingLevelDto> RatingScale,
        ReviewAssessmentDto? SelfAssessment, ReviewAssessmentDto? ManagerAssessment, IReadOnlyList<ReviewItemAssessmentDto> Items,
        Guid? RatingScaleVersionId = null, int? RatingScaleVersion = null, IReadOnlyList<ReviewQuestionAnswerDto>? Questions = null,
        ReviewPotential? Potential = null, ReviewPeersDto? Peers = null);
    private sealed record LegacyReviewFinalizedSnapshot(ReviewSnapshotFacts Review, IReadOnlyList<ReviewRatingLevelDto> RatingScale,
        ReviewAssessmentDto? SelfAssessment, ReviewAssessmentDto? ManagerAssessment, IReadOnlyList<LegacyReviewItemAssessmentDto> Items,
        Guid? RatingScaleVersionId = null, int? RatingScaleVersion = null);
    private sealed record LegacyReviewItemAssessmentDto(ReviewItemKind Kind, Guid ItemId, string Title, string? Description,
        IReadOnlyList<string> Behaviors, string? MeasurementSummary, bool HasProgress, decimal? Progress,
        IReadOnlyList<string> EvidenceSummary, string? SelfReflection, int? SelfRating, string? SelfComment,
        string? ManagerAssessment, int? ManagerRating);
    internal sealed record ReviewSnapshotFacts(Guid Id, Guid CycleId, Guid ReviewRoundId, string Name, DateOnly PeriodStart,
        DateOnly PeriodEnd, Guid SubjectEmployeeId, string SubjectDisplayName, Guid ReviewerEmployeeId,
        string ReviewerDisplayName, bool SelfAssessmentEnabled, bool ObjectiveRatingsEnabled, bool HasApprovedPlan,
        string? SubjectJobTitle = null, Guid? SubjectOrgUnitId = null, string? SubjectOrgUnitName = null, string? ReviewerBasis = null);

    private static ReviewAssessmentDto Assessment(ReviewAssessment value)
        => new(value.Summary, value.OverallRating, value.SavedAt, value.SubmittedAt);

    private static ReviewAssessmentDto? SubjectSafeManagerAssessment(ReviewVisibility visibility, ReviewAssessmentDto? assessment)
        => assessment is not null && visibility.IsSubject ? assessment with { OverallRating = null } : assessment;

    private static ReviewAssessmentDto Assessment(ReviewAssessment value, bool isSubject)
        => new(value.Summary, isSubject ? null : value.OverallRating, value.SavedAt, value.SubmittedAt);
}

public sealed class GetPerformanceReviewHandler(PerformanceDbContext db)
    : IQueryHandler<GetPerformanceReviewQuery, Result<PerformanceReviewDto>>
{
    public async Task<Result<PerformanceReviewDto>> Handle(GetPerformanceReviewQuery query, CancellationToken token)
    {
        var review = await db.PerformanceReviews.AsNoTracking().FirstOrDefaultAsync(item => item.Id == query.ReviewId, token);
        if (review is null) return Result.Failure<PerformanceReviewDto>(PerformanceErrors.NotFound("PerformanceReview", query.ReviewId));
        var round = await db.ReviewRounds.AsNoTracking().FirstOrDefaultAsync(item => item.Id == review.ReviewRoundId, token);
        if (round is null) return Result.Failure<PerformanceReviewDto>(PerformanceErrors.NotFound("ReviewRound", review.ReviewRoundId));
        var ratingScaleVersion = await db.RatingScaleVersions.AsNoTracking()
            .SingleAsync(item => item.Id == review.RatingScaleVersionId, token);
        var session = await db.CalibrationSessions.AsNoTracking().FirstOrDefaultAsync(item => item.ReviewRoundId == review.ReviewRoundId, token);
        var calibrationSubject = session is null ? null : await db.CalibrationSubjects.AsNoTracking()
            .FirstOrDefaultAsync(item => item.SessionId == session.Id && item.ReviewId == review.Id, token);
        var lastChange = calibrationSubject is null ? null : await db.CalibrationAdjustments.AsNoTracking()
            .Where(item => item.SubjectId == calibrationSubject.Id).OrderByDescending(item => item.At).FirstOrDefaultAsync(token);
        var calibration = calibrationSubject is null ? null : new ReviewCalibrationDto(session!.State == CalibrationSessionState.Finalized,
            calibrationSubject.OriginalRating, calibrationSubject.CalibratedRating, calibrationSubject.Rationale)
        {
            OriginalPotential = calibrationSubject.OriginalPotential,
            CalibratedPotential = calibrationSubject.CalibratedPotential,
            ChangedBy = calibrationSubject.IsAdjusted || calibrationSubject.IsPotentialAdjusted ? lastChange?.ActorDisplayName : null,
            ChangedAt = calibrationSubject.IsAdjusted || calibrationSubject.IsPotentialAdjusted ? lastChange?.At : null,
            SummaryRevisedAt = review.SummaryRevisedAt,
            SummaryCheckedAt = review.SummaryCheckedAt,
        };
        // Facilitation is a seat on this round's open session with this review as a subject, plus the grant.
        var actor = query.Actor.CalibratorUserId is Guid calibrator && calibrationSubject is not null
            && session!.State == CalibrationSessionState.Open
            && CalibrationPolicy.CanView(query.Actor.CalibratorUserId is not null, session, calibrator)
            ? query.Actor with { IsCalibrationFacilitator = true } : query.Actor with { IsCalibrationFacilitator = false };
        var visibility = ReviewPolicy.Visibility(actor, review, calibration?.SessionFinalized == true);
        if (!visibility.CanRead)
            return Result.Failure<PerformanceReviewDto>(PerformanceErrors.Forbidden(PerformanceErrors.Codes.ReviewAssessmentForbidden,
                "You do not have a relationship to this review."));
        if (calibration is not null)
            calibration = calibration with
            {
                CanReviseSummary = visibility.IsReviewer && review.State == PerformanceReviewState.ReadyToFinalize && review.CalibrationChangedRating,
            };

        var plan = await db.EmployeePlans.AsNoTracking().FirstOrDefaultAsync(item => item.CycleId == review.CycleId
            && item.EmployeeId == review.SubjectEmployeeId && item.State == PlanLifecycleState.Approved, token);
        var objectives = plan is null ? [] : await db.Objectives.AsNoTracking()
            .Where(item => item.EmployeePlanId == plan.Id && item.State != ObjectiveLifecycleState.Archived)
            .OrderBy(item => item.CreatedAt).ToListAsync(token);
        var objectiveIds = objectives.Select(item => item.Id).ToArray();
        var progress = objectiveIds.Length == 0 ? [] : await db.ProgressUpdates.AsNoTracking().Include(item => item.Evidence)
            .Where(item => objectiveIds.Contains(item.ObjectiveId)).OrderByDescending(item => item.RecordedAt).ToListAsync(token);
        var responses = await db.ReviewItemResponses.AsNoTracking().Where(item => item.ReviewId == review.Id).ToListAsync(token);
        var responseMap = responses.ToDictionary(item => (item.Kind, item.ItemId));
        var competencySnapshot = ReadCompetencies(round.ConfigSnapshotJson);
        var viewer = actor.IsAdministrator && !visibility.IsReviewer ? Guid.Empty : actor.EmployeeId;
        var objectiveFeedback = objectiveIds.Length == 0 || actor.IsCalibrationFacilitator && !visibility.IsReviewer && !visibility.IsSubject
            ? [] : await VisibleFeedback(review.SubjectEmployeeId, viewer)
                .Where(item => item.ObjectiveId != null && objectiveIds.Contains(item.ObjectiveId.Value))
                .OrderByDescending(item => item.SentAt)
                .Select(item => new { ObjectiveId = item.ObjectiveId!.Value, item.AuthorName, item.Message, item.SentAt })
                .ToListAsync(token);
        var items = objectives.Select(objective =>
        {
            responseMap.TryGetValue((ReviewItemKind.Objective, objective.Id), out var response);
            var evidence = progress.Where(update => update.ObjectiveId == objective.Id).SelectMany(update =>
                update.Evidence.Select(item => new ReviewEvidenceRefDto(item.Id, item.Kind, EvidenceLabel(item), update.RecordedAt)))
                .ToArray();
            return new ReviewItemAssessmentDto(ReviewItemKind.Objective, objective.Id, objective.Title, objective.Description,
                [], PerformanceMappers.ToDtoOrNull(objective.Measurement), objective.HasProgress,
                objective.HasProgress ? decimal.Round(objective.DerivedProgress, 2) : null,
                evidence.Length, evidence.Take(12).ToArray(), response?.SelfReflection, response?.SelfRating, response?.SelfComment,
                response?.ManagerAssessment, response?.ManagerRating)
            {
                Status = objective.CurrentStatus,
                Grade = GoalGrades.Of(objective),
                Weight = objective.PlanWeight,
                MeasurementSummary = PerformanceMappers.MeasurementSummary(objective),
                CurrentActual = objective.CurrentActual,
                SelfGrade = response?.SelfGrade,
                SelfGradeReason = response?.SelfGradeReason,
                ManagerGrade = response?.ManagerGrade,
                ManagerGradeReason = response?.ManagerGradeReason,
                Feedback = objectiveFeedback.Where(item => item.ObjectiveId == objective.Id).Take(2)
                    .Select(item => new ReviewObjectiveFeedbackDto(item.AuthorName, item.Message, item.SentAt)).ToArray(),
            };
        }).Concat(competencySnapshot.Select(competency =>
        {
            responseMap.TryGetValue((ReviewItemKind.Competency, competency.Id), out var response);
            return new ReviewItemAssessmentDto(ReviewItemKind.Competency, competency.Id, competency.Name, competency.Description,
                competency.Behaviors, null, false, null, 0, [], response?.SelfReflection, response?.SelfRating,
                response?.SelfComment, response?.ManagerAssessment, response?.ManagerRating);
        })).ToArray();
        var extras = await ExtrasAsync(review, token);
        var dto = ReviewComposer.Compose(review, round, actor, plan is not null, items, calibration, ratingScaleVersion.Number, extras);
        if (dto.Lens == "Facilitator") return Result.Success(dto);
        return Result.Success(dto with
        {
            Schedule = await ScheduleAsync(review, round, visibility.IsAdministrator, token),
            Year = await YearAsync(review, round, viewer, token),
            TalkItOverAt = visibility.IsSubject && review.State == PerformanceReviewState.Finalized ? await TalkItOverAsync(review, token) : null,
            Activity = visibility.IsAdministrator || actor.IsAdministrator && visibility.IsReviewer ? await ActivityAsync(review, token) : [],
        });
    }

    /// <summary>Questions with both sides' answers, potential and the peer list with attributed answers, before visibility.</summary>
    public async Task<ReviewExtras> ExtrasAsync(PerformanceReview review, CancellationToken token)
    {
        var snapshots = await db.ReviewQuestionSnapshots.AsNoTracking().Where(q => q.ReviewRoundId == review.ReviewRoundId)
            .OrderBy(q => q.Audience).ThenBy(q => q.SortOrder).ToListAsync(token);
        var answers = await db.ReviewQuestionAnswers.AsNoTracking().Where(a => a.ReviewId == review.Id).ToListAsync(token);
        var questions = !review.QuestionsEnabled ? Array.Empty<ReviewQuestionAnswerDto>() : snapshots
            .Where(q => q.Audience != ReviewQuestionAudience.Peer && (q.Audience == ReviewQuestionAudience.Manager || review.SelfAssessmentEnabled))
            .Select(q =>
            {
                var self = answers.FirstOrDefault(a => a.QuestionSnapshotId == q.Id && a.Author == ReviewQuestionAuthor.Self);
                var manager = answers.FirstOrDefault(a => a.QuestionSnapshotId == q.Id && a.Author == ReviewQuestionAuthor.Manager);
                return new ReviewQuestionAnswerDto(q.Id, q.Audience, q.SortOrder, q.Text, self?.Text, manager?.Text)
                {
                    SelfCitations = self?.Citations ?? [],
                    ManagerCitations = manager?.Citations ?? [],
                };
            }).ToArray();
        ReviewPeersDto? peers = null;
        if (review.PeerInputEnabled)
        {
            var peerQuestions = snapshots.Where(q => q.Audience == ReviewQuestionAudience.Peer).ToList();
            var nominations = await db.PeerNominations.AsNoTracking().Where(n => n.ReviewId == review.Id).OrderBy(n => n.NominatedAt)
                .ThenBy(n => n.DisplayName).ToListAsync(token);
            var requests = await db.PeerRequests.AsNoTracking().Include(r => r.Answers).Where(r => r.ReviewId == review.Id).ToListAsync(token);
            peers = new ReviewPeersDto(review.PeersNominatedAt,
                nominations.Select(nomination =>
                {
                    var request = requests.FirstOrDefault(r => r.PeerEmployeeId == nomination.EmployeeId);
                    return new ReviewPeerDto(nomination.EmployeeId, nomination.DisplayName, nomination.Source.ToString(), request?.Id,
                        request?.State, request?.DeclineNote, request?.RespondedAt,
                        request is null || request.State != PeerRequestState.Answered ? [] : peerQuestions
                            .Select(q => (Question: q, Answer: request.Answers.FirstOrDefault(a => a.QuestionSnapshotId == q.Id)))
                            .Where(pair => pair.Answer is not null)
                            .Select(pair => new ReviewPeerAnswerDto(pair.Question.Id, pair.Question.Text, pair.Answer!.Text)).ToArray());
                }).ToArray(),
                peerQuestions.Select(q => q.Text).ToArray());
        }
        // After calibration the reviewer and HR read the settled potential; the manager's stays on the calibration block.
        return new ReviewExtras(questions, review.FinalPotential ?? review.Potential, peers);
    }

    /// <summary>Feedback received by the person that the reader may see: shared, or manager-only addressed to them.</summary>
    private IQueryable<Feedback> VisibleFeedback(Guid subjectId, Guid viewerId)
        => db.Feedback.AsNoTracking().Where(item => item.ReceiverEmployeeId == subjectId
            && (item.Visibility == FeedbackVisibility.Shared
                || viewerId != Guid.Empty && item.Visibility == FeedbackVisibility.ManagerOnly && item.AddressedManagerEmployeeId == viewerId));

    private async Task<ReviewScheduleStateDto> ScheduleAsync(PerformanceReview review, ReviewRound round, bool administrator, CancellationToken token)
    {
        var today = PerformanceClock.Today;
        var sent = administrator
            ? await db.Notifications.AsNoTracking().Where(n => n.Kind == PerformanceNotificationKind.ReviewReminder && n.ResourceId == review.Id)
                .OrderBy(n => n.OccurredAt).Select(n => n.OccurredAt).ToListAsync(token)
            : [];
        var openTask = review.State == PerformanceReviewState.SelfAssessment && !review.SelfAssessment.IsSubmitted
            || review.State == PerformanceReviewState.ManagerAssessment && !review.ManagerAssessment.IsSubmitted;
        DateOnly? next = openTask && round.State == ReviewRoundState.Active && review.CurrentStageDueDate is DateOnly due
            ? ReviewReminderSchedule.NextTaskReminder(due, today.AddDays(1)) : null;
        return new ReviewScheduleStateDto(review.SelfAssessmentDueDate, round.PeerInputDueDate, review.ManagerAssessmentDueDate,
            openTask ? ReviewReminderSchedule.DaysLate(review.CurrentStageDueDate, today) : 0,
            review.SelfDueOverridden, review.ManagerDueOverridden, next, sent);
    }

    private async Task<ReviewYearContextDto> YearAsync(PerformanceReview review, ReviewRound round, Guid viewer, CancellationToken token)
    {
        var periodFrom = round.PeriodStart.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var periodTo = round.PeriodEnd.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var subject = review.SubjectEmployeeId;
        var feedback = await VisibleFeedback(subject, viewer).CountAsync(item => item.SentAt >= periodFrom && item.SentAt < periodTo, token);
        var praise = await (from recipient in db.PraiseRecipients.AsNoTracking()
                            join item in db.Praise.AsNoTracking() on recipient.PraiseId equals item.Id
                            where recipient.EmployeeId == subject && item.DeletedAt == null && item.GivenAt >= periodFrom && item.GivenAt < periodTo
                            select item.Id).CountAsync(token);
        var held = await (from meeting in db.OneOnOneMeetings.AsNoTracking()
                          join series in db.OneOnOneSeries.AsNoTracking() on meeting.SeriesId equals series.Id
                          where series.ReportEmployeeId == subject && meeting.State == OneOnOneMeetingState.Completed
                                && meeting.ScheduledAt >= periodFrom && meeting.ScheduledAt < periodTo
                          select meeting.Id).CountAsync(token);
        var actions = await db.OneOnOneActionItems.AsNoTracking()
            .CountAsync(item => item.OwnerEmployeeId == subject && item.DoneAt >= periodFrom && item.DoneAt < periodTo, token);
        var goals = await (from goal in db.DevelopmentGoals.AsNoTracking()
                           join development in db.DevelopmentPlans.AsNoTracking() on goal.DevelopmentPlanId equals development.Id
                           where development.EmployeeId == subject && development.CycleId == review.CycleId
                           select goal.Id).CountAsync(token);
        var last = await (from earlier in db.PerformanceReviews.AsNoTracking()
                          join earlierRound in db.ReviewRounds.AsNoTracking() on earlier.ReviewRoundId equals earlierRound.Id
                          where earlier.SubjectEmployeeId == subject && earlier.Id != review.Id && earlier.State == PerformanceReviewState.Finalized
                                && earlier.FinalizedAt < (review.FinalizedAt ?? DateTime.MaxValue)
                          orderby earlier.FinalizedAt descending
                          select new { earlier.Id, earlierRound.Name, earlier.FinalRating, earlier.FinalizedSnapshotJson, earlier.FinalizedAt })
            .FirstOrDefaultAsync(token);
        return new ReviewYearContextDto(subject, feedback, praise, held, actions, goals, last is null ? null
            : new ReviewLastResultDto(last.Id, last.Name, last.FinalRating, ReviewHistoryRating.Label(last.FinalizedSnapshotJson, last.FinalRating), last.FinalizedAt));
    }

    /// <summary>The upcoming 1:1 whose agenda carries this review, if the person asked to talk it over.</summary>
    private async Task<DateTime?> TalkItOverAsync(PerformanceReview review, CancellationToken token)
        => await (from item in db.OneOnOneAgendaItems.AsNoTracking()
                  join meeting in db.OneOnOneMeetings.AsNoTracking() on item.MeetingId equals meeting.Id
                  where item.SourceKind == AgendaSourceKind.Review && item.SourceId == review.Id
                        && meeting.State == OneOnOneMeetingState.Upcoming
                  orderby meeting.ScheduledAt
                  select (DateTime?)meeting.ScheduledAt).FirstOrDefaultAsync(token);

    private async Task<IReadOnlyList<ReviewActivityDto>> ActivityAsync(PerformanceReview review, CancellationToken token)
    {
        var activity = new List<ReviewActivityDto> { new("Opened", review.OpenedAt, "Review opened") };
        if (review.PeersNominatedAt is DateTime asked) activity.Add(new("PeersAsked", asked, "Peers asked"));
        if (review.SelfAssessment.SubmittedAt is DateTime self) activity.Add(new("SelfSubmitted", self, "Self-assessment submitted"));
        if (review.ManagerAssessment.SubmittedAt is DateTime manager) activity.Add(new("ManagerSubmitted", manager, "Manager assessment submitted"));
        foreach (var move in await db.ReviewDueDateMoves.AsNoTracking().Where(m => m.ReviewId == review.Id).ToListAsync(token))
            activity.Add(new("DueDateMoved", move.MovedAt,
                $"{ReviewRoundComposer.StageLabel(move.Stage)} moved to {move.ToDate:ddd d MMM} by {move.ActorName}", move.Reason));
        foreach (var reminder in await db.Notifications.AsNoTracking()
                     .Where(n => n.Kind == PerformanceNotificationKind.ReviewReminder && n.ResourceId == review.Id).ToListAsync(token))
            activity.Add(new("Reminder", reminder.OccurredAt, $"Reminder sent · {reminder.Title}"));
        if (review.FinalizedAt is DateTime released) activity.Add(new("Released", released, "Result released"));
        if (review.AcknowledgedAt is DateTime acknowledged) activity.Add(new("Acknowledged", acknowledged, "Result acknowledged"));
        if (review.ClosedAt is DateTime closed) activity.Add(new("Closed", closed, "Closed without a result", review.CloseReason));
        return activity.OrderByDescending(a => a.At).ToArray();
    }

    private static string EvidenceLabel(EvidenceItem item) => item.Kind switch
    {
        EvidenceKind.File => item.FileName ?? "File evidence",
        EvidenceKind.Link => item.ReferenceText ?? item.Url ?? "Linked evidence",
        _ => item.ReferenceText ?? "Evidence",
    };

    private static IReadOnlyList<CompetencySnapshot> ReadCompetencies(string? snapshot)
    {
        if (string.IsNullOrWhiteSpace(snapshot)) return [];
        try { return System.Text.Json.JsonSerializer.Deserialize<ReviewConfigSnapshot>(snapshot,
            new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true })?.Competencies ?? []; }
        catch (System.Text.Json.JsonException) { return []; }
    }

    private sealed record ReviewConfigSnapshot(IReadOnlyList<CompetencySnapshot>? Competencies);
    private sealed record CompetencySnapshot(Guid Id, string Name, string Description, IReadOnlyList<string> Behaviors);
}

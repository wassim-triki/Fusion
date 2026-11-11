using EY.HRPlatform.Performance.Domain.Reviews;

namespace EY.HRPlatform.Performance.Features.Security.Policies;

/// <summary>
/// Who is reading. <see cref="CalibratorUserId"/> is set only when the caller holds the calibrate
/// grant; the review query then makes them a calibrator of a review in calibration (D-35).
/// </summary>
public sealed record ReviewActor(Guid EmployeeId, bool IsAdministrator, bool IsCalibrationFacilitator = false,
    Guid? CalibratorUserId = null, bool CanParticipate = false, bool CanReviewReports = false);
public sealed record ReviewVisibility(bool CanRead, bool ShowSelfAssessment, bool ShowManagerAssessment,
    bool CanEditSelfAssessment, bool CanEditManagerAssessment, bool ShowCalibration = false, bool IsSubject = false)
{
    public bool IsReviewer { get; init; }
    /// <summary>A round administrator reading someone else's review.</summary>
    public bool IsAdministrator { get; init; }
    /// <summary>Potential and attributed peer answers: the reviewer and round administrators, never the person (D-R5).</summary>
    public bool ShowPeerInputAndPotential => !IsSubject && (IsReviewer || IsAdministrator);
}

/// <summary>Object-level review permissions and the stage-specific content projection.</summary>
public static class ReviewPolicy
{
    public static IQueryable<PerformanceReview> Readable(IQueryable<PerformanceReview> reviews, ReviewActor actor)
    {
        if (actor.IsAdministrator) return reviews;
        if (actor.EmployeeId == Guid.Empty) return reviews.Where(_ => false);
        var employeeId = actor.EmployeeId;
        return reviews.Where(review => review.SubjectEmployeeId == employeeId
            || actor.CanReviewReports && review.ReviewerEmployeeId == employeeId);
    }

    public static bool CanSelfAssess(ReviewActor actor, PerformanceReview review, bool allowSubmittedRetry = false)
        => actor.CanParticipate && actor.EmployeeId != Guid.Empty && actor.EmployeeId == review.SubjectEmployeeId
            && review.SelfAssessmentEnabled
            && (review.State == PerformanceReviewState.SelfAssessment && !review.SelfAssessment.IsSubmitted
                || allowSubmittedRetry && review.SelfAssessment.IsSubmitted);

    public static bool CanManagerAssess(ReviewActor actor, PerformanceReview review, bool allowSubmittedRetry = false)
        => actor.CanReviewReports && actor.EmployeeId != Guid.Empty && actor.EmployeeId == review.ReviewerEmployeeId
            && (review.State is PerformanceReviewState.SelfAssessment or PerformanceReviewState.ManagerAssessment && !review.ManagerAssessment.IsSubmitted
                || allowSubmittedRetry && review.ManagerAssessment.IsSubmitted);

    public static ReviewVisibility Visibility(ReviewActor actor, PerformanceReview review, bool calibrationDecided = false)
    {
        var isSubject = actor.EmployeeId != Guid.Empty && actor.EmployeeId == review.SubjectEmployeeId;
        var isReviewer = actor.CanReviewReports && actor.EmployeeId != Guid.Empty
            && actor.EmployeeId == review.ReviewerEmployeeId;
        // Calibrating never extends to one's own review: the subject boundary wins.
        var facilitator = actor.IsCalibrationFacilitator && !isSubject && review.State == PerformanceReviewState.Calibration;
        var canRead = actor.IsAdministrator || isSubject || isReviewer || facilitator;
        if (!canRead) return new(false, false, false, false, false);
        // Calibration detail: calibrators while they calibrate; reviewers and round administrators
        // once a decision is taken; never the subject, even one who also administers rounds.
        var showCalibration = !isSubject && (facilitator
            || ((isReviewer || actor.IsAdministrator) && calibrationDecided));
        // A subject sees their own reflection throughout the workflow, but manager content only
        // after the administrative release boundary. A reviewer sees self content only once sent.
        var showSelf = isSubject || (actor.IsAdministrator && !isSubject) || (isReviewer && review.SelfAssessment.IsSubmitted)
            || (facilitator && review.SelfAssessment.IsSubmitted);
        var showManager = isReviewer || (actor.IsAdministrator && !isSubject) || (isSubject && review.State == PerformanceReviewState.Finalized)
            || (facilitator && review.ManagerAssessment.IsSubmitted);
        var canEditSelf = CanSelfAssess(actor, review);
        var canEditManager = CanManagerAssess(actor, review);
        return new(true, showSelf, showManager, canEditSelf, canEditManager, showCalibration, isSubject)
        {
            IsReviewer = isReviewer && !isSubject,
            IsAdministrator = actor.IsAdministrator && !isSubject,
        };
    }
}

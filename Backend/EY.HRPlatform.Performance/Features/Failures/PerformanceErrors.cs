using EY.HRPlatform.SharedKernel.Results;

namespace EY.HRPlatform.Performance.Features.Failures;

public enum FailureKind { NotFound, Forbidden, Validation, InvalidState, Stale, UpstreamUnavailable }
public sealed record FailureInfo(FailureKind Kind, object? Extra = null);
public sealed record FailureDetails(string Code, FailureKind Kind, object? Extra = null);

public static class PerformanceErrors
{
    public static Error Create(string code, string message, FailureKind kind, object? extra = null)
        => new(code, message, new FailureInfo(kind, extra));
    public static Error NotFound(string entity, Guid id)
        => Create($"{entity}.NotFound", $"{entity} with Id '{id}' was not found.", FailureKind.NotFound);
    public static Error Validation(string code, string message, object? extra = null) => Create(code, message, FailureKind.Validation, extra);
    public static Error InvalidState(string code, string message, object? extra = null) => Create(code, message, FailureKind.InvalidState, extra);
    public static Error Forbidden(string code, string message) => Create(code, message, FailureKind.Forbidden);
    public static Error Stale(string code, string message) => Create(code, message, FailureKind.Stale);
    public static Error Changed() => Stale("Performance.Stale", "This changed since you opened it. Refresh and try again.");
    public static Error CoreUnavailable() => Create("Core.Unavailable", "Workforce information is temporarily unavailable. Try again.", FailureKind.UpstreamUnavailable);
    /// <summary>AI is off for the tenant, not configured, resting, or the call failed. Clients hide AI quietly.</summary>
    public static Error AiUnavailable() => Create(Codes.AiUnavailable, "Suggestions are not available right now.", FailureKind.UpstreamUnavailable);
    public static Error UniqueConflict() => InvalidState("Performance.UniqueConflict", "This action conflicts with an existing record. Refresh and try again.");
    public static FailureDetails Details(Error error)
        => error.Details is FailureInfo info ? new(error.Code, info.Kind, info.Extra)
            : throw new InvalidOperationException($"Performance error '{error.Code}' has no failure kind.");

    public static class Codes
    {
        public const string AiUnavailable = "Performance.AiUnavailable";
        public const string CoachInvalid = "Coach.Invalid";
        public const string CycleClosed = "Cycle.Closed";
        public const string CycleNotActive = "Cycle.NotActive";
        public const string CycleHasActiveReviewRound = "Cycle.HasActiveReviewRound";
        public const string CycleClosureUnresolved = "Cycle.ClosureUnresolved";
        public const string CycleEarlyCloseReason = "Cycle.EarlyCloseReason";
        public const string CycleNotDeletable = "Cycle.NotDeletable";
        public const string CycleInvalid = "Cycle.Invalid";
        public const string CycleNotActivatable = "Cycle.NotActivatable";
        public const string CycleNotDraft = "Cycle.NotDraft";
        public const string CycleNotFound = "Cycle.NotFound";
        public const string DevelopmentForbidden = "Development.Forbidden";
        public const string DevelopmentInvalid = "Development.Invalid";
        public const string DevelopmentNotParticipant = "Development.NotParticipant";
        public const string DevelopmentReadOnly = "Development.ReadOnly";
        public const string EvidenceUploadInvalid = "Evidence.UploadInvalid";
        public const string EvidenceForbidden = "Evidence.Forbidden";
        public const string EvidenceNotFound = "Evidence.NotFound";
        public const string OneOnOneNotReportingLine = "OneOnOne.NotReportingLine";
        public const string OneOnOneSeriesEnded = "OneOnOne.SeriesEnded";
        public const string OneOnOneAlreadyActive = "OneOnOne.AlreadyActive";
        public const string OneOnOneInvalid = "OneOnOne.Invalid";
        public const string OneOnOneWrongState = "OneOnOne.WrongState";
        public const string OneOnOneForbidden = "OneOnOne.Forbidden";
        public const string OneOnOneNotesChanged = "OneOnOne.NotesChanged";
        public const string FeedbackInvalid = "Feedback.Invalid";
        public const string FeedbackNoManager = "Feedback.NoManager";
        public const string FeedbackReceiverUnavailable = "Feedback.ReceiverUnavailable";
        public const string FeedbackIdConflict = "Feedback.IdConflict";
        public const string FeedbackRequestClosed = "FeedbackRequest.Closed";
        public const string FeedbackRequestForbidden = "FeedbackRequest.Forbidden";
        public const string PraiseInvalid = "Praise.Invalid";
        public const string PraiseDeleteForbidden = "Praise.DeleteForbidden";
        public const string ObjectiveAlignment = "Objective.Alignment";
        public const string ObjectiveAlignmentIneligible = "Objective.AlignmentIneligible";
        public const string ObjectiveContribution = "Objective.Contribution";
        public const string ObjectiveHasChildren = "Objective.HasChildren";
        public const string ObjectiveInvalid = "Objective.Invalid";
        public const string ObjectiveMaintainForbidden = "Objective.MaintainForbidden";
        public const string ObjectiveArchiveForbidden = "Objective.ArchiveForbidden";
        public const string ObjectiveNotArchivable = "Objective.NotArchivable";
        public const string ObjectiveNotDraft = "Objective.NotDraft";
        public const string ObjectiveNotEditable = "Objective.NotEditable";
        public const string ObjectiveNotFound = "Objective.NotFound";
        public const string ObjectiveStatusAcknowledgeForbidden = "Objective.StatusAcknowledgeForbidden";
        public const string ObjectiveStatusNotAcknowledgeable = "Objective.StatusNotAcknowledgeable";
        public const string ObjectiveNotOrganizational = "Objective.NotOrganizational";
        public const string ObjectiveNotPublishable = "Objective.NotPublishable";
        public const string ObjectiveOwnerOutsideTeam = "Objective.OwnerOutsideTeam";
        public const string ObjectivePublishForbidden = "Objective.PublishForbidden";
        public const string ObjectiveTeamInvalid = "Objective.TeamInvalid";
        public const string ObjectiveTeamRequired = "Objective.TeamRequired";
        public const string ObjectiveTeamScopeForbidden = "Objective.TeamScopeForbidden";
        public const string ObjectiveViewForbidden = "Objective.ViewForbidden";
        public const string ParentObjectiveNotFound = "ParentObjective.NotFound";
        public const string PlanAlignment = "Plan.Alignment";
        public const string PlanAuthorForbidden = "Plan.AuthorForbidden";
        public const string PlanChangeRequestForbidden = "Plan.ChangeRequestForbidden";
        public const string PlanChangeRequestInvalid = "Plan.ChangeRequestInvalid";
        public const string PlanChangeRequestNotOpen = "Plan.ChangeRequestNotOpen";
        public const string PlanConflict = "Plan.Conflict";
        public const string PlanDecideForbidden = "Plan.DecideForbidden";
        public const string PlanExceptionalForbidden = "Plan.ExceptionalForbidden";
        public const string PlanFeedback = "Plan.Feedback";
        public const string PlanInvalid = "Plan.Invalid";
        public const string PlanNotApprovable = "Plan.NotApprovable";
        public const string PlanNotFound = "Plan.NotFound";
        public const string PlanNotParticipant = "Plan.NotParticipant";
        public const string PlanNotReturnable = "Plan.NotReturnable";
        public const string PlanNotSubmittable = "Plan.NotSubmittable";
        public const string PlanObjectiveInvalid = "Plan.Objective.Invalid";
        public const string PlanParentNotBaseline = "Plan.ParentNotBaseline";
        public const string PlanReason = "Plan.Reason";
        public const string PlanViewForbidden = "Plan.ViewForbidden";
        public const string PlanWeight = "Plan.Weight";
        public const string PopulationEmpty = "Population.Empty";
        public const string PopulationInvalid = "Population.Invalid";
        public const string PopulationUnresolved = "Population.Unresolved";
        public const string ProgressInvalid = "Progress.Invalid";
        public const string ProgressStatusRequired = "Progress.StatusRequired";
        public const string ProgressReasonRequired = "Progress.ReasonRequired";
        public const string ProgressMismatch = "Progress.Mismatch";
        public const string ProgressNotUpdatable = "Progress.NotUpdatable";
        public const string ProgressUpdateForbidden = "Progress.UpdateForbidden";
        public const string ProgressViewForbidden = "Progress.ViewForbidden";
        public const string SettingsInvalid = "Settings.Invalid";
        public const string NotificationPreferencesInvalid = "NotificationPreferences.Invalid";
        public const string NotificationDefaultsInvalid = "NotificationDefaults.Invalid";
        public const string RatingScaleInvalid = "RatingScale.Invalid";
        public const string ReviewRoundCycleNotActive = "ReviewRound.CycleNotActive";
        public const string ReviewRoundInvalid = "ReviewRound.Invalid";
        public const string ReviewRoundNotDraft = "ReviewRound.NotDraft";
        public const string ReviewRoundExclusionReason = "ReviewRound.ExclusionReason";
        public const string ReviewRoundReviewerInvalid = "ReviewRound.ReviewerInvalid";
        public const string ReviewRoundPopulationInvalid = "ReviewRound.PopulationInvalid";
        public const string ReviewRoundNotReady = "ReviewRound.NotReady";
        public const string ReviewRoundPopulationEmpty = "ReviewRound.PopulationEmpty";
        public const string ReviewAssessmentForbidden = "Review.AssessmentForbidden";
        public const string ReviewAssessmentInvalid = "Review.AssessmentInvalid";
        public const string ReviewFinalizationInvalid = "Review.FinalizationInvalid";
        public const string ReviewFinalizationNotReady = "Review.FinalizationNotReady";
        public const string ReviewRoundUnresolved = "ReviewRound.Unresolved";
        public const string ReviewRoundNotActive = "ReviewRound.NotActive";
        public const string ReviewDueDateInvalid = "Review.DueDateInvalid";
        public const string ReviewNotOpen = "Review.NotOpen";
        public const string PeerInputInvalid = "PeerInput.Invalid";
        public const string PeerInputNotOpen = "PeerInput.NotOpen";
        public const string PeerInputForbidden = "PeerInput.Forbidden";
        public const string PeerRequestClosed = "PeerRequest.Closed";
        public const string PeerRequestInvalid = "PeerRequest.Invalid";
        public const string PeerRequestAnswered = "PeerRequest.AlreadyAnswered";
        public const string ReviewAcknowledgementInvalid = "Review.AcknowledgementInvalid";
        public const string ReviewNotReleased = "Review.NotReleased";
        public const string UpdateRequestForbidden = "UpdateRequest.Forbidden";
        public const string UpdateRequestInvalid = "UpdateRequest.Invalid";
        public const string UpdateRequestNotAllowed = "UpdateRequest.NotAllowed";
        public const string CalibrationForbidden = "Calibration.Forbidden";
        public const string CalibrationInvalid = "Calibration.Invalid";
        public const string CalibrationNotAvailable = "Calibration.NotAvailable";
        public const string CalibrationExists = "Calibration.Exists";
        public const string CalibrationFacilitatorInvalid = "Calibration.FacilitatorInvalid";
        public const string CalibrationOutstandingReviews = "Calibration.OutstandingReviews";
        public const string CalibrationFinalized = "Calibration.Finalized";
        /// <summary>Another facilitator changed the subject first; the failure carries their values, name and time.</summary>
        public const string CalibrationConflict = "Calibration.Conflict";
        public const string CalibrationPotentialDisabled = "Calibration.PotentialDisabled";
        public const string ReviewSummaryNotRevisable = "Review.SummaryNotRevisable";
        public const string StrategicObjectiveHasChildren = "StrategicObjective.HasChildren";
        public const string StrategicObjectiveInvalid = "StrategicObjective.Invalid";
        public const string StrategicObjectiveNotDraft = "StrategicObjective.NotDraft";
        public const string StrategicObjectiveNotEditable = "StrategicObjective.NotEditable";
        public const string StrategicObjectiveNotFound = "StrategicObjective.NotFound";
        public const string StrategicObjectiveNotPublishable = "StrategicObjective.NotPublishable";
    }
}

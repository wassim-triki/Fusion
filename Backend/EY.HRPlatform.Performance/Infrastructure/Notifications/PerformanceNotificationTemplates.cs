using System.Globalization;
using EY.HRPlatform.Performance.Domain.Calibration;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Reviews;

namespace EY.HRPlatform.Performance.Infrastructure.Notifications;

/// <summary>
/// What each notification says, as catalogue keys (<c>Infrastructure/Notifications/Text/notifications-{language}.json</c>)
/// and the values they need, plus the exact in-app path. The wording is chosen per reader when the notification is read
/// or emailed (B-153).
/// </summary>
public static class PerformanceNotificationTemplates
{
    public static string PlanPath(Guid cycleId, Guid planId) => $"/performance/cycles/{cycleId}/plans/{planId}";
    public static string ObjectivePath(Guid cycleId, Guid objectiveId, bool record = false)
        => $"/performance/cycles/{cycleId}/objectives/{objectiveId}{(record ? "?mode=record" : "")}";
    public static string ReviewPath(Guid reviewId) => $"/performance/reviews/{reviewId}";
    public static string RoundPath(Guid roundId) => $"/performance/reviews/rounds/{roundId}";
    public static string CalibrationPath(Guid roundId) => $"/performance/reviews/rounds/{roundId}/calibration";

    public static PerformanceNotificationMessage ForPlan(EmployeePlan plan, PerformanceNotificationKind kind, string? actorName)
    {
        var href = PlanPath(plan.CycleId, plan.Id);
        var actor = Clean(actorName);
        return kind switch
        {
            PerformanceNotificationKind.PlanSubmitted => Message("PlanSubmitted", "PlanSubmitted.context", actor ?? plan.EmployeeDisplayName, href,
                ("actor", actor ?? plan.EmployeeDisplayName)),
            PerformanceNotificationKind.PlanReturned => Message("PlanReturned",
                actor is null ? "PlanReturned.context.anonymous" : "PlanReturned.context", actor, href, ("actor", actor)),
            PerformanceNotificationKind.PlanApproved => Message("PlanApproved",
                actor is null ? "PlanApproved.context.anonymous" : "PlanApproved.context", actor, href, ("actor", actor)),
            _ => throw new ArgumentOutOfRangeException(nameof(kind), "Choose a plan notification kind."),
        };
    }

    public static PerformanceNotificationMessage ForUpdateRequest(UpdateRequest request, string? objectiveTitle)
    {
        var actor = Clean(request.RequestedByName);
        var objective = request.ObjectiveId is null ? null : Clean(objectiveTitle);
        var href = request.ObjectiveId is Guid objectiveId
            ? ObjectivePath(request.CycleId, objectiveId, record: true) : PlanPath(request.CycleId, request.PlanId);
        var context = request.ObjectiveId is null ? "UpdateRequested.context.plan" : objective is null ? null : "Context.objective";
        return Message(actor is null ? "UpdateRequested.anonymous" : "UpdateRequested", context, actor, href,
            ("actor", actor), ("objective", objective));
    }

    public static PerformanceNotificationMessage ForObjectiveAtRisk(string ownerName, string objectiveTitle, bool offTrack, string path)
        => Message(offTrack ? "ObjectiveAtRisk.offTrack" : "ObjectiveAtRisk", "Context.objective", ownerName, path,
            ("owner", ownerName), ("objective", objectiveTitle));

    public static PerformanceNotificationMessage ForUpdateRequestAnswered(string ownerName, string? objectiveTitle, string path)
        => Message("UpdateRequestAnswered", Clean(objectiveTitle) is null ? "UpdateRequestAnswered.context.plan" : "Context.objective",
            ownerName, path, ("owner", ownerName), ("objective", Clean(objectiveTitle)));

    public static PerformanceNotificationMessage ForDevelopmentGoalAdded(string actorName, string goalTitle, string path)
        => Message("DevelopmentGoalAdded", "Context.goal", actorName, path, ("actor", actorName), ("goal", goalTitle));

    /// <summary>"Amira nudged you: put your plan forward" — the step's key names what to do, the path opens where.</summary>
    public static PerformanceNotificationMessage ForYearNudge(string actorName, string stepKey, string path)
        => Message($"YearNudge.{stepKey}", "YearNudge.context", actorName, path, ("actor", actorName));

    public static string DevelopmentPath(Guid cycleId, Guid? planId, Guid employeeId, bool forOwner)
        => forOwner ? $"/performance/plan?cycle={cycleId}#development"
            : planId is Guid id ? $"{PlanPath(cycleId, id)}#development" : $"/performance/people/{employeeId}";

    public static PerformanceNotificationMessage ForReview(PerformanceReview review, PerformanceNotificationKind kind, string roundName)
    {
        var href = ReviewPath(review.Id);
        return kind switch
        {
            PerformanceNotificationKind.SelfAssessmentOpened => Message("SelfAssessmentOpened",
                review.PeerInputEnabled ? "SelfAssessmentOpened.context.peers" : "Context.round", null, href, ("round", roundName)),
            PerformanceNotificationKind.ManagerAssessmentOpened => Message("ManagerAssessmentOpened", "Context.round", null, href,
                ("subject", review.SubjectDisplayName), ("round", roundName)),
            PerformanceNotificationKind.SelfAssessmentSubmitted => Message("SelfAssessmentSubmitted", "Context.round",
                review.SubjectDisplayName, href, ("subject", review.SubjectDisplayName), ("round", roundName)),
            PerformanceNotificationKind.ReviewFinalized => Message("ReviewFinalized", "Context.round", null, href, ("round", roundName)),
            _ => throw new ArgumentOutOfRangeException(nameof(kind), "Choose a review notification kind."),
        };
    }

    public static string PeerRequestPath(Guid requestId) => $"/performance/reviews/peer-requests/{requestId}";
    public static string PeerListPath(Guid reviewId) => $"/performance/reviews?peers={reviewId}";

    public static PerformanceNotificationMessage ForPeersNominated(string subjectName, string roundName, Guid reviewId)
        => Message("PeersNominated", "PeersNominated.context", subjectName, PeerListPath(reviewId),
            ("subject", subjectName), ("round", roundName));

    public static PerformanceNotificationMessage ForPeerListApproved(string reviewerName, string roundName, Guid reviewId)
        => Message("PeerListApproved", "PeerListApproved.context", reviewerName, ReviewPath(reviewId),
            ("reviewer", reviewerName), ("round", roundName));

    public static PerformanceNotificationMessage ForPeerInputRequested(string subjectName, string roundName, DateOnly? due, Guid requestId)
        => Message("PeerInputRequested", due is null ? "Context.round" : "PeerInputRequested.context.due", subjectName,
            PeerRequestPath(requestId), ("subject", subjectName), ("round", roundName), ("due", Date(due)));

    public static PerformanceNotificationMessage ForPeerDeclined(string peerName, string subjectName, Guid reviewId)
        => Message("PeerDeclined", null, peerName, ReviewPath(reviewId), ("peer", peerName), ("subject", subjectName));

    /// <summary><paramref name="titleKey"/> names the moved task from the recipient's side.</summary>
    public static PerformanceNotificationMessage ForDueDateMoved(string titleKey, PerformanceReview review, DateOnly to, DateOnly? from,
        string roundName, string href)
        => Message(titleKey, from is null ? "Context.round" : "ReviewDueDateMoved.context.from", null, href,
            ("subject", review.SubjectDisplayName), ("reviewer", review.ReviewerDisplayName), ("due", Date(to)), ("from", Date(from)),
            ("round", roundName));

    /// <summary>
    /// "Your self-assessment is due Wed 15 Sep", "is a day late", "is 8 days late". <paramref name="task"/> is the
    /// reminder's task: <c>selfAssessment</c>, <c>peerList</c>, <c>peerInput</c>, <c>review</c> or <c>acknowledge</c>.
    /// </summary>
    public static PerformanceNotificationMessage ForReminder(string task, string? subjectName, DateOnly? due, int daysLate,
        string roundName, string href)
    {
        var state = task == "acknowledge" ? "" : daysLate > 0 ? ".late" : due is null ? ".waiting" : ".due";
        return Message($"Reminder.{task}{state}", "Context.round", null, href, ("subject", subjectName), ("due", Date(due)),
            ("count", daysLate > 0 ? daysLate.ToString(CultureInfo.InvariantCulture) : null), ("round", roundName));
    }

    public static PerformanceNotificationMessage ForAcknowledged(string subjectName, string roundName, Guid reviewId)
        => Message("ReviewAcknowledged", "Context.round", subjectName, ReviewPath(reviewId), ("subject", subjectName), ("round", roundName));

    public static PerformanceNotificationMessage ForCalibrationReady(CalibrationSession session, string roundName)
        => Message("CalibrationReady", "CalibrationReady.context", null, CalibrationPath(session.ReviewRoundId), ("round", roundName));

    /// <summary>Counts only: who changed and why stay in the app.</summary>
    public static PerformanceNotificationMessage ForCalibrationFinalized(string roundName, int changed, int total)
        => Message(changed == 0 ? "CalibrationFinalized.none" : "CalibrationFinalized.changed",
            changed == 0 ? "CalibrationFinalized.context.none" : "CalibrationFinalized.context.changed", null, ReviewsPath,
            ("round", roundName), ("count", changed.ToString(CultureInfo.InvariantCulture)),
            ("total", total.ToString(CultureInfo.InvariantCulture)));

    public const string ReviewsPath = "/performance/reviews";
    public const string TeamPath = "/performance/team";

    public static string OneOnOnePath(Guid seriesId) => $"/performance/one-on-ones/{seriesId}";
    public static string FeedbackPath(Guid feedbackId) => $"/performance/feedback?feedback={feedbackId}";
    public static string FeedbackRequestPath(Guid requestId) => $"/performance/feedback/requests/{requestId}";
    public static string PraisePath(Guid praiseId) => $"/performance/feedback?tab=praise&praise={praiseId}";

    // Notifications land on the item in its list (B-154): the hash names the card or action to scroll to and outline.
    // The query forms above open a drawer instead; both work for old links.
    public static string FeedbackLandingPath(Guid feedbackId, bool team = false)
        => $"/performance/feedback{(team ? "?tab=team" : "")}#feedback-{feedbackId}";
    public static string PraiseLandingPath(Guid praiseId) => $"/performance/feedback?tab=praise#praise-{praiseId}";
    public static string ActionLandingPath(Guid seriesId, Guid actionId) => $"{OneOnOnePath(seriesId)}#action-{actionId}";

    public static PerformanceNotificationMessage ForOneOnOneStarted(string actorName, Guid seriesId)
        => Message("OneOnOneStarted", null, actorName, OneOnOnePath(seriesId), ("actor", actorName));

    public static PerformanceNotificationMessage ForOneOnOneRescheduled(string actorName, Guid seriesId)
        => Message("OneOnOneRescheduled", null, actorName, OneOnOnePath(seriesId), ("actor", actorName));

    /// <summary>The owner reads the action's text in the app; the email never carries it.</summary>
    public static PerformanceNotificationMessage ForOneOnOneActionAssigned(string actorName, string actionText, Guid seriesId, Guid actionId)
        => Message("OneOnOneActionAssigned", "Context.action", actorName, ActionLandingPath(seriesId, actionId), ("actor", actorName),
            ("action", actionText));

    /// <summary>Names what the feedback is about, never what it says.</summary>
    public static PerformanceNotificationMessage ForFeedbackReceived(string authorName, string? subjectLabel, Guid feedbackId)
        => Message("FeedbackReceived", Clean(subjectLabel) is null ? null : "Context.about", authorName, FeedbackLandingPath(feedbackId),
            ("actor", authorName), ("about", Clean(subjectLabel)));

    public static PerformanceNotificationMessage ForFeedbackForReport(string authorName, string receiverName, Guid feedbackId)
        => Message("FeedbackForReport", "FeedbackForReport.context", authorName, FeedbackLandingPath(feedbackId, team: true),
            ("actor", authorName), ("receiver", receiverName));

    public static PerformanceNotificationMessage ForFeedbackRequested(string requesterName, string question, Guid requestId)
        => Message("FeedbackRequested", "Context.question", requesterName, FeedbackRequestPath(requestId),
            ("actor", requesterName), ("question", question));

    public static PerformanceNotificationMessage ForFeedbackRequestResponded(string inviteeName, bool answered, string question, Guid requestId)
        => Message(answered ? "FeedbackRequestResponded.answered" : "FeedbackRequestResponded.declined", "Context.question", inviteeName,
            FeedbackRequestPath(requestId), ("actor", inviteeName), ("question", question));

    public static PerformanceNotificationMessage ForPraiseReceived(string authorName, string valueName, Guid praiseId)
        => Message("PraiseReceived", null, authorName, PraiseLandingPath(praiseId), ("actor", authorName), ("value", valueName));

    public static PerformanceNotificationMessage ForPraiseForReport(string authorName, string recipientName, string valueName, Guid praiseId)
        => Message("PraiseForReport", null, authorName, PraiseLandingPath(praiseId), ("actor", authorName), ("recipient", recipientName),
            ("value", valueName));

    private static PerformanceNotificationMessage Message(string titleKey, string? contextKey, string? actorName, string href,
        params (string Name, string? Value)[] values)
        => new(titleKey, contextKey,
            values.Where(value => !string.IsNullOrWhiteSpace(value.Value))
                .ToDictionary(value => value.Name, value => value.Value!.Trim(), StringComparer.Ordinal),
            Clean(actorName), href);

    private static string? Date(DateOnly? date) => date?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

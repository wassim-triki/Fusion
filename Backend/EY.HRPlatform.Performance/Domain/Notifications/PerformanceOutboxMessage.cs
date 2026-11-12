using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Common;

namespace EY.HRPlatform.Performance.Domain.Notifications;

public enum PerformanceNotificationKind
{
    PlanSubmitted, PlanReturned, PlanApproved,
    SelfAssessmentOpened, ManagerAssessmentOpened, SelfAssessmentSubmitted, ReviewFinalized,
    UpdateRequested,
    ObjectiveAtRisk, UpdateRequestAnswered, DevelopmentGoalAdded,
    OneOnOneStarted, OneOnOneRescheduled, OneOnOneActionAssigned,
    FeedbackReceived, FeedbackForReport, FeedbackRequested, FeedbackRequestResponded,
    PraiseReceived, PraiseForReport,
    PeerInputRequested, PeerDeclined, ReviewDueDateMoved, ReviewReminder, ReviewAcknowledged,
    /// <summary>A calibrator kept or changed a rating the manager gave (D-35); the manager hears which.</summary>
    CalibrationDecided,
    /// <summary>Someone nudged the person toward their next step in the year (D-49).</summary>
    YearNudge,
    /// <summary>A 1:1's calendar invite (or cancellation) by email to each of the two people (D-39); no bell.</summary>
    OneOnOneInvite,
    /// <summary>The monthly reminder to update goals nobody has touched in a month.</summary>
    GoalUpdateReminder,
    /// <summary>A new year opened for the person, with what to do first (D-91: everyone is told when it launches).</summary>
    YearLaunched,
}

/// <summary>The meeting an invite is about; the email is worded from its state when it's sent.</summary>
public sealed record OneOnOneInvitePayload(Guid SeriesId, Guid MeetingId);

/// <summary>
/// A review-work notification (peers, schedule, reminders, acknowledgement): the review's context plus the exact in-app
/// path, and what the email may say. Never carries answers, notes or comments.
/// </summary>
public sealed record ReviewWorkNotificationPayload(Guid CycleId, Guid ReviewRoundId, Guid ReviewId, string ReviewRoundName, string Path,
    string? ActorDisplayName = null, string? SubjectDisplayName = null, string? Task = null, DateOnly? DueDate = null,
    int DaysLate = 0, DateOnly? PreviousDueDate = null);

/// <summary>A notification about a 1:1, feedback, a feedback request or praise: no cycle, one in-app path.</summary>
public sealed record ConversationNotificationPayload(Guid ResourceId, string? ActorDisplayName, string Path);

public sealed record PlanNotificationPayload(Guid CycleId, Guid PlanId, string? ActorDisplayName);
public sealed record ReviewNotificationPayload(Guid CycleId, Guid ReviewRoundId, Guid ReviewId, string ReviewRoundName);
/// <summary>A notification that opens one in-app place: an objective, a plan, or a person's development.</summary>
public sealed record PathNotificationPayload(Guid CycleId, Guid ResourceId, string? ActorDisplayName, string Path);

/// <summary>A durable notification staged with its transition and delivered after commit.</summary>
public sealed class PerformanceOutboxMessage : PerformanceChildEntity
{
    private PerformanceOutboxMessage() { }
    public PerformanceNotificationKind Kind { get; private set; }
    public Guid RecipientEmployeeId { get; private set; }
    public string ResourceType { get; private set; } = string.Empty;
    public Guid ResourceId { get; private set; }
    public string Payload { get; private set; } = "{}";
    public string DedupeKey { get; private set; } = string.Empty;
    public int Attempts { get; private set; }
    public DateTime NextAttemptAt { get; private set; }
    public DateTime? DispatchedAt { get; private set; }
    public string? SkippedReason { get; private set; }
    public string? LastError { get; private set; }
    public bool IsPending => DispatchedAt is null && SkippedReason is null && Attempts < 8;

    public static PerformanceOutboxMessage ForPlan(Guid tenantId, PerformanceNotificationKind kind,
        Guid recipientEmployeeId, Guid planId, Guid transitionId, PlanNotificationPayload payload)
    {
        if (tenantId == Guid.Empty || recipientEmployeeId == Guid.Empty || planId == Guid.Empty || transitionId == Guid.Empty)
            throw new ArgumentException("Notification tenant, recipient, resource and transition are required.");
        if (!Enum.IsDefined(kind) || payload.PlanId != planId || payload.CycleId == Guid.Empty)
            throw new ArgumentException("A supported notification and matching plan context are required.");
        return new PerformanceOutboxMessage
        {
            TenantId = tenantId, Kind = kind, RecipientEmployeeId = recipientEmployeeId,
            ResourceType = "EmployeePlan", ResourceId = planId,
            Payload = JsonSerializer.Serialize(payload),
            DedupeKey = $"{kind}:{planId:N}:{transitionId:N}:{recipientEmployeeId:N}",
            NextAttemptAt = PerformanceClock.UtcNow,
        };
    }

    public static PerformanceOutboxMessage ForReview(Guid tenantId, PerformanceNotificationKind kind,
        Guid recipientEmployeeId, Guid reviewId, Guid transitionId, ReviewNotificationPayload payload)
    {
        if (tenantId == Guid.Empty || recipientEmployeeId == Guid.Empty || reviewId == Guid.Empty || transitionId == Guid.Empty
            || payload.ReviewId != reviewId || payload.CycleId == Guid.Empty || payload.ReviewRoundId == Guid.Empty
            || string.IsNullOrWhiteSpace(payload.ReviewRoundName))
            throw new ArgumentException("Review notification tenant, recipient, resource and round context are required.");
        if (kind is not (PerformanceNotificationKind.SelfAssessmentOpened or PerformanceNotificationKind.ManagerAssessmentOpened
            or PerformanceNotificationKind.SelfAssessmentSubmitted or PerformanceNotificationKind.ReviewFinalized))
            throw new ArgumentException("Choose a review notification kind.", nameof(kind));
        return new PerformanceOutboxMessage
        {
            TenantId = tenantId, Kind = kind, RecipientEmployeeId = recipientEmployeeId,
            ResourceType = "PerformanceReview", ResourceId = reviewId,
            Payload = JsonSerializer.Serialize(payload),
            DedupeKey = $"{kind}:{reviewId:N}:{transitionId:N}:{recipientEmployeeId:N}",
            NextAttemptAt = PerformanceClock.UtcNow,
        };
    }

    /// <summary>
    /// A notification about one objective, update request or development plan that opens an in-app path
    /// (objective at risk, update request answered, development goal added).
    /// </summary>
    public static PerformanceOutboxMessage ForPath(Guid tenantId, PerformanceNotificationKind kind, Guid recipientEmployeeId,
        string resourceType, Guid transitionId, PathNotificationPayload payload)
    {
        if (tenantId == Guid.Empty || recipientEmployeeId == Guid.Empty || payload.ResourceId == Guid.Empty
            || transitionId == Guid.Empty || payload.CycleId == Guid.Empty || string.IsNullOrWhiteSpace(resourceType)
            || !payload.Path.StartsWith("/performance/", StringComparison.Ordinal))
            throw new ArgumentException("Notification tenant, recipient, resource, transition and path are required.");
        if (kind is not (PerformanceNotificationKind.ObjectiveAtRisk or PerformanceNotificationKind.UpdateRequestAnswered
            or PerformanceNotificationKind.DevelopmentGoalAdded or PerformanceNotificationKind.YearNudge
            or PerformanceNotificationKind.GoalUpdateReminder or PerformanceNotificationKind.YearLaunched))
            throw new ArgumentException("Choose a path notification kind.", nameof(kind));
        return new PerformanceOutboxMessage
        {
            TenantId = tenantId, Kind = kind, RecipientEmployeeId = recipientEmployeeId,
            ResourceType = resourceType, ResourceId = payload.ResourceId,
            Payload = JsonSerializer.Serialize(payload),
            DedupeKey = $"{kind}:{payload.ResourceId:N}:{transitionId:N}:{recipientEmployeeId:N}",
            NextAttemptAt = PerformanceClock.UtcNow,
        };
    }

    /// <summary>
    /// A calendar invite for one meeting to one of its two people. <paramref name="transitionId"/> names what changed
    /// (scheduled, moved, cancelled), so each change sends once.
    /// </summary>
    public static PerformanceOutboxMessage ForInvite(Guid tenantId, Guid recipientEmployeeId, Guid seriesId, Guid meetingId, Guid transitionId)
    {
        if (tenantId == Guid.Empty || recipientEmployeeId == Guid.Empty || seriesId == Guid.Empty || meetingId == Guid.Empty || transitionId == Guid.Empty)
            throw new ArgumentException("Invite tenant, recipient, meeting and transition are required.");
        return new PerformanceOutboxMessage
        {
            TenantId = tenantId, Kind = PerformanceNotificationKind.OneOnOneInvite, RecipientEmployeeId = recipientEmployeeId,
            ResourceType = "OneOnOneMeeting", ResourceId = meetingId,
            Payload = JsonSerializer.Serialize(new OneOnOneInvitePayload(seriesId, meetingId)),
            DedupeKey = $"{PerformanceNotificationKind.OneOnOneInvite}:{meetingId:N}:{transitionId:N}:{recipientEmployeeId:N}",
            NextAttemptAt = PerformanceClock.UtcNow,
        };
    }

    public static bool IsConversationKind(PerformanceNotificationKind kind) => kind is PerformanceNotificationKind.OneOnOneStarted
        or PerformanceNotificationKind.OneOnOneRescheduled or PerformanceNotificationKind.OneOnOneActionAssigned
        or PerformanceNotificationKind.FeedbackReceived or PerformanceNotificationKind.FeedbackForReport
        or PerformanceNotificationKind.FeedbackRequested or PerformanceNotificationKind.FeedbackRequestResponded
        or PerformanceNotificationKind.PraiseReceived or PerformanceNotificationKind.PraiseForReport;

    /// <summary>
    /// A conversation notification (1:1s, feedback, requests, praise). These belong to people, not cycles, so the
    /// payload carries no cycle; it never carries feedback, note, answer or praise text either.
    /// </summary>
    public static PerformanceOutboxMessage ForConversation(Guid tenantId, PerformanceNotificationKind kind, Guid recipientEmployeeId,
        string resourceType, Guid transitionId, ConversationNotificationPayload payload)
    {
        if (tenantId == Guid.Empty || recipientEmployeeId == Guid.Empty || payload.ResourceId == Guid.Empty
            || transitionId == Guid.Empty || string.IsNullOrWhiteSpace(resourceType)
            || !payload.Path.StartsWith("/performance/", StringComparison.Ordinal))
            throw new ArgumentException("Notification tenant, recipient, resource, transition and path are required.");
        if (!IsConversationKind(kind)) throw new ArgumentException("Choose a conversation notification kind.", nameof(kind));
        return new PerformanceOutboxMessage
        {
            TenantId = tenantId, Kind = kind, RecipientEmployeeId = recipientEmployeeId,
            ResourceType = resourceType, ResourceId = payload.ResourceId,
            Payload = JsonSerializer.Serialize(payload),
            DedupeKey = $"{kind}:{payload.ResourceId:N}:{transitionId:N}:{recipientEmployeeId:N}",
            NextAttemptAt = PerformanceClock.UtcNow,
        };
    }

    public static bool IsReviewWorkKind(PerformanceNotificationKind kind) => kind is PerformanceNotificationKind.PeerInputRequested
        or PerformanceNotificationKind.PeerDeclined or PerformanceNotificationKind.ReviewDueDateMoved
        or PerformanceNotificationKind.ReviewReminder or PerformanceNotificationKind.ReviewAcknowledged
        or PerformanceNotificationKind.CalibrationDecided;

    /// <summary>
    /// A review-work notification. The caller gives the dedupe key: per transition for events,
    /// <c>Reminder:{task}:{resource}:{date}</c> for reminders, so a task is reminded at most once a day.
    /// </summary>
    public static PerformanceOutboxMessage ForReviewWork(Guid tenantId, PerformanceNotificationKind kind, Guid recipientEmployeeId,
        string resourceType, Guid resourceId, string dedupeKey, ReviewWorkNotificationPayload payload)
    {
        if (tenantId == Guid.Empty || recipientEmployeeId == Guid.Empty || resourceId == Guid.Empty || string.IsNullOrWhiteSpace(resourceType)
            || string.IsNullOrWhiteSpace(dedupeKey) || payload.ReviewId == Guid.Empty || payload.CycleId == Guid.Empty
            || !payload.Path.StartsWith("/performance/", StringComparison.Ordinal))
            throw new ArgumentException("Review notification tenant, recipient, resource, key and path are required.");
        if (!IsReviewWorkKind(kind)) throw new ArgumentException("Choose a review-work notification kind.", nameof(kind));
        return new PerformanceOutboxMessage
        {
            TenantId = tenantId, Kind = kind, RecipientEmployeeId = recipientEmployeeId,
            ResourceType = resourceType, ResourceId = resourceId,
            Payload = JsonSerializer.Serialize(payload),
            DedupeKey = dedupeKey,
            NextAttemptAt = PerformanceClock.UtcNow,
        };
    }

    public void MarkDispatched(DateTime now)
    {
        RequirePending();
        Attempts++;
        DispatchedAt = now;
        LastError = null;
    }

    public void Skip(string reason)
    {
        RequirePending();
        if (string.IsNullOrWhiteSpace(reason)) throw new ArgumentException("A skip reason is required.");
        SkippedReason = reason;
    }

    public void Fail(DateTime now, string errorCode)
    {
        RequirePending();
        Attempts++;
        LastError = errorCode;
        if (Attempts >= 8) SkippedReason = "dead-letter";
        else NextAttemptAt = now.AddSeconds(15 * Math.Pow(2, Attempts - 1));
    }

    private void RequirePending()
    {
        if (!IsPending) throw new InvalidOperationException("This notification is already resolved.");
    }
}

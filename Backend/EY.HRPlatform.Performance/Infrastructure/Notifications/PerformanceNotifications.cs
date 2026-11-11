using EY.HRPlatform.Performance.Domain.Calibration;
using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Progress;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Infrastructure.Persistence;

namespace EY.HRPlatform.Performance.Infrastructure.Notifications;

/// <summary>
/// Stages what a transition tells its recipients: the email (outbox) and the in-app notification,
/// in the transition's own unit of work so they commit or roll back with it.
/// </summary>
public interface IPerformanceNotifications
{
    void EnqueuePlan(EmployeePlan plan, PerformanceNotificationKind kind, string? actorDisplayName);
    void EnqueueReview(PerformanceReview review, PerformanceNotificationKind kind, string reviewRoundName);
    void EnqueueCalibrationReady(CalibrationSession session, string reviewRoundName);
    void EnqueueUpdateRequested(UpdateRequest request, string? objectiveTitle);
    void EnqueueObjectiveAtRisk(EmployeePlan plan, Objective objective, ObjectiveStatus status, Guid progressUpdateId);
    void EnqueueUpdateRequestAnswered(UpdateRequest request, string ownerName, string? objectiveTitle);
    /// <summary>Stages a nudge toward the person's next step in the year; one per nudge, never to the nudger.</summary>
    void EnqueueYearNudge(Guid tenantId, Guid cycleId, Guid recipientEmployeeId, Guid actorEmployeeId, string actorName,
        string stepKey, string path, Guid nudgeId);

    void EnqueueDevelopmentGoalAdded(Guid tenantId, Guid cycleId, Guid developmentPlanId, Guid goalId, Guid recipientEmployeeId,
        Guid actorEmployeeId, string actorName, string goalTitle, string path);

    /// <summary>
    /// Stages a 1:1, feedback, request or praise notification for one recipient. Nothing is staged when the
    /// recipient is the person who acted. <paramref name="transitionId"/> makes the dedupe key per transition.
    /// </summary>
    void EnqueueConversation(Guid tenantId, PerformanceNotificationKind kind, Guid recipientEmployeeId, Guid actorEmployeeId,
        string resourceType, Guid resourceId, Guid transitionId, PerformanceNotificationMessage text);

    /// <summary>Stages a meeting's calendar invite (or cancellation) for both people; email only, no bell.</summary>
    void EnqueueInvite(OneOnOneSeries series, Guid meetingId, Guid transitionId);

    /// <summary>The monthly reminder to update goals; once per person per month, keyed by <paramref name="month"/>.</summary>
    void EnqueueGoalUpdateReminder(Guid tenantId, Guid cycleId, Guid planId, Guid recipientEmployeeId, DateOnly month);

    /// <summary>Stages a peer, schedule, reminder or acknowledgement notification. Nothing is staged without a recipient.</summary>
    void EnqueueReviewWork(PerformanceReview review, PerformanceNotificationKind kind, Guid recipientEmployeeId, string resourceType,
        Guid resourceId, string dedupeKey, ReviewWorkNotificationPayload payload, PerformanceNotificationMessage text);
}

public sealed class PerformanceNotifications(PerformanceDbContext db) : IPerformanceNotifications
{
    public void EnqueuePlan(EmployeePlan plan, PerformanceNotificationKind kind, string? actorDisplayName)
    {
        var recipient = kind == PerformanceNotificationKind.PlanSubmitted ? plan.ResponsibleManagerId : plan.EmployeeId;
        if (recipient is not Guid employeeId || employeeId == Guid.Empty)
            throw new InvalidOperationException("The notification has no recorded recipient.");
        var transition = plan.Decisions.Last();
        var message = PerformanceOutboxMessage.ForPlan(plan.TenantId, kind, employeeId, plan.Id, transition.Id,
            new PlanNotificationPayload(plan.CycleId, plan.Id, actorDisplayName));
        Stage(message, null, PerformanceNotificationTemplates.ForPlan(plan, kind, actorDisplayName)
            with { ActorEmployeeId = kind == PerformanceNotificationKind.PlanSubmitted ? plan.EmployeeId : transition.ActorEmployeeId });
    }

    public void EnqueueReview(PerformanceReview review, PerformanceNotificationKind kind, string reviewRoundName)
    {
        var recipient = kind is PerformanceNotificationKind.SelfAssessmentOpened or PerformanceNotificationKind.ReviewFinalized
            ? review.SubjectEmployeeId : review.ReviewerEmployeeId;
        var message = PerformanceOutboxMessage.ForReview(review.TenantId, kind, recipient, review.Id, review.ReviewRoundId,
            new ReviewNotificationPayload(review.CycleId, review.ReviewRoundId, review.Id, reviewRoundName));
        Stage(message, null, PerformanceNotificationTemplates.ForReview(review, kind, reviewRoundName)
            with { ActorEmployeeId = kind == PerformanceNotificationKind.SelfAssessmentSubmitted ? review.SubjectEmployeeId : null });
    }

    public void EnqueueCalibrationReady(CalibrationSession session, string reviewRoundName)
    {
        foreach (var facilitator in session.Facilitators)
        {
            var message = PerformanceOutboxMessage.ForCalibration(session.TenantId, facilitator.UserId, facilitator.EmployeeId,
                new CalibrationNotificationPayload(session.CycleId, session.ReviewRoundId, session.Id, reviewRoundName));
            Stage(message, facilitator.UserId, PerformanceNotificationTemplates.ForCalibrationReady(session, reviewRoundName));
        }
    }

    public void EnqueueUpdateRequested(UpdateRequest request, string? objectiveTitle)
    {
        var message = PerformanceOutboxMessage.ForPlan(request.TenantId, PerformanceNotificationKind.UpdateRequested, request.EmployeeId,
            request.PlanId, request.Id, new PlanNotificationPayload(request.CycleId, request.PlanId, request.RequestedByName));
        Stage(message, null, PerformanceNotificationTemplates.ForUpdateRequest(request, objectiveTitle)
            with { ActorEmployeeId = request.RequestedByEmployeeId });
    }

    /// <summary>The plan's responsible reviewer hears when a report's objective goes at risk or off track.</summary>
    public void EnqueueObjectiveAtRisk(EmployeePlan plan, Objective objective, ObjectiveStatus status, Guid progressUpdateId)
    {
        if (plan.ResponsibleManagerId is not Guid reviewer || reviewer == Guid.Empty) return;
        var path = PerformanceNotificationTemplates.ObjectivePath(objective.CycleId, objective.Id);
        var message = PerformanceOutboxMessage.ForPath(plan.TenantId, PerformanceNotificationKind.ObjectiveAtRisk, reviewer,
            "Objective", progressUpdateId, new PathNotificationPayload(objective.CycleId, objective.Id, plan.EmployeeDisplayName, path));
        Stage(message, null, PerformanceNotificationTemplates.ForObjectiveAtRisk(plan.EmployeeDisplayName, objective.Title,
            status == ObjectiveStatus.OffTrack, path) with { ActorEmployeeId = plan.EmployeeId });
    }

    /// <summary>The requester hears when recorded progress answers their request.</summary>
    public void EnqueueUpdateRequestAnswered(UpdateRequest request, string ownerName, string? objectiveTitle)
    {
        var path = request.ObjectiveId is Guid objectiveId
            ? PerformanceNotificationTemplates.ObjectivePath(request.CycleId, objectiveId)
            : PerformanceNotificationTemplates.PlanPath(request.CycleId, request.PlanId);
        var message = PerformanceOutboxMessage.ForPath(request.TenantId, PerformanceNotificationKind.UpdateRequestAnswered,
            request.RequestedByEmployeeId, "UpdateRequest", request.SatisfiedByProgressUpdateId ?? request.Id,
            new PathNotificationPayload(request.CycleId, request.Id, ownerName, path));
        Stage(message, null, PerformanceNotificationTemplates.ForUpdateRequestAnswered(ownerName, objectiveTitle, path)
            with { ActorEmployeeId = request.EmployeeId });
    }

    /// <summary>The other person hears when a development goal is added to the plan they share.</summary>
    public void EnqueueYearNudge(Guid tenantId, Guid cycleId, Guid recipientEmployeeId, Guid actorEmployeeId, string actorName,
        string stepKey, string path, Guid nudgeId)
    {
        if (recipientEmployeeId == Guid.Empty || recipientEmployeeId == actorEmployeeId) return;
        var message = PerformanceOutboxMessage.ForPath(tenantId, PerformanceNotificationKind.YearNudge, recipientEmployeeId,
            "Cycle", nudgeId, new PathNotificationPayload(cycleId, cycleId, actorName, path));
        Stage(message, null, PerformanceNotificationTemplates.ForYearNudge(actorName, stepKey, path) with { ActorEmployeeId = actorEmployeeId });
    }

    public void EnqueueDevelopmentGoalAdded(Guid tenantId, Guid cycleId, Guid developmentPlanId, Guid goalId, Guid recipientEmployeeId,
        Guid actorEmployeeId, string actorName, string goalTitle, string path)
    {
        var message = PerformanceOutboxMessage.ForPath(tenantId, PerformanceNotificationKind.DevelopmentGoalAdded, recipientEmployeeId,
            "DevelopmentPlan", goalId, new PathNotificationPayload(cycleId, developmentPlanId, actorName, path));
        Stage(message, null, PerformanceNotificationTemplates.ForDevelopmentGoalAdded(actorName, goalTitle, path)
            with { ActorEmployeeId = actorEmployeeId });
    }

    public void EnqueueConversation(Guid tenantId, PerformanceNotificationKind kind, Guid recipientEmployeeId, Guid actorEmployeeId,
        string resourceType, Guid resourceId, Guid transitionId, PerformanceNotificationMessage text)
    {
        if (recipientEmployeeId == Guid.Empty || recipientEmployeeId == actorEmployeeId) return;
        var message = PerformanceOutboxMessage.ForConversation(tenantId, kind, recipientEmployeeId, resourceType, transitionId,
            new ConversationNotificationPayload(resourceId, text.ActorName, text.Href));
        Stage(message, null, text with { ActorEmployeeId = actorEmployeeId });
    }

    public void EnqueueInvite(OneOnOneSeries series, Guid meetingId, Guid transitionId)
    {
        foreach (var recipient in new[] { series.ManagerEmployeeId, series.ReportEmployeeId })
        {
            var message = PerformanceOutboxMessage.ForInvite(series.TenantId, recipient, series.Id, meetingId, transitionId);
            if (!db.OutboxMessages.Local.Any(m => m.TenantId == message.TenantId && m.DedupeKey == message.DedupeKey))
                db.OutboxMessages.Add(message);
        }
    }

    /// <summary>The month's transition in a goal reminder's dedupe key: one reminder per person per month.</summary>
    public static Guid GoalUpdateTransition(DateOnly month)
        => new(System.Security.Cryptography.MD5.HashData(System.Text.Encoding.UTF8.GetBytes($"goal-update:{month:yyyy-MM}")));

    public void EnqueueGoalUpdateReminder(Guid tenantId, Guid cycleId, Guid planId, Guid recipientEmployeeId, DateOnly month)
    {
        var path = PerformanceNotificationTemplates.GoalsPath(cycleId);
        var transition = GoalUpdateTransition(month);
        var message = PerformanceOutboxMessage.ForPath(tenantId, PerformanceNotificationKind.GoalUpdateReminder, recipientEmployeeId,
            "EmployeePlan", transition, new PathNotificationPayload(cycleId, planId, null, path));
        Stage(message, null, PerformanceNotificationTemplates.ForGoalUpdateReminder(path));
    }

    public void EnqueueReviewWork(PerformanceReview review, PerformanceNotificationKind kind, Guid recipientEmployeeId, string resourceType,
        Guid resourceId, string dedupeKey, ReviewWorkNotificationPayload payload, PerformanceNotificationMessage text)
    {
        if (recipientEmployeeId == Guid.Empty) return;
        var message = PerformanceOutboxMessage.ForReviewWork(review.TenantId, kind, recipientEmployeeId, resourceType, resourceId,
            dedupeKey, payload);
        Stage(message, null, text);
    }

    /// <summary>
    /// State retries return before enqueue; this also protects repeated staging in the same context.
    /// Both rows share the outbox dedupe key, which is unique per tenant.
    /// </summary>
    private void Stage(PerformanceOutboxMessage message, Guid? recipientUserId, PerformanceNotificationMessage text)
    {
        if (db.OutboxMessages.Local.Any(m => m.TenantId == message.TenantId && m.DedupeKey == message.DedupeKey)) return;
        db.OutboxMessages.Add(message);
        db.Notifications.Add(PerformanceNotification.For(message, recipientUserId, text, PerformanceClock.UtcNow));
    }
}

using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.People.Changes;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Notifications;

/// <summary>
/// Stages what a recorded workforce change tells people (B-002 N8), on the change's own unit of work so the notifications
/// commit or roll back with it. A change recorded ahead tells people when it's recorded; on its date it shows under
/// Upcoming instead of being announced again. Whoever recorded it is never told about it.
/// </summary>
public sealed class CoreChangeNotifications(CoreHRDbContext db, IHttpContextAccessor? http = null)
{
    /// <summary>Cancellations staged in this unit of work, so an edit's new change can take their place.</summary>
    private readonly List<CoreNotification> cancellations = [];

    public async Task StageAsync(WorkforceChange change, WorkforceChangeDetails details, CancellationToken cancellationToken)
    {
        var employee = db.Employees.Local.FirstOrDefault(item => item.Id == change.EmployeeId)
            ?? await db.Employees.FirstOrDefaultAsync(item => item.Id == change.EmployeeId, cancellationToken);
        if (employee is null) return;

        var teamStaying = await CoreChangeMoments.TeamStayingAsync(db, change, details, cancellationToken);
        var moments = CoreChangeMoments.Of(change, details, WorkforceChangeService.Ref(employee), teamStaying);
        var actorEmployeeId = http?.HttpContext?.User.GetEmployeeId();
        var actorName = ChangeSupport.ActorName(change.CreatedBy);
        var now = DateTime.UtcNow;
        var today = DateOnly.FromDateTime(now);
        foreach (var moment in moments)
        {
            if (moment.RecipientEmployeeId == actorEmployeeId) continue;
            var notification = CoreNotification.For(change.TenantId, moment.RecipientEmployeeId, moment.Kind, change.Id,
                CoreChangeMoments.Words(moment, CoreMomentTense.Recorded, today, actorName, actorEmployeeId), now);
            if (db.Notifications.Local.Any(item => item.DedupeKey == notification.DedupeKey)) continue;
            db.Notifications.Add(notification);
        }

        // An edit: whoever the new change tells hears it instead of the cancellation, so nobody hears twice. A rolled-back
        // attempt clears the tracker, so its cancellations are no longer ours to take back.
        cancellations.RemoveAll(item => db.Entry(item).State == EntityState.Detached);
        var told = moments.Select(moment => moment.RecipientEmployeeId).ToHashSet();
        foreach (var superseded in cancellations.Where(item => told.Contains(item.RecipientEmployeeId)).ToList())
        {
            db.Notifications.Remove(superseded);
            cancellations.Remove(superseded);
        }
    }

    /// <summary>
    /// Tells the person's manager today that they go on leave, or that their leave changed or ends early
    /// (<paramref name="occasion"/>), with its type. Neither whoever set it nor <paramref name="proposedBy"/> (a manager whose
    /// request was approved) hears it.
    /// </summary>
    public async Task StageLeaveAsync(WorkforceChange change, string? occasion, Guid? proposedBy, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var today = DateOnly.FromDateTime(now);
        var at = WorkforceChangeService.At(today);
        var managerId = await db.ManagerRelationships.AsNoTracking()
            .Where(line => line.SubjectEmployeeId == change.EmployeeId && line.Type == ReportingRelationshipType.PrimaryManager
                && line.EffectiveFrom <= at && (line.EffectiveTo == null || at < line.EffectiveTo))
            .Select(line => (Guid?)line.ManagerEmployeeId)
            .FirstOrDefaultAsync(cancellationToken);
        var actorEmployeeId = http?.HttpContext?.User.GetEmployeeId();
        if (managerId is not { } recipient || recipient == actorEmployeeId || recipient == proposedBy || recipient == change.EmployeeId)
            return;
        var employee = await db.Employees.AsNoTracking().FirstAsync(item => item.Id == change.EmployeeId, cancellationToken);
        var details = WorkforceChangeService.ReadDetails(change);
        var back = LeaveReader.Back(change.LastDay, await LeaveReader.WorkWeekAsync(db, cancellationToken));
        var moment = new CoreChangeMoment(recipient, CoreNotificationKind.TeamLeave, change.EffectiveDate,
            [WorkforceChangeService.Ref(employee)], Summary: details.LeaveType, Back: back, Occasion: occasion);
        db.Notifications.Add(CoreNotification.For(change.TenantId, recipient, CoreNotificationKind.TeamLeave, change.Id,
            CoreChangeMoments.Words(moment, CoreMomentTense.Recorded, today, ChangeSupport.ActorName(change.UpdatedBy ?? change.CreatedBy), actorEmployeeId),
            now, occasion is null ? null : now.Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture)));
    }

    /// <summary>
    /// Tells everyone the change told that it was cancelled, from the notifications it stored rather than recomputed, so
    /// a cancelled hire (the person is deleted) still reaches the manager. Their earlier rows stay as history; whoever
    /// cancelled hears nothing.
    /// </summary>
    public async Task StageCancelledAsync(WorkforceChange change, string actor, CancellationToken cancellationToken)
    {
        var told = await db.Notifications.AsNoTracking()
            .Where(item => item.ChangeId == change.Id && item.Kind != CoreNotificationKind.ChangeCancelled)
            .OrderBy(item => item.OccurredAt).ThenBy(item => item.Id)
            .ToListAsync(cancellationToken);
        // Leave changed in place told its manager more than once: the cancellation answers the latest.
        told = told.GroupBy(item => (item.Kind, item.RecipientEmployeeId)).Select(group => group.Last())
            .OrderBy(item => item.OccurredAt).ThenBy(item => item.Id).ToList();
        var actorEmployeeId = http?.HttpContext?.User.GetEmployeeId();
        var actorName = ChangeSupport.ActorName(actor);
        var now = DateTime.UtcNow;
        foreach (var item in told)
        {
            if (item.RecipientEmployeeId == actorEmployeeId) continue;
            var notification = CoreNotification.CancellationOf(item, CoreChangeMoments.CancelledWords(item, actorName, actorEmployeeId), now);
            db.Notifications.Add(notification);
            cancellations.Add(notification);
        }
    }
}

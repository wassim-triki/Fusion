using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Infrastructure.Identity;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Notifications;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Reviews;

/// <summary>
/// Reminds open review work on its reminder days (D6): three days before the due date, the day after, then weekly; and an
/// unacknowledged result on its reminder day after release, then weekly. Each reminder's dedupe key
/// <c>Reminder:{task}:{resource}:{yyyy-MM-dd}</c> makes reruns and restarts harmless: at most one per task per day.
/// Reminders go out from 09:00 in the company's time zone on workdays; a Friday also sends the weekend's (B-002 N4).
/// </summary>
public sealed class ReviewReminderScanner(IServiceScopeFactory scopes)
{
    public async Task<int> ScanAsync(DateTime now, CancellationToken cancellationToken)
    {
        List<Guid> tenants;
        await using (var discovery = scopes.CreateAsyncScope())
        {
            var db = discovery.ServiceProvider.GetRequiredService<PerformanceDbContext>();
            // Discovery reads tenant identifiers only; every read and write after it is tenant-filtered.
            tenants = await db.Database.SqlQuery<Guid>($"""
                SELECT DISTINCT r."TenantId" AS "Value" FROM performance."ReviewRounds" r WHERE r."State" = 'Active'
                UNION
                SELECT DISTINCT p."TenantId" AS "Value" FROM performance."PerformanceReviews" p
                WHERE p."State" = 'Finalized' AND p."AcknowledgedAt" IS NULL
                """).ToListAsync(cancellationToken);
        }
        var staged = 0;
        foreach (var tenantId in tenants)
        {
            await using var scope = scopes.CreateAsyncScope();
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(tenantId);
            string timeZone;
            try
            {
                timeZone = (await scope.ServiceProvider.GetRequiredService<INotificationAudienceClient>().ReadAsync([], cancellationToken)).TimeZone;
            }
            catch (HttpRequestException) { continue; } // Identity unreachable: this tenant waits for the next hourly scan.
            if (ReminderClock.SendDay(now, timeZone) is not DateOnly sendDay) continue;
            var db = scope.ServiceProvider.GetRequiredService<PerformanceDbContext>();
            staged += await ScanTenantAsync(db, scope.ServiceProvider.GetRequiredService<IPerformanceNotifications>(), sendDay, cancellationToken);
        }
        return staged;
    }

    /// <summary>
    /// One tenant's reminders on the company's working day <paramref name="sendDay"/>, covering the reminder days it
    /// stands for (<see cref="ReminderClock.CoveredDays"/>); returns how many were staged.
    /// </summary>
    public static async Task<int> ScanTenantAsync(PerformanceDbContext db, IPerformanceNotifications notifications, DateOnly sendDay,
        CancellationToken cancellationToken)
    {
        var covered = ReminderClock.CoveredDays(sendDay);
        var due = new List<(ReviewReminderKind? Kind, Guid Resource, Guid Recipient, PerformanceReview Review, ReviewRound Round, DateOnly? Due, string Task, string Href, DateOnly Day)>();
        var active = await db.ReviewRounds.AsNoTracking().Where(r => r.State == ReviewRoundState.Active).ToListAsync(cancellationToken);
        foreach (var round in active)
        {
            var reviews = await db.PerformanceReviews.AsNoTracking().Where(r => r.ReviewRoundId == round.Id
                && r.State != PerformanceReviewState.Finalized && r.State != PerformanceReviewState.Closed).ToListAsync(cancellationToken);
            var requests = await db.PeerRequests.AsNoTracking().Where(r => r.ReviewRoundId == round.Id && r.State == PeerRequestState.Open)
                .ToListAsync(cancellationToken);
            foreach (var task in ReviewReminderTasks.For(round, reviews, requests))
            {
                var day = covered.FirstOrDefault(candidate => ReviewReminderSchedule.IsTaskReminderDay(task.Due, candidate));
                if (day == default) continue;
                due.Add((task.Kind, task.ResourceId, task.RecipientEmployeeId, task.Review, round, task.Due, TaskKey(task.Kind),
                    task.Kind switch
                    {
                        ReviewReminderKind.PeerInput => PerformanceNotificationTemplates.PeerRequestPath(task.ResourceId),
                        _ => PerformanceNotificationTemplates.ReviewPath(task.Review.Id),
                    }, day));
            }
        }
        var released = await db.PerformanceReviews.AsNoTracking()
            .Where(r => r.State == PerformanceReviewState.Finalized && r.AcknowledgedAt == null && r.FinalizedAt != null).ToListAsync(cancellationToken);
        if (released.Count > 0)
        {
            var roundIds = released.Select(r => r.ReviewRoundId).Distinct().ToArray();
            var rounds = await db.ReviewRounds.AsNoTracking().Where(r => roundIds.Contains(r.Id)).ToDictionaryAsync(r => r.Id, cancellationToken);
            foreach (var review in released)
            {
                var round = rounds[review.ReviewRoundId];
                var releasedOn = DateOnly.FromDateTime(review.FinalizedAt!.Value);
                var day = covered.FirstOrDefault(candidate =>
                    ReviewReminderSchedule.IsAcknowledgementReminderDay(releasedOn, round.AcknowledgementReminderDays, candidate));
                if (day != default)
                    due.Add((null, review.Id, review.SubjectEmployeeId, review, round, null, "acknowledge",
                        PerformanceNotificationTemplates.ReviewPath(review.Id), day));
            }
        }
        if (due.Count == 0) return 0;

        var keys = due.Select(task => Key(task.Kind, task.Resource, task.Day)).ToList();
        var sent = (await db.OutboxMessages.AsNoTracking().Where(m => keys.Contains(m.DedupeKey)).Select(m => m.DedupeKey).ToListAsync(cancellationToken))
            .ToHashSet();
        var staged = 0;
        foreach (var task in due)
        {
            var key = Key(task.Kind, task.Resource, task.Day);
            if (!sent.Add(key)) continue;
            var daysLate = ReviewReminderSchedule.DaysLate(task.Due, sendDay);
            var payload = new ReviewWorkNotificationPayload(task.Review.CycleId, task.Round.Id, task.Review.Id, task.Round.Name, task.Href,
                SubjectDisplayName: task.Review.SubjectDisplayName, Task: task.Task, DueDate: task.Due, DaysLate: daysLate);
            notifications.EnqueueReviewWork(task.Review, PerformanceNotificationKind.ReviewReminder, task.Recipient,
                task.Kind == ReviewReminderKind.PeerInput ? "PeerRequest" : "PerformanceReview", task.Resource, key, payload,
                PerformanceNotificationTemplates.ForReminder(task.Task, task.Review.SubjectDisplayName, task.Due, daysLate,
                    task.Round.Name, task.Href));
            staged++;
        }
        await db.SaveChangesAsync(cancellationToken);
        return staged;
    }

    private static string Key(ReviewReminderKind? kind, Guid resource, DateOnly day)
        => $"Reminder:{kind?.ToString() ?? "Acknowledgement"}:{resource:N}:{day:yyyy-MM-dd}";

    /// <summary>The reminder's task, as its catalogue key part.</summary>
    private static string TaskKey(ReviewReminderKind? kind) => kind switch
    {
        ReviewReminderKind.SelfAssessment => "selfAssessment",
        ReviewReminderKind.PeerInput => "peerInput",
        _ => "review",
    };
}

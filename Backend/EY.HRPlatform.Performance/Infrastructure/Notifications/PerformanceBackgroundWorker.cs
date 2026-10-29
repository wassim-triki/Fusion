using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Features.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Evidence;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Identity;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Notifications;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace EY.HRPlatform.Performance.Infrastructure.Notifications;

public static class PerformanceOutboxClaim
{
    /// <summary>Caller holds a transaction until delivery bookkeeping is saved.</summary>
    public static async Task<PerformanceOutboxMessage?> NextAsync(PerformanceDbContext db, DateTime now,
        CancellationToken cancellationToken)
    {
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Outbox claim requires a transaction.");
        var messages = await db.OutboxMessages.FromSqlInterpolated($"""
            SELECT * FROM performance."PerformanceOutboxMessages"
            WHERE "DispatchedAt" IS NULL AND "SkippedReason" IS NULL
              AND "Attempts" < 8 AND "NextAttemptAt" <= {now}
            ORDER BY "CreatedAt", "Id" LIMIT 1 FOR UPDATE SKIP LOCKED
            """).IgnoreQueryFilters().ToListAsync(cancellationToken);
        return messages.SingleOrDefault();
    }
}

/// <summary>Runs only within the claimed message's tenant; no global recipient/content queries.</summary>
public sealed class PerformanceNotificationDispatcher(PerformanceDbContext db, ITenantContext tenant,
    ICoreWorkforceClient workforce, INotificationAudienceClient audience, IPerformanceNotificationSender sender,
    IOptions<PerformanceNotificationOptions> options)
{
    /// <summary>The recipient turned email off for the kind's group. The in-app notification already exists.</summary>
    public const string RecipientOptedOut = "RecipientOptedOut";
    /// <summary>The in-app record the email is worded from is gone (purged, or never staged).</summary>
    public const string NoNotification = "no-notification";

    /// <summary>The kind's group follows the company's mode and the recipient's choice against it (B-002 N7).</summary>
    private async Task<bool> OptedOutAsync(PerformanceOutboxMessage message, NotificationDefaults? defaults, CancellationToken cancellationToken)
    {
        var group = NotificationGroups.Of(message.Kind);
        var preference = message.RecipientEmployeeId == Guid.Empty ? null : await db.NotificationPreferences.AsNoTracking()
            .FirstOrDefaultAsync(row => row.RecipientEmployeeId == message.RecipientEmployeeId, cancellationToken);
        return !NotificationPreference.EmailsGroup(preference, defaults, group);
    }

    public async Task DispatchAsync(PerformanceOutboxMessage message, DateTime now, CancellationToken cancellationToken)
    {
        if (!tenant.IsResolved || tenant.TenantId != message.TenantId)
            throw new InvalidOperationException("Notification dispatch requires the message's tenant context.");
        if (!message.IsPending || message.NextAttemptAt > now) return;
        var defaults = await db.NotificationDefaults.AsNoTracking().FirstOrDefaultAsync(cancellationToken);
        if (!options.Value.Enabled) message.Skip("disabled");
        else if (await OptedOutAsync(message, defaults, cancellationToken)) message.Skip(RecipientOptedOut);
        else
        {
            try
            {
                var recipients = await workforce.ResolveAsync(now, [message.RecipientEmployeeId], cancellationToken);
                var email = recipients.SingleOrDefault(r => r.EmployeeId == message.RecipientEmployeeId)?.WorkEmail;
                // The email says what the bell says: it's worded from the paired in-app record.
                var notification = await db.Notifications.AsNoTracking()
                    .FirstOrDefaultAsync(n => n.DedupeKey == message.DedupeKey, cancellationToken);
                if (string.IsNullOrWhiteSpace(email)) message.Skip("no-work-email");
                else if (notification is null) message.Skip(NoNotification);
                else
                {
                    var config = options.Value;
                    var reader = await audience.ReadAsync([message.RecipientEmployeeId], cancellationToken);
                    var content = PerformanceNotificationRenderer.Email(notification, reader.LanguageOf(message.RecipientEmployeeId),
                        config.ShellBaseUrl, reader.TenantName, defaults);
                    await sender.SendAsync(new FusionOutgoingEmail(email, content, $"<{message.Id:N}@fusion-performance>",
                        PerformanceNotificationRenderer.UnsubscribeUrl(message, config.ShellBaseUrl, config.UnsubscribeKey, defaults)), cancellationToken);
                    message.MarkDispatched(PerformanceClock.UtcNow);
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (Exception ex)
            {
                // Persist the error category, never provider exception text containing addresses or content.
                message.Fail(PerformanceClock.UtcNow, ex.GetType().Name);
            }
        }
        await db.SaveChangesAsync(cancellationToken);
    }
}

public sealed class PerformanceBackgroundWorker(IServiceScopeFactory scopeFactory, ILogger<PerformanceBackgroundWorker> logger,
    EvidenceUploadSweeper sweeper, PerformanceNotificationRetention retention,
    EY.HRPlatform.Performance.Features.OneOnOnes.OneOnOneReconciler oneOnOnes,
    EY.HRPlatform.Performance.Features.Reviews.ReviewReminderScanner reminders)
    : BackgroundService
{
    private DateTime _nextReminderScan = PerformanceClock.UtcNow;
    private DateTime _nextEvidenceSweep = PerformanceClock.UtcNow;
    private DateTime _nextOneOnOneReconciliation = PerformanceClock.UtcNow;
    private DateTime _nextNotificationPurge = PerformanceClock.UtcNow;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await ProcessBatchAsync(stoppingToken);
                if (PerformanceClock.UtcNow >= _nextEvidenceSweep)
                {
                    await sweeper.SweepAsync(PerformanceClock.UtcNow, stoppingToken);
                    _nextEvidenceSweep = PerformanceClock.UtcNow.AddHours(1);
                }
                if (PerformanceClock.UtcNow >= _nextOneOnOneReconciliation)
                {
                    // Set first: a Core outage shouldn't turn this into a retry every tick.
                    _nextOneOnOneReconciliation = PerformanceClock.UtcNow.AddMinutes(15);
                    await oneOnOnes.ReconcileAsync(PerformanceClock.UtcNow, stoppingToken);
                }
                if (PerformanceClock.UtcNow >= _nextReminderScan)
                {
                    // Hourly; the dedupe key keeps reruns and restarts to one reminder per task per day.
                    _nextReminderScan = PerformanceClock.UtcNow.AddHours(1);
                    await reminders.ScanAsync(PerformanceClock.UtcNow, stoppingToken);
                }
                if (PerformanceClock.UtcNow >= _nextNotificationPurge)
                {
                    await retention.PurgeAsync(PerformanceClock.UtcNow, stoppingToken);
                    _nextNotificationPurge = PerformanceClock.UtcNow.AddDays(1);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                logger.LogWarning("Performance background work failed ({ErrorType}).", ex.GetType().Name);
            }
        }
    }

    public async Task ProcessBatchAsync(CancellationToken cancellationToken)
    {
        // Small bounded batch, one row lock and a fresh tenant scope per message.
        for (var i = 0; i < 20; i++)
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<PerformanceDbContext>();
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            var message = await PerformanceOutboxClaim.NextAsync(db, PerformanceClock.UtcNow, cancellationToken);
            if (message is null) break;
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(message.TenantId);
            var dispatcher = scope.ServiceProvider.GetRequiredService<PerformanceNotificationDispatcher>();
            await dispatcher.DispatchAsync(message, PerformanceClock.UtcNow, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
    }
}

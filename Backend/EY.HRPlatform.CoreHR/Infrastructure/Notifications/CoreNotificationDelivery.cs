using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Notifications;
using EY.HRPlatform.SharedKernel.Security;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace EY.HRPlatform.CoreHR.Infrastructure.Notifications;

public sealed class CoreNotificationOptions
{
    public bool Enabled { get; set; }
    public string ShellBaseUrl { get; set; } = string.Empty;
    /// <summary>Signs one-click unsubscribe links (32+ characters). Without it, emails carry no unsubscribe header.</summary>
    public string? UnsubscribeKey { get; set; }
    public FusionSmtpOptions Smtp { get; set; } = new();
}

/// <summary>
/// Words a stored Core HR notification for one reader (B-153): the bell in the request's language, the email in the
/// recipient's account language. Emails carry names, titles, unit names and dates, never notes.
/// </summary>
public static class CoreNotificationRenderer
{
    public static readonly NotificationCatalog Catalog =
        NotificationCatalog.FromAssembly(typeof(CoreNotificationRenderer).Assembly, "EY.HRPlatform.CoreHR.Notifications.Text.notifications");

    public static (string Title, string? Context) InApp(CoreNotification notification, string language)
    {
        var values = notification.Values;
        var title = Catalog.Text(language, notification.TitleKey, values) ?? notification.TitleKey;
        var context = notification.ContextKey is null ? null : Catalog.Text(language, notification.ContextKey, values);
        return (title, string.IsNullOrWhiteSpace(context) ? null : context);
    }

    /// <summary>The email for one reader. <paramref name="defaults"/> are the company's modes (null: Fusion's).</summary>
    public static RenderedEmail Email(CoreNotification notification, string language, string shellBaseUrl, string companyName,
        CoreNotificationDefaults? defaults = null)
    {
        if (!Uri.TryCreate(shellBaseUrl, UriKind.Absolute, out var shell) || shell.Scheme is not ("https" or "http"))
            throw new InvalidOperationException("Notifications:ShellBaseUrl must be an absolute shell URL.");
        if (!notification.Href.StartsWith("/core/", StringComparison.Ordinal))
            throw new InvalidOperationException("A notification opens an in-app Core HR path.");
        var (title, context) = InApp(notification, language);
        var values = new Dictionary<string, string>(notification.Values) { ["title"] = title };
        // A title's first segment names what it's about, so a cancellation ("TeamJoining.cancelled") still opens the team.
        var about = notification.TitleKey.Split('.')[0];
        string? Part(string part)
            => Catalog.Text(language, $"{notification.TitleKey}.{part}", values) ?? Catalog.Text(language, $"{about}.{part}", values);
        const string group = CoreNotificationPreference.TeamAndJobChanges;
        return FusionNotificationEmail.Render(language,
            new NotificationEmailText(Part("subject") ?? title, context is null ? title : $"{title}. {context}.",
                Part("action") ?? FusionNotificationEmail.Text.Text(language, "action.open")!),
            $"{shellBaseUrl.TrimEnd('/')}{notification.Href}",
            new NotificationEmailGroup(Catalog.Text(language, $"group.{group}") ?? group,
                CanTurnOff: CoreNotificationDefaults.ModeOf(defaults, group) != NotificationEmailMode.Required),
            companyName, shellBaseUrl);
    }

    /// <summary>The one-click link that turns off this email's group; none for a group the company requires or without a key.</summary>
    public static string? UnsubscribeUrl(CoreNotification notification, string shellBaseUrl, string? key, CoreNotificationDefaults? defaults = null)
    {
        if (string.IsNullOrWhiteSpace(key)
            || CoreNotificationDefaults.ModeOf(defaults, CoreNotificationPreference.TeamAndJobChanges) == NotificationEmailMode.Required) return null;
        var token = UnsubscribeToken.Issue(
            new UnsubscribeClaim(notification.TenantId, notification.RecipientEmployeeId, CoreNotificationPreference.TeamAndJobChanges), key);
        return $"{shellBaseUrl.TrimEnd('/')}/api/corehr/notifications/unsubscribe?token={Uri.EscapeDataString(token)}";
    }
}

public interface ICoreNotificationSender
{
    Task SendAsync(FusionOutgoingEmail email, CancellationToken cancellationToken);
}

public sealed class SmtpCoreNotificationSender(IOptions<CoreNotificationOptions> options) : ICoreNotificationSender
{
    public Task SendAsync(FusionOutgoingEmail email, CancellationToken cancellationToken)
        => FusionMailer.SendAsync(options.Value.Smtp, email, cancellationToken);
}

/// <summary>Asks Identity for the company's name and each recipient's account language (B-002 N12); Core HR keeps no copy.</summary>
public interface ICoreNotificationAudienceClient
{
    Task<NotificationAudience> ReadAsync(IReadOnlyList<Guid> employeeIds, CancellationToken cancellationToken);
}

public sealed class CoreNotificationAudienceClient(HttpClient httpClient, IInternalServiceRequestSigner signer, ITenantContext tenantContext)
    : ICoreNotificationAudienceClient
{
    public async Task<NotificationAudience> ReadAsync(IReadOnlyList<Guid> employeeIds, CancellationToken cancellationToken)
    {
        if (!tenantContext.IsResolved)
            throw new InvalidOperationException("A resolved tenant context is required to read a notification audience.");
        var requestUri = new Uri(httpClient.BaseAddress!, "internal/identity/notification-audience");
        using var request = new HttpRequestMessage(HttpMethod.Post, requestUri)
        {
            Content = JsonContent.Create(new NotificationAudienceRequest(tenantContext.TenantId, employeeIds)),
        };
        await signer.SignAsync(request, cancellationToken);
        using var response = await httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<NotificationAudience>(cancellationToken)
            ?? throw new InvalidOperationException("Identity returned no notification audience.");
    }
}

/// <summary>Sends one notification's email inside its own tenant; never queries across tenants.</summary>
public sealed class CoreNotificationDispatcher(CoreHRDbContext db, ITenantContext tenant, ICoreNotificationAudienceClient audience,
    ICoreNotificationSender sender, IOptions<CoreNotificationOptions> options)
{
    public const string RecipientOptedOut = "RecipientOptedOut";

    public async Task DispatchAsync(CoreNotification notification, DateTime now, CancellationToken cancellationToken)
    {
        if (!tenant.IsResolved || tenant.TenantId != notification.TenantId)
            throw new InvalidOperationException("Notification dispatch requires the notification's tenant context.");
        if (!notification.EmailPending || notification.EmailNextAttemptAt > now) return;
        var config = options.Value;
        var defaults = await db.NotificationDefaults.AsNoTracking().FirstOrDefaultAsync(cancellationToken);
        var preference = await db.NotificationPreferences.AsNoTracking()
            .FirstOrDefaultAsync(item => item.RecipientEmployeeId == notification.RecipientEmployeeId, cancellationToken);
        if (!config.Enabled) notification.SkipEmail("disabled");
        else if (!CoreNotificationPreference.EmailsGroup(preference, defaults, CoreNotificationPreference.TeamAndJobChanges))
            notification.SkipEmail(RecipientOptedOut);
        else
        {
            try
            {
                var email = await db.Employees.AsNoTracking().Where(item => item.Id == notification.RecipientEmployeeId)
                    .Select(item => item.Email).FirstOrDefaultAsync(cancellationToken);
                if (string.IsNullOrWhiteSpace(email)) notification.SkipEmail("no-work-email");
                else
                {
                    var reader = await audience.ReadAsync([notification.RecipientEmployeeId], cancellationToken);
                    var content = CoreNotificationRenderer.Email(notification, reader.LanguageOf(notification.RecipientEmployeeId),
                        config.ShellBaseUrl, reader.TenantName, defaults);
                    await sender.SendAsync(new FusionOutgoingEmail(email, content, $"<{notification.Id:N}@fusion-corehr>",
                        CoreNotificationRenderer.UnsubscribeUrl(notification, config.ShellBaseUrl, config.UnsubscribeKey, defaults)), cancellationToken);
                    notification.MarkEmailSent(DateTime.UtcNow);
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (Exception ex)
            {
                // The error category only, never provider text that may hold addresses.
                notification.FailEmail(DateTime.UtcNow, ex.GetType().Name);
            }
        }
        await db.SaveChangesAsync(cancellationToken);
    }
}

/// <summary>
/// Sends pending Core HR notification emails (a small batch every 15 seconds, one row lock and tenant scope each) and
/// purges notifications past retention once a day.
/// </summary>
public sealed class CoreNotificationWorker(IServiceScopeFactory scopes, ILogger<CoreNotificationWorker> logger) : BackgroundService
{
    private DateTime _nextPurge = DateTime.UtcNow;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await ProcessBatchAsync(stoppingToken);
                if (DateTime.UtcNow >= _nextPurge)
                {
                    _nextPurge = DateTime.UtcNow.AddDays(1);
                    await PurgeAsync(DateTime.UtcNow, stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                logger.LogWarning("Core HR notification work failed ({ErrorType}).", ex.GetType().Name);
            }
        }
    }

    public async Task ProcessBatchAsync(CancellationToken cancellationToken)
    {
        for (var i = 0; i < 20; i++)
        {
            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<CoreHRDbContext>();
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            var now = DateTime.UtcNow;
            // Claims across tenants by id only; the dispatch then runs under the row's own tenant filter.
            var claimed = await db.Notifications.FromSqlInterpolated($"""
                SELECT * FROM corehr."CoreNotifications"
                WHERE "EmailSentAt" IS NULL AND "EmailSkippedReason" IS NULL
                  AND "EmailAttempts" < {CoreNotification.MaxEmailAttempts} AND "EmailNextAttemptAt" <= {now}
                ORDER BY "OccurredAt", "Id" LIMIT 1 FOR UPDATE SKIP LOCKED
                """).IgnoreQueryFilters().ToListAsync(cancellationToken);
            if (claimed.SingleOrDefault() is not { } notification) break;
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(notification.TenantId);
            await scope.ServiceProvider.GetRequiredService<CoreNotificationDispatcher>().DispatchAsync(notification, now, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
    }

    /// <summary>Deletes notifications past retention, one tenant at a time under its own filter.</summary>
    public async Task<int> PurgeAsync(DateTime now, CancellationToken cancellationToken)
    {
        var cutoff = now.AddDays(-CoreNotification.RetentionDays);
        List<Guid> tenants;
        await using (var discovery = scopes.CreateAsyncScope())
        {
            var db = discovery.ServiceProvider.GetRequiredService<CoreHRDbContext>();
            tenants = await db.Database.SqlQuery<Guid>($"""
                SELECT DISTINCT n."TenantId" AS "Value" FROM corehr."CoreNotifications" n WHERE n."OccurredAt" < {cutoff}
                """).ToListAsync(cancellationToken);
        }
        var removed = 0;
        foreach (var tenantId in tenants)
        {
            await using var scope = scopes.CreateAsyncScope();
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(tenantId);
            var db = scope.ServiceProvider.GetRequiredService<CoreHRDbContext>();
            removed += await db.Notifications.Where(item => item.OccurredAt < cutoff).ExecuteDeleteAsync(cancellationToken);
        }
        return removed;
    }
}

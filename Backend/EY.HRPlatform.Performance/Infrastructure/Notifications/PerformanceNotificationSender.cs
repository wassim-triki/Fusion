using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.SharedKernel.Notifications;
using Microsoft.Extensions.Options;

namespace EY.HRPlatform.Performance.Infrastructure.Notifications;

public sealed class PerformanceNotificationOptions
{
    public bool Enabled { get; set; }
    public string ShellBaseUrl { get; set; } = string.Empty;
    /// <summary>Signs one-click unsubscribe links (32+ characters). Without it, emails carry no unsubscribe header.</summary>
    public string? UnsubscribeKey { get; set; }
    public FusionSmtpOptions Smtp { get; set; } = new();
}

/// <summary>
/// Words a stored notification for one reader (B-153): the bell's title and context in the language the request reads
/// in, and the email in the recipient's account language. Emails only use names, round names, dates and counts.
/// </summary>
public static class PerformanceNotificationRenderer
{
    public static readonly NotificationCatalog Catalog =
        NotificationCatalog.FromAssembly(typeof(PerformanceNotificationRenderer).Assembly, "EY.HRPlatform.Performance.Notifications.Text.notifications");

    /// <summary>Rows from before B-153 have no keys; they keep the English they were written in.</summary>
    public static (string Title, string? Context) InApp(PerformanceNotification notification, string language)
    {
        if (notification.TitleKey is null) return (notification.Title ?? string.Empty, notification.Context);
        var values = notification.Values;
        var title = Catalog.Text(language, notification.TitleKey, values) ?? notification.TitleKey;
        var context = notification.ContextKey is null ? null : Catalog.Text(language, notification.ContextKey, values);
        return (title, string.IsNullOrWhiteSpace(context) ? null : context);
    }

    /// <summary>The email for one reader. <paramref name="defaults"/> are the company's modes (null: Fusion's).</summary>
    public static RenderedEmail Email(PerformanceNotification notification, string language, string shellBaseUrl, string companyName,
        NotificationDefaults? defaults = null)
    {
        if (!Uri.TryCreate(shellBaseUrl, UriKind.Absolute, out var shell) || shell.Scheme is not ("https" or "http"))
            throw new InvalidOperationException("Notifications:ShellBaseUrl must be an absolute shell URL.");
        if (!notification.Href.StartsWith("/performance/", StringComparison.Ordinal))
            throw new InvalidOperationException("A notification opens an in-app Performance path.");
        var (title, _) = InApp(notification, language);
        var values = new Dictionary<string, string>(notification.Values) { ["title"] = title };
        string? Part(string part) => notification.TitleKey is null ? null
            : Catalog.Text(language, $"{notification.TitleKey}.{part}", values) ?? Catalog.Text(language, $"{notification.Kind}.{part}", values);
        var group = NotificationGroups.Of(notification.Kind);
        return FusionNotificationEmail.Render(language,
            new NotificationEmailText(Part("subject") ?? title, Part("lead") ?? title,
                Part("action") ?? FusionNotificationEmail.Text.Text(language, "action.open")!),
            $"{shellBaseUrl.TrimEnd('/')}{notification.Href}",
            new NotificationEmailGroup(Catalog.Text(language, $"group.{group}") ?? group,
                NotificationDefaults.ModeOf(defaults, group) != NotificationEmailMode.Required),
            companyName, shellBaseUrl);
    }

    /// <summary>The one-click link that turns off this email's group; none for a group the company requires or without a key.</summary>
    public static string? UnsubscribeUrl(PerformanceOutboxMessage message, string shellBaseUrl, string? key, NotificationDefaults? defaults = null)
    {
        var group = NotificationGroups.Of(message.Kind);
        if (NotificationDefaults.ModeOf(defaults, group) == NotificationEmailMode.Required || message.RecipientEmployeeId == Guid.Empty
            || string.IsNullOrWhiteSpace(key)) return null;
        var token = UnsubscribeToken.Issue(new UnsubscribeClaim(message.TenantId, message.RecipientEmployeeId, group), key);
        return $"{shellBaseUrl.TrimEnd('/')}/api/performance/notifications/unsubscribe?token={Uri.EscapeDataString(token)}";
    }
}

public interface IPerformanceNotificationSender
{
    Task SendAsync(FusionOutgoingEmail email, CancellationToken cancellationToken);
}

public sealed class SmtpPerformanceNotificationSender(IOptions<PerformanceNotificationOptions> options) : IPerformanceNotificationSender
{
    public Task SendAsync(FusionOutgoingEmail email, CancellationToken cancellationToken)
        => FusionMailer.SendAsync(options.Value.Smtp, email, cancellationToken);
}

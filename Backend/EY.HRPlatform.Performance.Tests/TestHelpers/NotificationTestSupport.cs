using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Identity;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.SharedKernel.Localization;
using EY.HRPlatform.SharedKernel.Notifications;

namespace EY.HRPlatform.Performance.Tests.TestHelpers;

/// <summary>Identity's answer without Identity: English and UTC unless a test says otherwise.</summary>
public sealed class FakeNotificationAudienceClient : INotificationAudienceClient
{
    public Dictionary<Guid, string> Languages { get; } = [];
    public string TimeZone { get; set; } = "UTC";
    public string TenantName { get; set; } = "Carthage Industries";
    public bool Unreachable { get; set; }

    public Task<NotificationAudience> ReadAsync(IReadOnlyList<Guid> employeeIds, CancellationToken cancellationToken)
    {
        if (Unreachable) throw new HttpRequestException("Identity is down.");
        return Task.FromResult(new NotificationAudience(TenantName, TimeZone, FusionLanguages.English,
            employeeIds.Where(Languages.ContainsKey).Select(id => new NotificationRecipientLanguage(id, Languages[id])).ToList()));
    }
}

public static class NotificationText
{
    /// <summary>The bell's title as an English reader sees it.</summary>
    public static string EnglishTitle(this PerformanceNotification notification)
        => PerformanceNotificationRenderer.InApp(notification, FusionLanguages.English).Title;

    public static string? EnglishContext(this PerformanceNotification notification)
        => PerformanceNotificationRenderer.InApp(notification, FusionLanguages.English).Context;

    /// <summary>The email as an English recipient gets it.</summary>
    public static RenderedEmail EnglishEmail(this PerformanceNotification notification)
        => PerformanceNotificationRenderer.Email(notification, FusionLanguages.English, "http://localhost:3000", new NotificationCompany("Carthage Industries"));
}

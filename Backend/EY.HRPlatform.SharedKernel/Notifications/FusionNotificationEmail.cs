namespace EY.HRPlatform.SharedKernel.Notifications;

/// <summary>What a notification email says, already worded in the recipient's language by its module.</summary>
public sealed record NotificationEmailText(string Subject, string Lead, string ActionLabel);

/// <summary>Why the recipient got it: the email group, worded, and whether a person can turn it off.</summary>
public sealed record NotificationEmailGroup(string Name, bool CanTurnOff);

/// <summary>
/// The company an email is sent for, as Identity holds it: its name, its colour (<c>#rrggbb</c> or null for Fusion's)
/// and its logo (a checked PNG or null).
/// </summary>
public sealed record NotificationCompany(string Name, string? Color = null, byte[]? LogoPng = null);

/// <summary>
/// The notification email every module sends (B-002 N6): the shared layout, a footer that says why it was sent, the
/// company it was sent for and a link to the person's notification settings. Like an invitation (B-176, B-204), it
/// carries the company's brand: name and logo on top, the button in its colour, "Sent by {company} with Fusion" last.
/// </summary>
public static class FusionNotificationEmail
{
    public const string SettingsPath = "/settings/notifications";

    public static readonly NotificationCatalog Text =
        NotificationCatalog.FromAssembly(typeof(FusionNotificationEmail).Assembly, "EY.HRPlatform.SharedKernel.Notifications.Text.email");

    /// <summary>The <c>cid:</c> the company logo is carried under.</summary>
    public const string LogoContentId = "company-logo";

    public static RenderedEmail Render(string language, NotificationEmailText text, string actionUrl, NotificationEmailGroup group,
        NotificationCompany company, string shellBaseUrl)
    {
        var footer = new List<string>
        {
            Text.Text(language, group.CanTurnOff ? "footer.why" : "footer.locked", new Dictionary<string, string> { ["group"] = group.Name })!,
        };
        var brand = string.IsNullOrWhiteSpace(company.Name) ? null
            : new FusionEmailBrand(company.Name.Trim(), company.Color,
                Text.Text(language, "footer.sentBy", new Dictionary<string, string> { ["company"] = company.Name.Trim() })!,
                company.LogoPng is { Length: > 0 } logo ? new FusionEmailImage(LogoContentId, logo) : null);
        return FusionEmailLayout.Render(new FusionEmailContent(
            language, text.Subject, text.Subject, [text.Lead], text.ActionLabel, actionUrl, footer,
            FallbackLinkNote: Text.Text(language, "footer.fallback"),
            FooterLink: new FusionEmailLink(Text.Text(language, "footer.settings")!, $"{shellBaseUrl.TrimEnd('/')}{SettingsPath}"),
            Brand: brand));
    }
}

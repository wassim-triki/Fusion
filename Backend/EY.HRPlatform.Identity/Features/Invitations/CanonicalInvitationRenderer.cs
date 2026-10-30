using System.Globalization;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.SharedKernel.Localization;
using EY.HRPlatform.SharedKernel.Notifications;

namespace EY.HRPlatform.Identity.Features.Invitations;

/// <summary>
/// Everything a canonical invitation may say. The caller supplies only controlled
/// facts — never arbitrary HTML or purpose copy. <see cref="AccessSummary"/> is a
/// single friendly baseline phrase (for example, "Employee access") and must never
/// carry permission keys, claims, or internal identifiers. <see cref="Language"/> is the
/// company's default language (the recipient has none yet); <see cref="Brand"/> is the
/// company's brand, when the company sends the invitation.
/// </summary>
public sealed record CanonicalInvitation(
    InvitationPurpose Purpose,
    string TenantName,
    string Email,
    string ActionUrl,
    DateTime ExpiresAtUtc,
    string? RecipientName = null,
    string? AccessSummary = null,
    string? InviterName = null,
    string Language = FusionLanguages.English,
    InvitationBrand? Brand = null);

/// <summary>A company's colour (<c>#rrggbb</c> or null) and logo (a checked PNG or null), as the email shows them.</summary>
public sealed record InvitationBrand(string? Color, byte[]? LogoPng);

public sealed record RenderedInvitation(string Subject, string Html, string Text)
{
    /// <summary>Images the HTML shows by <c>cid:</c>: the company logo, when the invitation carries one.</summary>
    public IReadOnlyList<FusionEmailImage> Images { get; init; } = [];
}

/// <summary>
/// The one canonical Fusion invitation renderer. It is pure: no transport, no state,
/// no audit, no I/O. Every purpose produces its subject/heading/CTA on the shared
/// <see cref="FusionEmailLayout"/> in the company's language, a UTC expiry stated
/// identically in HTML and text, an opaque fallback URL and a security note. The first
/// administrator's invitation is Fusion's own; every other one carries the company's brand.
/// </summary>
public static class CanonicalInvitationRenderer
{
    /// <summary>The <c>cid:</c> the company logo travels under.</summary>
    public const string LogoContentId = "company-logo";

    private static readonly NotificationCatalog Copy =
        NotificationCatalog.FromAssembly(typeof(CanonicalInvitationRenderer).Assembly, "EY.HRPlatform.Identity.Notifications.Text.invitation");

    public static RenderedInvitation Render(CanonicalInvitation invitation)
    {
        ArgumentNullException.ThrowIfNull(invitation);
        if (!Enum.IsDefined(invitation.Purpose))
            throw new ArgumentOutOfRangeException(nameof(invitation), invitation.Purpose, "Unsupported invitation purpose.");

        var language = FusionLanguages.IsSupported(invitation.Language) ? invitation.Language : FusionLanguages.Default;
        var company = new Dictionary<string, string> { ["company"] = invitation.TenantName };
        string Say(string key, IReadOnlyDictionary<string, string>? values = null) => Copy.Text(language, key, values)!;
        string Purpose(string part) => Say($"{invitation.Purpose}.{part}", company);

        var brand = invitation.Brand is { } own && invitation.Purpose != InvitationPurpose.OrganizationBootstrap
            ? new FusionEmailBrand(
                invitation.TenantName,
                own.Color,
                Say("sentBy", company),
                own.LogoPng is { } logo ? new FusionEmailImage(LogoContentId, logo) : null)
            : null;

        var rendered = FusionEmailLayout.Render(new FusionEmailContent(
            language,
            Purpose("subject"),
            Purpose("heading"),
            [Purpose("lead")],
            Purpose("cta"),
            invitation.ActionUrl,
            [Say("ignore")],
            Greeting: string.IsNullOrWhiteSpace(invitation.RecipientName)
                ? null
                : Say("greeting", new Dictionary<string, string> { ["name"] = invitation.RecipientName!.Trim() }),
            Facts: [
                .. string.IsNullOrWhiteSpace(invitation.AccessSummary) ? [] : new[] { new FusionEmailFact(Say("fact.access"), invitation.AccessSummary!) },
                new FusionEmailFact(Say("fact.sentTo"), invitation.Email),
            ],
            ActionNote: Say("expires", new Dictionary<string, string> { ["date"] = FormatExpiry(invitation.ExpiresAtUtc, language) }),
            FallbackLinkNote: Say("fallback"),
            Brand: brand));

        return new RenderedInvitation(rendered.Subject, rendered.Html, rendered.Text) { Images = rendered.Images };
    }

    /// <summary>UTC named explicitly, in calendar terms, so the same instant reads the same in every client.</summary>
    public static string FormatExpiry(DateTime expiresAtUtc) => FormatExpiry(expiresAtUtc, FusionLanguages.English);

    /// <summary>The expiry in <paramref name="language"/>, on the Gregorian calendar, with UTC named.</summary>
    public static string FormatExpiry(DateTime expiresAtUtc, string language)
    {
        var value = expiresAtUtc.Kind == DateTimeKind.Utc
            ? expiresAtUtc
            : DateTime.SpecifyKind(expiresAtUtc, DateTimeKind.Utc);

        return language switch
        {
            FusionLanguages.French => value.ToString("d MMMM yyyy 'à' HH:mm 'UTC'", NotificationCatalog.Culture(language)),
            FusionLanguages.Arabic => value.ToString("d MMMM yyyy، HH:mm 'UTC'", NotificationCatalog.Culture(language)),
            _ => value.ToString("d MMMM yyyy 'at' HH:mm 'UTC'", CultureInfo.InvariantCulture),
        };
    }
}

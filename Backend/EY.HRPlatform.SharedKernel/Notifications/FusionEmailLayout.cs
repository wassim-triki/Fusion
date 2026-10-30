using System.Net;
using EY.HRPlatform.SharedKernel.Localization;

namespace EY.HRPlatform.SharedKernel.Notifications;

/// <summary>A labelled fact shown in its own box ("Access: Manager access").</summary>
public sealed record FusionEmailFact(string Label, string Value);

/// <summary>
/// Everything a Fusion email may say. Callers pass controlled text only; every value is HTML-escaped. The footer
/// lines say why the email was sent and what to do about it.
/// </summary>
public sealed record FusionEmailContent(
    string Language,
    string Subject,
    string Heading,
    IReadOnlyList<string> Lead,
    string ActionLabel,
    string ActionUrl,
    IReadOnlyList<string> Footer,
    string? Greeting = null,
    IReadOnlyList<FusionEmailFact>? Facts = null,
    string? ActionNote = null,
    string? FallbackLinkNote = null,
    FusionEmailLink? FooterLink = null,
    FusionEmailBrand? Brand = null);

/// <summary>
/// The company an email is sent for, in its own brand: its name (and logo, when it has one) head the email instead
/// of Fusion's, its colour fills the button, and <paramref name="SentBy"/> ("Sent by Carthage with Fusion") closes it.
/// <paramref name="Color"/> is <c>#rrggbb</c>, or null for Fusion's own.
/// </summary>
public sealed record FusionEmailBrand(string CompanyName, string? Color, string SentBy, FusionEmailImage? Logo = null);

/// <summary>An image carried inside the email and shown by <c>cid:</c>, so no client has to fetch anything.</summary>
public sealed record FusionEmailImage(string ContentId, byte[] Content, string MediaType = "image/png");

/// <summary>A link in the footer, such as the notification settings.</summary>
public sealed record FusionEmailLink(string Label, string Url);

public sealed record RenderedEmail(string Subject, string Html, string Text)
{
    /// <summary>Images the HTML shows by <c>cid:</c>; the mailer attaches them to the HTML part.</summary>
    public IReadOnlyList<FusionEmailImage> Images { get; init; } = [];
}

/// <summary>
/// The one Fusion email layout, shared by invitations and notifications: an email-safe one-column inline-CSS table with
/// text branding (or the company's brand), a single primary action, a fallback address, a plain-text twin, and
/// <c>lang</c>/<c>dir</c> from the language. No remote image, external stylesheet or gradient: a company logo travels
/// inside the email.
/// </summary>
public static class FusionEmailLayout
{
    /// <summary>Fusion's own button colour.</summary>
    public const string FusionAccent = "#f4c414";
    private const string FusionAccentText = "#2a1b00";
    private const string Ink = "#16161d";

    public static RenderedEmail Render(FusionEmailContent content)
    {
        ArgumentNullException.ThrowIfNull(content);
        var logo = content.Brand?.Logo;
        return new RenderedEmail(content.Subject, BuildHtml(content), BuildText(content))
        {
            Images = logo is { Content.Length: > 0 } ? [logo] : [],
        };
    }

    /// <summary>
    /// The text that reads best on <paramref name="color"/>: white or near-black, by WCAG contrast. The apps use the
    /// same rule, so the email's button matches the product's.
    /// </summary>
    public static string ReadableTextOn(string color)
    {
        var luminance = RelativeLuminance(color);
        var withWhite = 1.05 / (luminance + 0.05);
        var withInk = (luminance + 0.05) / (RelativeLuminance(Ink) + 0.05);
        return withWhite >= withInk ? "#ffffff" : Ink;
    }

    private static double RelativeLuminance(string hex)
    {
        static double Channel(string hex, int index)
        {
            var value = Convert.ToInt32(hex.Substring(1 + index * 2, 2), 16) / 255.0;
            return value <= 0.04045 ? value / 12.92 : Math.Pow((value + 0.055) / 1.055, 2.4);
        }
        return 0.2126 * Channel(hex, 0) + 0.7152 * Channel(hex, 1) + 0.0722 * Channel(hex, 2);
    }

    private static bool IsHexColor(string? value)
        => value is { Length: 7 } && value[0] == '#' && value.Skip(1).All(Uri.IsHexDigit);

    private static string BuildText(FusionEmailContent content)
    {
        var lines = new List<string> { content.Brand?.CompanyName.Trim() ?? "Fusion", "" };
        if (!string.IsNullOrWhiteSpace(content.Greeting)) lines.AddRange([content.Greeting!.Trim(), ""]);
        foreach (var paragraph in content.Lead) lines.AddRange([paragraph, ""]);
        foreach (var fact in content.Facts ?? []) lines.AddRange([$"{fact.Label}: {fact.Value.Trim()}", ""]);
        lines.Add($"{content.ActionLabel}:");
        lines.Add(content.ActionUrl);
        if (!string.IsNullOrWhiteSpace(content.ActionNote)) lines.AddRange(["", content.ActionNote!]);
        foreach (var line in content.Footer) lines.AddRange(["", line]);
        if (content.FooterLink is { } link) lines.AddRange(["", $"{link.Label}: {link.Url}"]);
        if (content.Brand is { } brand) lines.AddRange(["", brand.SentBy]);
        return string.Join(Environment.NewLine, lines);
    }

    private static string BuildHtml(FusionEmailContent content)
    {
        static string E(string value) => WebUtility.HtmlEncode(value);
        var language = FusionLanguages.IsSupported(content.Language) ? content.Language : FusionLanguages.Default;
        var direction = language == FusionLanguages.Arabic ? "rtl" : "ltr";
        var link = E(content.ActionUrl);
        var brand = content.Brand;
        var accent = IsHexColor(brand?.Color) ? brand!.Color!.ToLowerInvariant() : FusionAccent;
        var accentText = accent == FusionAccent ? FusionAccentText : ReadableTextOn(accent);
        var logoCell = brand?.Logo is { } logo
            ? $"""<td style="padding-inline-end:12px;"><img src="cid:{E(logo.ContentId)}" width="44" height="44" alt="" style="display:block; width:44px; height:44px; border-radius:10px;" /></td>"""
            : string.Empty;
        var identity = brand is null
            ? """<div style="font-size:15px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:#16161d;">Fusion</div>"""
            : $"""<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>{logoCell}<td style="font-size:17px; font-weight:700; color:#16161d;">{E(brand.CompanyName.Trim())}</td></tr></table>""";
        var sentBy = brand is null ? string.Empty
            : $"""<p style="margin:12px 0 0 0; font-size:12px; line-height:19px; color:#6b6b76;">{E(brand.SentBy)}</p>""";

        var greeting = string.IsNullOrWhiteSpace(content.Greeting) ? string.Empty : $"""
            <tr><td style="padding:22px 32px 0 32px;">
            <p style="margin:0; font-size:14px; line-height:22px; color:#6b6b76;">{E(content.Greeting!.Trim())}</p>
            </td></tr>
            """;
        var lead = string.Concat(content.Lead.Select(paragraph =>
            $"""<p style="margin:14px 0 0 0; font-size:15px; line-height:24px; color:#4a4a55;">{E(paragraph)}</p>"""));
        var facts = string.Concat((content.Facts ?? []).Select(fact => $"""
            <tr><td style="padding:20px 32px 0 32px;">
            <div style="border:1px solid #e2e2e8; border-radius:10px; padding:14px 16px; background:#fafafb;">
            <div style="font-size:12px; letter-spacing:0.06em; text-transform:uppercase; color:#6b6b76;">{E(fact.Label)}</div>
            <div style="margin-top:4px; font-size:15px; font-weight:600; color:#16161d; word-break:break-all;">{E(fact.Value.Trim())}</div>
            </div>
            </td></tr>
            """));
        var actionNote = string.IsNullOrWhiteSpace(content.ActionNote) ? string.Empty
            : $"""<p style="margin:14px 0 0 0; font-size:13px; line-height:20px; color:#6b6b76;">{E(content.ActionNote!)}</p>""";
        var fallback = string.IsNullOrWhiteSpace(content.FallbackLinkNote) ? string.Empty
            : $"""<p style="margin:18px 0 0 0; font-size:12px; line-height:19px; color:#6b6b76;">{E(content.FallbackLinkNote!)}<br /><span style="color:#16161d; word-break:break-all;">{link}</span></p>""";
        var footer = string.Concat(content.Footer.Select(line =>
            $"""<p style="margin:12px 0 0 0; font-size:12px; line-height:19px; color:#6b6b76;">{E(line)}</p>"""));
        var footerLink = content.FooterLink is { } settings
            ? $"""<p style="margin:12px 0 0 0; font-size:12px; line-height:19px;"><a href="{E(settings.Url)}" style="color:#16161d;">{E(settings.Label)}</a></p>"""
            : string.Empty;

        return $"""
            <!doctype html>
            <html lang="{language}" dir="{direction}">
            <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>{E(content.Subject)}</title>
            </head>
            <body style="margin:0; padding:32px 16px; background:#f4f4f6; font-family:'Segoe UI',Helvetica,Arial,sans-serif; color:#16161d;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="{direction}">
            <tr><td align="center">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:100%; max-width:560px; background:#ffffff; border:1px solid #e2e2e8; border-radius:14px; text-align:start;">
            <tr><td style="padding:28px 32px 0 32px;">
            {identity}
            </td></tr>
            {greeting}
            <tr><td style="padding:22px 32px 0 32px;">
            <h1 style="margin:0; font-size:24px; line-height:32px; font-weight:700; color:#16161d;">{E(content.Heading)}</h1>
            {lead}
            </td></tr>
            {facts}
            <tr><td style="padding:24px 32px 0 32px;">
            <a href="{link}" style="display:inline-block; background:{accent}; color:{accentText}; text-decoration:none; font-size:15px; font-weight:600; line-height:20px; padding:14px 24px; border-radius:10px;">{E(content.ActionLabel)}</a>
            {actionNote}
            </td></tr>
            <tr><td style="padding:22px 32px 28px 32px; border-top:1px solid #ececf1;">
            {fallback}
            {footer}
            {footerLink}
            {sentBy}
            </td></tr>
            </table>
            </td></tr>
            </table>
            </body>
            </html>
            """;
    }
}

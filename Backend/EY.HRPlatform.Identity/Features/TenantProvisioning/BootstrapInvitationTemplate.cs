using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.Branding;
using EY.HRPlatform.Identity.Features.Invitations;
using EY.HRPlatform.SharedKernel.Localization;
using EY.HRPlatform.SharedKernel.Notifications;

namespace EY.HRPlatform.Identity.Features.TenantProvisioning;

/// <summary>
/// Everything a bootstrap or administrative invitation message needs to say.
/// Assembled once by the delivery step so every sender — SMTP, local capture, or a
/// future provider — renders identical content from identical input.
/// <para>
/// <see cref="Purpose"/> selects the canonical variant: bootstrap keeps its
/// first-administrator semantics, while the additional-administrator and recovery
/// purposes render their own copy and never inherit bootstrap wording. It defaults
/// to <see cref="InvitationPurpose.OrganizationBootstrap"/> so bootstrap callers are
/// unchanged. <see cref="InviterName"/> personalizes the additional-administrator
/// message only.
/// </para>
/// </summary>
public sealed record BootstrapInvitationMessage(
    string TenantName,
    string Email,
    string ActivationLink,
    DateTime ExpiresAtUtc,
    InvitationPurpose Purpose = InvitationPurpose.OrganizationBootstrap,
    string? InviterName = null,
    InvitationBranding? Branding = null);

public sealed record RenderedBootstrapInvitation(string Subject, string Html, string Text)
{
    public IReadOnlyList<FusionEmailImage> Images { get; init; } = [];
}

/// <summary>
/// The approved Fusion administrative invitation message, now rendered through the
/// one canonical renderer (<see cref="CanonicalInvitationRenderer"/>). This type
/// remains the assembly seam bootstrap and administrative delivery already share; it
/// no longer owns its own HTML/text, so bootstrap, additional-administrator, and
/// recovery each get their exact locked copy from a single source.
///
/// `Fusion` is the visible text identity. There is no logo asset, so the message
/// renders identically in clients that block remote images.
/// </summary>
public static class BootstrapInvitationTemplate
{
    public static RenderedBootstrapInvitation Render(BootstrapInvitationMessage message)
    {
        ArgumentNullException.ThrowIfNull(message);

        var rendered = CanonicalInvitationRenderer.Render(new CanonicalInvitation(
            Purpose: message.Purpose,
            TenantName: message.TenantName,
            Email: message.Email,
            ActionUrl: message.ActivationLink,
            ExpiresAtUtc: message.ExpiresAtUtc,
            InviterName: message.InviterName,
            Language: message.Branding?.Language ?? FusionLanguages.English,
            Brand: message.Branding?.Brand));

        return new RenderedBootstrapInvitation(rendered.Subject, rendered.Html, rendered.Text) { Images = rendered.Images };
    }

    /// <summary>
    /// The expiry as the recipient reads it, in their calendar's terms rather than a
    /// machine timestamp. UTC is named explicitly because the message crosses time
    /// zones and a bare time would be a guess. Delegates to the canonical renderer so
    /// every purpose formats the expiry identically.
    /// </summary>
    public static string FormatExpiry(DateTime expiresAtUtc)
        => CanonicalInvitationRenderer.FormatExpiry(expiresAtUtc);
}

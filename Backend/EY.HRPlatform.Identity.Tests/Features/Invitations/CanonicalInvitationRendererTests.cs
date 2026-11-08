using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.Invitations;

namespace EY.HRPlatform.Identity.Tests.Features.Invitations;

/// <summary>
/// The canonical renderer is the single source of invitation wording, so its exact
/// locked copy, escaping, expiry equivalence, and absence of leaked wording are pinned
/// here per purpose. If any subject/heading/CTA drifts, or a variant inherits another's
/// semantics, these fail.
/// </summary>
public sealed class CanonicalInvitationRendererTests
{
    private static readonly DateTime Expiry =
        new(2026, 8, 24, 9, 30, 0, DateTimeKind.Utc);

    private static CanonicalInvitation Invite(
        InvitationPurpose purpose,
        string tenant = "Atlas Group",
        string email = "casey@atlas.example",
        string url = "https://app.fusion.local/activate/opaque-token",
        string? recipient = null,
        string? summary = null,
        string? inviter = null)
        => new(purpose, tenant, email, url, Expiry, recipient, summary, inviter);

    [Fact]
    public void Bootstrap_uses_its_exact_locked_copy()
    {
        var rendered = CanonicalInvitationRenderer.Render(Invite(InvitationPurpose.OrganizationBootstrap));

        Assert.Equal("Set up your Fusion administrator account for Atlas Group", rendered.Subject);
        Assert.Contains("Set up your administrator account", rendered.Html);
        Assert.Contains(">Set up administrator account</a>", rendered.Html);
        Assert.Contains("first administrator account", rendered.Text); // first-administrator semantics preserved
    }

    [Fact]
    public void Recovery_restores_access_and_describes_no_new_tenant_or_first_admin()
    {
        var rendered = CanonicalInvitationRenderer.Render(
            Invite(InvitationPurpose.TenantAdministratorRecovery));

        Assert.Equal("Restore administrator access to Atlas Group", rendered.Subject);
        Assert.Contains(">Restore access</a>", rendered.Html);
        Assert.Contains("A recovery invitation was issued to restore administrator access to Atlas Group.", rendered.Text);
        Assert.DoesNotContain("first administrator", rendered.Html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("first administrator", rendered.Text, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Workforce_uses_its_exact_locked_copy_and_never_legacy_branding()
    {
        var rendered = CanonicalInvitationRenderer.Render(
            Invite(InvitationPurpose.WorkforceAccount, summary: "Employee access"));

        Assert.Equal("Activate your Fusion access for Atlas Group", rendered.Subject);
        Assert.Contains("Activate your Fusion account", rendered.Html);
        Assert.Contains(">Activate Fusion access</a>", rendered.Html);
        Assert.Contains("Your organization has activated Fusion access for you at Atlas Group.", rendered.Text);
        Assert.DoesNotContain("EY HR Platform", rendered.Html);
        Assert.DoesNotContain("EY HR Platform", rendered.Text);
    }

    [Fact]
    public void Workforce_access_summary_shows_only_the_friendly_baseline()
    {
        var rendered = CanonicalInvitationRenderer.Render(
            Invite(InvitationPurpose.WorkforceAccount, summary: "Manager access"));

        Assert.Contains("Manager access", rendered.Html);
        Assert.Contains("Manager access", rendered.Text);
        // No permission keys, claims, or internal identifiers.
        foreach (var forbidden in new[] { "core.access", "@Tenant", "claim", "UserId", "EmployeeId", "MembershipId", "permission" })
        {
            Assert.DoesNotContain(forbidden, rendered.Html, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain(forbidden, rendered.Text, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public void Every_dynamic_value_is_html_escaped_but_text_stays_literal()
    {
        var rendered = CanonicalInvitationRenderer.Render(Invite(
            InvitationPurpose.WorkforceAccount,
            tenant: "Atlas <b>Group</b>",
            email: "a&b@atlas.example",
            url: "https://app.fusion.local/activate?t=a&b=<x>",
            recipient: "O'Neil <script>"));

        Assert.DoesNotContain("<b>Group</b>", rendered.Html);
        Assert.Contains("Atlas &lt;b&gt;Group&lt;/b&gt;", rendered.Html);
        Assert.Contains("a&amp;b@atlas.example", rendered.Html);
        Assert.DoesNotContain("<script>", rendered.Html);
        // The subject is plain text and keeps the literal tenant name.
        Assert.Equal("Activate your Fusion access for Atlas <b>Group</b>", rendered.Subject);
        // The text view keeps literal meaning.
        Assert.Contains("a&b@atlas.example", rendered.Text);
    }

    [Fact]
    public void Expiry_is_the_same_exact_utc_instant_in_html_and_text()
    {
        var rendered = CanonicalInvitationRenderer.Render(Invite(InvitationPurpose.OrganizationBootstrap));

        const string expected = "24 August 2026 at 09:30 UTC";
        Assert.Contains(expected, rendered.Html);
        Assert.Contains(expected, rendered.Text);
    }

    [Fact]
    public void The_opaque_action_url_is_the_only_link_and_appears_as_a_fallback()
    {
        var url = "https://app.fusion.local/activate/opaque-token";
        var rendered = CanonicalInvitationRenderer.Render(Invite(InvitationPurpose.WorkforceAccount, url: url));

        Assert.Contains($"href=\"{url}\"", rendered.Html);
        Assert.Contains(url, rendered.Text);
    }

    [Fact]
    public void Message_depends_on_no_remote_asset_or_external_style()
    {
        var rendered = CanonicalInvitationRenderer.Render(Invite(InvitationPurpose.OrganizationBootstrap));

        Assert.DoesNotContain("<img", rendered.Html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("http://", rendered.Html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("<link", rendered.Html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("linear-gradient", rendered.Html, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void An_unsupported_purpose_is_rejected_rather_than_falling_back()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            CanonicalInvitationRenderer.Render(Invite((InvitationPurpose)999)));
    }
}

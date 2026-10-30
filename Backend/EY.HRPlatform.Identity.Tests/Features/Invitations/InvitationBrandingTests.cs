using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.Branding;
using EY.HRPlatform.Identity.Features.Invitations;
using EY.HRPlatform.Identity.Features.WorkforceAccounts;
using EY.HRPlatform.SharedKernel.Notifications;

namespace EY.HRPlatform.Identity.Tests.Features.Invitations;

/// <summary>B-176: invitations speak the company's language and wear its brand; the first administrator's stays Fusion's.</summary>
public class InvitationBrandingTests
{
    private static readonly byte[] Logo = Controllers.BrandControllerTests.Png();

    private static CanonicalInvitation Invitation(InvitationPurpose purpose, string language, InvitationBrand? brand) => new(
        purpose, "Carthage", "sami@example.test", "http://localhost:3000/invite/accept?token=x",
        new DateTime(2026, 11, 6, 9, 30, 0, DateTimeKind.Utc), RecipientName: "Sami Ben Ali", Language: language, Brand: brand);

    [Fact]
    public void A_workforce_invitation_carries_the_company_name_logo_and_colour()
    {
        var rendered = CanonicalInvitationRenderer.Render(
            Invitation(InvitationPurpose.WorkforceAccount, "en", new InvitationBrand("#3e63dd", Logo)));

        Assert.Contains("cid:company-logo", rendered.Html);
        Assert.Contains("background:#3e63dd; color:#ffffff;", rendered.Html);
        Assert.Contains("Sent by Carthage with Fusion", rendered.Html);
        Assert.DoesNotContain("letter-spacing:0.14em; text-transform:uppercase; color:#16161d;\">Fusion<", rendered.Html);
        Assert.StartsWith("Carthage", rendered.Text);
        Assert.Equal("company-logo", Assert.Single(rendered.Images).ContentId);
    }

    [Fact]
    public void A_light_colour_gets_dark_text()
    {
        var rendered = CanonicalInvitationRenderer.Render(
            Invitation(InvitationPurpose.WorkforceAccount, "en", new InvitationBrand("#ffd84d", null)));
        Assert.Contains("background:#ffd84d; color:#16161d;", rendered.Html);
        Assert.Empty(rendered.Images);
        Assert.DoesNotContain("cid:", rendered.Html);
    }

    [Fact]
    public void In_arabic_the_invitation_reads_right_to_left_on_the_gregorian_calendar()
    {
        var rendered = CanonicalInvitationRenderer.Render(
            Invitation(InvitationPurpose.WorkforceAccount, "ar", new InvitationBrand(null, null)));

        Assert.Contains("lang=\"ar\" dir=\"rtl\"", rendered.Html);
        Assert.Equal("فعّل وصولك إلى Fusion في Carthage", rendered.Subject);
        Assert.Contains("مرحبًا Sami Ben Ali،", rendered.Text);
        Assert.Contains("2026", rendered.Text);
        Assert.Contains("نوفمبر", rendered.Text);
        Assert.Contains("background:#f4c414", rendered.Html);
    }

    [Fact]
    public void In_french_the_expiry_is_written_the_french_way()
    {
        var rendered = CanonicalInvitationRenderer.Render(Invitation(InvitationPurpose.TenantAdministrator, "fr", null));
        Assert.Equal("Vous êtes invité à administrer Carthage dans Fusion", rendered.Subject);
        Assert.Contains("Cette invitation expire le 6 novembre 2026 à 09:30 UTC.", rendered.Text);
    }

    [Fact]
    public void The_first_administrators_invitation_stays_fusions_own()
    {
        var rendered = CanonicalInvitationRenderer.Render(
            Invitation(InvitationPurpose.OrganizationBootstrap, "en", new InvitationBrand("#3e63dd", Logo)));
        Assert.DoesNotContain("cid:", rendered.Html);
        Assert.DoesNotContain("#3e63dd", rendered.Html);
        Assert.StartsWith("Fusion", rendered.Text);
    }

    [Fact]
    public void Every_language_has_every_line()
    {
        var copy = typeof(CanonicalInvitationRenderer).Assembly;
        var catalog = NotificationCatalog.FromAssembly(copy, "EY.HRPlatform.Identity.Notifications.Text.invitation");
        var english = catalog.Entries["en"].Keys.Order().ToList();
        Assert.All(new[] { "fr", "ar" }, language => Assert.Equal(english, catalog.Entries[language].Keys.Order().ToList()));
    }

    [Fact]
    public void The_sent_email_carries_the_logo_inside_the_html_part()
    {
        using var mail = WorkforceInvitationMailAssembly.Build(
            new WorkforceInvitationEmailMessage(Guid.NewGuid(), Guid.NewGuid(), "Carthage", null, "sami@example.test", "Sami",
                "http://localhost:3000/invite/accept?token=x", DateTime.UtcNow.AddDays(7), ["Employee"],
                new InvitationBranding("en", new InvitationBrand("#3e63dd", Logo))),
            new WorkforceInvitationEmailOptions { FromEmail = "no-reply@fusion.test", FromName = "Fusion" });

        var html = Assert.Single(mail.AlternateViews);
        var resource = Assert.Single(html.LinkedResources);
        Assert.Equal("company-logo", resource.ContentId);
        Assert.Equal("image/png", resource.ContentType.MediaType);
    }
}

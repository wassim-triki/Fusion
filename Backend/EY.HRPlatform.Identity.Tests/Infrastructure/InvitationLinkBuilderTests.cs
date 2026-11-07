using EY.HRPlatform.Identity.Infrastructure.Services;
using Microsoft.Extensions.Configuration;

namespace EY.HRPlatform.Identity.Tests.Infrastructure;

public class InvitationLinkBuilderTests
{
    [Fact]
    public void Build_UsesConfiguredPublicBaseUrl()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Application:PublicBaseUrl"] = "https://demo.example.com/"
            })
            .Build();

        var link = InvitationLinkBuilder.Build(configuration, "abc123");

        Assert.Equal("https://demo.example.com/invite/accept?token=abc123", link);
    }

    [Fact]
    public void Build_UsesDefaultLocalBaseUrlWhenMissing()
    {
        var configuration = new ConfigurationBuilder().Build();

        var link = InvitationLinkBuilder.Build(configuration, "abc123");

        Assert.Equal("http://localhost:3000/invite/accept?token=abc123", link);
    }

    [Fact]
    public void Build_EncodesTokenForQueryString()
    {
        var link = InvitationLinkBuilder.Build("http://localhost:3000", "a+b/c?=");

        Assert.Equal("http://localhost:3000/invite/accept?token=a%2Bb%2Fc%3F%3D", link);
    }

    [Fact]
    public void Every_invitation_link_names_its_company_so_the_page_wears_its_brand()
    {
        Assert.Equal("http://localhost:3000/invite/accept?token=abc123&company=carthage-digital",
            InvitationLinkBuilder.Build("http://localhost:3000", "abc123", "carthage-digital"));
        Assert.Equal("http://localhost:3000/activate-invitation?credential=abc123&company=carthage-digital",
            EY.HRPlatform.Identity.Features.TenantProvisioning.BootstrapActivationLinkBuilder.Build("http://localhost:3000", "abc123", "carthage-digital"));
        Assert.Equal("http://localhost:3000/recover-administrator-access?credential=abc123&company=carthage-digital",
            EY.HRPlatform.Identity.Features.TenantAdministration.AdministrativeAcceptanceLinkBuilder.Build("http://localhost:3000", "abc123", "carthage-digital"));
        Assert.Equal("http://localhost:3000/invite/accept?token=abc123", InvitationLinkBuilder.Build("http://localhost:3000", "abc123", " "));
    }
}

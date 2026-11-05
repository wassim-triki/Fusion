using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.SingleSignOn;
using EY.HRPlatform.Identity.Features.TenantProvisioning;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Tests.Features.SingleSignOn;

/// <summary>
/// B-191 invitations accepted through a provider: only from the invitation's own link, only with the invited address,
/// creating the account with no password and the link in the same transaction; the company's requirement decides
/// which ways a workforce invitation offers, while administrative ones keep every way.
/// </summary>
[Collection(SsoCollection.Name)]
public sealed class SsoInvitationTests(SsoFixture fixture)
{
    private readonly Sso _sso = new(fixture);
    private bool Available => fixture.Available;

    [SkippableFact]
    public async Task A_workforce_invitation_accepted_with_Google_creates_the_account_without_a_password_and_signs_in()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var email = $"hana@{Sso.UniqueDomain()}";
        var (credential, inviteId) = await WorkforceInvitationAsync(tenantId, email);

        var (status, data) = await AcceptAsync("workforce", credential, "google", Sso.Person(email));

        Assert.Equal(HttpStatusCode.OK, status);
        var userId = Guid.Parse(Sso.Session(data, "userId")!);
        Assert.Equal(tenantId.ToString(), Sso.Session(data, "tenantId"));
        await _sso.WithDbAsync(async db =>
        {
            var account = await db.Users.IgnoreQueryFilters().SingleAsync(item => item.Id == userId);
            Assert.Null(account.PasswordHash);
            Assert.Equal(email, account.Email);
            Assert.True(await db.TenantMemberships.IgnoreQueryFilters().AnyAsync(item => item.UserId == userId && item.TenantId == tenantId && item.EmployeeId != null));
            Assert.True(await db.ExternalLogins.AnyAsync(item => item.UserId == userId && item.Provider == "google"));
            Assert.Equal(InvitationState.Accepted, (await db.InviteTokens.IgnoreQueryFilters().SingleAsync(item => item.Id == inviteId)).State);
        });
    }

    [SkippableFact]
    public async Task Another_address_at_the_provider_leaves_the_invitation_open_and_creates_nothing()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var email = $"aicha@{Sso.UniqueDomain()}";
        var (credential, inviteId) = await WorkforceInvitationAsync(tenantId, email);

        var (_, data) = await AcceptAsync("workforce", credential, "google", Sso.Person("aicha.b@gmail.com"));

        Assert.Equal(SsoRefusals.InvitationMismatch, Sso.RefusalCode(data));
        Assert.Equal("aicha.b@gmail.com", data.GetProperty("refusal").GetProperty("email").GetString());
        Assert.Equal(InvitationState.Pending, await _sso.WithDbAsync(db => db.InviteTokens.IgnoreQueryFilters().Where(item => item.Id == inviteId).Select(item => item.State).SingleAsync()));
        Assert.Equal(0, await _sso.CountAsync(db => db.Users.IgnoreQueryFilters().Where(item => item.Email == email)));
    }

    [SkippableFact]
    public async Task An_administrator_invitation_and_a_first_activation_accept_through_Microsoft()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var adminEmail = $"youssef@{Sso.UniqueDomain()}";
        var adminCredential = await AdministrativeInvitationAsync(tenantId, adminEmail, InvitationPurpose.TenantAdministrator);

        var administrator = await AcceptAsync("administrator", adminCredential, "microsoft", Sso.Person(adminEmail));
        var adminId = Guid.Parse(Sso.Session(administrator.Data, "userId")!);
        Assert.True(await _sso.WithDbAsync(db => db.TenantAdministratorAssignments.IgnoreQueryFilters().AnyAsync(item => item.UserId == adminId && item.RevokedAt == null)));

        // A freshly provisioned company, waiting for its first administrator.
        var fresh = await _sso.WithDbAsync(async db =>
        {
            var tenant = Tenant.Create($"New {Guid.NewGuid():N}"[..14]);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();
            return tenant.Id;
        });
        var firstEmail = $"first@{Sso.UniqueDomain()}";
        var bootstrap = await BootstrapInvitationAsync(fresh, firstEmail);

        var activated = await AcceptAsync("bootstrap", bootstrap, "microsoft", Sso.Person(firstEmail));

        Assert.Equal(fresh.ToString(), Sso.Session(activated.Data, "tenantId"));
        Assert.Equal(TenantAdministratorActivationStatus.Active,
            await _sso.WithDbAsync(db => db.Tenants.Where(item => item.Id == fresh).Select(item => item.AdministratorActivationStatus).SingleAsync()));
    }

    [SkippableFact]
    public async Task An_address_that_already_has_an_account_is_refused()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var existing = await _sso.AddMemberAsync(tenantId, $"taken@{Sso.UniqueDomain()}");
        var credential = await AdministrativeInvitationAsync(tenantId, existing.Email!, InvitationPurpose.TenantAdministrator);

        var (refused, response) = await _sso.StartAsync(_sso.Browser(),
            new { purpose = "invitation", provider = "google", invitation = new { kind = "administrator", credential } });

        Assert.Null(refused);
        Assert.Equal(SsoRefusals.ExistingAccount, await Sso.ProblemCode(response));
        Assert.Equal(0, await _sso.CountAsync(db => db.ExternalLogins.Where(item => item.UserId == existing.Id)));
    }

    [SkippableFact]
    public async Task Where_the_company_requires_its_provider_a_workforce_invitation_accepts_only_through_it()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var domain = Sso.UniqueDomain();
        var admin = await _sso.AddMemberAsync(tenantId, $"admin@{domain}", administrator: true);
        await _sso.ConnectAsync(tenantId, admin.Id, [domain], required: true);
        var email = $"sara@{domain}";
        var (credential, _) = await WorkforceInvitationAsync(tenantId, email);

        // The invitation page offers only the company's provider.
        var invite = await _sso.Browser().GetFromJsonAsync<JsonElement>($"/api/identity/invites/{Uri.EscapeDataString(credential)}");
        var ways = invite.GetProperty("data").GetProperty("waysIn");
        Assert.False(ways.GetProperty("password").GetBoolean());
        Assert.Equal("company", Assert.Single(ways.GetProperty("providers").EnumerateArray()).GetProperty("key").GetString());

        var password = await _sso.Browser().PostAsJsonAsync($"/api/identity/invites/{Uri.EscapeDataString(credential)}/accept",
            new { password = "Choose@123456", firstName = "Sara", lastName = "Person" });
        Assert.Equal(HttpStatusCode.Conflict, password.StatusCode);
        Assert.Equal(SsoRefusals.SsoRequired, await Sso.ProblemCode(password));

        var (refusedStart, google) = await _sso.StartAsync(_sso.Browser(),
            new { purpose = "invitation", provider = "google", invitation = new { kind = "workforce", credential } });
        Assert.Null(refusedStart);
        Assert.Equal(SsoRefusals.CompanyRequires, await Sso.ProblemCode(google));

        var (status, data) = await AcceptAsync("workforce", credential, "company", Sso.Person(email));
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.NotNull(Sso.Session(data));
    }

    // ── plumbing ─────────────────────────────────────────

    private async Task<(HttpStatusCode Status, JsonElement Data)> AcceptAsync(
        string kind, string credential, string provider, Dictionary<string, string> person)
    {
        var browser = _sso.Browser();
        var (authorize, response) = await _sso.StartAsync(browser, new { purpose = "invitation", provider, invitation = new { kind, credential } });
        Assert.True(authorize is not null, await response.Content.ReadAsStringAsync());
        var landing = await _sso.CallbackAsync(browser, await _sso.AtProviderAsync(browser, authorize!, person));
        Assert.Equal($"{SsoFixture.Origin}/auth/sso/complete", landing.ToString());
        return await _sso.ResultAsync(browser);
    }

    private async Task<(string Credential, Guid InviteId)> WorkforceInvitationAsync(Guid tenantId, string email)
        => await _sso.WithDbAsync(async db =>
        {
            var invite = InviteToken.CreateWorkforce(email, tenantId, PlatformRole.Employee, Guid.NewGuid(), "Invited", "Person", Guid.NewGuid());
            var credential = BootstrapCredential.Issue();
            invite.IssueCredential(credential.Selector, BootstrapCredential.Digest(credential.Secret));
            db.InviteTokens.Add(invite);
            await db.SaveChangesAsync();
            return (credential.RawValue, invite.Id);
        });

    private async Task<string> AdministrativeInvitationAsync(Guid tenantId, string email, InvitationPurpose purpose)
        => await _sso.WithDbAsync(async db =>
        {
            var invite = InviteToken.CreateAdministrative(email, tenantId, Guid.NewGuid(), purpose, firstName: "Youssef", lastName: "Haddad");
            var credential = BootstrapCredential.Issue();
            invite.IssueCredential(credential.Selector, BootstrapCredential.Digest(credential.Secret));
            db.InviteTokens.Add(invite);
            await db.SaveChangesAsync();
            return credential.RawValue;
        });

    private async Task<string> BootstrapInvitationAsync(Guid tenantId, string email)
        => await _sso.WithDbAsync(async db =>
        {
            var invite = InviteToken.CreateOrganizationBootstrap(email, tenantId, Guid.NewGuid(), firstName: "First", lastName: "Admin");
            var credential = BootstrapCredential.Issue();
            invite.IssueCredential(credential.Selector, BootstrapCredential.Digest(credential.Secret));
            db.InviteTokens.Add(invite);
            await db.SaveChangesAsync();
            return credential.RawValue;
        });
}

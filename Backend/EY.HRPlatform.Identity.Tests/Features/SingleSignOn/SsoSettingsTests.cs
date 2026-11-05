using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using EY.HRPlatform.Identity.Controllers;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Features.SingleSignOn;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace EY.HRPlatform.Identity.Tests.Features.SingleSignOn;

/// <summary>
/// B-191 Settings › Sign-in on the server: who may read and change it, company isolation, the client secret, domain
/// proof, the requirement and the sessions it ends, and confirming it's you through the provider.
/// </summary>
[Collection(SsoCollection.Name)]
public sealed class SsoSettingsTests(SsoFixture fixture)
{
    private const string Secret = "a-client-secret-nobody-sees";
    private readonly Sso _sso = new(fixture);
    private bool Available => fixture.Available;

    // ── Who may read and change ──────────────────────────

    [SkippableFact]
    public async Task Only_a_usable_administrator_changes_single_sign_on_and_a_viewer_only_reads()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var domain = Sso.UniqueDomain();
        var admin = await _sso.AddMemberAsync(tenantId, $"admin@{domain}", administrator: true);
        var manager = await _sso.AddMemberAsync(tenantId, $"hr@{domain}");
        await _sso.ConnectAsync(tenantId, admin.Id, [domain]);

        // Someone who holds the sign-in settings permissions but doesn't administer the company.
        var holder = Principal(manager.Id, tenantId, CorePermissions.SettingsProvisioningView, CorePermissions.SettingsProvisioningManage);
        using var scope = _sso.Factory.Services.CreateScope();
        var controller = Controller(scope, tenantId, holder);
        var writes = new Func<Task<IActionResult>>[]
        {
            () => controller.SetProviders(new SetFusionProvidersRequest(false, false), default),
            () => controller.SaveConnection(new SaveSsoConnectionRequest("OpenIdConnect", "X", "https://x.example", null, "id", "s", SsoFixture.Password, false), default),
            () => controller.RemoveConnection(new SsoConfirmationRequest(SsoFixture.Password, false), default),
            () => controller.AddDomain(new AddSsoDomainRequest(Sso.UniqueDomain()), default),
            () => controller.RemoveDomain(domain, new SsoConfirmationRequest(SsoFixture.Password, false), default),
            () => controller.SetRequirement(new SetSsoRequirementRequest(true, null, false), default),
        };
        foreach (var write in writes)
            Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<ObjectResult>(await write()).StatusCode);

        var read = Assert.IsType<OkObjectResult>(await controller.Get(default));
        Assert.False(((Models.Responses.ApiResponse<SsoSettingsDto>)read.Value!).Data!.CanManage);
        var stranger = Controller(scope, tenantId, Principal(manager.Id, tenantId));
        Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<ObjectResult>(await stranger.Get(default)).StatusCode);

        var asAdmin = await _sso.SignedInAsync(admin.Email!);
        var settings = await asAdmin.GetFromJsonAsync<JsonElement>("/api/identity/sso/settings");
        Assert.True(settings.GetProperty("data").GetProperty("canManage").GetBoolean());
        Assert.False((await _sso.WithDbAsync(db => db.Tenants.SingleAsync(item => item.Id == tenantId))).AllowMicrosoftSignIn == false);
    }

    [SkippableFact]
    public async Task One_company_never_reaches_anothers_settings_or_links()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var a = await _sso.AddTenantAsync();
        var b = await _sso.AddTenantAsync();
        var aDomain = Sso.UniqueDomain();
        var aAdmin = await _sso.AddMemberAsync(a, $"admin@{aDomain}", administrator: true);
        var aPerson = await _sso.AddMemberAsync(a, $"person@{aDomain}");
        var bAdmin = await _sso.AddMemberAsync(b, $"admin@{Sso.UniqueDomain()}", administrator: true);
        await _sso.ConnectAsync(a, aAdmin.Id, [aDomain]);
        await _sso.SignInAsync("company", aPerson.Email!);
        var linkId = await _sso.WithDbAsync(db => db.ExternalLogins.Where(item => item.UserId == aPerson.Id).Select(item => item.Id).SingleAsync());

        var asB = await _sso.SignedInAsync(bAdmin.Email!);
        var settings = (await asB.GetFromJsonAsync<JsonElement>("/api/identity/sso/settings")).GetProperty("data");
        Assert.Equal(JsonValueKind.Null, settings.GetProperty("connection").ValueKind);
        Assert.Empty(settings.GetProperty("domains").EnumerateArray());
        Assert.Equal(HttpStatusCode.NotFound, (await asB.GetAsync($"/api/identity/sso/links?userId={aPerson.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await asB.DeleteAsync($"/api/identity/sso/links/{linkId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await asB.SendAsync(new HttpRequestMessage(HttpMethod.Delete, $"/api/identity/sso/settings/domains/{aDomain}")
            { Content = JsonContent.Create(new { password = SsoFixture.Password }) })).StatusCode);
        Assert.Equal(1, await _sso.CountAsync(db => db.ExternalLogins.Where(item => item.Id == linkId)));

        // A's own administrator sees and removes the link.
        var asA = await _sso.SignedInAsync(aAdmin.Email!);
        var links = (await asA.GetFromJsonAsync<JsonElement>($"/api/identity/sso/links?userId={aPerson.Id}")).GetProperty("data");
        Assert.Equal("company", Assert.Single(links.EnumerateArray()).GetProperty("provider").GetString());
        Assert.Equal(HttpStatusCode.OK, (await asA.DeleteAsync($"/api/identity/sso/links/{linkId}")).StatusCode);
    }

    [SkippableFact]
    public async Task The_client_secret_never_leaves_Identity_and_another_companys_ciphertext_does_not_decrypt()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var a = await _sso.AddTenantAsync();
        var b = await _sso.AddTenantAsync();
        var aAdmin = await _sso.AddMemberAsync(a, $"admin@{Sso.UniqueDomain()}", administrator: true);
        var bAdmin = await _sso.AddMemberAsync(b, $"admin@{Sso.UniqueDomain()}", administrator: true);
        var asA = await _sso.SignedInAsync(aAdmin.Email!);

        var unconfirmed = await asA.PutAsJsonAsync("/api/identity/sso/settings/connection", Connection(Secret, null));
        Assert.Equal("password-incorrect", await Sso.ProblemCode(unconfirmed));
        var saved = await asA.PutAsJsonAsync("/api/identity/sso/settings/connection", Connection(Secret, SsoFixture.Password));
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        Assert.DoesNotContain(Secret, await saved.Content.ReadAsStringAsync());
        Assert.DoesNotContain(Secret, await asA.GetStringAsync("/api/identity/sso/settings"));
        // The stored secret never follows the connection to another issuer.
        var moveAway = await asA.PutAsJsonAsync("/api/identity/sso/settings/connection", new
        {
            kind = "OpenIdConnect", displayName = "Acme Login", issuer = $"{SsoFixture.Origin}/api/identity/dev-oidc/google",
            clientId = "acme-app", password = SsoFixture.Password,
        });
        Assert.Equal("secret-required", await Sso.ProblemCode(moveAway));

        var stored = await _sso.WithDbAsync(db => db.SsoConnections.SingleAsync(item => item.TenantId == a));
        Assert.DoesNotContain(Secret, stored.ProtectedClientSecret);

        using var scope = _sso.Factory.Services.CreateScope();
        var catalog = scope.ServiceProvider.GetRequiredService<SsoProviderCatalog>();
        Assert.Equal(Secret, catalog.Company(stored)!.ClientSecret);
        var moved = SsoConnection.Create(b, SsoConnectionKind.OpenIdConnect, "Moved", stored.Issuer, null, "x", stored.ProtectedClientSecret, bAdmin.Id, DateTime.UtcNow);
        Assert.Equal(string.Empty, catalog.Company(moved)!.ClientSecret);
    }

    // ── The provider address ─────────────────────────────

    [Theory]
    [InlineData("http://login.example/.well-known/openid-configuration", "https://")]
    [InlineData("https://127.0.0.1/.well-known/openid-configuration", "private")]
    [InlineData("https://169.254.169.254/latest/meta-data", "private")]
    [InlineData("https://10.0.0.5/.well-known/openid-configuration", "private")]
    [InlineData("https://[::1]/.well-known/openid-configuration", "private")]
    [InlineData("https://localhost/.well-known/openid-configuration", "private")]
    [InlineData("http://localhost:3000/api/identity/dev-oidc/company/.well-known/openid-configuration", "https://")]
    public async Task Fusion_does_not_call_private_or_plain_addresses(string url, string reason)
    {
        using var backchannel = new SsoBackchannel(new SsoOptions { PublicOrigin = "https://fusion.example", IsLocal = false });

        var refused = await Assert.ThrowsAsync<SsoBackchannelException>(() => backchannel.GetAsync(url, default));

        Assert.Contains(reason, refused.Message);
    }

    [Fact]
    public async Task Fusion_does_not_follow_redirects_and_checks_the_issuer_the_provider_names()
    {
        var redirecting = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.Found) { Headers = { Location = new Uri("https://10.0.0.5/") } });
        using var first = new SsoBackchannel(new SsoOptions { PublicOrigin = "https://fusion.example" }, guardedHandler: redirecting);
        Assert.Contains("redirect", (await Assert.ThrowsAsync<SsoBackchannelException>(() => first.GetAsync("https://login.example/x", default))).Message);

        var lying = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = JsonContent.Create(new { issuer = "https://someone-else.example", authorization_endpoint = "https://login.example/a", token_endpoint = "https://login.example/t", jwks_uri = "https://login.example/k" }),
        });
        using var second = new SsoBackchannel(new SsoOptions { PublicOrigin = "https://fusion.example" }, guardedHandler: lying);
        var oidc = new SsoOidcClient(second, new Microsoft.Extensions.Caching.Memory.MemoryCache(new Microsoft.Extensions.Caching.Memory.MemoryCacheOptions()));
        var provider = new SsoProvider("company", Guid.NewGuid(), Guid.NewGuid(), "Acme", "https://login.example", "https://login.example",
            "id", "secret", SsoTrustProfile.CompanyOidc, null);
        Assert.Contains("issuer", (await Assert.ThrowsAsync<SsoBackchannelException>(() => oidc.DiscoverAsync(provider, default))).Message);

        // The browser is sent to the authorization endpoint: a script address there is refused, never stored.
        var scripted = new StubHandler(request => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = request.RequestUri!.AbsolutePath.EndsWith("keys")
                ? JsonContent.Create(new { keys = Array.Empty<object>() })
                : JsonContent.Create(new { issuer = "https://login.example", authorization_endpoint = "javascript:alert(document.cookie)//", token_endpoint = "https://login.example/t", jwks_uri = "https://login.example/keys" }),
        });
        using var third = new SsoBackchannel(new SsoOptions { PublicOrigin = "https://fusion.example" }, guardedHandler: scripted);
        var scriptedOidc = new SsoOidcClient(third, new Microsoft.Extensions.Caching.Memory.MemoryCache(new Microsoft.Extensions.Caching.Memory.MemoryCacheOptions()));
        Assert.Contains("https://", (await Assert.ThrowsAsync<SsoBackchannelException>(() => scriptedOidc.DiscoverAsync(provider, default))).Message);
    }

    [SkippableFact]
    public async Task Outside_Development_and_Testing_the_test_provider_does_not_exist()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var admin = SsoFixture.AdminConnection!;
        var name = await SsoFixture.CreateDatabaseAsync(admin, "fusion_sso_prod");
        try
        {
            await using var production = new SsoApiFactory(new Npgsql.NpgsqlConnectionStringBuilder(admin) { Database = name }.ConnectionString, "Production");
            var client = production.CreateClient();

            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/identity/dev-oidc/google/.well-known/openid-configuration")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/identity/dev-oidc/keys")).StatusCode);
            var options = production.Services.GetRequiredService<SsoOptions>();
            Assert.Null(options.TestProviderPrefix);
            Assert.False(options.Microsoft.IsConfigured);
        }
        finally
        {
            await SsoFixture.DropDatabaseAsync(admin, name);
        }
    }

    // ── Domains ──────────────────────────────────────────

    [SkippableFact]
    public async Task Domains_are_proved_only_by_a_test_sign_in_from_them_and_by_one_company()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var other = await _sso.AddTenantAsync();
        var domain = Sso.UniqueDomain();
        var elsewhere = Sso.UniqueDomain();
        var admin = await _sso.AddMemberAsync(tenantId, $"admin@{domain}", administrator: true);
        var otherAdmin = await _sso.AddMemberAsync(other, $"admin@{elsewhere}", administrator: true);
        await _sso.ConnectAsync(other, otherAdmin.Id, [elsewhere]);
        var browser = _sso.Bearer((await _sso.LoginAsync(admin.Email!)).GetProperty("accessToken").GetString()!);
        Assert.Equal(HttpStatusCode.OK, (await browser.PutAsJsonAsync("/api/identity/sso/settings/connection", Connection(SsoFixture.TestSecret, SsoFixture.Password))).StatusCode);

        Assert.Equal("public-domain", await Sso.ProblemCode(await browser.PostAsJsonAsync("/api/identity/sso/settings/domains", new { domain = "gmail.com" })));
        Assert.Equal("domain-taken", await Sso.ProblemCode(await browser.PostAsJsonAsync("/api/identity/sso/settings/domains", new { domain = elsewhere })));
        Assert.Equal(HttpStatusCode.OK, (await browser.PostAsJsonAsync("/api/identity/sso/settings/domains", new { domain = domain.ToUpperInvariant() })).StatusCode);

        // A test as someone outside the list proves nothing and links nobody.
        await TestAsync(browser, Sso.Person($"admin@{Sso.UniqueDomain()}"));
        var data = (await browser.GetFromJsonAsync<JsonElement>("/api/identity/sso/settings")).GetProperty("data");
        Assert.Equal(JsonValueKind.Null, data.GetProperty("domains")[0].GetProperty("provedAt").ValueKind);
        Assert.Equal("Tested", data.GetProperty("connection").GetProperty("status").GetString());

        // A test as themselves proves the domain and links them.
        await TestAsync(browser, Sso.Person(admin.Email!));
        data = (await browser.GetFromJsonAsync<JsonElement>("/api/identity/sso/settings")).GetProperty("data");
        Assert.NotEqual(JsonValueKind.Null, data.GetProperty("domains")[0].GetProperty("provedAt").ValueKind);
        Assert.True(data.GetProperty("checks").GetProperty("freshOwnLink").GetBoolean());
    }

    [SkippableFact]
    public async Task A_wrong_secret_fails_the_test_with_what_the_provider_said()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var admin = await _sso.AddMemberAsync(tenantId, $"admin@{Sso.UniqueDomain()}", administrator: true);
        var browser = _sso.Bearer((await _sso.LoginAsync(admin.Email!)).GetProperty("accessToken").GetString()!);
        await browser.PutAsJsonAsync("/api/identity/sso/settings/connection", Connection("not-the-secret", SsoFixture.Password));

        await TestAsync(browser, Sso.Person(admin.Email!));

        var connection = (await browser.GetFromJsonAsync<JsonElement>("/api/identity/sso/settings")).GetProperty("data").GetProperty("connection");
        Assert.Equal("failed", connection.GetProperty("lastTestOutcome").GetString());
        Assert.Contains("refused the client secret", connection.GetProperty("lastTestMessage").GetString());
        Assert.Equal("Draft", connection.GetProperty("status").GetString());
    }

    // ── The requirement ──────────────────────────────────

    [SkippableFact]
    public async Task The_requirement_turns_on_only_when_everything_is_in_place()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var domain = Sso.UniqueDomain();
        var admin = await _sso.AddMemberAsync(tenantId, $"admin@{domain}", administrator: true);
        await _sso.ConnectAsync(tenantId, admin.Id, [domain]);
        var browser = await _sso.SignedInAsync(admin.Email!);

        // Tested and proved, but the administrator hasn't signed in with it lately.
        var notFresh = await browser.PostAsJsonAsync("/api/identity/sso/settings/requirement", new { on = true });
        Assert.Equal("requirement-not-ready", await Sso.ProblemCode(notFresh));

        // Fresh link, but nobody who administers the company keeps a password.
        await TestAsync(browser, Sso.Person(admin.Email!));
        await _sso.WithDbAsync(async db =>
        {
            (await db.Users.IgnoreQueryFilters().SingleAsync(item => item.Id == admin.Id)).PasswordHash = null;
            await db.SaveChangesAsync();
        });
        Assert.Equal("requirement-not-ready", await Sso.ProblemCode(await browser.PostAsJsonAsync("/api/identity/sso/settings/requirement", new { on = true })));
        Assert.Null(await _sso.WithDbAsync(db => db.SsoConnections.Where(item => item.TenantId == tenantId).Select(item => item.RequiredAt).SingleAsync()));
    }

    [SkippableFact]
    public async Task Requiring_the_provider_ends_members_password_sessions_and_keeps_administrators_password()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var other = await _sso.AddTenantAsync();
        var domain = Sso.UniqueDomain();
        var admin = await _sso.AddMemberAsync(tenantId, $"admin@{domain}", administrator: true);
        var member = await _sso.AddMemberAsync(tenantId, $"member@{domain}");
        var providerUser = await _sso.AddMemberAsync(tenantId, $"provider@{domain}");
        // Another company's person at the same domain (which this company proved) is not this company's to govern.
        var outsider = await _sso.AddMemberAsync(other, $"outsider@{domain}");
        await _sso.ConnectAsync(tenantId, admin.Id, [domain]);

        var memberSession = await _sso.LoginAsync(member.Email!);
        var adminSession = await _sso.LoginAsync(admin.Email!);
        var providerSession = (await _sso.SignInAsync("company", providerUser.Email!)).Data.GetProperty("session");
        var revisionBefore = await RevisionAsync(member.Id);
        var browser = _sso.Bearer(adminSession.GetProperty("accessToken").GetString()!);
        await TestAsync(browser, Sso.Person(admin.Email!));

        var on = await browser.PostAsJsonAsync("/api/identity/sso/settings/requirement", new { on = true });

        Assert.Equal(HttpStatusCode.OK, on.StatusCode);
        var connection = (await on.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("connection");
        Assert.True(connection.GetProperty("requiredEndedSessions").GetInt32() >= 1);
        Assert.True(await RevisionAsync(member.Id) > revisionBefore);

        // The member's password session is over; the provider session and the administrator's password session survive.
        Assert.Equal(SsoRefusals.SsoRequired, await RefreshCodeAsync(memberSession));
        Assert.Null(await RefreshCodeAsync(providerSession));
        Assert.Null(await RefreshCodeAsync(adminSession));

        // After: only administrators keep the password, and their use of it is recorded.
        await _sso.LoginAsync(member.Email!, expected: HttpStatusCode.Unauthorized);
        await _sso.LoginAsync(admin.Email!);
        Assert.True(await _sso.CountAsync(db => db.AccessAuditEvents.IgnoreQueryFilters()
            .Where(item => item.TenantId == tenantId && item.Action == SsoAuditActions.PasswordUsedWhileRequired)) >= 1);
        Assert.Equal(SsoRefusals.CompanyRequires, Sso.RefusalCode((await _sso.SignInAsync("google", member.Email!)).Data));
        Assert.NotNull(Sso.Session((await _sso.SignInAsync("company", member.Email!)).Data));
        await _sso.LoginAsync(outsider.Email!);

        // While on: the provider's identity can't change, its secret can, and turning it off asks who you are.
        Assert.Equal("requirement-on", await Sso.ProblemCode(await browser.PutAsJsonAsync("/api/identity/sso/settings/connection",
            new { kind = "OpenIdConnect", displayName = "Acme Login", issuer = $"{SsoFixture.Origin}/api/identity/dev-oidc/google", clientId = "acme-app", password = SsoFixture.Password })));
        Assert.Equal(HttpStatusCode.OK, (await browser.PutAsJsonAsync("/api/identity/sso/settings/connection",
            new { kind = "OpenIdConnect", displayName = "Acme Login", issuer = $"{SsoFixture.Origin}/api/identity/dev-oidc/company", clientId = "acme-app", clientSecret = SsoFixture.TestSecret, password = SsoFixture.Password })).StatusCode);
        Assert.Equal("password-incorrect", await Sso.ProblemCode(await browser.PostAsJsonAsync("/api/identity/sso/settings/requirement", new { on = false })));
        Assert.Equal(HttpStatusCode.OK, (await browser.PostAsJsonAsync("/api/identity/sso/settings/requirement", new { on = false, password = SsoFixture.Password })).StatusCode);
        await _sso.LoginAsync(member.Email!);
    }

    // ── Confirming it's you ──────────────────────────────

    [SkippableFact]
    public async Task An_administrator_without_a_password_confirms_through_the_provider_once()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var domain = Sso.UniqueDomain();
        var admin = await _sso.AddMemberAsync(tenantId, $"admin@{domain}", password: null, administrator: true);
        var providerOnly = await _sso.AddMemberAsync(tenantId, $"newadmin@{domain}", password: null);
        await _sso.ConnectAsync(tenantId, admin.Id, [domain]);
        await _sso.SignInAsync("company", providerOnly.Email!);
        var browser = _sso.Bearer(Sso.Session((await _sso.SignInAsync("company", admin.Email!)).Data)!);

        var unconfirmed = await browser.PostAsJsonAsync("/api/identity/tenant-access/administrators", new { userId = providerOnly.Id, sso = true });
        Assert.Equal("confirmation-required", await Sso.ProblemCode(unconfirmed));

        var (authorize, _) = await _sso.StartAsync(browser, new { purpose = "confirm", provider = "company", returnTo = "/core/access" });
        var landing = await _sso.CallbackAsync(browser, await _sso.AtProviderAsync(browser, authorize!, Sso.Person(admin.Email!)));
        Assert.Equal($"{SsoFixture.Origin}/core/access?confirmed=sso", landing.ToString());

        var added = await browser.PostAsJsonAsync("/api/identity/tenant-access/administrators", new { userId = providerOnly.Id, sso = true });
        Assert.Equal(HttpStatusCode.OK, added.StatusCode);
        Assert.True(await _sso.WithDbAsync(db => db.TenantAdministratorAssignments.IgnoreQueryFilters().AnyAsync(item => item.UserId == providerOnly.Id && item.RevokedAt == null)));

        // Used once.
        var replay = await browser.PostAsJsonAsync("/api/identity/sso/settings/requirement", new { on = false, sso = true });
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode); // nothing to turn off, so no confirmation is asked
        var again = await browser.PutAsJsonAsync("/api/identity/sso/settings/connection",
            new { kind = "OpenIdConnect", displayName = "Renamed", issuer = $"{SsoFixture.Origin}/api/identity/dev-oidc/company", clientId = "acme-app", sso = true });
        Assert.Equal("confirmation-required", await Sso.ProblemCode(again));

        // Someone else's sign-in at the provider doesn't confirm this administrator.
        var (other, _) = await _sso.StartAsync(browser, new { purpose = "confirm", provider = "company", returnTo = "/core/access" });
        var refused = await _sso.CallbackAsync(browser, await _sso.AtProviderAsync(browser, other!, Sso.Person(providerOnly.Email!)));
        Assert.Equal($"{SsoFixture.Origin}/core/access?confirmed=failed", refused.ToString());
        Assert.Equal("confirmation-required", await Sso.ProblemCode(await browser.PutAsJsonAsync("/api/identity/sso/settings/connection",
            new { kind = "OpenIdConnect", displayName = "Renamed", issuer = $"{SsoFixture.Origin}/api/identity/dev-oidc/company", clientId = "acme-app", sso = true })));
    }

    // ── plumbing ─────────────────────────────────────────

    private static object Connection(string secret, string? password) => new
    {
        kind = "OpenIdConnect",
        displayName = "Acme Login",
        issuer = $"{SsoFixture.Origin}/api/identity/dev-oidc/company",
        clientId = "acme-app",
        clientSecret = secret,
        password,
    };

    private async Task TestAsync(HttpClient browser, Dictionary<string, string> person)
    {
        var (authorize, response) = await _sso.StartAsync(browser, new { purpose = "test", provider = "company" });
        Assert.True(authorize is not null, await response.Content.ReadAsStringAsync());
        var landing = await _sso.CallbackAsync(browser, await _sso.AtProviderAsync(browser, authorize!, person));
        Assert.Equal($"{SsoFixture.Origin}/core/settings/sign-in?sso=tested", landing.ToString());
    }

    private Task<int> RevisionAsync(Guid userId)
        => _sso.WithDbAsync(db => db.TenantMemberships.IgnoreQueryFilters().Where(item => item.UserId == userId).Select(item => item.AccessRevision).SingleAsync());

    /// <summary>Null when the refresh works; the refusal code otherwise.</summary>
    private async Task<string?> RefreshCodeAsync(JsonElement session)
    {
        var response = await _sso.Factory.CreateClient().PostAsJsonAsync("/api/identity/auth/refresh",
            new { refreshToken = session.GetProperty("refreshToken").GetString() });
        return response.StatusCode == HttpStatusCode.OK ? null : await Sso.ProblemCode(response) ?? response.StatusCode.ToString();
    }

    private static ClaimsPrincipal Principal(Guid userId, Guid tenantId, params string[] permissions) => new(new ClaimsIdentity(
        [
            new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
            new Claim(CustomClaimTypes.TenantId, tenantId.ToString()),
            .. permissions.Select(permission => new Claim(CustomClaimTypes.CorePermission, CorePermissionClaimValue.Encode(permission, PermissionScopes.Tenant))),
        ], "test"));

    private static SsoSettingsController Controller(IServiceScope scope, Guid tenantId, ClaimsPrincipal user)
        => new(
            scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>(),
            TestTenantContext.WithTenant(tenantId),
            scope.ServiceProvider.GetRequiredService<SsoPolicy>(),
            scope.ServiceProvider.GetRequiredService<SsoProviderCatalog>(),
            scope.ServiceProvider.GetRequiredService<SsoOidcClient>(),
            scope.ServiceProvider.GetRequiredService<SsoStepUp>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = user } },
        };

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> answer) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => Task.FromResult(answer(request));
    }
}

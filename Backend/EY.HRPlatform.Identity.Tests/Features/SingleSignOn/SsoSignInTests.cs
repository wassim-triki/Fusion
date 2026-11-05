using System.Net;
using System.Net.Http.Json;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.SingleSignOn;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace EY.HRPlatform.Identity.Tests.Features.SingleSignOn;

/// <summary>
/// B-191 sign-in through a provider, end to end through the API and the built-in test provider: the flow's binding
/// and replay rules, which emails are trusted, who vouches for whom, and that nobody is created by signing in.
/// </summary>
[Collection(SsoCollection.Name)]
public sealed class SsoSignInTests(SsoFixture fixture)
{
    private readonly Sso _sso = new(fixture);
    private bool Available => fixture.Available;

    // ── Flow security ────────────────────────────────────

    [SkippableFact]
    public async Task A_first_trusted_sign_in_links_the_account_and_later_sign_ins_use_the_link()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var domain = Sso.UniqueDomain();
        var person = await _sso.AddMemberAsync(tenantId, $"nour@{domain}");

        var (status, data, landing) = await _sso.SignInAsync(SsoProviderKeys.Google, person.Email!,
            Sso.Person(person.Email!, ("sub", "nour-at-google")));

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal($"{SsoFixture.Origin}/auth/sso/complete", landing.ToString());
        Assert.NotNull(Sso.Session(data));
        var refresh = Sso.Session(data, "refreshToken");
        Assert.Equal("sso:google", await _sso.WithDbAsync(db => db.RefreshTokens.Where(item => item.Token == refresh).Select(item => item.Method).SingleAsync()));
        Assert.Equal(1, await _sso.CountAsync(db => db.ExternalLogins.Where(item => item.UserId == person.Id && item.Provider == "google")));
        Assert.Equal(1, await _sso.CountAsync(db => db.AccessAuditEvents.IgnoreQueryFilters().Where(item => item.TenantId == tenantId && item.Action == SsoAuditActions.LinkCreated)));

        // The link wins over email: the provider now says another address for the same person.
        var again = await _sso.SignInAsync(SsoProviderKeys.Google, person.Email!,
            Sso.Person($"renamed@{domain}", ("sub", "nour-at-google")));
        Assert.NotNull(Sso.Session(again.Data));
        Assert.Equal(person.Id.ToString(), Sso.Session(again.Data, "userId"));
    }

    [SkippableFact]
    public async Task The_result_is_collected_once_and_a_second_callback_does_nothing()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var person = await _sso.AddMemberAsync(tenantId, $"once@{Sso.UniqueDomain()}");
        var browser = _sso.Browser();
        var (authorize, _) = await _sso.StartAsync(browser, new { purpose = "signIn", provider = "google", email = person.Email });
        var callback = await _sso.AtProviderAsync(browser, authorize!, Sso.Person(person.Email!));

        var landing = await _sso.CallbackAsync(browser, callback);
        var replay = await _sso.CallbackAsync(browser, callback);
        var first = await _sso.ResultAsync(browser);
        var second = await _sso.ResultAsync(browser);

        Assert.Equal(landing, replay);
        Assert.DoesNotContain("code=", landing.Query);
        Assert.DoesNotContain("token", landing.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(HttpStatusCode.OK, first.Status);
        Assert.NotNull(Sso.Session(first.Data));
        Assert.Equal(HttpStatusCode.NotFound, second.Status);
        Assert.Equal(1, await _sso.CountAsync(db => db.RefreshTokens.Where(item => item.UserId == person.Id)));
    }

    [SkippableFact]
    public async Task A_callback_without_the_starting_browser_or_with_a_wrong_state_hands_out_nothing()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var person = await _sso.AddMemberAsync(tenantId, $"bound@{Sso.UniqueDomain()}");
        var browser = _sso.Browser();
        var (authorize, _) = await _sso.StartAsync(browser, new { purpose = "signIn", provider = "google", email = person.Email });
        var callback = await _sso.AtProviderAsync(browser, authorize!, Sso.Person(person.Email!));

        // Another browser (an attacker's, or one that never started this) gets nothing.
        var stranger = _sso.Browser();
        await _sso.CallbackAsync(stranger, callback);
        Assert.Equal(HttpStatusCode.NotFound, (await _sso.ResultAsync(stranger)).Status);

        // The right browser with a forged state is refused, and the flow is spent.
        var forged = new Uri(callback.ToString().Replace("state=", "state=x"));
        await _sso.CallbackAsync(browser, forged);
        await _sso.CallbackAsync(browser, callback);
        var result = await _sso.ResultAsync(browser);
        Assert.Equal(SsoRefusals.ProviderFailed, Sso.RefusalCode(result.Data));
        Assert.Equal(0, await _sso.CountAsync(db => db.RefreshTokens.Where(item => item.UserId == person.Id)));
    }

    [SkippableFact]
    public async Task A_flow_past_ten_minutes_is_expired()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var person = await _sso.AddMemberAsync(tenantId, $"late@{Sso.UniqueDomain()}");
        var browser = _sso.Browser();
        var (authorize, _) = await _sso.StartAsync(browser, new { purpose = "signIn", provider = "google", email = person.Email });
        var callback = await _sso.AtProviderAsync(browser, authorize!, Sso.Person(person.Email!));
        var state = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(callback.Query)["state"].ToString();
        await _sso.WithDbAsync(db => db.Database.ExecuteSqlRawAsync(
            "UPDATE identity.\"SsoFlows\" SET \"ExpiresAt\" = now() - interval '1 minute' WHERE \"State\" = {0}", state));

        await _sso.CallbackAsync(browser, callback);

        Assert.Equal(SsoRefusals.Expired, Sso.RefusalCode((await _sso.ResultAsync(browser)).Data));
    }

    [SkippableTheory]
    [InlineData("nonce")]
    [InlineData("aud")]
    [InlineData("iss")]
    [InlineData("exp")]
    [InlineData("alg-none")]
    [InlineData("alg-hs256")]
    public async Task A_token_that_does_not_validate_is_refused(string tamper)
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var person = await _sso.AddMemberAsync(tenantId, $"tamper@{Sso.UniqueDomain()}");

        var (_, data, _) = await _sso.SignInAsync("google", person.Email!, Sso.Person(person.Email!, ("tamper", tamper)));

        Assert.Equal(SsoRefusals.ProviderFailed, Sso.RefusalCode(data));
        Assert.Equal(0, await _sso.CountAsync(db => db.ExternalLogins.Where(item => item.UserId == person.Id)));
    }

    [SkippableFact]
    public async Task One_providers_answer_on_another_providers_path_or_naming_another_issuer_is_refused()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var person = await _sso.AddMemberAsync(tenantId, $"mixup@{Sso.UniqueDomain()}");

        foreach (var forge in new Func<Uri, Uri>[]
                 {
                     callback => new Uri(callback.ToString().Replace("/callback/google", "/callback/microsoft")),
                     callback => new Uri(callback.ToString().Replace("iss=", "iss=https%3A%2F%2Fevil.example%2F")),
                 })
        {
            var browser = _sso.Browser();
            var (authorize, _) = await _sso.StartAsync(browser, new { purpose = "signIn", provider = "google", email = person.Email });
            var callback = await _sso.AtProviderAsync(browser, authorize!, Sso.Person(person.Email!));
            await _sso.CallbackAsync(browser, forge(callback));
            Assert.Equal(SsoRefusals.ProviderFailed, Sso.RefusalCode((await _sso.ResultAsync(browser)).Data));
        }
    }

    [Theory]
    [InlineData("https://evil.example/x", "/")]
    [InlineData("//evil.example", "/")]
    [InlineData("/\\evil.example", "/")]
    [InlineData("/core/settings/sign-in", "/core/settings/sign-in")]
    public void Return_addresses_stay_inside_Fusion(string requested, string kept)
        => Assert.Equal(kept, SsoFlowService.SafeReturnTo(requested));

    // ── Which emails are trusted ─────────────────────────

    [SkippableTheory]
    [InlineData("google", "email_verified", null)]
    [InlineData("google", "workspace", null)]
    [InlineData("google", "hd", "other.example")]
    [InlineData("microsoft", "xms_edov", null)]
    [InlineData("microsoft", "tid", SsoOptions.MicrosoftConsumerTenant)]
    public async Task An_address_the_provider_does_not_vouch_for_is_not_trusted(string provider, string field, string? value)
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var person = await _sso.AddMemberAsync(tenantId, $"trust@{Sso.UniqueDomain()}");
        var fields = field == "hd"
            ? Sso.Person(person.Email!, ("workspace", null))
            : Sso.Person(person.Email!, (field, value));

        var (_, data, _) = await _sso.SignInAsync(provider, person.Email!, fields);

        Assert.Equal(SsoRefusals.EmailNotVerified, Sso.RefusalCode(data));
        Assert.Equal(0, await _sso.CountAsync(db => db.ExternalLogins.Where(item => item.UserId == person.Id)));
    }

    [SkippableFact]
    public async Task Microsoft_work_accounts_with_a_verified_address_sign_in()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var person = await _sso.AddMemberAsync(tenantId, $"ms@{Sso.UniqueDomain()}");

        var (_, data, _) = await _sso.SignInAsync("microsoft", person.Email!);

        Assert.Equal(person.Id.ToString(), Sso.Session(data, "userId"));
    }

    // ── Only invited people ──────────────────────────────

    [SkippableFact]
    public async Task An_address_without_an_account_is_refused_and_nothing_is_created()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var users = await _sso.CountAsync(db => db.Users.IgnoreQueryFilters());
        var memberships = await _sso.CountAsync(db => db.TenantMemberships.IgnoreQueryFilters());

        var (_, data, _) = await _sso.SignInAsync("google", $"nobody@{Sso.UniqueDomain()}");

        Assert.Equal(SsoRefusals.NoAccount, Sso.RefusalCode(data));
        Assert.Equal(users, await _sso.CountAsync(db => db.Users.IgnoreQueryFilters()));
        Assert.Equal(memberships, await _sso.CountAsync(db => db.TenantMemberships.IgnoreQueryFilters()));
    }

    [SkippableFact]
    public async Task Another_provider_identity_with_a_linked_address_is_refused()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var person = await _sso.AddMemberAsync(tenantId, $"owner@{Sso.UniqueDomain()}");
        await _sso.SignInAsync("google", person.Email!);

        var (_, data, _) = await _sso.SignInAsync("google", person.Email!, Sso.Person(person.Email!, ("sub", "someone-else")));

        Assert.Equal(SsoRefusals.LinkedToSomeoneElse, Sso.RefusalCode(data));
    }

    [SkippableFact]
    public async Task Fusion_operators_suspended_people_and_switched_off_providers_are_refused()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var domain = Sso.UniqueDomain();
        var operatorAccount = await _sso.AddMemberAsync(tenantId, $"op@{domain}");
        var suspended = await _sso.AddMemberAsync(tenantId, $"paused@{domain}");
        var member = await _sso.AddMemberAsync(tenantId, $"member@{domain}");
        await _sso.WithDbAsync(async db =>
        {
            if (!await db.Roles.AnyAsync(role => role.Name == PlatformRole.PlatformAdmin))
                db.Roles.Add(new IdentityRole<Guid> { Id = Guid.NewGuid(), Name = PlatformRole.PlatformAdmin, NormalizedName = PlatformRole.PlatformAdmin.ToUpperInvariant() });
            await db.SaveChangesAsync();
            var role = await db.Roles.SingleAsync(item => item.Name == PlatformRole.PlatformAdmin);
            db.UserRoles.Add(new IdentityUserRole<Guid> { UserId = operatorAccount.Id, RoleId = role.Id });
            (await db.TenantMemberships.IgnoreQueryFilters().SingleAsync(item => item.UserId == suspended.Id)).Suspend(null);
            (await db.Tenants.SingleAsync(item => item.Id == tenantId)).SetFusionSignIn(true, false);
            await db.SaveChangesAsync();
        });

        Assert.Equal(SsoRefusals.Operator, Sso.RefusalCode((await _sso.SignInAsync("microsoft", operatorAccount.Email!)).Data));
        Assert.Equal(SsoRefusals.AccessPaused, Sso.RefusalCode((await _sso.SignInAsync("microsoft", suspended.Email!)).Data));
        Assert.Equal(SsoRefusals.ProviderOff, Sso.RefusalCode((await _sso.SignInAsync("google", member.Email!)).Data));
        Assert.NotNull(Sso.Session((await _sso.SignInAsync("microsoft", member.Email!)).Data));
    }

    [SkippableFact]
    public async Task An_account_without_a_password_gets_401_from_password_sign_in()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var person = await _sso.AddMemberAsync(tenantId, $"nopass@{Sso.UniqueDomain()}", password: null);

        await _sso.LoginAsync(person.Email!, "Anything@123456", HttpStatusCode.Unauthorized);
    }

    // ── A company's provider ─────────────────────────────

    [SkippableFact]
    public async Task A_companys_provider_signs_in_only_its_own_people_in_its_proved_domains()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var acme = await _sso.AddTenantAsync();
        var other = await _sso.AddTenantAsync();
        var acmeDomain = Sso.UniqueDomain();
        var otherDomain = Sso.UniqueDomain();
        var admin = await _sso.AddMemberAsync(acme, $"admin@{acmeDomain}", administrator: true);
        var acmePerson = await _sso.AddMemberAsync(acme, $"aicha@{acmeDomain}");
        var otherPerson = await _sso.AddMemberAsync(other, $"sami@{otherDomain}");
        // Acme lists the other company's domain too, unproved: it reaches nobody there.
        var connection = await _sso.ConnectAsync(acme, admin.Id, [acmeDomain], [otherDomain]);

        var discover = await _sso.Browser().GetFromJsonAsync<System.Text.Json.JsonElement>($"/api/identity/sso/discover?email=aicha@{acmeDomain}");
        Assert.Equal("company", discover.GetProperty("data").GetProperty("providers")[0].GetProperty("key").GetString());

        var own = await _sso.SignInAsync("company", acmePerson.Email!);
        Assert.Equal(acmePerson.Id.ToString(), Sso.Session(own.Data, "userId"));
        Assert.Equal(connection.Id, await _sso.WithDbAsync(db => db.ExternalLogins.Where(item => item.UserId == acmePerson.Id).Select(item => item.ConnectionId).SingleAsync()));

        // The other company's person can't even start through Acme's provider, and a forced round trip finds nobody.
        var (refusedStart, response) = await _sso.StartAsync(_sso.Browser(), new { purpose = "signIn", provider = "company", email = otherPerson.Email });
        Assert.Null(refusedStart);
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var browser = _sso.Browser();
        var (authorize, _) = await _sso.StartAsync(browser, new { purpose = "signIn", provider = "company", email = acmePerson.Email });
        var callback = await _sso.AtProviderAsync(browser, authorize!, Sso.Person(otherPerson.Email!));
        await _sso.CallbackAsync(browser, callback);
        Assert.Equal(SsoRefusals.NoAccount, Sso.RefusalCode((await _sso.ResultAsync(browser)).Data));
        Assert.Equal(0, await _sso.CountAsync(db => db.ExternalLogins.Where(item => item.UserId == otherPerson.Id)));
    }

    [SkippableFact]
    public async Task Discovery_answers_by_domain_never_by_account()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var domain = Sso.UniqueDomain();
        await _sso.AddMemberAsync(tenantId, $"exists@{domain}");

        var known = await _sso.Browser().GetStringAsync($"/api/identity/sso/discover?email=exists@{domain}");
        var unknown = await _sso.Browser().GetStringAsync($"/api/identity/sso/discover?email=ghost@{domain}");

        Assert.Equal(known, unknown);
    }
}

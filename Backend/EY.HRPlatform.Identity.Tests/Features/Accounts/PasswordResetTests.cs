using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Features.Accounts;
using EY.HRPlatform.Identity.Features.Notifications;
using EY.HRPlatform.Identity.Tests.Features.SingleSignOn;
using EY.HRPlatform.SharedKernel.Notifications;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace EY.HRPlatform.Identity.Tests.Features.Accounts;

/// <summary>
/// B-295 password reset by an emailed one-time link, through the API on a migrated PostgreSQL database: the link
/// works once and ends every session, asking tells nobody who has an account, and where a company requires its
/// provider only its administrators get a link.
/// </summary>
[Collection(SsoCollection.Name)]
public sealed class PasswordResetTests(SsoFixture fixture) : IAsyncLifetime
{
    private const string NewPassword = "Brand-new-42-password";

    private readonly Sso _sso = new(fixture);
    private readonly CapturingSender _mail = new();
    private WebApplicationFactory<Program>? _api;
    private bool Available => fixture.Available;

    public Task InitializeAsync()
    {
        if (Available)
        {
            _api = fixture.Factory!.WithWebHostBuilder(builder =>
            {
                builder.UseSetting("PasswordReset:RateLimitPerMinute", "100000");
                builder.ConfigureTestServices(services => services.AddSingleton<IAccountMailSender>(_mail));
            });
        }

        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        if (_api is not null) await _api.DisposeAsync();
    }

    [SkippableFact]
    public async Task A_link_sets_a_new_password_once_and_ends_every_session()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var email = $"rim.{Guid.NewGuid():N}@atlas.example";
        await _sso.AddMemberAsync(tenantId, email);
        var session = await _sso.LoginAsync(email);

        // Asked in another case: the address matches regardless.
        var token = await RequestLinkAsync(email.ToUpperInvariant(), email);
        Assert.False(await _sso.WithDbAsync(db => db.PasswordResetTokens.AnyAsync(row => row.TokenHash == token)));

        var link = await InspectAsync(token);
        Assert.Equal("ready", link.GetProperty("state").GetString());
        Assert.Equal(email, link.GetProperty("email").GetString());

        var done = await CompleteAsync(token, NewPassword);
        Assert.Equal(HttpStatusCode.OK, done.StatusCode);

        await _sso.LoginAsync(email, SsoFixture.Password, HttpStatusCode.Unauthorized);
        await _sso.LoginAsync(email, NewPassword);
        var refresh = await Api().PostAsJsonAsync("/api/identity/auth/refresh",
            new { refreshToken = session.GetProperty("refreshToken").GetString() });
        Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);

        var again = await CompleteAsync(token, "Another-42-password");
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal("used", await CodeAsync(again));
        Assert.Contains(_mail.To(email), sent => sent.Content.Subject == "Your password was changed");
        Assert.True(await _sso.WithDbAsync(db => db.AccessAuditEvents.IgnoreQueryFilters()
            .AnyAsync(row => row.TenantId == tenantId && row.Action == PasswordReset.PasswordResetAction)));
    }

    [SkippableFact]
    public async Task Unknown_addresses_and_accounts_without_a_password_get_the_same_answer_and_no_mail()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var providerOnly = $"sami.{Guid.NewGuid():N}@atlas.example";
        await _sso.AddMemberAsync(tenantId, providerOnly, password: null);
        var unknown = $"nobody.{Guid.NewGuid():N}@atlas.example";

        foreach (var address in new[] { unknown, providerOnly })
        {
            var response = await Api().PostAsJsonAsync("/api/identity/auth/password-reset", new { email = address });
            Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
            Assert.Empty(_mail.To(address));
        }
    }

    [SkippableFact]
    public async Task Where_the_company_requires_its_provider_only_administrators_get_a_link()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var domain = Sso.UniqueDomain();
        var administrator = await _sso.AddMemberAsync(tenantId, $"amira@{domain}", administrator: true);
        var member = $"omar@{domain}";
        await _sso.AddMemberAsync(tenantId, member);

        // A link sent before the requirement stops working once it is on.
        var earlier = await RequestLinkAsync(member, member);
        await _sso.ConnectAsync(tenantId, administrator.Id, [domain], required: true);

        var refused = await CompleteAsync(earlier, NewPassword);
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("provider_required", await CodeAsync(refused));
        await _sso.WithDbAsync(db => db.PasswordResetTokens.Where(row => row.TokenHash == RefreshToken.HashOf(earlier))
            .ExecuteUpdateAsync(set => set.SetProperty(row => row.CreatedAt, DateTime.UtcNow.AddMinutes(-5))));

        var before = _mail.To(member).Count;
        var asked = await Api().PostAsJsonAsync("/api/identity/auth/password-reset", new { email = member });
        Assert.Equal(HttpStatusCode.Accepted, asked.StatusCode);
        Assert.Equal(before, _mail.To(member).Count);

        var token = await RequestLinkAsync(administrator.Email!, administrator.Email!);
        Assert.Equal(HttpStatusCode.OK, (await CompleteAsync(token, NewPassword)).StatusCode);
        await _sso.LoginAsync(administrator.Email!, NewPassword);
    }

    [SkippableFact]
    public async Task Only_the_newest_link_works_and_an_expired_one_is_refused()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var email = $"leila.{Guid.NewGuid():N}@atlas.example";
        await _sso.AddMemberAsync(tenantId, email);

        var first = await RequestLinkAsync(email, email);

        // Within a minute, asking again sends nothing.
        await Api().PostAsJsonAsync("/api/identity/auth/password-reset", new { email });
        Assert.Single(_mail.To(email));

        await _sso.WithDbAsync(db => db.PasswordResetTokens.Where(row => row.TokenHash == RefreshToken.HashOf(first))
            .ExecuteUpdateAsync(set => set.SetProperty(row => row.CreatedAt, DateTime.UtcNow.AddMinutes(-2))));
        var second = await RequestLinkAsync(email, email);

        Assert.Equal("expired", (await InspectAsync(first)).GetProperty("state").GetString());
        Assert.Equal("ready", (await InspectAsync(second)).GetProperty("state").GetString());

        await _sso.WithDbAsync(db => db.PasswordResetTokens.Where(row => row.TokenHash == RefreshToken.HashOf(second))
            .ExecuteUpdateAsync(set => set.SetProperty(row => row.ExpiresAt, DateTime.UtcNow.AddSeconds(-1))));
        var late = await CompleteAsync(second, NewPassword);
        Assert.Equal(HttpStatusCode.Conflict, late.StatusCode);
        Assert.Equal("expired", await CodeAsync(late));
        Assert.Equal("invalid", (await InspectAsync("not-a-real-token")).GetProperty("state").GetString());
        await _sso.LoginAsync(email);
    }

    [SkippableFact]
    public async Task A_password_the_rules_refuse_leaves_the_link_usable()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var tenantId = await _sso.AddTenantAsync();
        var email = $"hana.{Guid.NewGuid():N}@atlas.example";
        await _sso.AddMemberAsync(tenantId, email);
        var token = await RequestLinkAsync(email, email);

        var weak = await CompleteAsync(token, "short");
        Assert.Equal(HttpStatusCode.BadRequest, weak.StatusCode);
        Assert.Equal("invalid-password", await CodeAsync(weak));

        Assert.Equal("ready", (await InspectAsync(token)).GetProperty("state").GetString());
        Assert.Equal(HttpStatusCode.OK, (await CompleteAsync(token, NewPassword)).StatusCode);
    }

    private HttpClient Api() => _api!.CreateClient();

    /// <summary>Asks for a link and reads the token out of the one new mail to <paramref name="inbox"/>.</summary>
    private async Task<string> RequestLinkAsync(string asked, string inbox)
    {
        var before = _mail.To(inbox).Count;
        var response = await Api().PostAsJsonAsync("/api/identity/auth/password-reset", new { email = asked });
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var sent = _mail.To(inbox);
        Assert.Equal(before + 1, sent.Count);
        var match = Regex.Match(sent[^1].Content.Text, @"/auth/reset-password\?token=([A-Za-z0-9_-]+)&company=");
        Assert.True(match.Success, sent[^1].Content.Text);
        return match.Groups[1].Value;
    }

    private async Task<JsonElement> InspectAsync(string token)
    {
        var response = await Api().PostAsJsonAsync("/api/identity/auth/password-reset/inspect", new { token });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
    }

    private Task<HttpResponseMessage> CompleteAsync(string token, string newPassword)
        => Api().PostAsJsonAsync("/api/identity/auth/password-reset/complete", new { token, newPassword });

    private static async Task<string?> CodeAsync(HttpResponseMessage response)
        => (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("details").GetProperty("code").GetString();

    private sealed class CapturingSender : IAccountMailSender
    {
        private readonly ConcurrentQueue<FusionOutgoingEmail> _sent = new();

        public List<FusionOutgoingEmail> To(string address)
            => _sent.Where(mail => string.Equals(mail.To, address, StringComparison.OrdinalIgnoreCase)).ToList();

        public Task SendAsync(FusionOutgoingEmail email, CancellationToken cancellationToken)
        {
            _sent.Enqueue(email);
            return Task.CompletedTask;
        }
    }
}

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Identity.Controllers;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace EY.HRPlatform.Identity.Tests.Features.Accounts;

/// <summary>
/// A person's language as the browser meets it: what sign-in and refresh report,
/// and what the self-service endpoint lets a caller change. Also how refresh tokens
/// are kept: only their hash is stored (B-294).
///
/// These go through the real endpoints because the rules under test are about the
/// caller: whose account a token can change, and what a later session sees.
/// </summary>
public sealed class AccountLanguageEndpointTests : IAsyncLifetime
{
    private const string Password = "Language@123456";

    private string? _admin;
    private readonly List<string> _databases = [];
    private bool Available => _admin is not null;

    public Task InitializeAsync()
    {
        var configured = Environment.GetEnvironmentVariable("FUSION_TEST_PG")
            ?? Environment.GetEnvironmentVariable("ConnectionStrings__IdentityDb");
        if (!string.IsNullOrWhiteSpace(configured)) _admin = configured;
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        if (!Available) return;
        NpgsqlConnection.ClearAllPools();
        foreach (var database in _databases)
        {
            await using var connection = new NpgsqlConnection(AdminConnectionString());
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = $"DROP DATABASE IF EXISTS \"{database}\" WITH (FORCE);";
            await command.ExecuteNonQueryAsync();
        }
    }

    // ── Resolution at sign-in ────────────────────────────

    [SkippableFact]
    public async Task A_tenant_whose_locale_is_French_gives_French_to_someone_who_never_chose()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var tenantId = await AddTenantAsync(factory, "fr-FR");
        await AddMemberAsync(factory, "rim@atlas.example", tenantId);

        var session = await LoginAsync(factory.CreateClient(), "rim@atlas.example");

        Assert.Equal("fr", session.GetProperty("language").GetString());
    }

    [SkippableFact]
    public async Task The_persons_own_choice_wins_over_the_tenant_language()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var tenantId = await AddTenantAsync(factory, "fr-FR");
        await AddMemberAsync(factory, "khaled@atlas.example", tenantId, preferredLanguage: "en");

        var session = await LoginAsync(factory.CreateClient(), "khaled@atlas.example");

        Assert.Equal("en", session.GetProperty("language").GetString());
    }

    [SkippableFact]
    public async Task An_unsupported_tenant_locale_falls_back_to_English()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var tenantId = await AddTenantAsync(factory, "de-DE");
        await AddMemberAsync(factory, "lena@atlas.example", tenantId);

        var session = await LoginAsync(factory.CreateClient(), "lena@atlas.example");

        Assert.Equal("en", session.GetProperty("language").GetString());
    }

    [SkippableFact]
    public async Task A_Platform_Administrator_without_a_choice_gets_English()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        await AddPlatformAdministratorAsync(factory, "platform@fusion.example");

        var session = await LoginAsync(factory.CreateClient(), "platform@fusion.example");

        Assert.Equal("en", session.GetProperty("language").GetString());
    }

    [SkippableFact]
    public async Task Refresh_reports_the_language_as_sign_in_does()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var tenantId = await AddTenantAsync(factory, "fr-FR");
        await AddMemberAsync(factory, "rim@atlas.example", tenantId);
        var client = factory.CreateClient();
        var session = await LoginAsync(client, "rim@atlas.example");

        var response = await client.PostAsJsonAsync("/api/identity/auth/refresh",
            new { refreshToken = session.GetProperty("refreshToken").GetString() });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var refreshed = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        Assert.Equal("fr", refreshed.GetProperty("language").GetString());
    }

    // ── Refresh tokens are stored as hashes (B-294) ──────

    [SkippableFact]
    public async Task Refresh_works_with_the_raw_token_and_the_store_holds_only_its_hash()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var tenantId = await AddTenantAsync(factory, "en-US");
        var rim = await AddMemberAsync(factory, "rim@atlas.example", tenantId);
        var client = factory.CreateClient();
        var raw = (await LoginAsync(client, "rim@atlas.example")).GetProperty("refreshToken").GetString()!;

        Assert.Equal([RefreshToken.HashOf(raw)], await StoredHashesAsync(factory, rim));

        var response = await client.PostAsJsonAsync("/api/identity/auth/refresh", new { refreshToken = raw });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var rotated = (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").GetProperty("refreshToken").GetString()!;

        var stored = await StoredHashesAsync(factory, rim);
        Assert.Equal(2, stored.Count);
        Assert.Contains(RefreshToken.HashOf(rotated), stored);
        Assert.DoesNotContain(stored, hash => hash == raw || hash == rotated);

        // Rotation is one-time use, as before.
        var replay = await client.PostAsJsonAsync("/api/identity/auth/refresh", new { refreshToken = raw });
        Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);
    }

    [SkippableFact]
    public async Task A_stored_hash_presented_as_a_refresh_token_is_refused()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var tenantId = await AddTenantAsync(factory, "en-US");
        var rim = await AddMemberAsync(factory, "rim@atlas.example", tenantId);
        await LoginAsync(factory.CreateClient(), "rim@atlas.example");
        var hash = (await StoredHashesAsync(factory, rim)).Single();

        var response = await factory.CreateClient()
            .PostAsJsonAsync("/api/identity/auth/refresh", new { refreshToken = hash });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [SkippableFact]
    public async Task Logout_ends_the_refresh_token()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var tenantId = await AddTenantAsync(factory, "en-US");
        await AddMemberAsync(factory, "rim@atlas.example", tenantId);
        var client = factory.CreateClient();
        var session = await LoginAsync(client, "rim@atlas.example");
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", session.GetProperty("accessToken").GetString());

        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync("/api/identity/auth/logout", null)).StatusCode);
        var response = await factory.CreateClient().PostAsJsonAsync("/api/identity/auth/refresh",
            new { refreshToken = session.GetProperty("refreshToken").GetString() });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── Setting it ───────────────────────────────────────

    [SkippableFact]
    public async Task Setting_requires_a_session()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();

        var response = await factory.CreateClient()
            .PutAsJsonAsync("/api/identity/account/language", new { language = "fr" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [SkippableTheory]
    [InlineData("de")]
    [InlineData("FR")]
    [InlineData("")]
    [InlineData(null)]
    public async Task An_unsupported_language_is_refused_and_the_account_is_unchanged(string? language)
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var tenantId = await AddTenantAsync(factory, "en-US");
        var aicha = await AddMemberAsync(factory, "aicha@atlas.example", tenantId);
        var client = await SignedInClientAsync(factory, "aicha@atlas.example");

        var response = await client.PutAsJsonAsync("/api/identity/account/language", new { language });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(AccountController.UnsupportedLanguageCode,
            body.GetProperty("details").GetProperty("code").GetString());
        Assert.Null(await PreferredLanguageAsync(factory, aicha));
    }

    [SkippableFact]
    public async Task A_chosen_language_is_returned_and_survives_a_new_sign_in()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var tenantId = await AddTenantAsync(factory, "en-US");
        await AddMemberAsync(factory, "aicha@atlas.example", tenantId);
        var client = await SignedInClientAsync(factory, "aicha@atlas.example");

        var response = await client.PutAsJsonAsync("/api/identity/account/language", new { language = "fr" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        Assert.Equal("fr", body.GetProperty("language").GetString());

        // A browser that has never seen her: only the account can carry it there.
        var session = await LoginAsync(factory.CreateClient(), "aicha@atlas.example");
        Assert.Equal("fr", session.GetProperty("language").GetString());
    }

    [SkippableFact]
    public async Task A_Platform_Administrator_without_a_tenant_can_choose_a_language()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        await AddPlatformAdministratorAsync(factory, "platform@fusion.example");
        var client = await SignedInClientAsync(factory, "platform@fusion.example");

        var response = await client.PutAsJsonAsync("/api/identity/account/language", new { language = "fr" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var session = await LoginAsync(factory.CreateClient(), "platform@fusion.example");
        Assert.Equal("fr", session.GetProperty("language").GetString());
    }

    [SkippableFact]
    public async Task Setting_changes_only_the_callers_own_account()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var tenantId = await AddTenantAsync(factory, "en-US");
        var amira = await AddMemberAsync(factory, "amira@atlas.example", tenantId);
        var khaled = await AddMemberAsync(factory, "khaled@atlas.example", tenantId);
        var client = await SignedInClientAsync(factory, "amira@atlas.example");

        // A body naming another account changes nothing about that account: the
        // contract has no field for it, so the token alone decides.
        var response = await client.PutAsJsonAsync("/api/identity/account/language",
            new { language = "fr", userId = khaled, accountId = khaled });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("fr", await PreferredLanguageAsync(factory, amira));
        Assert.Null(await PreferredLanguageAsync(factory, khaled));
    }

    [SkippableFact]
    public async Task The_route_accepts_no_account_id()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var tenantId = await AddTenantAsync(factory, "en-US");
        await AddMemberAsync(factory, "amira@atlas.example", tenantId);
        var khaled = await AddMemberAsync(factory, "khaled@atlas.example", tenantId);
        var client = await SignedInClientAsync(factory, "amira@atlas.example");

        var response = await client.PutAsJsonAsync(
            $"/api/identity/account/{khaled}/language", new { language = "fr" });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Null(await PreferredLanguageAsync(factory, khaled));
    }

    // ── Pop-ups and sound (B-154) ────────────────────────

    [SkippableFact]
    public async Task Pop_ups_and_sound_start_on_and_a_choice_survives_a_new_sign_in()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var tenantId = await AddTenantAsync(factory, "en-US");
        await AddMemberAsync(factory, "aicha@atlas.example", tenantId);
        var first = await LoginAsync(factory.CreateClient(), "aicha@atlas.example");
        Assert.True(first.GetProperty("notificationPopups").GetBoolean());
        Assert.True(first.GetProperty("notificationSound").GetBoolean());
        var client = await SignedInClientAsync(factory, "aicha@atlas.example");

        var response = await client.PutAsJsonAsync("/api/identity/account/alerts", new { sound = false });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        Assert.True(body.GetProperty("popups").GetBoolean());
        Assert.False(body.GetProperty("sound").GetBoolean());
        var session = await LoginAsync(factory.CreateClient(), "aicha@atlas.example");
        Assert.True(session.GetProperty("notificationPopups").GetBoolean());
        Assert.False(session.GetProperty("notificationSound").GetBoolean());
    }

    [SkippableFact]
    public async Task Alerts_require_a_session()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();

        var response = await factory.CreateClient()
            .PutAsJsonAsync("/api/identity/account/alerts", new { popups = false });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [SkippableFact]
    public async Task Alerts_without_a_choice_are_refused()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var tenantId = await AddTenantAsync(factory, "en-US");
        await AddMemberAsync(factory, "aicha@atlas.example", tenantId);
        var client = await SignedInClientAsync(factory, "aicha@atlas.example");

        var response = await client.PutAsJsonAsync("/api/identity/account/alerts", new { });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(AccountController.NothingToChangeCode, body.GetProperty("details").GetProperty("code").GetString());
    }

    [SkippableFact]
    public async Task Alerts_change_only_the_callers_own_account()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var tenantId = await AddTenantAsync(factory, "en-US");
        var amira = await AddMemberAsync(factory, "amira@atlas.example", tenantId);
        var khaled = await AddMemberAsync(factory, "khaled@atlas.example", tenantId);
        var client = await SignedInClientAsync(factory, "amira@atlas.example");

        var response = await client.PutAsJsonAsync("/api/identity/account/alerts",
            new { popups = false, userId = khaled, accountId = khaled });
        var byRoute = await client.PutAsJsonAsync($"/api/identity/account/{khaled}/alerts", new { popups = false });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, byRoute.StatusCode);
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>();
        var popups = await db.Users.IgnoreQueryFilters().Where(u => u.Id == amira || u.Id == khaled)
            .ToDictionaryAsync(u => u.Id, u => u.NotificationPopups);
        Assert.False(popups[amira]);
        Assert.True(popups[khaled]);
    }

    // ── Arrangement ──────────────────────────────────────

    private async Task<LanguageApiFactory> NewApiAsync()
    {
        var name = $"fusion_language_api_{Guid.NewGuid():N}";
        await using (var connection = new NpgsqlConnection(AdminConnectionString()))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = $"CREATE DATABASE \"{name}\";";
            await command.ExecuteNonQueryAsync();
        }

        _databases.Add(name);

        var factory = new LanguageApiFactory(
            new NpgsqlConnectionStringBuilder(_admin) { Database = name }.ConnectionString);

        using var scope = factory.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>().Database.MigrateAsync();
        return factory;
    }

    private string AdminConnectionString()
        => new NpgsqlConnectionStringBuilder(_admin) { Database = "postgres" }.ConnectionString;

    private static async Task<Guid> AddTenantAsync(LanguageApiFactory factory, string locale)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>();
        var tenant = Tenant.Create($"Atlas {Guid.NewGuid():N}"[..20]);
        tenant.ApplyInitialSettings(locale, "Africa/Tunis", null);
        tenant.CompleteAdministratorActivation();
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();
        return tenant.Id;
    }

    private static async Task<Guid> AddMemberAsync(
        LanguageApiFactory factory, string email, Guid tenantId, string? preferredLanguage = null)
    {
        using var scope = factory.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var db = scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>();
        var account = NewAccount(email, preferredLanguage);
        Assert.True((await users.CreateAsync(account, Password)).Succeeded);
        db.TenantMemberships.Add(TenantMembership.Create(account.Id, tenantId));
        await db.SaveChangesAsync();
        return account.Id;
    }

    private static async Task AddPlatformAdministratorAsync(LanguageApiFactory factory, string email)
    {
        using var scope = factory.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var db = scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>();
        var account = NewAccount(email, null);
        Assert.True((await users.CreateAsync(account, Password)).Succeeded);
        // The schema may already seed the platform role; add it only where it is missing.
        if (!await db.Roles.AnyAsync(role => role.NormalizedName == PlatformRole.PlatformAdmin.ToUpperInvariant()))
        {
            db.Roles.Add(new IdentityRole<Guid>
            {
                Name = PlatformRole.PlatformAdmin,
                NormalizedName = PlatformRole.PlatformAdmin.ToUpperInvariant(),
            });
            await db.SaveChangesAsync();
        }
        Assert.True((await users.AddToRoleAsync(account, PlatformRole.PlatformAdmin)).Succeeded);
    }

    private static ApplicationUser NewAccount(string email, string? preferredLanguage) => new()
    {
        Id = Guid.NewGuid(),
        UserName = email,
        Email = email,
        FirstName = "Test",
        LastName = "Person",
        IsActive = true,
        EmailConfirmed = true,
        PreferredLanguage = preferredLanguage,
    };

    private static async Task<string?> PreferredLanguageAsync(LanguageApiFactory factory, Guid accountId)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>();
        return await db.Users.IgnoreQueryFilters().AsNoTracking()
            .Where(user => user.Id == accountId)
            .Select(user => user.PreferredLanguage)
            .SingleAsync();
    }

    private static async Task<List<string>> StoredHashesAsync(LanguageApiFactory factory, Guid accountId)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>();
        return await db.RefreshTokens.AsNoTracking()
            .Where(token => token.UserId == accountId)
            .Select(token => token.TokenHash)
            .ToListAsync();
    }

    private static async Task<JsonElement> LoginAsync(HttpClient client, string email)
    {
        var response = await client.PostAsJsonAsync("/api/identity/auth/login", new { email, password = Password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
    }

    private static async Task<HttpClient> SignedInClientAsync(LanguageApiFactory factory, string email)
    {
        var client = factory.CreateClient();
        var session = await LoginAsync(client, email);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", session.GetProperty("accessToken").GetString());
        return client;
    }

    private sealed class LanguageApiFactory(string connectionString) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:IdentityDb", connectionString);
            builder.UseSetting("Jwt:Secret", "integration-test-secret-please-change-please");
            builder.UseSetting("Jwt:Issuer", "fusion-tests");
            builder.UseSetting("Jwt:Audience", "fusion-tests");
            builder.UseSetting("Jwt:ExpirationInMinutes", "30");
            builder.UseSetting("Jwt:RefreshTokenExpirationInDays", "7");
            builder.UseSetting("Application:PublicBaseUrl", "http://localhost:3000");
        }
    }
}

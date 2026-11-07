using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.TenantProvisioning;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Tests.TestHelpers;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace EY.HRPlatform.Identity.Tests.Features.TenantProvisioning;

/// <summary>
/// The public activation contract as the recipient's browser meets it.
///
/// These run against the real endpoint rather than the service, because the
/// behaviour under test is what an anonymous caller can see and change: which
/// states are distinguishable, what is disclosed, and whether the invited address
/// can be altered by editing a request.
/// </summary>
[Collection(CapturedBootstrapMailCollection.Name)]
public sealed class TenantActivationEndpointTests : IAsyncLifetime
{
    private const string InvitedEmail = "admin@atlas.example";
    private const string GoodPassword = "Bootstrap@123456";

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
        foreach (var database in _databases) await DropAsync(database);
    }

    /// <summary>
    /// Provisioning and activation are transactional, and the in-memory provider
    /// does not model transactions at all. Running these against a real database
    /// is what makes the atomicity assertions mean anything.
    /// </summary>
    private async Task<ActivationApiFactory> NewApiAsync()
    {
        var name = $"fusion_activation_api_{Guid.NewGuid():N}";
        await using (var connection = new NpgsqlConnection(AdminConnectionString()))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = $"CREATE DATABASE \"{name}\";";
            await command.ExecuteNonQueryAsync();
        }

        _databases.Add(name);

        var connectionString =
            new NpgsqlConnectionStringBuilder(_admin) { Database = name }.ConnectionString;

        var factory = new ActivationApiFactory(connectionString);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>();
        await db.Database.MigrateAsync();
        return factory;
    }

    private async Task DropAsync(string database)
    {
        NpgsqlConnection.ClearAllPools();
        await using var connection = new NpgsqlConnection(AdminConnectionString());
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"DROP DATABASE IF EXISTS \"{database}\" WITH (FORCE);";
        await command.ExecuteNonQueryAsync();
    }

    private string AdminConnectionString()
        => new NpgsqlConnectionStringBuilder(_admin) { Database = "postgres" }.ConnectionString;

    // ── Entry ────────────────────────────────────────────

    [SkippableFact]
    public async Task A_valid_invitation_opens_account_creation_with_its_context()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var client = factory.CreateClient();
        var credential = await ProvisionAsync(factory);

        var entry = await InspectAsync(client, credential);

        Assert.Equal("account_creation", entry.GetProperty("state").GetString());
        Assert.Equal("Atlas Group", entry.GetProperty("tenantName").GetString());
        Assert.Equal(InvitedEmail, entry.GetProperty("invitedEmail").GetString());
        Assert.NotEqual(JsonValueKind.Null, entry.GetProperty("expiresAt").ValueKind);

        // The form states the rules the service will enforce, from one source.
        var rules = entry.GetProperty("passwordRequirements");
        var policy = EY.HRPlatform.Identity.Features.Accounts.AccountPasswordPolicy.Describe();
        Assert.Equal(policy.MinimumLength, rules.GetProperty("minimumLength").GetInt32());
        Assert.Equal(policy.RequiresDigit, rules.GetProperty("requiresDigit").GetBoolean());
        Assert.Equal(policy.RequiresSymbol, rules.GetProperty("requiresSymbol").GetBoolean());
    }

    [SkippableTheory]
    [InlineData("")]
    [InlineData("garbage")]
    [InlineData("unknown.secret")]
    public async Task An_unusable_credential_discloses_nothing(string credential)
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var client = factory.CreateClient();
        await ProvisionAsync(factory);

        var entry = await InspectAsync(client, credential);

        Assert.Equal("invalid", entry.GetProperty("state").GetString());
        Assert.Equal(JsonValueKind.Null, entry.GetProperty("tenantName").ValueKind);
        Assert.Equal(JsonValueKind.Null, entry.GetProperty("invitedEmail").ValueKind);
        Assert.Equal(JsonValueKind.Null, entry.GetProperty("passwordRequirements").ValueKind);
    }

    [SkippableFact]
    public async Task A_revoked_invitation_is_distinguishable_from_an_invalid_one()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var client = factory.CreateClient();
        var credential = await ProvisionAsync(factory);

        await MutateInvitationAsync(factory, invitation => invitation.Revoke());

        var entry = await InspectAsync(client, credential);
        Assert.Equal("revoked", entry.GetProperty("state").GetString());
        Assert.Equal(JsonValueKind.Null, entry.GetProperty("tenantName").ValueKind);
    }

    [SkippableFact]
    public async Task An_existing_account_is_reported_before_the_form_is_filled_in()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var client = factory.CreateClient();
        var credential = await ProvisionAsync(factory);
        await SeedAccountAsync(factory, InvitedEmail);

        var entry = await InspectAsync(client, credential);

        // The recipient cannot resolve this themselves, so they are told before
        // choosing a password rather than after.
        Assert.Equal("existing_account", entry.GetProperty("state").GetString());
    }

    [SkippableFact]
    public async Task Inspecting_an_invitation_changes_nothing()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var client = factory.CreateClient();
        var credential = await ProvisionAsync(factory);

        await InspectAsync(client, credential);
        await InspectAsync(client, credential);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>();
        var invitation = await db.InviteTokens.IgnoreQueryFilters().SingleAsync();

        Assert.Equal(InvitationState.Pending, invitation.State);
        Assert.Empty(await db.TenantBootstrapAuditEvents.IgnoreQueryFilters()
            .Where(e => e.EventType == TenantBootstrapAuditEventType.ActivationRejected)
            .ToListAsync());
    }

    // ── Submission ───────────────────────────────────────

    [SkippableFact]
    public async Task A_valid_submission_activates_and_returns_a_tenant_scoped_session()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var client = factory.CreateClient();
        var credential = await ProvisionAsync(factory);

        var response = await client.PostAsJsonAsync("/api/identity/tenant-activation", new
        {
            credential,
            firstName = "Ada",
            lastName = "Admin",
            password = GoodPassword,
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var session = (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data");

        // The session carries the membership activation just created, so the
        // recipient reaches the workspace without signing in again.
        Assert.False(string.IsNullOrWhiteSpace(session.GetProperty("accessToken").GetString()));
        Assert.NotEqual(JsonValueKind.Null, session.GetProperty("tenantId").ValueKind);
        Assert.NotEqual(JsonValueKind.Null, session.GetProperty("tenantMembershipId").ValueKind);
        Assert.Equal(InvitedEmail, session.GetProperty("email").GetString());

        // No Platform authority is inferred from having activated a tenant.
        var roles = session.GetProperty("roles").EnumerateArray()
            .Select(role => role.GetString()).ToList();
        Assert.DoesNotContain("PlatformAdmin", roles);
    }

    [SkippableFact]
    public async Task The_invited_address_cannot_be_altered_by_editing_the_request()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var client = factory.CreateClient();
        var credential = await ProvisionAsync(factory);

        // A caller supplying a different address is not honoured: the address is
        // read from the invitation, so there is nothing here to tamper with.
        var response = await client.PostAsJsonAsync("/api/identity/tenant-activation", new
        {
            credential,
            firstName = "Mallory",
            lastName = "Elsewhere",
            password = GoodPassword,
            email = "attacker@elsewhere.example",
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>();
        var account = await db.Users.IgnoreQueryFilters().SingleAsync();
        Assert.Equal(InvitedEmail, account.Email);
    }

    [SkippableFact]
    public async Task A_weak_password_is_returned_against_its_own_field()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var client = factory.CreateClient();
        var credential = await ProvisionAsync(factory);

        var response = await client.PostAsJsonAsync("/api/identity/tenant-activation", new
        {
            credential,
            firstName = "Ada",
            lastName = "Admin",
            password = "weak",
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var refusal = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");

        Assert.Equal("invalid_details", refusal.GetProperty("reason").GetString());
        var fields = refusal.GetProperty("fieldErrors").EnumerateArray().ToList();
        Assert.NotEmpty(fields);
        Assert.All(fields, error => Assert.Equal("password", error.GetProperty("field").GetString()));

        // Correctable, so the invitation is untouched.
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>();
        Assert.Equal(InvitationState.Pending,
            (await db.InviteTokens.IgnoreQueryFilters().SingleAsync()).State);
    }

    [SkippableFact]
    public async Task An_invitation_revoked_during_submission_is_reported_as_revoked()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var client = factory.CreateClient();
        var credential = await ProvisionAsync(factory);

        await MutateInvitationAsync(factory, invitation => invitation.Revoke());

        var response = await client.PostAsJsonAsync("/api/identity/tenant-activation", new
        {
            credential, firstName = "Ada", lastName = "Admin", password = GoodPassword,
        });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var refusal = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        Assert.Equal("revoked", refusal.GetProperty("reason").GetString());

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>();
        Assert.Empty(await db.Users.IgnoreQueryFilters().ToListAsync());
        Assert.Empty(await db.TenantMemberships.IgnoreQueryFilters().ToListAsync());
    }

    [SkippableFact]
    public async Task A_repeated_submission_is_terminal_and_creates_nothing_further()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var client = factory.CreateClient();
        var credential = await ProvisionAsync(factory);

        var body = new { credential, firstName = "Ada", lastName = "Admin", password = GoodPassword };
        Assert.Equal(HttpStatusCode.OK,
            (await client.PostAsJsonAsync("/api/identity/tenant-activation", body)).StatusCode);

        var repeat = await client.PostAsJsonAsync("/api/identity/tenant-activation", body);

        Assert.Equal(HttpStatusCode.Conflict, repeat.StatusCode);
        var refusal = (await repeat.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        Assert.Equal("already_accepted", refusal.GetProperty("reason").GetString());

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>();
        Assert.Single(await db.Users.IgnoreQueryFilters().ToListAsync());
        Assert.Single(await db.TenantMemberships.IgnoreQueryFilters().ToListAsync());
        Assert.Single(await db.TenantAdministratorAssignments.IgnoreQueryFilters().ToListAsync());
    }

    [SkippableFact]
    public async Task An_existing_account_conflict_creates_no_tenant_access()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var client = factory.CreateClient();
        var credential = await ProvisionAsync(factory);
        await SeedAccountAsync(factory, InvitedEmail);

        var response = await client.PostAsJsonAsync("/api/identity/tenant-activation", new
        {
            credential, firstName = "Ada", lastName = "Admin", password = GoodPassword,
        });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var refusal = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        Assert.Equal("existing_account", refusal.GetProperty("reason").GetString());

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>();
        Assert.Empty(await db.TenantMemberships.IgnoreQueryFilters().ToListAsync());
        Assert.Empty(await db.TenantAdministratorAssignments.IgnoreQueryFilters().ToListAsync());
    }

    [SkippableFact]
    public async Task No_refusal_leaks_internal_detail()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var factory = await NewApiAsync();
        var client = factory.CreateClient();
        var credential = await ProvisionAsync(factory);
        await MutateInvitationAsync(factory, invitation => invitation.Revoke());

        var response = await client.PostAsJsonAsync("/api/identity/tenant-activation", new
        {
            credential, firstName = "Ada", lastName = "Admin", password = GoodPassword,
        });

        var body = await response.Content.ReadAsStringAsync();

        // No credential, no identifier, no service or table name.
        Assert.DoesNotContain(credential, body);
        Assert.DoesNotContain("InviteToken", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Npgsql", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("BootstrapActivationService", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Exception", body, StringComparison.OrdinalIgnoreCase);
    }

    // ── plumbing ─────────────────────────────────────────

    private static async Task<JsonElement> InspectAsync(HttpClient client, string credential)
    {
        var response = await client.GetAsync(
            $"/api/identity/tenant-activation?credential={Uri.EscapeDataString(credential)}");

        // Every entry state is a page the recipient can read, never a transport
        // error, so a caller cannot enumerate invitations from status codes alone.
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
    }

    private static async Task<string> ProvisionAsync(ActivationApiFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        var provisioning = scope.ServiceProvider.GetRequiredService<ITenantProvisioningService>();

        var result = await provisioning.ProvisionAsync(new ProvisionTenantRequest
        {
            Name = "Atlas Group",
            Locale = "en-US",
            TimeZone = "Europe/Paris",
            AdministratorEmail = InvitedEmail,
            IdempotencyKey = $"endpoint-{Guid.NewGuid():N}",
        }, Guid.NewGuid());

        Assert.True(result.IsSuccess);

        var captured = CapturedBootstrapInvitationEmailSender.LastFor(InvitedEmail);
        Assert.NotNull(captured);

        // The credential the recipient actually has: taken from the delivered
        // message, never read out of the database.
        var query = new Uri(captured!.ActivationLink).Query;
        return Uri.UnescapeDataString(query["?credential=".Length..].Split('&')[0]);
    }

    private static async Task SeedAccountAsync(ActivationApiFactory factory, string email)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>();
        db.Users.Add(new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = email,
            Email = email,
            NormalizedEmail = email.ToUpperInvariant(),
            NormalizedUserName = email.ToUpperInvariant(),
            FirstName = "Existing",
            LastName = "Account",
            IsActive = true,
            EmailConfirmed = true,
            SecurityStamp = Guid.NewGuid().ToString(),
        });
        await db.SaveChangesAsync();
    }

    private static async Task MutateInvitationAsync(
        ActivationApiFactory factory, Action<InviteToken> mutate)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>();
        var invitation = await db.InviteTokens.IgnoreQueryFilters().SingleAsync();
        mutate(invitation);
        await db.SaveChangesAsync();
    }

    /// <summary>
    /// The API with local capture wired in, so the tests obtain the credential the
    /// way a recipient does — from the delivered message.
    /// </summary>
    private sealed class ActivationApiFactory : WebApplicationFactory<Program>
    {
        private readonly string _connectionString;

        public ActivationApiFactory(string connectionString)
        {
            _connectionString = connectionString;
            CapturedBootstrapInvitationEmailSender.Clear();
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:IdentityDb", _connectionString);
            builder.UseSetting("Jwt:Secret", "integration-test-secret-please-change-please");
            builder.UseSetting("Jwt:Issuer", "fusion-tests");
            builder.UseSetting("Jwt:Audience", "fusion-tests");
            builder.UseSetting("Jwt:ExpirationInMinutes", "30");
            builder.UseSetting("Jwt:RefreshTokenExpirationInDays", "7");
            builder.UseSetting("Application:PublicBaseUrl", "http://localhost:3000");
            builder.UseSetting(
                $"{BootstrapInvitationCaptureOptions.SectionName}:Directory",
                Path.Combine(Path.GetTempPath(), $"fusion-mail-{Guid.NewGuid():N}"));

            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IBootstrapInvitationEmailSender>();
                services.AddScoped<IBootstrapInvitationEmailSender, CapturedBootstrapInvitationEmailSender>();
            });
        }
    }
}

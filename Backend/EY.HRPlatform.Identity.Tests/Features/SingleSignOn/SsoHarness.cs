using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.Identity.Features.SingleSignOn;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace EY.HRPlatform.Identity.Tests.Features.SingleSignOn;

/// <summary>
/// One migrated PostgreSQL database and one Identity API for the single sign-on tests (B-191). The built-in test
/// provider is reached in process, so every flow runs the real code path: discovery, PKCE, token exchange, ID token
/// validation and the callback, exactly as a browser would drive them.
/// </summary>
public sealed class SsoFixture : IAsyncLifetime
{
    public const string Origin = "http://localhost:3000";
    public const string TestSecret = "fusion-test-provider-secret";
    public const string Password = "Member@123456";

    private string? _admin;
    private string? _database;

    public SsoApiFactory? Factory { get; private set; }
    public bool Available => Factory is not null;

    public async Task InitializeAsync()
    {
        _admin = Environment.GetEnvironmentVariable("FUSION_TEST_PG")
            ?? Environment.GetEnvironmentVariable("ConnectionStrings__IdentityDb");
        if (string.IsNullOrWhiteSpace(_admin)) return;

        _database = await CreateDatabaseAsync(_admin, "fusion_sso");
        Factory = new SsoApiFactory(new NpgsqlConnectionStringBuilder(_admin) { Database = _database }.ConnectionString, "Testing");
        using var scope = Factory.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>().Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        if (Factory is not null) await Factory.DisposeAsync();
        if (_admin is not null && _database is not null) await DropDatabaseAsync(_admin, _database);
    }

    public static async Task<string> CreateDatabaseAsync(string admin, string prefix)
    {
        var name = $"{prefix}_{Guid.NewGuid():N}";
        await using var connection = new NpgsqlConnection(new NpgsqlConnectionStringBuilder(admin) { Database = "postgres" }.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"CREATE DATABASE \"{name}\";";
        await command.ExecuteNonQueryAsync();
        return name;
    }

    public static async Task DropDatabaseAsync(string admin, string name)
    {
        NpgsqlConnection.ClearAllPools();
        await using var connection = new NpgsqlConnection(new NpgsqlConnectionStringBuilder(admin) { Database = "postgres" }.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"DROP DATABASE IF EXISTS \"{name}\" WITH (FORCE);";
        await command.ExecuteNonQueryAsync();
    }

    public static string? AdminConnection => Environment.GetEnvironmentVariable("FUSION_TEST_PG")
        ?? Environment.GetEnvironmentVariable("ConnectionStrings__IdentityDb");
}

[CollectionDefinition(Name)]
public sealed class SsoCollection : ICollectionFixture<SsoFixture>
{
    public const string Name = "Single sign-on";
}

public sealed class SsoApiFactory(string connectionString, string environment) : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(environment);
        builder.UseSetting("ConnectionStrings:IdentityDb", connectionString);
        builder.UseSetting("Jwt:Secret", "integration-test-secret-please-change-please");
        builder.UseSetting("Jwt:Issuer", "fusion-tests");
        builder.UseSetting("Jwt:Audience", "fusion-tests");
        builder.UseSetting("Jwt:ExpirationInMinutes", "30");
        builder.UseSetting("Jwt:RefreshTokenExpirationInDays", "7");
        builder.UseSetting("Application:PublicBaseUrl", SsoFixture.Origin);
        builder.UseSetting("ServiceUrls:CoreHRApiBaseUrl", "http://localhost:59999");
        builder.UseSetting("Sso:PublicOrigin", SsoFixture.Origin);
        builder.UseSetting("Sso:TestProvider:ClientSecret", SsoFixture.TestSecret);
        builder.UseSetting("Sso:RateLimitPerMinute", "100000");
        builder.ConfigureTestServices(services =>
            services.AddSingleton<ISsoLoopbackChannel>(new InProcessLoopback(this)));
    }

    /// <summary>The test provider lives in this same app, so its calls go through the in-memory server.</summary>
    private sealed class InProcessLoopback(SsoApiFactory factory) : ISsoLoopbackChannel
    {
        public HttpMessageHandler CreateHandler() => factory.Server.CreateHandler();
    }
}

/// <summary>Arrangement and browser steps shared by the single sign-on tests.</summary>
public sealed class Sso(SsoFixture fixture)
{
    public SsoApiFactory Factory => fixture.Factory!;

    public static string UniqueDomain() => $"c{Guid.NewGuid():N}"[..12] + ".example";

    public AppIdentityDbContext Db(IServiceScope scope) => scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>();

    public async Task<T> WithDbAsync<T>(Func<AppIdentityDbContext, Task<T>> work)
    {
        using var scope = Factory.Services.CreateScope();
        return await work(Db(scope));
    }

    public async Task WithDbAsync(Func<AppIdentityDbContext, Task> work)
    {
        using var scope = Factory.Services.CreateScope();
        await work(Db(scope));
    }

    public HttpClient Browser() => Factory.CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        HandleCookies = true,
        BaseAddress = new Uri("http://localhost"),
    });

    public async Task<Guid> AddTenantAsync(string? name = null)
    {
        using var scope = Factory.Services.CreateScope();
        var db = Db(scope);
        var tenant = Tenant.Create(name ?? $"Co {Guid.NewGuid():N}"[..14]);
        tenant.CompleteAdministratorActivation();
        db.Tenants.Add(tenant);
        db.TenantModuleEntitlements.Add(TenantModuleEntitlement.Create(tenant.Id, TenantModule.CoreHR));
        await db.SaveChangesAsync();
        await scope.ServiceProvider.GetRequiredService<IAccessProfileService>().EnsureTenantAccessProfilesAsync(tenant.Id);
        return tenant.Id;
    }

    public async Task<ApplicationUser> AddMemberAsync(Guid tenantId, string email, string? password = SsoFixture.Password, bool administrator = false)
    {
        using var scope = Factory.Services.CreateScope();
        var db = Db(scope);
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var account = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = email,
            Email = email,
            FirstName = email.Split('@')[0],
            LastName = "Person",
            IsActive = true,
            EmailConfirmed = true,
        };
        var created = password is null ? await users.CreateAsync(account) : await users.CreateAsync(account, password);
        Assert.True(created.Succeeded, string.Join(", ", created.Errors.Select(error => error.Description)));
        var membership = TenantMembership.Create(account.Id, tenantId);
        db.TenantMemberships.Add(membership);
        await db.SaveChangesAsync();
        if (administrator)
        {
            db.TenantAdministratorAssignments.Add(TenantAdministratorAssignment.Grant(membership, TenantAdministratorGrantActor.BootstrapActivation, account.Id));
            await db.SaveChangesAsync();
        }

        return account;
    }

    /// <summary>A tested company connection on the test provider's generic shape, with these domains proved.</summary>
    public async Task<SsoConnection> ConnectAsync(Guid tenantId, Guid actorId, string[] proved, string[]? listed = null, bool required = false)
    {
        using var scope = Factory.Services.CreateScope();
        var db = Db(scope);
        var catalog = scope.ServiceProvider.GetRequiredService<SsoProviderCatalog>();
        var now = DateTime.UtcNow;
        var connection = SsoConnection.Create(tenantId, SsoConnectionKind.OpenIdConnect, "Acme Login",
            $"{SsoFixture.Origin}/api/identity/dev-oidc/company", null, "acme-app", catalog.ProtectSecret(tenantId, SsoFixture.TestSecret), actorId, now);
        connection.RecordTest(true, null, null, actorId, now);
        if (required) connection.Require(actorId, now, 0);
        db.SsoConnections.Add(connection);
        foreach (var domain in proved)
        {
            var row = SsoDomain.Create(tenantId, connection.Id, domain, actorId, now);
            row.Prove(actorId, now);
            db.SsoDomains.Add(row);
        }

        foreach (var domain in listed ?? [])
            db.SsoDomains.Add(SsoDomain.Create(tenantId, connection.Id, domain, actorId, now));
        await db.SaveChangesAsync();
        return connection;
    }

    public async Task<JsonElement> LoginAsync(string email, string password = SsoFixture.Password, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var response = await Factory.CreateClient().PostAsJsonAsync("/api/identity/auth/login", new { email, password });
        Assert.Equal(expected, response.StatusCode);
        return expected == HttpStatusCode.OK ? (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data") : default;
    }

    public HttpClient Bearer(string accessToken, HttpClient? client = null)
    {
        client ??= Browser();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        return client;
    }

    public async Task<HttpClient> SignedInAsync(string email)
        => Bearer((await LoginAsync(email)).GetProperty("accessToken").GetString()!);

    /// <summary>Starts a flow and answers the provider's address, or the refusal response.</summary>
    public async Task<(string? AuthorizeUrl, HttpResponseMessage Response)> StartAsync(HttpClient browser, object request)
    {
        var response = await browser.PostAsJsonAsync("/api/identity/sso/flows", request);
        if (response.StatusCode != HttpStatusCode.OK) return (null, response);
        var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        return (data.GetProperty("authorizeUrl").GetString(), response);
    }

    /// <summary>The person signs in at the test provider; answers the callback address the provider sends them to.</summary>
    public async Task<Uri> AtProviderAsync(HttpClient browser, string authorizeUrl, IDictionary<string, string> person)
    {
        var uri = new Uri(authorizeUrl);
        var form = QueryHelpers.ParseQuery(uri.Query).ToDictionary(pair => pair.Key, pair => pair.Value.ToString());
        foreach (var (key, value) in person) form[key] = value;
        var response = await browser.PostAsync(uri.AbsolutePath, new FormUrlEncodedContent(form));
        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        return response.Headers.Location!;
    }

    /// <summary>Follows the provider's redirect into Fusion's callback; answers where Fusion sends the browser next.</summary>
    public async Task<Uri> CallbackAsync(HttpClient browser, Uri callback)
    {
        var response = await browser.GetAsync(callback.PathAndQuery);
        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        return response.Headers.Location!;
    }

    public async Task<(HttpStatusCode Status, JsonElement Data)> ResultAsync(HttpClient browser)
    {
        var response = await browser.PostAsync("/api/identity/sso/result", null);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return (response.StatusCode, body.TryGetProperty("data", out var data) ? data : body);
    }

    public static Dictionary<string, string> Person(string email, params (string Key, string? Value)[] overrides)
    {
        var person = new Dictionary<string, string>
        {
            ["email"] = email,
            ["given_name"] = email.Split('@')[0],
            ["family_name"] = "Person",
            ["email_verified"] = "true",
            ["workspace"] = "true",
            ["xms_edov"] = "true",
        };
        foreach (var (key, value) in overrides)
        {
            if (value is null) person.Remove(key);
            else person[key] = value;
        }

        return person;
    }

    /// <summary>A whole sign-in round trip in a fresh browser; answers the collected result and the landing address.</summary>
    public async Task<(HttpStatusCode Status, JsonElement Data, Uri Landing)> SignInAsync(
        string provider, string email, Dictionary<string, string>? person = null, HttpClient? browser = null)
    {
        browser ??= Browser();
        var (authorize, response) = await StartAsync(browser, new { purpose = "signIn", provider, email });
        Assert.True(authorize is not null, await response.Content.ReadAsStringAsync());
        var callback = await AtProviderAsync(browser, authorize!, person ?? Person(email));
        var landing = await CallbackAsync(browser, callback);
        var (status, data) = await ResultAsync(browser);
        return (status, data, landing);
    }

    public static string? RefusalCode(JsonElement data)
        => data.TryGetProperty("refusal", out var refusal) && refusal.ValueKind == JsonValueKind.Object
            ? refusal.GetProperty("code").GetString()
            : null;

    public static string? Session(JsonElement data, string property = "accessToken")
        => data.TryGetProperty("session", out var session) && session.ValueKind == JsonValueKind.Object
            ? session.GetProperty(property).GetString()
            : null;

    public static async Task<string?> ProblemCode(HttpResponseMessage response)
    {
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.TryGetProperty("details", out var details) && details.ValueKind == JsonValueKind.Object
               && details.TryGetProperty("code", out var code)
            ? code.GetString()
            : null;
    }

    public Task<int> CountAsync<T>(Func<AppIdentityDbContext, IQueryable<T>> query)
        => WithDbAsync(db => query(db).CountAsync());
}

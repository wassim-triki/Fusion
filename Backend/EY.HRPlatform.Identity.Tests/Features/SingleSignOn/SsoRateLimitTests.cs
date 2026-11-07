using System.Net;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace EY.HRPlatform.Identity.Tests.Features.SingleSignOn;

/// <summary>
/// B-297: single sign-on's limits count per client address, and that address comes only from the hop in front of
/// Identity (the Gateway, on loopback). A caller can't reset its count by sending its own X-Forwarded-For.
/// </summary>
public sealed class SsoRateLimitTests : IAsyncLifetime
{
    private const int Permits = 3;
    private static readonly IPAddress Gateway = IPAddress.Loopback;
    private string? _database;
    private SsoApiFactory? _host;
    private WebApplicationFactory<Program>? _factory;

    public async Task InitializeAsync()
    {
        var admin = SsoFixture.AdminConnection;
        if (string.IsNullOrWhiteSpace(admin)) return;
        _database = await SsoFixture.CreateDatabaseAsync(admin, "fusion_sso_limit");
        var connection = new NpgsqlConnectionStringBuilder(admin) { Database = _database }.ConnectionString;
        _host = new SsoApiFactory(connection, "Testing");
        _factory = _host.WithWebHostBuilder(builder => builder.UseSetting("Sso:RateLimitPerMinute", Permits.ToString()));
        using var scope = _factory.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>().Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        if (_host is not null) await _host.DisposeAsync();
        if (SsoFixture.AdminConnection is { } admin && _database is not null) await SsoFixture.DropDatabaseAsync(admin, _database);
    }

    [SkippableFact]
    public async Task A_caller_reaching_Identity_directly_cannot_reset_its_count_with_a_forged_header()
    {
        Skip.If(_factory is null, "No PostgreSQL connection configured.");
        var caller = IPAddress.Parse("203.0.113.7");

        for (var i = 0; i < Permits; i++)
            Assert.Equal(HttpStatusCode.OK, await DiscoverAsync(caller, $"198.51.100.{i}"));

        Assert.Equal(HttpStatusCode.TooManyRequests, await DiscoverAsync(caller, "198.51.100.200"));
    }

    [SkippableFact]
    public async Task Through_the_Gateway_only_the_address_it_forwarded_counts()
    {
        Skip.If(_factory is null, "No PostgreSQL connection configured.");

        for (var i = 0; i < Permits; i++)
            Assert.Equal(HttpStatusCode.OK, await DiscoverAsync(Gateway, $"10.9.9.{i}, 192.0.2.10"));

        // The same client with a different address claimed in front of the Gateway's is still the same client.
        Assert.Equal(HttpStatusCode.TooManyRequests, await DiscoverAsync(Gateway, "10.9.9.200, 192.0.2.10"));
        // Another client through the same Gateway has its own count.
        Assert.Equal(HttpStatusCode.OK, await DiscoverAsync(Gateway, "192.0.2.11"));
    }

    private async Task<HttpStatusCode> DiscoverAsync(IPAddress connection, string forwardedFor)
    {
        var context = await _factory!.Server.SendAsync(http =>
        {
            http.Request.Method = HttpMethods.Get;
            http.Request.Path = "/api/identity/sso/discover";
            http.Request.QueryString = new QueryString("?email=someone@example.com");
            http.Request.Headers["X-Forwarded-For"] = forwardedFor;
            http.Connection.RemoteIpAddress = connection;
        });
        return (HttpStatusCode)context.Response.StatusCode;
    }
}

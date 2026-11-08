using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace EY.HRPlatform.Identity.Tests.TestHelpers;

public class IdentityApiFactory : WebApplicationFactory<Program>
{
    private readonly string _databaseName = $"IdentityIntegration_{Guid.NewGuid()}";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        
        // Use UseSetting for configuration - these are applied before host builds
        builder.UseSetting("ConnectionStrings:IdentityDb", "Host=localhost;Port=5432;Database=identity_integration_tests;Username=postgres;Password=postgres");
        builder.UseSetting("Jwt:Secret", "integration-test-secret-please-change");
        builder.UseSetting("Database:Provider", "inmemory");
        builder.UseSetting("Database:InMemoryName", _databaseName);
        builder.UseSetting("Application:PublicBaseUrl", "http://localhost:3000");
    }
}

/// <summary>
/// Factory for creating AppIdentityDbContext instances for unit testing.
/// Supports configurable tenant context and interceptor injection.
/// </summary>
public static class TestDbContextFactory
{
    /// <summary>
    /// Creates a DbContext with a specific tenant context (for testing tenant-scoped queries).
    /// </summary>
    public static AppIdentityDbContext Create(
        ITenantContext tenantContext,
        string? databaseName = null)
    {
        var options = new DbContextOptionsBuilder<AppIdentityDbContext>()
            .UseInMemoryDatabase(databaseName ?? Guid.NewGuid().ToString())
            .Options;

        return new AppIdentityDbContext(options, tenantContext);
    }

    /// <summary>
    /// Creates a DbContext without tenant context (design-time mode, filters disabled).
    /// Useful for seeding test data without tenant filter interference.
    /// </summary>
    public static AppIdentityDbContext CreateWithoutTenant(string? databaseName = null,
        params Microsoft.EntityFrameworkCore.Diagnostics.IInterceptor[] interceptors)
    {
        var options = new DbContextOptionsBuilder<AppIdentityDbContext>()
            .UseInMemoryDatabase(databaseName ?? Guid.NewGuid().ToString())
            .AddInterceptors(interceptors)
            .Options;

        return new AppIdentityDbContext(options);
    }

    /// <summary>
    /// Creates a DbContext with the TenantSaveChangesInterceptor attached.
    /// Use this when testing write-time tenant enforcement.
    /// </summary>
    public static AppIdentityDbContext CreateWithInterceptor(
        ITenantContext tenantContext,
        string? databaseName = null)
    {
        var interceptor = new Identity.Infrastructure.Persistence.Interceptors.TenantSaveChangesInterceptor(tenantContext);
        var options = new DbContextOptionsBuilder<AppIdentityDbContext>()
            .UseInMemoryDatabase(databaseName ?? Guid.NewGuid().ToString())
            .AddInterceptors(interceptor)
            .Options;

        return new AppIdentityDbContext(options, tenantContext);
    }
}

/// <summary>
/// Simple ITenantContext implementation for testing.
/// </summary>
public sealed class TestTenantContext : ITenantContext
{
    private readonly Guid? _tenantId;

    public TestTenantContext(Guid? tenantId = null)
    {
        _tenantId = tenantId;
    }

    public Guid TenantId => _tenantId ?? throw new InvalidOperationException("Tenant not resolved.");
    public bool IsResolved => _tenantId.HasValue;
    public Guid? TenantIdOrDefault => _tenantId;

    public static TestTenantContext WithTenant(Guid tenantId) => new(tenantId);
    public static TestTenantContext Unresolved() => new();
}


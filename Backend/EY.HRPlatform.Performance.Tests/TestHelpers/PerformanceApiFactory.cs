using System.Net.Http.Headers;
using EY.HRPlatform.Performance.Infrastructure.Ai;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace EY.HRPlatform.Performance.Tests.TestHelpers;

/// <summary>Hosts the real HTTP/JWT/tenant pipeline without a listening socket or external data.</summary>
/// <param name="environment">The host environment; Development turns on the demo clock (performance-demo-clock).</param>
public sealed class PerformanceApiFactory(string environment = "Testing") : WebApplicationFactory<Program>
{
    public TestStore Store { get; } = TestStore.ForNewTenant();
    public FakeCoreWorkforceClient Core { get; } = new();
    public FakePermissionHoldersClient Holders { get; } = new();
    public FakeNotificationAudienceClient Audience { get; } = new();
    public const string UnsubscribeKey = "test-unsubscribe-key-0123456789abcdef";
    /// <summary>Never the real provider: a GROQ_API_KEY in the environment must not reach tests.</summary>
    public FakePerformanceAiProvider Ai { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(environment);
        builder.UseSetting("Jwt:Secret", PerformanceTestJwt.Secret);
        builder.UseSetting("Jwt:Issuer", PerformanceTestJwt.Issuer);
        builder.UseSetting("Jwt:Audience", PerformanceTestJwt.Audience);
        builder.UseSetting("Database:AutoMigrate", "false");
        builder.UseSetting("ConnectionStrings:PerformanceDb", "Host=localhost;Database=unused_http_test_store");
        builder.UseSetting("Urls", "http://localhost");
        builder.UseSetting("Notifications:UnsubscribeKey", UnsubscribeKey);
        builder.UseSetting("Notifications:ShellBaseUrl", "http://localhost:3000");

        builder.ConfigureServices(services =>
        {
            foreach (var service in services.Where(s => s.ImplementationType == typeof(EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceBackgroundWorker)).ToList())
                services.Remove(service);
            foreach (var service in services.Where(s => s.ImplementationType == typeof(EY.HRPlatform.SharedKernel.Notifications.FeedNudgeListener)).ToList())
                services.Remove(service);
            services.RemoveAll<PerformanceDbContext>();
            services.RemoveAll<DbContextOptions<PerformanceDbContext>>();
            services.RemoveAll<IDbContextOptionsConfiguration<PerformanceDbContext>>();
            services.AddScoped(sp => Store.NewContext(sp.GetRequiredService<ITenantContext>()));
            services.RemoveAll<ICoreWorkforceClient>();
            services.AddSingleton<ICoreWorkforceClient>(Core);
            services.RemoveAll<EY.HRPlatform.Performance.Infrastructure.Identity.IPermissionHoldersClient>();
            services.AddSingleton<EY.HRPlatform.Performance.Infrastructure.Identity.IPermissionHoldersClient>(Holders);
            services.RemoveAll<EY.HRPlatform.Performance.Infrastructure.Identity.INotificationAudienceClient>();
            services.AddSingleton<EY.HRPlatform.Performance.Infrastructure.Identity.INotificationAudienceClient>(Audience);
            services.RemoveAll<IPerformanceAiProvider>();
            services.AddSingleton<IPerformanceAiProvider>(Ai);
        });
    }

    public HttpClient CreateAuthenticatedClient(
        Guid? tenantId = null,
        Guid? employeeId = null,
        IEnumerable<EffectivePermissionGrant>? permissions = null,
        IEnumerable<string>? modules = null,
        Guid? userId = null)
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",
            PerformanceTestJwt.Issue(tenantId ?? Store.TenantId, employeeId, permissions,
                modules ?? [ModuleEntitlements.Performance], userId));
        return client;
    }
}

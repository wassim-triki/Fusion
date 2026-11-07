using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;

namespace EY.HRPlatform.Performance.Tests;

public sealed class EntitlementHttpTests
{
    // One real route from every product controller. Permission grants deliberately permit the
    // controller action; the module boundary must deny it before it reads or mutates resources.
    [Theory]
    [InlineData("/api/performance/context")]
    [InlineData("/api/performance/settings")]
    [InlineData("/api/performance/search?q=a")]
    [InlineData("/api/performance/cycles/11111111-1111-1111-1111-111111111111/population")]
    [InlineData("/api/performance/cycles/11111111-1111-1111-1111-111111111111/strategy")]
    [InlineData("/api/performance/cycles/11111111-1111-1111-1111-111111111111/goals")]
    [InlineData("/api/performance/cycles/11111111-1111-1111-1111-111111111111/plan")]
    [InlineData("/api/performance/cycles/11111111-1111-1111-1111-111111111111/objectives/22222222-2222-2222-2222-222222222222/progress")]
    public async Task Every_controller_denies_a_tenant_without_performance(string path)
    {
        await using var factory = new PerformanceApiFactory();
        using var client = factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), modules: [], permissions:
        [
            new(PerformancePermissions.CycleView, PermissionScopes.Tenant),
            new(PerformancePermissions.CycleManage, PermissionScopes.Tenant),
            new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self),
            new(PerformancePermissions.StrategyPublish, PermissionScopes.Tenant),
        ]);

        using var response = await client.GetAsync(path);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Performance.EntitlementForbidden", body.GetProperty("details").GetProperty("code").GetString());
        Assert.Equal("Forbidden", body.GetProperty("details").GetProperty("kind").GetString());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Platform_context_cannot_enter_even_with_a_module_claim(bool moduleClaim)
    {
        await using var factory = new PerformanceApiFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",
            PerformanceTestJwt.Issue(tenantId: null,
                permissions: [new(PerformancePermissions.CycleView, PermissionScopes.Tenant)],
                modules: moduleClaim ? [ModuleEntitlements.Performance] : []));
        client.DefaultRequestHeaders.Add("X-Tenant-Id", factory.Store.TenantId.ToString());

        using var response = await client.GetAsync("/api/performance/context");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Performance.EntitlementForbidden", body.GetProperty("details").GetProperty("code").GetString());
    }

    [Fact]
    public async Task Entitled_health_and_workspace_context_keep_their_intended_availability()
    {
        await using var factory = new PerformanceApiFactory();
        using var anonymous = factory.CreateClient();
        using var live = await anonymous.GetAsync("/health/live");
        Assert.Equal(HttpStatusCode.OK, live.StatusCode);
        using var entitled = factory.CreateAuthenticatedClient(permissions:
            [new(PerformancePermissions.CycleView, PermissionScopes.Self)]);
        using var context = await entitled.GetAsync("/api/performance/context");
        Assert.Equal(HttpStatusCode.OK, context.StatusCode);
    }
}

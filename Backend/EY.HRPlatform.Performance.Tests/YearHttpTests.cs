using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>Who may move the year on and nudge, through the API, with a cross-tenant negative.</summary>
public sealed class YearHttpTests
{
    private static readonly EffectivePermissionGrant[] Admin =
        [new(PerformancePermissions.CycleView, PermissionScopes.Tenant), new(PerformancePermissions.CycleManage, PermissionScopes.Tenant)];
    private static readonly EffectivePermissionGrant[] Member = [new(PerformancePermissions.CycleView, PermissionScopes.Self)];

    [Fact]
    public async Task Only_a_cycle_administrator_of_the_tenant_moves_the_year_on()
    {
        await using var factory = new PerformanceApiFactory();
        var w = await YearTests.World.ArrangeAsync(factory.Store);
        var cycleId = w.Cycle.Id;

        using var lina = factory.CreateAuthenticatedClient(employeeId: w.Lina, permissions: Member);
        var linaYear = await lina.GetFromJsonAsync<JsonElement>($"/api/performance/cycles/{cycleId}/year");
        Assert.Equal("Team", linaYear.GetProperty("data").GetProperty("scope").GetString());
        Assert.Equal(JsonValueKind.Null, linaYear.GetProperty("data").GetProperty("nextMove").ValueKind);
        Assert.Equal(HttpStatusCode.Forbidden, (await lina.PostAsJsonAsync($"/api/performance/cycles/{cycleId}/move-on",
            new { expectedVersion = w.Cycle.Version, to = "Execution" })).StatusCode);

        using var outsider = factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), employeeId: Guid.NewGuid(), permissions: Admin);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync($"/api/performance/cycles/{cycleId}/year")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.PostAsJsonAsync($"/api/performance/cycles/{cycleId}/move-on",
            new { expectedVersion = w.Cycle.Version, to = "Execution" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.PostAsJsonAsync($"/api/performance/cycles/{cycleId}/nudges",
            new { employeeIds = new[] { w.Nour } })).StatusCode);

        using var admin = factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: Admin);
        var preview = await admin.GetFromJsonAsync<JsonElement>($"/api/performance/cycles/{cycleId}/year");
        var move = preview.GetProperty("data").GetProperty("nextMove");
        Assert.Equal("closePlanning", move.GetProperty("kind").GetString());
        Assert.Equal(2, move.GetProperty("affected").GetInt32());
        Assert.Equal("Planning", preview.GetProperty("data").GetProperty("phase").GetString());

        var moved = await admin.PostAsJsonAsync($"/api/performance/cycles/{cycleId}/move-on",
            new { expectedVersion = preview.GetProperty("data").GetProperty("version").GetUInt32(), to = "Execution" });
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);
        var year = (await moved.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        Assert.Equal("Execution", year.GetProperty("phase").GetString());
        Assert.Equal("Company", year.GetProperty("scope").GetString());

        // A manager nudges their own people; someone else's are skipped, never reached.
        var nudged = await lina.PostAsJsonAsync($"/api/performance/cycles/{cycleId}/nudges", new { employeeIds = new[] { w.Nour, w.Yasmine } });
        Assert.Equal(HttpStatusCode.OK, nudged.StatusCode);
        var result = (await nudged.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        Assert.Equal(1, result.GetProperty("nudged").GetInt32());
        Assert.Equal([w.Yasmine], result.GetProperty("skipped").EnumerateArray().Select(e => e.GetGuid()));
    }
}

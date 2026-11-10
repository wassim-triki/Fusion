using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>The Lina → Nour → Lina loop over HTTP: request, see it as attention, update, see it resolved.</summary>
public sealed class UpdateRequestHttpTests
{
    private static readonly DateOnly Start = new(2026, 1, 1);
    private static readonly EffectivePermissionGrant[] Manager =
        [new(PerformancePermissions.CycleView, PermissionScopes.DirectReports), new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)];
    private static readonly EffectivePermissionGrant[] Employee =
        [new(PerformancePermissions.CycleView, PermissionScopes.Self), new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)];

    [Fact]
    public async Task Lina_asks_Nour_updates_and_Lina_sees_it_resolved()
    {
        using var factory = new PerformanceApiFactory();
        var (cycleId, planId, objectiveId, nour, lina) = await ArrangeAsync(factory);
        var linaClient = factory.CreateAuthenticatedClient(employeeId: lina, permissions: Manager);
        var nourClient = factory.CreateAuthenticatedClient(employeeId: nour, permissions: Employee);
        var requests = $"/api/performance/cycles/{cycleId}/plans/{planId}/update-requests";

        var before = await Data(await linaClient.GetAsync($"/api/performance/cycles/{cycleId}/team/people?filter=All&page=1&pageSize=25"));
        Assert.True(before.GetProperty("items")[0].GetProperty("canRequestUpdate").GetBoolean());
        var created = await Data(await linaClient.PostAsJsonAsync(requests, new { objectiveId, note = "Please add this week's numbers." }));
        Assert.Equal("Open", created.GetProperty("state").GetString());
        Assert.Equal(HttpStatusCode.Forbidden, (await nourClient.PostAsJsonAsync(requests, new { objectiveId })).StatusCode);

        // Nour's next step is the request, opening the goal's record.
        var work = await Data(await nourClient.GetAsync("/api/performance/work"));
        var asked = work.EnumerateArray().Single(item => item.GetProperty("kind").GetString() == "update-request");
        Assert.Equal($"/performance/cycles/{cycleId}/objectives/{objectiveId}?mode=record", asked.GetProperty("href").GetString());

        var progress = await Data(await nourClient.GetAsync($"/api/performance/cycles/{cycleId}/objectives/{objectiveId}/progress"));
        var recorded = await nourClient.PostAsJsonAsync($"/api/performance/cycles/{cycleId}/objectives/{objectiveId}/progress", new
        {
            expectedVersion = progress.GetProperty("version").GetUInt32(), percentage = 40, numericActual = (decimal?)null,
            milestones = (object[]?)null, status = "OnTrack", contextNote = "Closed two more entities.", isCorrection = false, evidence = Array.Empty<object>(),
        });
        Assert.True(recorded.IsSuccessStatusCode, await recorded.Content.ReadAsStringAsync());

        var roster = await Data(await linaClient.GetAsync($"/api/performance/cycles/{cycleId}/team/people?filter=All&page=1&pageSize=25"));
        var row = roster.GetProperty("items").EnumerateArray().Single();
        Assert.Equal("Satisfied", row.GetProperty("updateRequest").GetProperty("state").GetString());
        var workAfter = await Data(await nourClient.GetAsync("/api/performance/work"));
        Assert.DoesNotContain(workAfter.EnumerateArray(), item => item.GetProperty("kind").GetString() == "update-request");
    }

    [Fact]
    public async Task Another_tenants_plan_is_not_found()
    {
        using var factory = new PerformanceApiFactory();
        var (cycleId, planId, objectiveId, _, lina) = await ArrangeAsync(factory);
        var outsider = factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), employeeId: lina, permissions: Manager);
        var response = await outsider.PostAsJsonAsync($"/api/performance/cycles/{cycleId}/plans/{planId}/update-requests", new { objectiveId });
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Recorded_manager_without_direct_report_permission_cannot_read_request_history()
    {
        using var factory = new PerformanceApiFactory();
        var (cycleId, planId, objectiveId, _, lina) = await ArrangeAsync(factory);
        var authorizedManager = factory.CreateAuthenticatedClient(employeeId: lina, permissions: Manager);
        var requests = $"/api/performance/cycles/{cycleId}/plans/{planId}/update-requests";
        Assert.True((await authorizedManager.PostAsJsonAsync(requests, new { objectiveId })).IsSuccessStatusCode);

        // Self-scope grants Performance entry but do not authorize reading a direct report's request history.
        var limitedCaller = factory.CreateAuthenticatedClient(employeeId: lina, permissions: Employee);
        Assert.Equal(HttpStatusCode.Forbidden, (await limitedCaller.GetAsync(requests)).StatusCode);
    }

    private static async Task<JsonElement> Data(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
    }

    private static async Task<(Guid Cycle, Guid Plan, Guid Objective, Guid Nour, Guid Lina)> ArrangeAsync(PerformanceApiFactory factory)
    {
        var tenant = factory.Store.TenantId;
        var nour = Guid.NewGuid();
        var lina = Guid.NewGuid();
        var cycle = PerformanceCycle.CreateDraft(tenant, "FY26", Start, Start.AddYears(1).AddDays(-1), Start.AddDays(30)).Activated();
        var participant = Participant.Create(tenant, cycle.Id, nour, "Nour", "Analyst", null, "Finance", lina, "Lina", false, Start);
        var plan = EmployeePlan.Create(tenant, cycle.Id, participant.Id, nour, "Nour", "Finance", lina, "Lina");
        var objective = Objective.CreateEmployee(tenant, cycle.Id, plan.Id, nour, "Close the books faster", null, null,
            Start, Start.AddMonths(11), ObjectiveMeasurement.ManualPercentage(), 100m, null, null, Start, Start.AddMonths(11));
        plan.Submit(nour, new PlanSubmissionFacts(1, true, 100m, true, false, PlanAlignmentPolicy.Optional));
        plan.Approve(lina);
        await using var db = factory.Store.NewContext();
        db.Cycles.Add(cycle);
        db.Participants.Add(participant);
        db.EmployeePlans.Add(plan);
        db.Objectives.Add(objective);
        await db.SaveChangesAsync();
        return (cycle.Id, plan.Id, objective.Id, nour, lina);
    }
}

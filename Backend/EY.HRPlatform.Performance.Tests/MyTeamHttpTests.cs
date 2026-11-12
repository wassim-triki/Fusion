using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Progress;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// The Team page's year over HTTP (B-434): the team is Core HR's reports, what's due is answered in place by the reviewer
/// only, and nothing crosses tenants. A round's results export is HR's.
/// </summary>
public sealed class MyTeamHttpTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private static readonly PlanSubmissionFacts Ready = new(1, true, 100m, true, false, PlanAlignmentPolicy.Optional);
    private static readonly EffectivePermissionGrant[] Manager =
        [new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self), new(PerformancePermissions.CycleView, PermissionScopes.DirectReports)];
    private static readonly EffectivePermissionGrant[] Employee =
        [new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self), new(PerformancePermissions.CycleView, PermissionScopes.Self)];
    private static readonly EffectivePermissionGrant[] Hr = [new(PerformancePermissions.CycleManage, PermissionScopes.Tenant)];

    /// <summary>Lina manages Nour and Sami in Core HR; Omar manages Rim. Nour's approved goal is off track with a reason.</summary>
    private sealed record World(PerformanceApiFactory Factory, PerformanceCycle Cycle, Guid PlanId, Guid Nour, Guid Sami, Guid Lina, Guid Omar);

    private static async Task<World> ArrangeAsync()
    {
        var factory = new PerformanceApiFactory();
        var tenant = factory.Store.TenantId;
        var lina = factory.Core.Add("Lina Haddad").EmployeeId;
        var omar = factory.Core.Add("Omar Mansour").EmployeeId;
        var nour = factory.Core.Add("Nour Trabelsi", managerId: lina).EmployeeId;
        var sami = factory.Core.Add("Sami Ben Ali", managerId: lina).EmployeeId;
        factory.Core.Add("Rim Jaziri", managerId: omar);
        var start = Today.AddMonths(-2);
        var cycle = PerformanceCycle.CreateDraft(tenant, "FY2027", start, Today.AddMonths(10), Today.AddDays(-10)).Activated();
        var participant = Participant.Create(tenant, cycle.Id, nour, "Nour Trabelsi", null, null, "Learning", lina, "Lina Haddad", false, start);
        await using var db = factory.Store.NewContext();
        db.Cycles.Add(cycle);
        db.Participants.Add(participant);
        var plan = EmployeePlan.Create(tenant, cycle.Id, participant.Id, nour, "Nour Trabelsi", "Learning", lina, "Lina Haddad");
        var goal = Objective.CreateEmployee(tenant, cycle.Id, plan.Id, nour, "Migrate billing", null, null,
            start, cycle.EndDate, ObjectiveMeasurement.ManualPercentage(), 100m, null, null, start, cycle.EndDate);
        db.EmployeePlans.Add(plan);
        db.Objectives.Add(goal);
        plan.Submit(nour, Ready);
        plan.Approve(lina);
        goal.ApplyManualPercentage(25m);
        goal.ReportStatus(ObjectiveStatus.OffTrack, DateTime.UtcNow.AddDays(-3));
        db.ProgressUpdates.Add(ProgressUpdate.RecordPercentage(tenant, cycle.Id, goal.Id, nour, 25m, ObjectiveStatus.OffTrack,
            "Vendor API delayed to May", false, false));
        await db.SaveChangesAsync();
        return new World(factory, cycle, plan.Id, nour, sami, lina, omar);
    }

    private static async Task<JsonElement> Data(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
    }

    [Fact]
    public async Task The_manager_sees_their_core_hr_team_and_asks_for_an_update_in_place()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        using var lina = w.Factory.CreateAuthenticatedClient(employeeId: w.Lina, permissions: Manager);
        using var nour = w.Factory.CreateAuthenticatedClient(employeeId: w.Nour, permissions: Employee);

        var year = await Data(await lina.GetAsync($"/api/performance/cycles/{w.Cycle.Id}/team/year"));
        var people = year.GetProperty("people").EnumerateArray().ToList();
        Assert.Equal(new[] { w.Nour, w.Sami }.Order(), people.Select(p => p.GetProperty("employeeId").GetGuid()).Order());
        var due = people.Single(p => p.GetProperty("employeeId").GetGuid() == w.Nour).GetProperty("due");
        Assert.Equal("goals-off-track", due.GetProperty("kind").GetString());
        Assert.Equal("Vendor API delayed to May", due.GetProperty("quote").GetString());

        var ask = due.GetProperty("actions").EnumerateArray().Single(a => a.GetProperty("primary").GetBoolean()).GetProperty("path").GetString();
        await Data(await lina.PostAsJsonAsync($"/api/performance{ask}", new { }));
        var work = await Data(await nour.GetAsync("/api/performance/work"));
        Assert.Contains(work.EnumerateArray(), item => item.GetProperty("kind").GetString() == "update-request");
        var after = await Data(await lina.GetAsync("/api/performance/work"));
        Assert.DoesNotContain(after.EnumerateArray(), item => item.GetProperty("kind").GetString() == "goals-off-track");
    }

    [Fact]
    public async Task Only_the_reviewer_answers_and_an_employee_has_no_team()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        using var omar = w.Factory.CreateAuthenticatedClient(employeeId: w.Omar, permissions: Manager);
        using var nour = w.Factory.CreateAuthenticatedClient(employeeId: w.Nour, permissions: Employee);
        var ask = $"/api/performance/cycles/{w.Cycle.Id}/plans/{w.PlanId}/attention/ask-for-update";

        Assert.Equal(HttpStatusCode.Forbidden, (await omar.PostAsJsonAsync(ask, new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await nour.PostAsJsonAsync(ask, new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await nour.GetAsync($"/api/performance/cycles/{w.Cycle.Id}/team/year")).StatusCode);
        // Omar's team is Rim, who has no plan here: never Lina's people.
        var year = await Data(await omar.GetAsync($"/api/performance/cycles/{w.Cycle.Id}/team/year"));
        Assert.DoesNotContain(year.GetProperty("people").EnumerateArray(), p => p.GetProperty("employeeId").GetGuid() == w.Nour);
    }

    [Fact]
    public async Task Another_tenant_reaches_nothing()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        using var other = w.Factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), employeeId: w.Lina, permissions: Manager);
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/api/performance/cycles/{w.Cycle.Id}/team/year")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await other.PostAsJsonAsync($"/api/performance/cycles/{w.Cycle.Id}/plans/{w.PlanId}/attention/ask-for-update", new { })).StatusCode);
    }

    [Fact]
    public async Task Exporting_a_rounds_results_is_hrs()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        using var lina = w.Factory.CreateAuthenticatedClient(employeeId: w.Lina, permissions: Manager);
        using var hr = w.Factory.CreateAuthenticatedClient(employeeId: w.Omar, permissions: Hr);
        var path = $"/api/performance/review-rounds/{Guid.NewGuid()}/results.csv";
        Assert.Equal(HttpStatusCode.Forbidden, (await lina.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await hr.GetAsync(path)).StatusCode);
    }
}

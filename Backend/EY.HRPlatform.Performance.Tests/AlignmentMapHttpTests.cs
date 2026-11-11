using System.Net;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Progress;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// The alignment map (D-06): published direction for every entrant, status and progress per node,
/// personal objectives as counts by status, and personal nodes only through plan visibility.
/// </summary>
public sealed class AlignmentMapHttpTests
{
    private static readonly DateOnly Start = new(2026, 1, 1);
    private static readonly DateOnly End = new(2026, 12, 31);
    private static readonly PlanSubmissionFacts Ready = new(1, true, 100m, true, false, PlanAlignmentPolicy.AtLeastOneConnected);

    private sealed record World(
        PerformanceApiFactory Factory,
        Guid CycleId,
        Guid StrategyId,
        Guid TalentId,
        Guid DeepId,
        Guid DraftId,
        Guid DisconnectedId,
        Guid SamiObjectiveId,
        Guid LinaObjectiveId,
        Guid OmarObjectiveId,
        Guid DinaObjectiveId,
        Guid NourId,
        Guid SamiId) : IAsyncDisposable
    {
        public string Url => $"/api/performance/cycles/{CycleId}/goals/map";

        public HttpClient Employee(Guid employeeId) => Factory.CreateAuthenticatedClient(employeeId: employeeId, permissions:
            [new(PerformancePermissions.CycleView, PermissionScopes.Self), new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)]);

        public HttpClient Manager() => Factory.CreateAuthenticatedClient(employeeId: NourId, permissions:
            [new(PerformancePermissions.CycleView, PermissionScopes.DirectReports), new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)]);

        public HttpClient Admin() => Factory.CreateAuthenticatedClient(permissions:
            [new(PerformancePermissions.CycleManage, PermissionScopes.Tenant), new(PerformancePermissions.CycleView, PermissionScopes.Tenant)]);

        public ValueTask DisposeAsync() => Factory.DisposeAsync();
    }

    private static async Task<World> ArrangeAsync()
    {
        var factory = new PerformanceApiFactory();
        var tenant = factory.Store.TenantId;
        var workforce = factory.Core;
        var talentPod = Guid.NewGuid();
        var coo = workforce.Add("Coralie Ops");
        var nour = workforce.Add("Nour Lead", orgUnitId: talentPod, orgUnitName: "Talent Pod");
        var sami = workforce.Add("Sami Member", orgUnitId: talentPod, orgUnitName: "Talent Pod");
        var lina = workforce.Add("Lina Member", orgUnitId: talentPod, orgUnitName: "Talent Pod");
        var omar = workforce.Add("Omar Member", orgUnitId: talentPod, orgUnitName: "Talent Pod");
        var dina = workforce.Add("Dina Member", orgUnitId: talentPod, orgUnitName: "Talent Pod");
        var hana = workforce.Add("Hana Strategist");
        workforce.OrgUnits[talentPod] = new WorkforceOrgUnitContext(talentPod, "Talent Pod", null, true, []);
        var at = new DateTime(2026, 3, 1, 9, 0, 0, DateTimeKind.Utc);

        var cycle = PerformanceCycle.CreateDraft(tenant, "FY2026", Start, End, Start.AddDays(30)).Activated();
        var strategy = Objective.CreateStrategic(tenant, cycle.Id, "Grow the company", null, coo.EmployeeId,
            Start, End, ObjectiveMeasurement.ManualPercentage(), Start, End);
        strategy.Publish();
        var talent = Org(tenant, cycle.Id, talentPod, "Talent Pod", "Grow talent", nour.EmployeeId, strategy.Id);
        talent.Publish();
        talent.ApplyManualPercentage(40m);
        talent.ReportStatus(ObjectiveStatus.AtRisk, at);
        var deep = Org(tenant, cycle.Id, Guid.NewGuid(), "Mentoring Guild", "Pair every new joiner", nour.EmployeeId, talent.Id);
        deep.Publish();
        var draft = Org(tenant, cycle.Id, Guid.NewGuid(), "Delivery Pod", "Unannounced plan", coo.EmployeeId, strategy.Id);
        var disconnected = Org(tenant, cycle.Id, Guid.NewGuid(), "Lone Pod", "Standalone direction", coo.EmployeeId, null);
        disconnected.Publish();

        Objective Personal(EmployeePlan plan, Guid owner, string title)
            => Objective.CreateEmployee(tenant, cycle.Id, plan.Id, owner, title, null, talent.Id, Start, End,
                ObjectiveMeasurement.ManualPercentage(), 100m, Start, End, Start, End);
        EmployeePlan Plan(Guid owner, string name)
            => EmployeePlan.Create(tenant, cycle.Id, Guid.NewGuid(), owner, name, "Talent Pod", nour.EmployeeId, "Nour Lead");

        var samiPlan = Plan(sami.EmployeeId, "Sami Member");
        var samiObjective = Personal(samiPlan, sami.EmployeeId, "Run two workshops");
        samiPlan.Submit(sami.EmployeeId, Ready);
        samiPlan.Approve(nour.EmployeeId);
        samiObjective.ApplyManualPercentage(30m);
        samiObjective.ReportStatus(ObjectiveStatus.AtRisk, at);

        var linaPlan = Plan(lina.EmployeeId, "Lina Member");
        var linaObjective = Personal(linaPlan, lina.EmployeeId, "Coach three juniors");
        linaPlan.Submit(lina.EmployeeId, Ready);
        linaPlan.Approve(nour.EmployeeId);
        linaObjective.ReportStatus(ObjectiveStatus.OnTrack, at);

        var omarPlan = Plan(omar.EmployeeId, "Omar Member");
        var omarObjective = Personal(omarPlan, omar.EmployeeId, "Write the guide");
        omarPlan.Submit(omar.EmployeeId, Ready);

        var dinaPlan = Plan(dina.EmployeeId, "Dina Member");
        var dinaObjective = Personal(dinaPlan, dina.EmployeeId, "Still drafting");

        // Straight under the company goal, in a plan Sami and Nour may not read.
        var hanaPlan = EmployeePlan.Create(tenant, cycle.Id, Guid.NewGuid(), hana.EmployeeId, "Hana Strategist", null, coo.EmployeeId, "Coralie Ops");
        var hanaObjective = Objective.CreateEmployee(tenant, cycle.Id, hanaPlan.Id, hana.EmployeeId, "Map the market", null, strategy.Id, Start, End,
            ObjectiveMeasurement.ManualPercentage(), 100m, Start, End, Start, End);
        hanaPlan.Submit(hana.EmployeeId, Ready);
        hanaPlan.Approve(coo.EmployeeId);
        hanaObjective.ApplyManualPercentage(80m);

        // Talent's year: 20% on 1 March, 40% on 1 April; Hana's 80% on 15 March.
        ProgressUpdate Update(Objective objective, Guid author, decimal value, DateTime when)
        {
            using var _ = EY.HRPlatform.Performance.Domain.Common.PerformanceClock.Travel(when);
            return ProgressUpdate.RecordPercentage(tenant, cycle.Id, objective.Id, author, value, ObjectiveStatus.OnTrack, null, false, false);
        }
        var updates = new[]
        {
            Update(talent, nour.EmployeeId, 20m, at),
            Update(hanaObjective, hana.EmployeeId, 80m, at.AddDays(14)),
            Update(talent, nour.EmployeeId, 40m, at.AddDays(31)),
        };

        await using (var db = factory.Store.NewContext())
        {
            db.Cycles.Add(cycle);
            db.Objectives.AddRange(strategy, talent, deep, draft, disconnected, samiObjective, linaObjective, omarObjective, dinaObjective, hanaObjective);
            db.EmployeePlans.AddRange(samiPlan, linaPlan, omarPlan, dinaPlan, hanaPlan);
            db.ProgressUpdates.AddRange(updates);
            await db.SaveChangesAsync();
        }

        return new World(factory, cycle.Id, strategy.Id, talent.Id, deep.Id, draft.Id, disconnected.Id,
            samiObjective.Id, linaObjective.Id, omarObjective.Id, dinaObjective.Id, nour.EmployeeId, sami.EmployeeId);
    }

    private static Objective Org(Guid tenant, Guid cycleId, Guid unit, string unitName, string title, Guid owner, Guid? parent)
        => Objective.CreateOrganizational(tenant, cycleId, unit, unitName, title, null, owner, parent, Start, End,
            ObjectiveProgressSource.Direct, ObjectiveMeasurement.ManualPercentage(),
            parent is null ? null : Start, parent is null ? null : End, Start, End);

    [Fact]
    public async Task Employee_sees_published_direction_as_a_tree_with_status_progress_and_counts()
    {
        await using var w = await ArrangeAsync();
        using var sami = w.Employee(w.SamiId);

        var (raw, nodes) = await MapAsync(sami, w.Url);

        Assert.Equal("Company", nodes[w.StrategyId].GetProperty("kind").GetString());
        Assert.Equal(JsonValueKind.Null, nodes[w.StrategyId].GetProperty("parentId").ValueKind);
        Assert.Equal(w.StrategyId, nodes[w.TalentId].GetProperty("parentId").GetGuid());
        Assert.Equal(w.TalentId, nodes[w.DeepId].GetProperty("parentId").GetGuid());
        Assert.False(nodes.ContainsKey(w.DraftId));
        Assert.False(nodes.ContainsKey(w.DisconnectedId));

        var talent = nodes[w.TalentId];
        Assert.Equal("AtRisk", talent.GetProperty("status").GetString());
        Assert.True(talent.GetProperty("hasProgress").GetBoolean());
        Assert.Equal(40m, talent.GetProperty("progress").GetDecimal());
        Assert.Equal([20m, 40m], Line(talent));
        var strategy = nodes[w.StrategyId];
        Assert.Equal(JsonValueKind.Null, strategy.GetProperty("status").ValueKind);

        // Sami, Lina (Approved) and Omar (Submitted) count; Dina's Draft plan does not.
        var personal = talent.GetProperty("personal");
        Assert.Equal(3, personal.GetProperty("total").GetInt32());
        Assert.Equal(1, personal.GetProperty("onTrack").GetInt32());
        Assert.Equal(1, personal.GetProperty("atRisk").GetInt32());
        Assert.Equal(0, personal.GetProperty("offTrack").GetInt32());
        Assert.Equal(1, personal.GetProperty("noStatus").GetInt32());
        Assert.Equal(1, personal.GetProperty("readable").GetInt32());

        // Only Sami's own objective is a node, and nothing about the others leaves the server.
        var own = nodes[w.SamiObjectiveId];
        Assert.Equal("Personal", own.GetProperty("kind").GetString());
        Assert.True(own.GetProperty("isOwn").GetBoolean());
        foreach (var hidden in new object[] { w.LinaObjectiveId, w.OmarObjectiveId, w.DinaObjectiveId, "Coach three juniors", "Write the guide", "Still drafting", "Lina", "Omar", "Dina", "Map the market", "Hana" })
            Assert.DoesNotContain(hidden.ToString()!, raw, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task A_company_goal_reads_as_the_mean_of_the_goals_straight_under_it()
    {
        await using var w = await ArrangeAsync();
        using var sami = w.Employee(w.SamiId);

        var (_, nodes) = await MapAsync(sami, w.Url);

        // Talent's 40% and Hana's 80%, though Sami can't read Hana's goal; the line moves at each of their updates.
        var strategy = nodes[w.StrategyId];
        Assert.True(strategy.GetProperty("hasProgress").GetBoolean());
        Assert.Equal(60m, strategy.GetProperty("progress").GetDecimal());
        Assert.Equal([10m, 50m, 60m], Line(strategy));
    }

    [Fact]
    public async Task Manager_sees_their_reports_put_forward_objectives()
    {
        await using var w = await ArrangeAsync();
        using var nour = w.Manager();

        var (raw, nodes) = await MapAsync(nour, w.Url);

        Assert.True(nodes.ContainsKey(w.SamiObjectiveId));
        Assert.True(nodes.ContainsKey(w.LinaObjectiveId));
        Assert.True(nodes.ContainsKey(w.OmarObjectiveId));
        Assert.False(nodes.ContainsKey(w.DinaObjectiveId));
        Assert.Equal(3, nodes[w.TalentId].GetProperty("personal").GetProperty("readable").GetInt32());
        Assert.Equal("Sami Member", nodes[w.SamiObjectiveId].GetProperty("ownerName").GetString());
        Assert.DoesNotContain("Still drafting", raw);
    }

    [Fact]
    public async Task Administrator_sees_every_counted_personal_objective()
    {
        await using var w = await ArrangeAsync();
        using var admin = w.Admin();

        var (_, nodes) = await MapAsync(admin, w.Url);

        Assert.Equal(4, nodes.Values.Count(node => node.GetProperty("kind").GetString() == "Personal"));
        Assert.False(nodes.ContainsKey(w.DinaObjectiveId));
        // Administrators read Drafts in List; the map still shows published direction only.
        Assert.False(nodes.ContainsKey(w.DraftId));
    }

    [Fact]
    public async Task Another_tenants_cycle_is_not_found()
    {
        await using var w = await ArrangeAsync();
        using var outsider = w.Factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), permissions:
            [new(PerformancePermissions.CycleManage, PermissionScopes.Tenant), new(PerformancePermissions.CycleView, PermissionScopes.Tenant)]);

        using var response = await outsider.GetAsync(w.Url);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Without_performance_access_the_map_is_forbidden()
    {
        await using var w = await ArrangeAsync();
        using var stranger = w.Factory.CreateAuthenticatedClient(permissions: []);

        using var response = await stranger.GetAsync(w.Url);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    private static decimal[] Line(JsonElement node)
        => node.GetProperty("line").EnumerateArray().Select(point => point.GetProperty("progress").GetDecimal()).ToArray();

    private static async Task<(string Raw, Dictionary<Guid, JsonElement> Nodes)> MapAsync(HttpClient client, string url)
    {
        using var response = await client.GetAsync(url);
        var raw = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {raw}");
        using var json = JsonDocument.Parse(raw);
        var nodes = json.RootElement.GetProperty("data").GetProperty("nodes").EnumerateArray()
            .ToDictionary(node => node.GetProperty("id").GetGuid(), node => node.Clone());
        return (raw, nodes);
    }
}

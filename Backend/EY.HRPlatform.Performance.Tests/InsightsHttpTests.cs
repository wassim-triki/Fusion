using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Progress;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Settings;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// Insights › Performance (D-88–D-90): a year against the one before on the same days, replayed from check-ins; by
/// department and by manager; how the year ended once results are out; the people behind each figure. Year
/// administrators only; another tenant finds no year.
/// </summary>
public sealed class InsightsHttpTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private static readonly PlanSubmissionFacts Ready = new(1, true, 100m, true, false, PlanAlignmentPolicy.Optional);
    private static readonly EffectivePermissionGrant[] Admin =
        [new(PerformancePermissions.CycleView, PermissionScopes.Tenant), new(PerformancePermissions.CycleManage, PermissionScopes.Tenant)];
    private static readonly EffectivePermissionGrant[] Manager =
        [new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self), new(PerformancePermissions.CycleView, PermissionScopes.DirectReports)];

    private sealed record World(PerformanceApiFactory Factory, PerformanceCycle Cycle, Guid Engineering, Guid EngineeringB,
        Guid Nour, Guid Sami, Guid Rim, Guid Lina, Objective NourObjective, Objective SamiObjective, EmployeePlan SamiPlan);

    /// <summary>
    /// Carthage holds Engineering (Engineering A with Nour, Engineering B with Sami) and Finance (Rim); Lina manages all
    /// three. This year (two months in): Nour's goal supports the company goal and was reported on track five days ago;
    /// Sami's has no update; Rim has no plan. Last year Nour's goal was at risk by the same day.
    /// </summary>
    private static async Task<World> ArrangeAsync()
    {
        var factory = new PerformanceApiFactory();
        var tenant = factory.Store.TenantId;
        var (root, eng, engA, engB, fin) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        factory.Core.OrgUnits[root] = new WorkforceOrgUnitContext(root, "Carthage", null, true, []);
        factory.Core.OrgUnits[eng] = new WorkforceOrgUnitContext(eng, "Engineering", root, true, [root]);
        factory.Core.OrgUnits[engA] = new WorkforceOrgUnitContext(engA, "Engineering A", eng, true, [root, eng]);
        factory.Core.OrgUnits[engB] = new WorkforceOrgUnitContext(engB, "Engineering B", eng, true, [root, eng]);
        factory.Core.OrgUnits[fin] = new WorkforceOrgUnitContext(fin, "Finance", root, true, [root]);

        var (nour, sami, rim, lina) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        var start = Today.AddMonths(-2);
        var cycle = PerformanceCycle.CreateDraft(tenant, "FY2027", start, Today.AddMonths(10), Today.AddDays(-10)).Activated();
        var lastStart = start.AddYears(-1);
        var lastCycle = PerformanceCycle.CreateDraft(tenant, "FY2026", lastStart, start.AddDays(-1), lastStart.AddDays(30)).Activated();

        await using var db = factory.Store.NewContext();
        Participant P(PerformanceCycle c, Guid id, string name, Guid unit, string unitName)
            => Participant.Create(tenant, c.Id, id, name, null, unit, unitName, lina, "Lina", false, c.StartDate);
        Objective Goal(PerformanceCycle c, EmployeePlan plan, Guid owner, string title, Guid? parent)
            => Objective.CreateEmployee(tenant, c.Id, plan.Id, owner, title, null, parent, c.StartDate, c.EndDate,
                ObjectiveMeasurement.ManualPercentage(), 100m, parent is null ? null : c.StartDate, parent is null ? null : c.EndDate, c.StartDate, c.EndDate);
        EmployeePlan Approved(PerformanceCycle c, Participant p, Guid owner, string name, string unitName, DateTime at)
        {
            using var _ = PerformanceClock.Travel(at);
            var plan = EmployeePlan.Create(tenant, c.Id, p.Id, owner, name, unitName, lina, "Lina");
            plan.Submit(owner, Ready);
            plan.Approve(lina);
            return plan;
        }
        var startAt = start.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var lastStartAt = lastStart.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);

        // This year.
        var nourP = P(cycle, nour, "Nour", engA, "Engineering A");
        var samiP = P(cycle, sami, "Sami", engB, "Engineering B");
        var rimP = P(cycle, rim, "Rim", fin, "Finance");
        var company = Objective.CreateStrategic(tenant, cycle.Id, "Grow retention", null, lina, start, cycle.EndDate,
            ObjectiveMeasurement.ManualPercentage(), start, cycle.EndDate);
        company.Publish();
        var nourPlan = Approved(cycle, nourP, nour, "Nour", "Engineering A", startAt.AddDays(1));
        var samiPlan = Approved(cycle, samiP, sami, "Sami", "Engineering B", startAt.AddDays(1));
        var nourObjective = Goal(cycle, nourPlan, nour, "Migrate billing", company.Id);
        var samiObjective = Goal(cycle, samiPlan, sami, "Coach the team", null);
        var reported = DateTime.UtcNow.AddDays(-5);
        nourObjective.ReportStatus(ObjectiveStatus.OnTrack, reported);
        ProgressUpdate nourCheckIn;
        using (PerformanceClock.Travel(reported))
            nourCheckIn = ProgressUpdate.RecordStatusOnly(tenant, cycle.Id, nourObjective.Id, nour, ObjectiveStatus.OnTrack, null);

        // Last year: Nour's goal at risk from its tenth day.
        var lastNourP = P(lastCycle, nour, "Nour", engA, "Engineering A");
        var lastNourPlan = Approved(lastCycle, lastNourP, nour, "Nour", "Engineering A", lastStartAt.AddDays(1));
        var lastNourObjective = Goal(lastCycle, lastNourPlan, nour, "Ship the portal", null);
        lastNourObjective.ReportStatus(ObjectiveStatus.AtRisk, lastStartAt.AddDays(10));
        ProgressUpdate lastCheckIn;
        using (PerformanceClock.Travel(lastStartAt.AddDays(10)))
            lastCheckIn = ProgressUpdate.RecordStatusOnly(tenant, lastCycle.Id, lastNourObjective.Id, nour, ObjectiveStatus.AtRisk, "Waiting on legal");

        db.Cycles.AddRange(cycle, lastCycle);
        db.Participants.AddRange(nourP, samiP, rimP, lastNourP);
        db.Objectives.AddRange(company, nourObjective, samiObjective, lastNourObjective);
        db.EmployeePlans.AddRange(nourPlan, samiPlan, lastNourPlan);
        db.ProgressUpdates.AddRange(nourCheckIn, lastCheckIn);
        await db.SaveChangesAsync();
        return new World(factory, cycle, eng, engB, nour, sami, rim, lina, nourObjective, samiObjective, samiPlan);
    }

    /// <summary>Results out: Nour's goal met and rated Strong, Sami's carried into next year's draft and rated Effective.</summary>
    private static async Task EndAsync(World w)
    {
        var tenant = w.Factory.Store.TenantId;
        w.Factory.Core.ById[w.Nour] = new WorkforceSnapshot(w.Nour, "CDG-001", "Nour", "Nour", null, null, true, null, null, Today.AddYears(-3));
        w.Factory.Core.ById[w.Sami] = new WorkforceSnapshot(w.Sami, "CDG-002", "Sami", "Sami", null, null, true, null, null, Today.AddMonths(-6));
        await using var db = w.Factory.Store.NewContext();
        var nourObjective = db.Objectives.Single(o => o.Id == w.NourObjective.Id);
        nourObjective.ApplyManualPercentage(100m);
        var next = PerformanceCycle.CreateDraft(tenant, "FY2028", w.Cycle.EndDate.AddDays(1), w.Cycle.EndDate.AddYears(1), w.Cycle.EndDate.AddDays(30));
        var nextPlan = EmployeePlan.Create(tenant, next.Id, Guid.NewGuid(), w.Sami, "Sami", "Engineering B", w.Lina, "Lina");
        var carried = w.SamiObjective.CarryInto(next.Id, nextPlan.Id, next.StartDate, next.EndDate);

        var round = ReviewRound.CreateDraft(tenant, w.Cycle, "Year-end", w.Cycle.StartDate, w.Cycle.EndDate, false, false, true);
        round.UpdateDraft(w.Cycle, "Year-end", w.Cycle.StartDate, w.Cycle.EndDate, false, false, true, null, Today.AddDays(5), "[]");
        var scale = RatingScale.CreateDefault(tenant);
        var version = scale.CreateNextVersion(RatingScaleDefaults.Levels);
        var reviews = new List<PerformanceReview>();
        var subjects = new List<ReviewRoundSubject>();
        foreach (var (employee, rating) in new[] { (w.Nour, 4), (w.Sami, 3) })
        {
            var participant = db.Participants.Single(p => p.CycleId == w.Cycle.Id && p.EmployeeId == employee);
            var subject = ReviewRoundSubject.Create(tenant, round.Id, participant, w.Lina, "Lina");
            var review = PerformanceReview.Open(tenant, round, subject, version.Id, version.LevelsJson, DateTime.UtcNow);
            subjects.Add(subject);
            reviews.Add(review);
            review.SubmitManagerAssessment(w.Lina, "Summary", rating, DateTime.UtcNow);
            review.CompleteCalibration(rating, calibrated: false);
            review.Finalize("{}", rating, FinalRatingSources.Manager, DateTime.UtcNow);
        }
        round.Launch("{}", version.Id, DateTime.UtcNow);
        db.Cycles.Add(next); db.EmployeePlans.Add(nextPlan); db.Objectives.Add(carried);
        db.RatingScales.Add(scale); db.RatingScaleVersions.Add(version); db.ReviewRounds.Add(round);
        db.ReviewRoundSubjects.AddRange(subjects); db.PerformanceReviews.AddRange(reviews);
        await db.SaveChangesAsync();
    }

    private static async Task<JsonElement> InsightsAsync(World w, string query = "")
    {
        using var client = w.Factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: Admin);
        using var response = await client.GetAsync($"/api/performance/insights{query}");
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
    }

    private static async Task<string[]> PeopleAsync(World w, string query)
    {
        using var client = w.Factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: Admin);
        using var response = await client.GetAsync($"/api/performance/insights/people?cycleId={w.Cycle.Id}&{query}");
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("items").EnumerateArray()
            .Select(i => i.GetProperty("name").GetString()!).ToArray();
    }

    private static JsonElement Trend(JsonElement insights, string key)
        => insights.GetProperty("trends").EnumerateArray().Single(t => t.GetProperty("key").GetString() == key);

    [Fact]
    public async Task During_the_year_each_figure_reads_against_last_year_on_the_same_day()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;

        var insights = await InsightsAsync(w);
        Assert.Equal(w.Cycle.Id.ToString(), insights.GetProperty("cycleId").GetString());
        Assert.False(insights.GetProperty("ended").GetBoolean());
        Assert.Equal("FY2026", insights.GetProperty("lastYear").GetProperty("name").GetString());
        Assert.Equal(JsonValueKind.Null, insights.GetProperty("end").ValueKind);

        var onTrack = Trend(insights, "on-track");
        Assert.Equal(50m, onTrack.GetProperty("now").GetDecimal());
        Assert.Equal(2, onTrack.GetProperty("of").GetInt32());
        Assert.Equal(0m, onTrack.GetProperty("lastNow").GetDecimal());
        Assert.Equal(1m, Trend(insights, "not-updated").GetProperty("now").GetDecimal());
        Assert.Equal(50m, Trend(insights, "supporting").GetProperty("now").GetDecimal());
        // Last year, by this day, Nour's one goal was at risk.
        Assert.Equal(1m, Trend(insights, "at-risk").GetProperty("lastNow").GetDecimal());

        var department = Assert.Single(insights.GetProperty("onTrackByDepartment").EnumerateArray());
        Assert.Equal("Engineering", department.GetProperty("name").GetString());
        Assert.Equal(50m, department.GetProperty("share").GetDecimal());
        Assert.Equal(0m, department.GetProperty("lastShare").GetDecimal());

        var manager = Assert.Single(insights.GetProperty("notUpdatedByManager").EnumerateArray());
        Assert.Equal("Lina", manager.GetProperty("name").GetString());
        Assert.Equal(["Sami"], manager.GetProperty("notUpdated").EnumerateArray().Select(p => p.GetProperty("name").GetString()));
        Assert.DoesNotContain("average", insights.GetRawText(), StringComparison.OrdinalIgnoreCase);

        Assert.Equal(["Sami"], await PeopleAsync(w, "metric=not-updated"));
        Assert.Equal(["Nour"], await PeopleAsync(w, $"metric=on-track&departmentId={w.Engineering}"));
        Assert.Equal(["Nour", "Rim", "Sami"], await PeopleAsync(w, "metric=people"));
    }

    [Fact]
    public async Task A_unit_filter_counts_the_unit_and_everything_below_it()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;

        var engineering = await InsightsAsync(w, $"?unitId={w.Engineering}");
        Assert.Equal(2, engineering.GetProperty("participants").GetInt32());
        Assert.Equal("Engineering", engineering.GetProperty("scopeName").GetString());
        var teamB = await InsightsAsync(w, $"?unitId={w.EngineeringB}");
        Assert.Equal(0m, Trend(teamB, "on-track").GetProperty("now").GetDecimal());
        Assert.Equal(["Sami"], await PeopleAsync(w, $"metric=people&unitId={w.EngineeringB}"));
    }

    [Fact]
    public async Task Once_results_are_out_the_year_reads_how_it_ended()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        await EndAsync(w);

        var insights = await InsightsAsync(w, $"?cycleId={w.Cycle.Id}");
        Assert.True(insights.GetProperty("ended").GetBoolean());
        Assert.Equal("FY2028", insights.GetProperty("nextYear").GetProperty("name").GetString());
        Assert.False(insights.GetProperty("nextYearLaunched").GetBoolean());
        var end = insights.GetProperty("end");
        Assert.Equal("Strong", end.GetProperty("strongLabel").GetString());
        var ratings = end.GetProperty("ratings").EnumerateArray().ToDictionary(r => r.GetProperty("value").GetInt32(), r => r.GetProperty("count").GetInt32());
        Assert.Equal(1, ratings[4]);
        Assert.Equal(1, ratings[3]);
        var goals = end.GetProperty("goals");
        Assert.Equal(1, goals.GetProperty("met").GetInt32());
        Assert.Equal(1, goals.GetProperty("carried").GetInt32());
        Assert.Equal(0, goals.GetProperty("notMet").GetInt32());
        Assert.Equal(1, end.GetProperty("carriedCount").GetInt32());
        Assert.Equal("Coach the team", end.GetProperty("carried")[0].GetProperty("title").GetString());
        var tenure = end.GetProperty("byTenure").EnumerateArray().ToDictionary(t => t.GetProperty("key").GetString()!, t => t.GetProperty("share").GetDecimal());
        Assert.Equal(100m, tenure["2-4"]);
        Assert.Equal(0m, tenure["1-2"]); // Sami, six months in today, past a year by the year's end
        Assert.Equal(100m, end.GetProperty("reviews").GetProperty("this").EnumerateArray().Last().GetProperty("share").GetDecimal());

        Assert.Equal(["Nour"], await PeopleAsync(w, "metric=strong&bucket=2-4"));
        Assert.Equal(["Sami"], await PeopleAsync(w, "metric=carried"));
        Assert.Equal(["Sami"], await PeopleAsync(w, "metric=level&level=3"));
        Assert.Equal(["Nour"], await PeopleAsync(w, "metric=met"));
    }

    [Fact]
    public async Task Only_year_administrators_read_insights_and_another_tenant_finds_no_year()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;

        using var manager = w.Factory.CreateAuthenticatedClient(employeeId: w.Lina, permissions: Manager);
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.GetAsync("/api/performance/insights")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.GetAsync("/api/performance/insights/people?metric=people")).StatusCode);

        using var other = w.Factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), employeeId: Guid.NewGuid(), permissions: Admin);
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/api/performance/insights?cycleId={w.Cycle.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync("/api/performance/insights")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/api/performance/insights/people?cycleId={w.Cycle.Id}&metric=people")).StatusCode);

        using var admin = w.Factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: Admin);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("/api/performance/insights/people?metric=salary")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("/api/performance/insights/people?metric=strong&bucket=forever")).StatusCode);
    }
}

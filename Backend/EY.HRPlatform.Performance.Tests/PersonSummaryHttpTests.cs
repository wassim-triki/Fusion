using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Settings;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>performance-person-summary: one viewer-shaped answer, sections only for allowed relations, no leaks.</summary>
public sealed class PersonSummaryHttpTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private static readonly PlanSubmissionFacts Ready = new(2, true, 100m, true, true, PlanAlignmentPolicy.Optional);

    private static readonly EffectivePermissionGrant[] Employee = [new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)];
    private static readonly EffectivePermissionGrant[] Manager =
        [new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self), new(PerformancePermissions.CycleView, PermissionScopes.DirectReports)];
    private static readonly EffectivePermissionGrant[] Admin =
        [new(PerformancePermissions.CycleView, PermissionScopes.Tenant), new(PerformancePermissions.CycleManage, PermissionScopes.Tenant)];

    private sealed record World(PerformanceApiFactory Factory, PerformanceCycle Cycle, PerformanceCycle Closed,
        Guid Nour, Guid Lina, Guid Reviewer, Guid Colleague, Guid ReviewId, Guid HistoryReviewId);

    /// <summary>
    /// Nour reports to Lina in Core HR; an admin-assigned reviewer holds Nour's plan this cycle. Nour's plan is
    /// approved with an aligned and a standalone objective; her mid-year review sits in calibration. Last year's
    /// closed cycle carries a finalized review rated "Strong".
    /// </summary>
    private static async Task<World> ArrangeAsync()
    {
        var factory = new PerformanceApiFactory();
        var tenant = factory.Store.TenantId;
        var lina = factory.Core.Add("Lina");
        var nour = factory.Core.Add("Nour", managerId: lina.EmployeeId, orgUnitId: Guid.NewGuid(), orgUnitName: "Learning");
        var colleague = factory.Core.Add("Sami", managerId: lina.EmployeeId);
        var reviewer = Guid.NewGuid();
        var start = Today.AddMonths(-3);

        var closed = PerformanceCycle.CreateDraft(tenant, "FY2026", start.AddYears(-1), start.AddDays(-1), start.AddYears(-1).AddDays(30)).Activated();
        var cycle = PerformanceCycle.CreateDraft(tenant, "FY2027", start, Today.AddMonths(9), start.AddDays(20)).Activated();
        var lastYear = Participant.Create(tenant, closed.Id, nour.EmployeeId, "Nour", null, null, "Learning", reviewer, "Reviewer", false, closed.StartDate);
        var participant = Participant.Create(tenant, cycle.Id, nour.EmployeeId, "Nour", null, null, "Learning", reviewer, "Reviewer", false, start);
        var company = Objective.CreateStrategic(tenant, cycle.Id, "Grow retention", null, lina.EmployeeId, start, cycle.EndDate,
            ObjectiveMeasurement.ManualPercentage(), start, cycle.EndDate);
        company.Publish();
        var plan = EmployeePlan.Create(tenant, cycle.Id, participant.Id, nour.EmployeeId, "Nour", "Learning", reviewer, "Reviewer");
        var aligned = Objective.CreateEmployee(tenant, cycle.Id, plan.Id, nour.EmployeeId, "Ship the playbook", null, company.Id,
            start, cycle.EndDate, ObjectiveMeasurement.ManualPercentage(), 60m, start, cycle.EndDate, start, cycle.EndDate);
        var standalone = Objective.CreateEmployee(tenant, cycle.Id, plan.Id, nour.EmployeeId, "Learn Spanish", null, null,
            start, cycle.EndDate, ObjectiveMeasurement.ManualPercentage(), 40m, null, null, start, cycle.EndDate);
        plan.Submit(nour.EmployeeId, Ready);
        plan.Approve(reviewer);
        aligned.ApplyManualPercentage(50m);
        var asked = UpdateRequest.Create(plan, standalone, reviewer, "Reviewer", null, DateTime.UtcNow.AddDays(-3));

        var scale = RatingScale.CreateDefault(tenant);
        var version = scale.CreateNextVersion(RatingScaleDefaults.Levels);
        var pastRound = ReviewRound.CreateDraft(tenant, closed, "Year-end", closed.StartDate, closed.EndDate, false, false, false);
        var pastSubject = ReviewRoundSubject.Create(tenant, pastRound.Id, lastYear, reviewer, "Reviewer");
        var past = PerformanceReview.Open(tenant, pastRound, pastSubject, version.Id, version.LevelsJson, DateTime.UtcNow.AddMonths(-4));
        pastRound.Launch("{\"competencies\":[]}", version.Id, DateTime.UtcNow.AddMonths(-4));
        past.SubmitManagerAssessment(reviewer, "Strong year", 4, DateTime.UtcNow.AddMonths(-4));
        past.Finalize("{\"ratingScale\":[{\"value\":4,\"label\":\"Strong\"}]}", 4, "Manager", DateTime.UtcNow.AddMonths(-4));

        var round = ReviewRound.CreateDraft(tenant, cycle, "Mid-year", start, cycle.EndDate, false, false, true);
        var subject = ReviewRoundSubject.Create(tenant, round.Id, participant, reviewer, "Reviewer");
        var review = PerformanceReview.Open(tenant, round, subject, version.Id, version.LevelsJson, DateTime.UtcNow);
        round.Launch("{\"competencies\":[]}", version.Id, DateTime.UtcNow);
        review.SubmitManagerAssessment(reviewer, "On track", 3, DateTime.UtcNow);

        await using (var db = factory.Store.NewContext())
        {
            db.Cycles.AddRange(closed, cycle);
            db.Participants.AddRange(lastYear, participant);
            db.Objectives.AddRange(company, aligned, standalone);
            db.EmployeePlans.Add(plan);
            db.UpdateRequests.Add(asked);
            db.RatingScales.Add(scale); db.RatingScaleVersions.Add(version);
            db.ReviewRounds.AddRange(pastRound, round);
            db.ReviewRoundSubjects.AddRange(pastSubject, subject);
            db.PerformanceReviews.AddRange(past, review);
            await db.SaveChangesAsync();
        }
        await using (var db = factory.Store.NewContext())
        {
            var tracked = db.Cycles.Single(c => c.Id == closed.Id);
            tracked.Close();
            await db.SaveChangesAsync();
        }
        return new(factory, cycle, closed, nour.EmployeeId, lina.EmployeeId, reviewer, colleague.EmployeeId, review.Id, past.Id);
    }

    private static async Task<JsonElement> SummaryAsync(HttpClient client, Guid employeeId, Guid? cycleId = null)
    {
        var response = await client.GetAsync($"/api/performance/people/{employeeId}/summary{(cycleId is null ? "" : $"?cycleId={cycleId}")}");
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
    }

    [Theory]
    [InlineData("self", "Self")]
    [InlineData("manager", "Manager")]
    [InlineData("reviewer", "Reviewer")]
    [InlineData("admin", "Administrator")]
    public async Task Each_allowed_relation_sees_both_sections(string who, string relation)
    {
        var world = await ArrangeAsync();
        await using var _ = world.Factory;
        var client = who switch
        {
            "self" => world.Factory.CreateAuthenticatedClient(employeeId: world.Nour, permissions: Employee),
            "manager" => world.Factory.CreateAuthenticatedClient(employeeId: world.Lina, permissions: Manager),
            "reviewer" => world.Factory.CreateAuthenticatedClient(employeeId: world.Reviewer, permissions: Manager),
            _ => world.Factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: Admin),
        };
        var summary = await SummaryAsync(client, world.Nour);
        Assert.Equal(relation, summary.GetProperty("relation").GetString());
        Assert.Equal("Nour", summary.GetProperty("displayName").GetString());
        Assert.Equal("KEY-Nour", summary.GetProperty("stableEmployeeKey").GetString());

        var current = summary.GetProperty("currentCycle");
        Assert.Equal("FY2027", current.GetProperty("cycleName").GetString());
        Assert.True(current.GetProperty("isParticipant").GetBoolean());
        Assert.Equal("Approved", current.GetProperty("planStatus").GetString());
        Assert.Equal(30m, current.GetProperty("overallProgress").GetDecimal());
        var objectives = current.GetProperty("objectives").EnumerateArray().ToArray();
        Assert.Equal(2, objectives.Length);
        Assert.Equal(1, objectives[0].GetProperty("number").GetInt32());
        Assert.Equal("Grow retention", objectives[0].GetProperty("alignedTo").GetString());
        Assert.Equal(60m, objectives[0].GetProperty("weight").GetDecimal());
        Assert.Equal(50m, objectives[0].GetProperty("progress").GetDecimal());
        Assert.Equal(JsonValueKind.Null, objectives[1].GetProperty("alignedTo").ValueKind);
        // An update asked for and not yet given, for the person page's Coming up.
        Assert.Equal(JsonValueKind.Null, objectives[0].GetProperty("openRequest").ValueKind);
        Assert.Equal("Reviewer", objectives[1].GetProperty("openRequest").GetProperty("requestedByName").GetString());

        var reviews = summary.GetProperty("reviews");
        Assert.Equal("Calibration", reviews.GetProperty("current").GetProperty("state").GetString());
        var result = Assert.Single(reviews.GetProperty("history").EnumerateArray());
        Assert.Equal("Strong", result.GetProperty("finalRatingLabel").GetString());
        Assert.Equal("FY2026", result.GetProperty("cycleName").GetString());
    }

    [Fact]
    public async Task The_subject_in_calibration_sees_the_step_and_no_rating()
    {
        var world = await ArrangeAsync();
        await using var _ = world.Factory;
        var summary = await SummaryAsync(world.Factory.CreateAuthenticatedClient(employeeId: world.Nour, permissions: Employee), world.Nour);
        var reviews = summary.GetProperty("reviews");
        var current = reviews.GetProperty("current");
        Assert.Equal("Calibration", current.GetProperty("state").GetString());
        Assert.True(current.GetProperty("calibrationEnabled").GetBoolean());
        Assert.False(current.GetProperty("selfAssessmentEnabled").GetBoolean());
        Assert.False(current.TryGetProperty("finalRatingLabel", out var rating), rating.ToString());
        Assert.DoesNotContain(reviews.GetProperty("history").EnumerateArray(),
            item => item.GetProperty("reviewId").GetString() == world.ReviewId.ToString());
    }

    [Fact]
    public async Task A_colleague_gets_identity_and_no_sections()
    {
        var world = await ArrangeAsync();
        await using var _ = world.Factory;
        var summary = await SummaryAsync(world.Factory.CreateAuthenticatedClient(employeeId: world.Colleague, permissions: Employee), world.Nour);
        Assert.Equal("Other", summary.GetProperty("relation").GetString());
        Assert.Equal("Nour", summary.GetProperty("displayName").GetString());
        Assert.Equal(JsonValueKind.Null, summary.GetProperty("currentCycle").ValueKind);
        Assert.Equal(JsonValueKind.Null, summary.GetProperty("reviews").ValueKind);
    }

    [Fact]
    public async Task A_manager_without_the_reports_view_grant_is_just_another_colleague()
    {
        var world = await ArrangeAsync();
        await using var _ = world.Factory;
        var summary = await SummaryAsync(world.Factory.CreateAuthenticatedClient(employeeId: world.Lina, permissions: Employee), world.Nour);
        Assert.Equal("Other", summary.GetProperty("relation").GetString());
        Assert.Equal(JsonValueKind.Null, summary.GetProperty("currentCycle").ValueKind);
    }

    [Fact]
    public async Task An_unknown_and_a_foreign_employee_get_the_same_empty_answer()
    {
        var world = await ArrangeAsync();
        await using var _ = world.Factory;
        var admin = world.Factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: Admin);
        var unknownId = Guid.NewGuid();
        var unknown = await SummaryAsync(admin, unknownId);
        // An employee of another tenant isn't resolvable in this tenant's Core HR snapshot.
        var foreignId = Guid.NewGuid();
        var foreign = await SummaryAsync(admin, foreignId);
        Assert.Equal(unknown.GetRawText().Replace(unknownId.ToString(), "id"), foreign.GetRawText().Replace(foreignId.ToString(), "id"));
        Assert.Equal(JsonValueKind.Null, unknown.GetProperty("displayName").ValueKind);
        Assert.Equal(JsonValueKind.Null, unknown.GetProperty("currentCycle").ValueKind);

        var otherTenant = world.Factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), employeeId: Guid.NewGuid(), permissions: Admin);
        // The fake Core client resolves people for any tenant (the real snapshot is tenant-scoped), so this checks
        // only that nothing from tenant A's Performance data reaches tenant B.
        var crossTenant = await SummaryAsync(otherTenant, world.Nour);
        Assert.Equal(JsonValueKind.Null, crossTenant.GetProperty("currentCycle").ValueKind);
        var reviews = crossTenant.GetProperty("reviews");
        if (reviews.ValueKind != JsonValueKind.Null)
        {
            Assert.Equal(JsonValueKind.Null, reviews.GetProperty("current").ValueKind);
            Assert.Empty(reviews.GetProperty("history").EnumerateArray());
        }
    }

    [Fact]
    public async Task An_explicit_closed_cycle_describes_that_cycle()
    {
        var world = await ArrangeAsync();
        await using var _ = world.Factory;
        var summary = await SummaryAsync(world.Factory.CreateAuthenticatedClient(employeeId: world.Nour, permissions: Employee),
            world.Nour, world.Closed.Id);
        var current = summary.GetProperty("currentCycle");
        Assert.Equal("FY2026", current.GetProperty("cycleName").GetString());
        Assert.Equal("Closed", current.GetProperty("cycleState").GetString());
        Assert.True(current.GetProperty("isParticipant").GetBoolean());
        Assert.Equal("NotStarted", current.GetProperty("planStatus").GetString());
        Assert.Equal(JsonValueKind.Null, current.GetProperty("overallProgress").ValueKind);
    }

    [Fact]
    public async Task Someone_outside_the_cycle_reads_as_not_a_participant()
    {
        var world = await ArrangeAsync();
        await using var _ = world.Factory;
        var summary = await SummaryAsync(world.Factory.CreateAuthenticatedClient(employeeId: world.Colleague, permissions: Employee), world.Colleague);
        var current = summary.GetProperty("currentCycle");
        Assert.False(current.GetProperty("isParticipant").GetBoolean());
        Assert.Empty(current.GetProperty("objectives").EnumerateArray());
    }

    [Fact]
    public async Task The_summary_requires_the_entitlement_and_Performance_access()
    {
        await using var factory = new PerformanceApiFactory();
        var notEntitled = factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: Employee, modules: [ModuleEntitlements.CoreHR]);
        Assert.Equal(HttpStatusCode.Forbidden, (await notEntitled.GetAsync($"/api/performance/people/{Guid.NewGuid()}/summary")).StatusCode);
        var noAccess = factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: []);
        Assert.Equal(HttpStatusCode.Forbidden, (await noAccess.GetAsync($"/api/performance/people/{Guid.NewGuid()}/summary")).StatusCode);
    }
}

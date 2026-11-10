using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Calibration;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Settings;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>performance-work-items: derived per role from current state, absolute paths, gone once done.</summary>
public sealed class WorkItemsHttpTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private static readonly PlanSubmissionFacts Ready = new(1, true, 100m, true, false, PlanAlignmentPolicy.Optional);

    private static readonly EffectivePermissionGrant[] Employee = [new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)];
    private static readonly EffectivePermissionGrant[] Manager =
        [new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self), new(PerformancePermissions.CycleView, PermissionScopes.DirectReports)];
    private static readonly EffectivePermissionGrant[] Admin =
        [new(PerformancePermissions.CycleView, PermissionScopes.Tenant), new(PerformancePermissions.CycleManage, PermissionScopes.Tenant)];
    private static readonly EffectivePermissionGrant[] Facilitator =
        [new(PerformancePermissions.CycleView, PermissionScopes.Tenant), new(PerformancePermissions.ReviewCalibrate, PermissionScopes.Tenant)];

    private sealed record World(PerformanceApiFactory Factory, PerformanceCycle Cycle, Guid Nour, Guid Sami, Guid Lina,
        EmployeePlan SamiPlan);

    /// <summary>Lina manages Nour and Sami in a cycle still in planning. Nour hasn't submitted; Sami's plan waits for Lina.</summary>
    private static async Task<World> PlanningAsync()
    {
        var factory = new PerformanceApiFactory();
        var tenant = factory.Store.TenantId;
        var nour = Guid.NewGuid(); var sami = Guid.NewGuid(); var lina = Guid.NewGuid();
        var start = Today.AddMonths(-1);
        var cycle = PerformanceCycle.CreateDraft(tenant, "FY2027", start, Today.AddMonths(11), Today.AddDays(14)).Activated();
        var nourParticipant = Participant.Create(tenant, cycle.Id, nour, "Nour", null, null, "Learning", lina, "Lina", false, start);
        var samiParticipant = Participant.Create(tenant, cycle.Id, sami, "Sami", null, null, "Learning", lina, "Lina", false, start);
        var samiPlan = EmployeePlan.Create(tenant, cycle.Id, samiParticipant.Id, sami, "Sami", "Learning", lina, "Lina");
        samiPlan.Submit(sami, Ready);
        await using var db = factory.Store.NewContext();
        db.Cycles.Add(cycle);
        db.Participants.AddRange(nourParticipant, samiParticipant);
        db.EmployeePlans.Add(samiPlan);
        await db.SaveChangesAsync();
        return new(factory, cycle, nour, sami, lina, samiPlan);
    }

    /// <summary>Applies a plan transition the way the plan handlers save it (new decisions are inserts).</summary>
    private static async Task DecideAsync(World world, Action<EmployeePlan> decide)
    {
        await using var db = world.Factory.Store.NewContext();
        var plan = await db.EmployeePlans.Include(p => p.Decisions).SingleAsync(p => p.Id == world.SamiPlan.Id);
        decide(plan);
        foreach (var entry in db.ChangeTracker.Entries<PlanDecision>().Where(e => e.State == EntityState.Modified))
            entry.State = EntityState.Added;
        await db.SaveChangesAsync();
    }

    private static async Task<JsonElement[]> WorkAsync(HttpClient client)
    {
        var response = await client.GetAsync("/api/performance/work");
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").EnumerateArray().ToArray();
    }

    private static string Kind(JsonElement item) => item.GetProperty("kind").GetString()!;

    /// <summary>The item says since when someone has waited on the caller, to the second the store keeps.</summary>
    private static void AssertWaitingSince(DateTime expected, JsonElement item)
        => Assert.Equal(expected, item.GetProperty("waitingSince").GetDateTime().ToUniversalTime(), TimeSpan.FromSeconds(1));

    [Fact]
    public async Task A_participant_in_planning_has_one_item_to_write_their_plan_due_on_the_deadline()
    {
        var world = await PlanningAsync();
        await using var _ = world.Factory;
        var item = Assert.Single(await WorkAsync(world.Factory.CreateAuthenticatedClient(employeeId: world.Nour, permissions: Employee)));
        Assert.Equal("plan-write", Kind(item));
        Assert.Equal("Write your plan", item.GetProperty("title").GetString());
        Assert.Equal("performance", item.GetProperty("module").GetString());
        Assert.Equal(world.Cycle.PlanningDeadline.ToString("yyyy-MM-dd"), item.GetProperty("dueOn").GetString());
        Assert.Equal("/performance/goals", item.GetProperty("href").GetString());
        Assert.Equal("/performance/goals", item.GetProperty("section").GetString());
        Assert.StartsWith("performance:plan-write:", item.GetProperty("id").GetString());
        Assert.Equal(JsonValueKind.Null, item.GetProperty("waitingSince").ValueKind);
    }

    [Fact]
    public async Task A_returned_plan_reads_as_a_revision()
    {
        var world = await PlanningAsync();
        await using var _ = world.Factory;
        await DecideAsync(world, plan => plan.Return(world.Lina, "Add a measure"));
        var item = Assert.Single(await WorkAsync(world.Factory.CreateAuthenticatedClient(employeeId: world.Sami, permissions: Employee)));
        Assert.Equal("plan-revise", Kind(item));
        Assert.Equal("Revise your plan", item.GetProperty("title").GetString());
        Assert.Equal("/performance/goals", item.GetProperty("section").GetString());
    }

    [Fact]
    public async Task A_manager_has_an_item_per_plan_awaiting_them_and_it_disappears_after_approval()
    {
        var world = await PlanningAsync();
        await using var _ = world.Factory;
        var lina = world.Factory.CreateAuthenticatedClient(employeeId: world.Lina, permissions: Manager);
        var decision = Assert.Single(await WorkAsync(lina), item => Kind(item) == "plan-decision");
        Assert.Equal("Sami's plan", decision.GetProperty("title").GetString());
        Assert.Equal("Put forward, 0 goals", decision.GetProperty("context").GetString());
        Assert.Equal("Sami", decision.GetProperty("subject").GetProperty("displayName").GetString());
        Assert.Equal($"/performance/cycles/{world.Cycle.Id}/plans/{world.SamiPlan.Id}", decision.GetProperty("href").GetString());
        Assert.Equal("/performance/team", decision.GetProperty("section").GetString());
        AssertWaitingSince(world.SamiPlan.SubmittedAt!.Value, decision);

        await DecideAsync(world, plan => plan.Approve(world.Lina));
        Assert.DoesNotContain(await WorkAsync(lina), item => Kind(item) == "plan-decision");
    }

    [Fact]
    public async Task A_plan_is_answered_in_place_by_its_reviewer_only()
    {
        var world = await PlanningAsync();
        await using var _ = world.Factory;
        var lina = world.Factory.CreateAuthenticatedClient(employeeId: world.Lina, permissions: Manager);
        var decision = Assert.Single(await WorkAsync(lina), item => Kind(item) == "plan-decision").GetProperty("decision");
        var approve = "/api/performance" + decision.GetProperty("approvePath").GetString();
        var change = "/api/performance" + decision.GetProperty("declinePath").GetString();
        Assert.Equal("Ask for a change", decision.GetProperty("declineLabel").GetString());

        // Another manager, the plan's owner and another company's manager are all refused; the plan still waits.
        var other = world.Factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: Manager);
        Assert.False((await other.PostAsync(approve, null)).IsSuccessStatusCode);
        var sami = world.Factory.CreateAuthenticatedClient(employeeId: world.Sami, permissions: Employee);
        Assert.False((await sami.PostAsync(approve, null)).IsSuccessStatusCode);
        var elsewhere = world.Factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), employeeId: world.Lina, permissions: Manager);
        Assert.False((await elsewhere.PostAsync(approve, null)).IsSuccessStatusCode);
        Assert.False((await elsewhere.PostAsJsonAsync(change, new { reason = "No" })).IsSuccessStatusCode);
        Assert.Contains(await WorkAsync(lina), item => Kind(item) == "plan-decision");

        // Asking for a change sends the plan back with the note; put forward again, it reads as changed and is approved in place.
        var returned = await lina.PostAsJsonAsync(change, new { reason = "Add a measure" });
        Assert.True(returned.IsSuccessStatusCode, await returned.Content.ReadAsStringAsync());
        Assert.DoesNotContain(await WorkAsync(lina), item => Kind(item) == "plan-decision");
        await DecideAsync(world, plan => plan.Submit(world.Sami, Ready));
        var again = Assert.Single(await WorkAsync(lina), item => Kind(item) == "plan-decision");
        Assert.StartsWith("Changed as you asked", again.GetProperty("context").GetString());
        var approved = await lina.PostAsync(approve, null);
        Assert.True(approved.IsSuccessStatusCode, await approved.Content.ReadAsStringAsync());
        Assert.DoesNotContain(await WorkAsync(lina), item => Kind(item) == "plan-decision");
    }

    [Fact]
    public async Task An_objective_update_request_opens_the_objective_ready_to_record_progress()
    {
        var world = await PlanningAsync();
        await using var _ = world.Factory;
        Guid objectiveId;
        var requestedAt = DateTime.UtcNow.AddDays(-2);
        await DecideAsync(world, plan => plan.Approve(world.Lina));
        await using (var db = world.Factory.Store.NewContext())
        {
            var plan = await db.EmployeePlans.Include(p => p.Decisions).SingleAsync(p => p.Id == world.SamiPlan.Id);
            var objective = Domain.Objectives.Objective.CreateEmployee(world.Factory.Store.TenantId, world.Cycle.Id, plan.Id, world.Sami,
                "Ship the playbook", null, null, world.Cycle.StartDate, world.Cycle.EndDate,
                Domain.Objectives.ObjectiveMeasurement.ManualPercentage(), 100m, null, null, world.Cycle.StartDate, world.Cycle.EndDate);
            objectiveId = objective.Id;
            db.Objectives.Add(objective);
            db.UpdateRequests.Add(UpdateRequest.Create(plan, objective, world.Lina, "Lina", null, requestedAt));
            await db.SaveChangesAsync();
        }
        var item = Assert.Single(await WorkAsync(world.Factory.CreateAuthenticatedClient(employeeId: world.Sami, permissions: Employee)));
        Assert.Equal("update-request", Kind(item));
        Assert.Equal("Update progress on Ship the playbook", item.GetProperty("title").GetString());
        Assert.Equal($"/performance/cycles/{world.Cycle.Id}/objectives/{objectiveId}?mode=record", item.GetProperty("href").GetString());
        Assert.Equal("/performance/goals", item.GetProperty("section").GetString());
        AssertWaitingSince(requestedAt, item);
    }

    [Fact]
    public async Task Assessments_are_due_for_the_subject_then_the_reviewer_and_rounds_ready_to_finalize_reach_administrators()
    {
        var world = await PlanningAsync();
        await using var _ = world.Factory;
        var tenant = world.Factory.Store.TenantId;
        var round = ReviewRound.CreateDraft(tenant, world.Cycle, "Mid-year", world.Cycle.StartDate, world.Cycle.EndDate, true, false, false);
        round.UpdateDraft(world.Cycle, "Mid-year", world.Cycle.StartDate, world.Cycle.EndDate, true, false, false,
            Today.AddDays(5), Today.AddDays(15), "[]");
        var scale = RatingScale.CreateDefault(tenant);
        var version = scale.CreateNextVersion(RatingScaleDefaults.Levels);
        PerformanceReview review;
        await using (var db = world.Factory.Store.NewContext())
        {
            var participant = await db.Participants.SingleAsync(p => p.EmployeeId == world.Nour);
            var subject = ReviewRoundSubject.Create(tenant, round.Id, participant, world.Lina, "Lina");
            review = PerformanceReview.Open(tenant, round, subject, version.Id, version.LevelsJson, DateTime.UtcNow);
            round.Launch("{\"competencies\":[]}", version.Id, DateTime.UtcNow);
            db.RatingScales.Add(scale); db.RatingScaleVersions.Add(version);
            db.ReviewRounds.Add(round); db.ReviewRoundSubjects.Add(subject); db.PerformanceReviews.Add(review);
            await db.SaveChangesAsync();
        }
        var nour = world.Factory.CreateAuthenticatedClient(employeeId: world.Nour, permissions: Employee);
        var lina = world.Factory.CreateAuthenticatedClient(employeeId: world.Lina, permissions: Manager);
        var admin = world.Factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: Admin);

        var self = Assert.Single(await WorkAsync(nour), item => Kind(item) == "self-assessment");
        Assert.Equal(Today.AddDays(5).ToString("yyyy-MM-dd"), self.GetProperty("dueOn").GetString());
        Assert.Equal($"/performance/reviews/{review.Id}", self.GetProperty("href").GetString());
        Assert.Equal(JsonValueKind.Null, self.GetProperty("waitingSince").ValueKind);
        Assert.Equal("/performance/reviews", self.GetProperty("section").GetString());
        Assert.DoesNotContain(await WorkAsync(lina), item => Kind(item) == "manager-assessment");

        await using (var db = world.Factory.Store.NewContext())
        {
            var tracked = await db.PerformanceReviews.SingleAsync(r => r.Id == review.Id);
            tracked.SubmitSelfAssessment(world.Nour, "A good half", 3, DateTime.UtcNow);
            await db.SaveChangesAsync();
        }
        Assert.DoesNotContain(await WorkAsync(nour), item => Kind(item) == "self-assessment");
        var manager = Assert.Single(await WorkAsync(lina), item => Kind(item) == "manager-assessment");
        Assert.Equal("Assess Nour", manager.GetProperty("title").GetString());
        Assert.Equal("/performance/reviews", manager.GetProperty("section").GetString());
        Assert.DoesNotContain(await WorkAsync(admin), item => Kind(item) == "round-finalize");

        await using (var db = world.Factory.Store.NewContext())
        {
            var tracked = await db.PerformanceReviews.SingleAsync(r => r.Id == review.Id);
            tracked.SubmitManagerAssessment(world.Lina, "Solid", 3, DateTime.UtcNow);
            await db.SaveChangesAsync();
        }
        var finalize = Assert.Single(await WorkAsync(admin), item => Kind(item) == "round-finalize");
        Assert.Equal("Finalize Mid-year", finalize.GetProperty("title").GetString());
        Assert.Equal($"/performance/reviews/rounds/{round.Id}", finalize.GetProperty("href").GetString());
        Assert.Equal("/performance/reviews", finalize.GetProperty("section").GetString());
    }

    [Fact]
    public async Task A_facilitator_has_an_item_for_an_open_calibration_session()
    {
        var world = await PlanningAsync();
        await using var _ = world.Factory;
        var tenant = world.Factory.Store.TenantId;
        var facilitator = new FacilitatorIdentity(Guid.NewGuid(), null, "QA Admin");
        var round = ReviewRound.CreateDraft(tenant, world.Cycle, "Year-end", world.Cycle.StartDate, world.Cycle.EndDate, false, false, true);
        var scale = RatingScale.CreateDefault(tenant);
        var version = scale.CreateNextVersion(RatingScaleDefaults.Levels);
        round.Launch("{\"competencies\":[]}", version.Id, DateTime.UtcNow);
        var session = CalibrationSession.Open(tenant, round, facilitator, new NineBoxBands(2, 3), DateTime.UtcNow);
        await using (var db = world.Factory.Store.NewContext())
        {
            db.RatingScales.Add(scale); db.RatingScaleVersions.Add(version);
            db.ReviewRounds.Add(round); db.CalibrationSessions.Add(session);
            await db.SaveChangesAsync();
        }
        var item = Assert.Single(await WorkAsync(world.Factory.CreateAuthenticatedClient(userId: facilitator.UserId, permissions: Facilitator)));
        Assert.Equal("calibration", Kind(item));
        Assert.Equal("/performance/reviews", item.GetProperty("section").GetString());
        Assert.Equal($"/performance/reviews/rounds/{round.Id}/calibration", item.GetProperty("href").GetString());
        Assert.Empty(await WorkAsync(world.Factory.CreateAuthenticatedClient(userId: Guid.NewGuid(), permissions: Facilitator)));
    }

    [Fact]
    public async Task Someone_with_nothing_outstanding_gets_an_empty_list_and_another_tenant_sees_nothing()
    {
        var world = await PlanningAsync();
        await using var _ = world.Factory;
        Assert.Empty(await WorkAsync(world.Factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: Employee)));
        Assert.Empty(await WorkAsync(world.Factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), employeeId: world.Lina, permissions: Manager)));
    }

    [Fact]
    public async Task Work_requires_the_entitlement_and_Performance_access()
    {
        await using var factory = new PerformanceApiFactory();
        var notEntitled = factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: Employee, modules: [ModuleEntitlements.CoreHR]);
        Assert.Equal(HttpStatusCode.Forbidden, (await notEntitled.GetAsync("/api/performance/work")).StatusCode);
        var noAccess = factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: []);
        Assert.Equal(HttpStatusCode.Forbidden, (await noAccess.GetAsync("/api/performance/work")).StatusCode);
    }
}

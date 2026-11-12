using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Plans;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// Chunk C — employee plan authoring, the whole-plan submission gate, manager decision, lock
/// immutability, and the governed exceptional-approval escape hatch. Exercises the handlers over
/// the shared in-memory store the way the API does (a fresh context per request).
/// </summary>
public sealed class EmployeePlansTests
{
    private static readonly DateOnly CycleStart = new(2026, 1, 1);
    private static readonly DateOnly CycleEnd = new(2026, 12, 31);

    private sealed record Fixture(
        TestStore Store,
        FakeCoreWorkforceClient Workforce,
        Guid CycleId,
        Guid StrategicId,
        Guid EmployeeId,
        Guid ManagerId,
        Guid ParticipantId);

    private static async Task<Fixture> ArrangeAsync(bool standaloneAllowed = true, bool active = true, PlanAlignmentPolicy? alignmentPolicy = null)
    {
        var store = TestStore.ForNewTenant();
        var workforce = new FakeCoreWorkforceClient();
        var coo = workforce.Add("Coralie Ops");
        var manager = workforce.Add("Mo Manager");
        var employee = workforce.Add("Emma Employee");

        var cycle = PerformanceCycle.CreateDraft(store.TenantId, "FY2026", CycleStart, CycleEnd, CycleStart.AddDays(30));
        var strategic = Objective.CreateStrategic(store.TenantId, cycle.Id, "Grow the company", null, coo.EmployeeId,
            CycleStart, CycleEnd, ObjectiveMeasurement.ManualPercentage(), CycleStart, CycleEnd);
        strategic.Publish();

        var participant = Participant.Create(store.TenantId, cycle.Id, employee.EmployeeId, "Emma Employee", "Engineer",
            Guid.NewGuid(), "Engineering", manager.EmployeeId, "Mo Manager", byExplicitInclusion: false, reviewerAsOf: cycle.StartDate);

        await using (var db = store.NewContext())
        {
            db.Cycles.Add(cycle);
            db.Objectives.Add(strategic);
            db.Participants.Add(participant);
            var settings = SettingsWith(store.TenantId, standaloneAllowed);
            if (alignmentPolicy is { } policy) settings.Update(settings.DefaultMeasurementMethod, 3, 6, 30, policy);
            db.CycleSettings.Add(settings);
            await db.SaveChangesAsync();
            if (!active)
                return new Fixture(store, workforce, cycle.Id, strategic.Id, employee.EmployeeId, manager.EmployeeId, participant.Id);

            var tracked = await db.Cycles.FirstAsync();
            var snapshot = ActivationSnapshot.Capture(store.TenantId, cycle.Id, "FY2026", CycleStart, CycleEnd, CycleStart.AddDays(30), CycleStart, 1, System.Text.Json.JsonSerializer.Serialize(settings.ToSnapshot()), "{}", "[]", "[]");
            tracked.Activate(snapshot);
            db.Entry(snapshot).State = EntityState.Added;
            await db.SaveChangesAsync();
        }

        return new Fixture(store, workforce, cycle.Id, strategic.Id, employee.EmployeeId, manager.EmployeeId, participant.Id);
    }

    private static CycleSettings SettingsWith(Guid tenantId, bool standaloneAllowed)
    {
        var settings = CycleSettings.CreateDefault(tenantId);
        if (!standaloneAllowed)
            settings.Update(settings.DefaultMeasurementMethod, settings.SuggestedObjectiveCountMin, settings.SuggestedObjectiveCountMax, settings.PlanningDeadlineOffsetDays, planAlignmentPolicy: PlanAlignmentPolicy.EveryObjectiveConnected);
        return settings;
    }

    private static PlanActorContext Employee(Guid id) => new(id, IsAdmin: false, CanReviewReports: false);
    private static PlanActorContext Manager(Guid id) => new(id, IsAdmin: false, CanReviewReports: true);
    private static PlanActorContext Admin(Guid id) => new(id, IsAdmin: true, CanReviewReports: true);

    private static AddPlanObjectiveRequest AlignedNumeric(Guid parentId, decimal weight, string title = "Reduce escalation time")
        => new(title, null, parentId, null, null,
            new MeasurementInput(MeasurementMethod.NumericTarget, 24m, 12m, "hours", null), weight);

    private static AddPlanObjectiveRequest Standalone(decimal weight, string title = "Complete operational documentation")
        => new(title, null, null, null, null,
            new MeasurementInput(MeasurementMethod.ManualPercentage, null, null, null, null), weight);

    // ── Handler wiring ────────────────────────────────────────────────────

    private static async Task<EmployeePlanDto> CreatePlanAsync(Fixture f, PlanActorContext actor)
    {
        await using var db = f.Store.NewContext();
        var result = await new CreateMyPlanHandler(db, f.Workforce, f.Store.Tenant).Handle(new CreateMyPlanCommand(f.CycleId, actor), default);
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        return result.Value;
    }

    private static async Task<Result<EmployeePlanDto>> AddObjectiveAsync(Fixture f, AddPlanObjectiveRequest request, PlanActorContext actor)
    {
        await using var db = f.Store.NewContext();
        return await new AddPlanObjectiveHandler(db, f.Workforce, f.Store.Tenant).Handle(new AddPlanObjectiveCommand(f.CycleId, request, actor), default);
    }

    private static async Task<Result<EmployeePlanDto>> SubmitAsync(Fixture f, PlanActorContext actor)
    {
        await using var db = f.Store.NewContext();
        var result = await new SubmitMyPlanHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db), new EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceNotifications(db)).Handle(new SubmitMyPlanCommand(f.CycleId, actor), default);
        if (result.IsSuccess) await AuditAssertions.RecordedAsync(db, "Plan.Submitted", result.Value.Id, f.CycleId);
        return result;
    }

    [Fact]
    public async Task Plan_projection_marks_owner_from_server_resolved_caller_identity()
    {
        var f = await ArrangeAsync();
        var ownerPlan = await CreatePlanAsync(f, Employee(f.EmployeeId));
        Assert.True(ownerPlan.IsOwner);

        await using var db = f.Store.NewContext();
        var reviewerView = await new GetPlanForReviewHandler(db, f.Workforce, f.Store.Tenant)
            .Handle(new GetPlanForReviewQuery(f.CycleId, ownerPlan.Id, Admin(Guid.NewGuid())), default);

        Assert.True(reviewerView.IsSuccess);
        Assert.False(reviewerView.Value.IsOwner);
    }

    [Theory]
    [InlineData(PlanAlignmentPolicy.Optional, true)]
    [InlineData(PlanAlignmentPolicy.AtLeastOneConnected, false)]
    [InlineData(PlanAlignmentPolicy.EveryObjectiveConnected, false)]
    public async Task Standalone_only_submission_uses_the_captured_policy(PlanAlignmentPolicy policy, bool allowed)
    {
        var f = await ArrangeAsync(alignmentPolicy: policy);
        await CreatePlanAsync(f, Employee(f.EmployeeId));
        Assert.True((await AddObjectiveAsync(f, Standalone(100m), Employee(f.EmployeeId))).IsSuccess);
        await using (var db = f.Store.NewContext())
        {
            var settings = await db.CycleSettings.SingleAsync();
            settings.Update(settings.DefaultMeasurementMethod, 3, 6, 30,
                policy == PlanAlignmentPolicy.Optional ? PlanAlignmentPolicy.EveryObjectiveConnected : PlanAlignmentPolicy.Optional);
            await db.SaveChangesAsync();
        }
        Assert.Equal(allowed, (await SubmitAsync(f, Employee(f.EmployeeId))).IsSuccess);
    }

    [Theory]
    [InlineData(PlanAlignmentPolicy.Optional, true)]
    [InlineData(PlanAlignmentPolicy.AtLeastOneConnected, true)]
    [InlineData(PlanAlignmentPolicy.EveryObjectiveConnected, false)]
    public async Task Mixed_plan_submission_requires_every_connection_only_under_every_objective_policy(PlanAlignmentPolicy policy, bool allowed)
    {
        var f = await ArrangeAsync(alignmentPolicy: policy);
        await CreatePlanAsync(f, Employee(f.EmployeeId));
        Assert.True((await AddObjectiveAsync(f, AlignedNumeric(f.StrategicId, 60m), Employee(f.EmployeeId))).IsSuccess);
        Assert.True((await AddObjectiveAsync(f, Standalone(40m), Employee(f.EmployeeId))).IsSuccess);
        Assert.Equal(allowed, (await SubmitAsync(f, Employee(f.EmployeeId))).IsSuccess);
    }

    [Theory]
    [InlineData(PlanAlignmentPolicy.EveryObjectiveConnected)]
    [InlineData(PlanAlignmentPolicy.AtLeastOneConnected)]
    [InlineData(PlanAlignmentPolicy.Optional)]
    public async Task Fully_connected_plan_can_submit_under_each_policy(PlanAlignmentPolicy policy)
    {
        var f = await ArrangeAsync(alignmentPolicy: policy);
        await CreatePlanAsync(f, Employee(f.EmployeeId));
        Assert.True((await AddObjectiveAsync(f, AlignedNumeric(f.StrategicId, 100m), Employee(f.EmployeeId))).IsSuccess);
        Assert.True((await SubmitAsync(f, Employee(f.EmployeeId))).IsSuccess);
    }

    [Fact]
    public async Task Organizational_parent_without_a_strategic_ancestor_does_not_satisfy_every_objective_policy()
    {
        var f = await ArrangeAsync(alignmentPolicy: PlanAlignmentPolicy.EveryObjectiveConnected);
        await CreatePlanAsync(f, Employee(f.EmployeeId));
        var org = Objective.CreateOrganizational(f.Store.TenantId, f.CycleId, Guid.NewGuid(), "Engineering", "Local direction", null,
            f.ManagerId, null, CycleStart, CycleEnd, ObjectiveProgressSource.Direct, ObjectiveMeasurement.ManualPercentage(), null, null, CycleStart, CycleEnd);
        org.Publish();
        await using (var db = f.Store.NewContext()) { db.Objectives.Add(org); await db.SaveChangesAsync(); }
        Assert.True((await AddObjectiveAsync(f, AlignedNumeric(org.Id, 100m), Employee(f.EmployeeId))).IsSuccess);
        Assert.False((await SubmitAsync(f, Employee(f.EmployeeId))).IsSuccess);
    }

    [Theory]
    [InlineData("{\"AllowStandaloneObjectives\":true}", PlanAlignmentPolicy.AtLeastOneConnected)]
    [InlineData("{\"AllowStandaloneObjectives\":false}", PlanAlignmentPolicy.EveryObjectiveConnected)]
    [InlineData("{\"PlanAlignmentPolicy\":\"Optional\"}", PlanAlignmentPolicy.Optional)]
    [InlineData("{\"PlanAlignmentPolicy\":0}", PlanAlignmentPolicy.EveryObjectiveConnected)]
    public void Historical_activation_settings_preserve_their_alignment_policy(string json, PlanAlignmentPolicy expected)
        => Assert.Equal(expected, PlanAlignmentSnapshots.Read(json));

    // ── Planning opens at activation ──────────────────────────────────────

    [Fact]
    public async Task A_confirmed_participant_cannot_create_a_plan_while_the_cycle_is_draft()
    {
        var f = await ArrangeAsync(active: false);
        await using var db = f.Store.NewContext();
        var result = await new CreateMyPlanHandler(db, f.Workforce, f.Store.Tenant)
            .Handle(new CreateMyPlanCommand(f.CycleId, Employee(f.EmployeeId)), default);

        Assert.True(result.IsFailure);
        Assert.Equal("Cycle.NotActive", result.Error.Code);
        Assert.Empty(db.EmployeePlans);
    }

    [Fact]
    public async Task Draft_roster_changes_cannot_orphan_a_plan_because_planning_has_not_opened()
    {
        var f = await ArrangeAsync(active: false);
        await using (var db = f.Store.NewContext())
        {
            var create = await new CreateMyPlanHandler(db, f.Workforce, f.Store.Tenant).Handle(new(f.CycleId, Employee(f.EmployeeId)), default);
            Assert.Equal("Cycle.NotActive", create.Error.Code);
        }
        await using (var db = f.Store.NewContext())
        {
            var changed = await new EY.HRPlatform.Performance.Features.Population.SetPopulationHandler(db, f.Store.Tenant, new(f.Workforce)).Handle(new(f.CycleId, new(PopulationMode.AllActive, [], [], [new(f.EmployeeId, "Outside this cycle")]) { ExpectedVersion = 0 }), default);
            Assert.True(changed.IsSuccess);
        }
        await using var verify = f.Store.NewContext();
        Assert.Empty(await verify.Participants.Where(p => p.CycleId == f.CycleId).ToListAsync());
        Assert.Empty(await verify.EmployeePlans.Where(p => p.CycleId == f.CycleId).ToListAsync());
    }

    [Fact]
    public async Task A_plan_left_in_a_draft_cycle_cannot_be_authored_submitted_or_decided()
    {
        var f = await ArrangeAsync(active: false);
        Guid planId;
        await using (var db = f.Store.NewContext())
        {
            var plan = EmployeePlan.Create(f.Store.TenantId, f.CycleId, f.ParticipantId, f.EmployeeId, "Emma Employee", "Engineering", f.ManagerId, "Mo Manager");
            db.EmployeePlans.Add(plan);
            await db.SaveChangesAsync();
            planId = plan.Id;
        }

        var add = await AddObjectiveAsync(f, AlignedNumeric(f.StrategicId, 100m), Employee(f.EmployeeId));
        var submit = await SubmitAsync(f, Employee(f.EmployeeId));
        Result<EmployeePlanDto> approve;
        await using (var db = f.Store.NewContext())
            approve = await new ApprovePlanHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db), new EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceNotifications(db))
                .Handle(new ApprovePlanCommand(f.CycleId, planId, Manager(f.ManagerId)), default);

        Assert.All([add, submit, approve], r => Assert.Equal("Cycle.NotActive", r.Error.Code));
        await using var unchanged = f.Store.NewContext();
        Assert.Empty(unchanged.Objectives.Where(o => o.EmployeePlanId == planId));
        Assert.Equal(PlanLifecycleState.Draft, (await unchanged.EmployeePlans.FindAsync(planId))!.State);
    }

    // ── Authoring ownership & uniqueness ──────────────────────────────────

    [Fact]
    public async Task Second_competing_plan_for_the_same_participant_is_rejected()
    {
        var f = await ArrangeAsync();
        await CreatePlanAsync(f, Employee(f.EmployeeId));

        // A second create for the same participant returns the existing plan, never a competing one.
        var first = await LoadPlanIdAsync(f);
        await CreatePlanAsync(f, Employee(f.EmployeeId));
        var second = await LoadPlanIdAsync(f);

        Assert.Equal(first, second);
        await using var db = f.Store.NewContext();
        Assert.Equal(1, await db.EmployeePlans.CountAsync(p => p.CycleId == f.CycleId && p.EmployeeId == f.EmployeeId));
    }

    [Fact]
    public async Task Manager_cannot_author_into_the_employee_plan()
    {
        var f = await ArrangeAsync();
        await CreatePlanAsync(f, Employee(f.EmployeeId));

        // Authoring is self-scoped: the add endpoint only ever targets the caller's own plan, so a
        // manager cannot reach the employee's plan to insert an objective, and the employee's plan is
        // left untouched.
        var result = await AddObjectiveAsync(f, AlignedNumeric(f.StrategicId, 100m), Manager(f.ManagerId));
        Assert.True(result.IsFailure);

        await using var db = f.Store.NewContext();
        Assert.Equal(0, await db.Objectives.CountAsync(o => o.EmployeePlanId != null));
    }

    // ── Submission gate ───────────────────────────────────────────────────

    [Fact]
    public async Task Plan_without_strategic_connection_cannot_submit()
    {
        var f = await ArrangeAsync();
        await CreatePlanAsync(f, Employee(f.EmployeeId));
        // One standalone objective worth 100% — no connection to strategic direction.
        Assert.True((await AddObjectiveAsync(f, Standalone(100m), Employee(f.EmployeeId))).IsSuccess);

        var submit = await SubmitAsync(f, Employee(f.EmployeeId));
        Assert.True(submit.IsFailure);
        Assert.Contains("strategic", submit.Error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Plan_weights_must_total_100_to_submit()
    {
        var f = await ArrangeAsync();
        await CreatePlanAsync(f, Employee(f.EmployeeId));
        Assert.True((await AddObjectiveAsync(f, AlignedNumeric(f.StrategicId, 60m), Employee(f.EmployeeId))).IsSuccess);

        // 60% only — under 100%.
        var under = await SubmitAsync(f, Employee(f.EmployeeId));
        Assert.True(under.IsFailure);

        var last = (await AddObjectiveAsync(f, Standalone(40m), Employee(f.EmployeeId))).Value;
        Assert.Equal(100m, last.Readiness.WeightTotal);
        Assert.True(last.Readiness.CanSubmit);

        var ok = await SubmitAsync(f, Employee(f.EmployeeId));
        Assert.True(ok.IsSuccess, ok.IsFailure ? ok.Error.Message : null);
        Assert.Equal(PlanLifecycleState.Submitted, ok.Value.State);
    }

    [Fact]
    public async Task Standalone_objective_is_rejected_when_policy_disables_it()
    {
        var f = await ArrangeAsync(standaloneAllowed: false);
        await CreatePlanAsync(f, Employee(f.EmployeeId));
        Assert.True((await AddObjectiveAsync(f, AlignedNumeric(f.StrategicId, 60m), Employee(f.EmployeeId))).IsSuccess);
        Assert.True((await AddObjectiveAsync(f, Standalone(40m), Employee(f.EmployeeId))).IsSuccess);

        var submit = await SubmitAsync(f, Employee(f.EmployeeId));
        Assert.True(submit.IsFailure);
        Assert.Contains("Every objective", submit.Error.Message, StringComparison.OrdinalIgnoreCase);
    }

    // ── Manager decision & lock ───────────────────────────────────────────

    private static async Task SubmitReadyPlanAsync(Fixture f)
    {
        await CreatePlanAsync(f, Employee(f.EmployeeId));
        Assert.True((await AddObjectiveAsync(f, AlignedNumeric(f.StrategicId, 100m), Employee(f.EmployeeId))).IsSuccess);
        var submit = await SubmitAsync(f, Employee(f.EmployeeId));
        Assert.True(submit.IsSuccess, submit.IsFailure ? submit.Error.Message : null);
    }

    [Fact]
    public async Task Only_the_responsible_manager_can_approve()
    {
        var f = await ArrangeAsync();
        await SubmitReadyPlanAsync(f);
        var planId = await LoadPlanIdAsync(f);

        // A different manager cannot approve.
        await using (var db = f.Store.NewContext())
        {
            var stranger = await new ApprovePlanHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db), new EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceNotifications(db))
                .Handle(new ApprovePlanCommand(f.CycleId, planId, Manager(Guid.NewGuid())), default);
            Assert.True(stranger.IsFailure);
        }

        // The responsible manager approves, locking the plan.
        await using (var db = f.Store.NewContext())
        {
            var approved = await new ApprovePlanHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db), new EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceNotifications(db))
                .Handle(new ApprovePlanCommand(f.CycleId, planId, Manager(f.ManagerId)), default);
            Assert.True(approved.IsSuccess, approved.IsFailure ? approved.Error.Message : null);
            Assert.Equal(PlanLifecycleState.Approved, approved.Value.State);
            Assert.True(approved.Value.IsLocked);
            Assert.Equal(PlanApprovalKind.Normal, approved.Value.ApprovalKind);
            await AuditAssertions.RecordedAsync(db, "Plan.Approved", planId, f.CycleId);
        }
    }

    [Fact]
    public async Task Cannot_approve_a_plan_that_is_not_submitted()
    {
        var f = await ArrangeAsync();
        await CreatePlanAsync(f, Employee(f.EmployeeId));
        var planId = await LoadPlanIdAsync(f);

        await using var db = f.Store.NewContext();
        var result = await new ApprovePlanHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db), new EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceNotifications(db))
            .Handle(new ApprovePlanCommand(f.CycleId, planId, Manager(f.ManagerId)), default);
        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task Return_requires_feedback_and_sends_the_plan_back_to_draft()
    {
        var f = await ArrangeAsync();
        await SubmitReadyPlanAsync(f);
        var planId = await LoadPlanIdAsync(f);

        await using (var db = f.Store.NewContext())
        {
            var empty = await new ReturnPlanHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db), new EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceNotifications(db))
                .Handle(new ReturnPlanCommand(f.CycleId, planId, new ReturnPlanRequest("  "), Manager(f.ManagerId)), default);
            Assert.True(empty.IsFailure);
        }

        await using (var db = f.Store.NewContext())
        {
            var returned = await new ReturnPlanHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db), new EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceNotifications(db))
                .Handle(new ReturnPlanCommand(f.CycleId, planId, new ReturnPlanRequest("Sharpen the second objective."), Manager(f.ManagerId)), default);
            Assert.True(returned.IsSuccess, returned.IsFailure ? returned.Error.Message : null);
            Assert.Equal(PlanLifecycleState.Draft, returned.Value.State);
            await AuditAssertions.RecordedAsync(db, "Plan.Returned", planId, f.CycleId);
            Assert.Contains(returned.Value.History, h => h.Kind == PlanDecisionKind.Returned && h.Feedback == "Sharpen the second objective.");
        }
    }

    [Fact]
    public async Task Approved_plan_is_locked_and_the_employee_cannot_edit_it()
    {
        var f = await ArrangeAsync();
        await SubmitReadyPlanAsync(f);
        var planId = await LoadPlanIdAsync(f);
        await using (var db = f.Store.NewContext())
            await new ApprovePlanHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db), new EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceNotifications(db)).Handle(new ApprovePlanCommand(f.CycleId, planId, Manager(f.ManagerId)), default);

        // Adding another objective after lock is refused (authoring is Draft-only).
        var add = await AddObjectiveAsync(f, Standalone(10m), Employee(f.EmployeeId));
        Assert.True(add.IsFailure);
        Assert.Contains("Forbidden", add.Error.Code, StringComparison.OrdinalIgnoreCase);
    }

    // ── Exceptional approval ──────────────────────────────────────────────

    [Fact]
    public async Task Exceptional_approval_requires_a_reason_and_is_attributed_administratively()
    {
        var f = await ArrangeAsync();
        await SubmitReadyPlanAsync(f);
        var planId = await LoadPlanIdAsync(f);
        var adminId = Guid.NewGuid();

        await using (var db = f.Store.NewContext())
        {
            var noReason = await new ExceptionalApprovePlanHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db), new EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceNotifications(db))
                .Handle(new ExceptionalApprovePlanCommand(f.CycleId, planId, new ExceptionalApprovePlanRequest("  "), Admin(adminId)), default);
            Assert.True(noReason.IsFailure);
        }

        await using (var db = f.Store.NewContext())
        {
            var approved = await new ExceptionalApprovePlanHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db), new EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceNotifications(db))
                .Handle(new ExceptionalApprovePlanCommand(f.CycleId, planId, new ExceptionalApprovePlanRequest("Manager on extended leave."), Admin(adminId)), default);
            Assert.True(approved.IsSuccess, approved.IsFailure ? approved.Error.Message : null);
            Assert.Equal(PlanApprovalKind.Exceptional, approved.Value.ApprovalKind);
            await AuditAssertions.RecordedAsync(db, "Plan.ExceptionallyApproved", planId, f.CycleId);
            // The responsible manager identity is preserved separately; the administrator is the approver.
            Assert.Equal(f.ManagerId, approved.Value.ResponsibleManager!.Id);
            Assert.Contains(approved.Value.History, h => h.Kind == PlanDecisionKind.ApprovedExceptionally && h.Feedback == "Manager on extended leave.");
            // Never both approvals.
            Assert.DoesNotContain(approved.Value.History, h => h.Kind == PlanDecisionKind.Approved);
        }
    }

    [Fact]
    public async Task Exceptional_approval_requires_a_submitted_plan()
    {
        var f = await ArrangeAsync();
        await CreatePlanAsync(f, Employee(f.EmployeeId));
        var planId = await LoadPlanIdAsync(f);

        await using var db = f.Store.NewContext();
        var result = await new ExceptionalApprovePlanHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db), new EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceNotifications(db))
            .Handle(new ExceptionalApprovePlanCommand(f.CycleId, planId, new ExceptionalApprovePlanRequest("Blocked"), Admin(Guid.NewGuid())), default);
        Assert.True(result.IsFailure);
    }

    // ── Cycle state ───────────────────────────────────────────────────────

    [Fact]
    public async Task Plan_authoring_is_rejected_on_a_closed_cycle()
    {
        var f = await ArrangeAsync();
        await CreatePlanAsync(f, Employee(f.EmployeeId));
        await using (var db = f.Store.NewContext())
        {
            var cycle = await db.Cycles.FirstAsync();
            cycle.Close();
            await db.SaveChangesAsync();
        }

        var add = await AddObjectiveAsync(f, AlignedNumeric(f.StrategicId, 100m), Employee(f.EmployeeId));
        Assert.True(add.IsFailure);
        Assert.Contains("Closed", add.Error.Code, StringComparison.OrdinalIgnoreCase);
    }

    private static async Task DecideAsync(Fixture f, bool approve)
    {
        var planId = await LoadPlanIdAsync(f);
        await using var db = f.Store.NewContext();
        var result = approve
            ? await new ApprovePlanHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db), new EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceNotifications(db))
                .Handle(new ApprovePlanCommand(f.CycleId, planId, Manager(f.ManagerId)), default)
            : await new ReturnPlanHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db), new EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceNotifications(db))
                .Handle(new ReturnPlanCommand(f.CycleId, planId, new ReturnPlanRequest("Sharpen it."), Manager(f.ManagerId)), default);
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
    }

    [Fact]
    public async Task Milestone_due_dates_must_fall_inside_the_objective_window()
    {
        var f = await ArrangeAsync();
        await CreatePlanAsync(f, Employee(f.EmployeeId));

        AddPlanObjectiveRequest WithDue(DateOnly due) => new("Ship the playbook", null, f.StrategicId, null, null,
            new MeasurementInput(MeasurementMethod.WeightedMilestones, null, null, null,
                [new MilestoneInput("Draft", 40m, due), new MilestoneInput("Roll out", 60m, null)]), 100m);

        var outside = await AddObjectiveAsync(f, WithDue(CycleEnd.AddDays(1)), Employee(f.EmployeeId));
        Assert.True(outside.IsFailure);

        var inside = await AddObjectiveAsync(f, WithDue(CycleStart.AddDays(45)), Employee(f.EmployeeId));
        Assert.True(inside.IsSuccess, inside.IsFailure ? inside.Error.Message : null);
        var milestone = Assert.Single(inside.Value.Objectives).Measurement!.Milestones[0];
        Assert.Equal(CycleStart.AddDays(45), milestone.DueDate);
    }

    private static async Task<Guid> LoadPlanIdAsync(Fixture f)
    {
        await using var db = f.Store.NewContext();
        var plan = await db.EmployeePlans.AsNoTracking().FirstAsync(p => p.CycleId == f.CycleId && p.EmployeeId == f.EmployeeId);
        return plan.Id;
    }
    [Theory]
    [InlineData("submit")]
    [InlineData("return")]
    [InlineData("approve")]
    [InlineData("exceptional")]
    public async Task Transition_retry_precedes_version_check_and_preserves_representation(string transition)
    {
        var f = await ArrangeAsync();
        await CreatePlanAsync(f, Employee(f.EmployeeId));
        Assert.True((await AddObjectiveAsync(f, AlignedNumeric(f.StrategicId, 100m), Employee(f.EmployeeId))).IsSuccess);
        if (transition != "submit") Assert.True((await SubmitAsync(f, Employee(f.EmployeeId))).IsSuccess);
        var planId = await LoadPlanIdAsync(f);
        var admin = Admin(Guid.NewGuid());
        async Task<Result<EmployeePlanDto>> Apply(uint expected)
        {
            await using var db = f.Store.NewContext();
            return transition switch
            {
                "submit" => await new SubmitMyPlanHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db), new EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceNotifications(db)).Handle(new(f.CycleId, Employee(f.EmployeeId), expected), default),
                "return" => await new ReturnPlanHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db), new EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceNotifications(db)).Handle(new(f.CycleId, planId,
                    new("Sharpen the outcome.") { ExpectedVersion = expected }, Manager(f.ManagerId)), default),
                "approve" => await new ApprovePlanHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db), new EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceNotifications(db)).Handle(new(f.CycleId, planId, Manager(f.ManagerId), expected), default),
                _ => await new ExceptionalApprovePlanHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db), new EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceNotifications(db)).Handle(new(f.CycleId, planId,
                    new("Manager unavailable.") { ExpectedVersion = expected }, admin), default),
            };
        }
        var first = await Apply(0);
        Assert.True(first.IsSuccess);
        var repeated = await Apply(1);
        Assert.True(repeated.IsSuccess, repeated.IsFailure ? repeated.Error.Message : null);
        Assert.Equal(System.Text.Json.JsonSerializer.Serialize(first.Value), System.Text.Json.JsonSerializer.Serialize(repeated.Value));
        await using var check = f.Store.NewContext();
        var kind = transition switch { "submit" => PlanDecisionKind.Submitted, "return" => PlanDecisionKind.Returned,
            "approve" => PlanDecisionKind.Approved, _ => PlanDecisionKind.ApprovedExceptionally };
        Assert.Single(check.PlanDecisions.Where(d => d.PlanId == planId && d.Kind == kind));
        var auditAction = transition switch { "submit" => "Plan.Submitted", "return" => "Plan.Returned",
            "approve" => "Plan.Approved", _ => "Plan.ExceptionallyApproved" };
        Assert.Single(check.AuditEntries.Where(e => e.ResourceId == planId && e.Action == auditAction));
        var notificationKind = transition switch { "submit" => EY.HRPlatform.Performance.Domain.Notifications.PerformanceNotificationKind.PlanSubmitted,
            "return" => EY.HRPlatform.Performance.Domain.Notifications.PerformanceNotificationKind.PlanReturned,
            _ => EY.HRPlatform.Performance.Domain.Notifications.PerformanceNotificationKind.PlanApproved };
        var message = Assert.Single(check.OutboxMessages.Where(m => m.ResourceId == planId && m.Kind == notificationKind));
        Assert.Equal(transition == "submit" ? f.ManagerId : f.EmployeeId, message.RecipientEmployeeId);
        Assert.Null(message.DispatchedAt);
    }

    [Fact]
    public async Task A_changed_return_payload_is_not_a_successful_retry()
    {
        var f = await ArrangeAsync();
        await SubmitReadyPlanAsync(f);
        var planId = await LoadPlanIdAsync(f);
        await using (var db = f.Store.NewContext())
        {
            Assert.True((await new ReturnPlanHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db), new EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceNotifications(db)).Handle(new(f.CycleId, planId,
                new("Sharpen the outcome."), Manager(f.ManagerId)), default)).IsSuccess);
        }
        await using var retryDb = f.Store.NewContext();
        var changed = await new ReturnPlanHandler(retryDb, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(retryDb), new EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceNotifications(retryDb)).Handle(new(f.CycleId, planId,
            new("Different feedback") { ExpectedVersion = 1 }, Manager(f.ManagerId)), default);
        Assert.Equal("Performance.Stale", changed.Error.Code);
        Assert.Single(retryDb.PlanDecisions.Where(d => d.Kind == PlanDecisionKind.Returned));
    }
}

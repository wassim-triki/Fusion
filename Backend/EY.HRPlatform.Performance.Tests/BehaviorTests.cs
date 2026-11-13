using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Cycles;
using EY.HRPlatform.Performance.Features.Population;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>Setting up a year and launching it (D-57, D-91): who's in, what comes along, the year before ending.</summary>
public sealed class BehaviorTests
{
    private static readonly DateOnly Start = new(2026, 1, 1);
    private static readonly DateOnly End = new(2026, 12, 31);

    private static YearPlanInput Plan(DateOnly start, DateOnly end, IReadOnlyList<Guid>? dropped = null)
        => new(end.AddDays(-45), end.AddDays(-14), start.AddMonths(6), end.AddDays(-30), end.AddDays(-20), true, dropped ?? []);

    /// <summary>A planned draft year that runs from <paramref name="start"/> for a year.</summary>
    private static PerformanceCycle Draft(Guid tenant, string name, DateOnly start, IReadOnlyList<Guid>? dropped = null)
    {
        var end = start.AddYears(1).AddDays(-1);
        var cycle = PerformanceCycle.CreateDraft(tenant, name, start, end, start.AddDays(30));
        var plan = Plan(start, end, dropped);
        cycle.PlanYear(plan.ReviewOpensOn, plan.ResultsOutOn, plan.MidYearCheckInOn, plan.SelfReviewsDueOn, plan.CalibrationOn, plan.JoinersJoin,
            plan.DroppedCompanyGoalIds!);
        return cycle;
    }

    private static Task<SharedKernel.Results.Result<YearLaunchDto>> LaunchAsync(TestStore store, FakeCoreWorkforceClient workforce, Guid cycleId,
        uint version)
    {
        var db = store.NewContext();
        return new LaunchYearHandler(db, store.Tenant, new PopulationResolutionService(workforce), new TestPerformanceAudit(db), new PerformanceNotifications(db))
            .Handle(new LaunchYearCommand(cycleId, version, Guid.Empty), default);
    }

    private static async Task<uint> VersionAsync(TestStore store, Guid cycleId)
    {
        await using var db = store.NewContext();
        return (await db.Cycles.AsNoTracking().SingleAsync(c => c.Id == cycleId)).Version;
    }

    [Fact]
    public async Task Planning_deadline_defaults_from_the_tenant_settings_offset()
    {
        var store = TestStore.ForNewTenant();
        await using (var db = store.NewContext())
        {
            var settings = CycleSettings.CreateDefault(store.TenantId);
            settings.Update(MeasurementMethod.NumericTarget, 3, 6, planningDeadlineOffsetDays: 45, planAlignmentPolicy: PlanAlignmentPolicy.AtLeastOneConnected);
            db.CycleSettings.Add(settings);
            await db.SaveChangesAsync();
        }

        await using (var db = store.NewContext())
        {
            var created = await new CreateCycleHandler(db, store.Tenant).Handle(
                new CreateCycleCommand(new CreateCycleRequest("FY2026", Start, End, PlanningDeadline: null)), default);

            Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
            Assert.Equal(Start.AddDays(45), created.Value.PlanningDeadline);
        }
    }

    [Fact]
    public async Task A_year_set_up_keeps_its_steps_and_moments_in_order()
    {
        var store = TestStore.ForNewTenant();
        await using var db = store.NewContext();
        var created = await new CreateCycleHandler(db, store.Tenant).Handle(new CreateCycleCommand(
            new CreateCycleRequest("FY2026", Start, End, Start.AddDays(30)) { Plan = Plan(Start, End) }), default);
        Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
        var stored = await db.Cycles.AsNoTracking().SingleAsync();
        Assert.Equal(End.AddDays(-45), stored.ReviewOpensOn);
        Assert.Equal(End.AddDays(-14), stored.ResultsOutOn);

        // The review can't open before planning ends.
        var backwards = await new CreateCycleHandler(db, store.Tenant).Handle(new CreateCycleCommand(
            new CreateCycleRequest("FY2027", Start, End, Start.AddDays(30)) { Plan = Plan(Start, End) with { ReviewOpensOn = Start.AddDays(10) } }), default);
        Assert.True(backwards.IsFailure);
    }

    [Fact]
    public void Next_year_is_named_and_dated_a_year_on()
    {
        Assert.Equal("FY2028", YearSetup.NextName("FY2027"));
        Assert.Equal("Performance 2027–2028", YearSetup.NextName("Performance 2027–2027"));
        var last = new YearPlanDto("FY2027", new(2026, 4, 25), new(2027, 4, 24), new(2026, 5, 25), new(2027, 3, 1), new(2027, 4, 9),
            null, null, null, true, []);
        var next = YearSetup.Propose(last, new DateOnly(2027, 4, 10));
        Assert.Equal("FY2028", next.Name);
        Assert.Equal(new DateOnly(2027, 4, 25), next.StartDate);
        Assert.Equal(new DateOnly(2028, 3, 1), next.ReviewOpensOn);
    }

    [Fact]
    public async Task Launch_brings_everyone_in_core_hr_with_a_manager_and_freezes_a_snapshot()
    {
        var store = TestStore.ForNewTenant();
        var workforce = new FakeCoreWorkforceClient();
        var unit = Guid.NewGuid();
        var manager = Guid.NewGuid();
        workforce.Add("Amina", orgUnitId: unit, managerId: manager);
        workforce.Add("Rania", orgUnitId: unit); // no manager: left out, she can't be reviewed
        var cycle = Draft(store.TenantId, "FY2026", Start);
        await using (var db = store.NewContext())
        {
            db.CycleSettings.Add(CycleSettings.CreateDefault(store.TenantId));
            db.Cycles.Add(cycle);
            await db.SaveChangesAsync();
        }

        var launched = await LaunchAsync(store, workforce, cycle.Id, await VersionAsync(store, cycle.Id));

        Assert.True(launched.IsSuccess, launched.IsFailure ? launched.Error.Message : null);
        Assert.Equal(1, launched.Value.People);
        await using (var db = store.NewContext())
        {
            var active = await db.Cycles.Include(c => c.ActivationSnapshot).AsNoTracking().SingleAsync();
            Assert.Equal(CycleLifecycleState.Active, active.State);
            Assert.Equal(1, active.ActivationSnapshot!.ConfirmedParticipantCount);
            var participant = await db.Participants.AsNoTracking().SingleAsync();
            Assert.Equal(manager, participant.ManagerEmployeeId);
            Assert.Equal(ReviewerBasis.CoreManagerAtCycleStart, participant.ReviewerBasis);
            await AuditAssertions.RecordedAsync(db, "Cycle.Activated", cycle.Id, cycle.Id);
            // Everyone in is told, once.
            Assert.Single(await db.OutboxMessages.IgnoreQueryFilters().Where(m => m.Kind == Domain.Notifications.PerformanceNotificationKind.YearLaunched).ToListAsync());
        }
    }

    [Fact]
    public async Task A_year_without_its_steps_does_not_launch()
    {
        var store = TestStore.ForNewTenant();
        var workforce = new FakeCoreWorkforceClient();
        workforce.Add("Amina", orgUnitId: Guid.NewGuid(), managerId: Guid.NewGuid());
        var cycle = PerformanceCycle.CreateDraft(store.TenantId, "FY2026", Start, End, Start.AddDays(30));
        await using (var db = store.NewContext())
        {
            db.Cycles.Add(cycle);
            await db.SaveChangesAsync();
        }

        var launched = await LaunchAsync(store, workforce, cycle.Id, await VersionAsync(store, cycle.Id));

        Assert.True(launched.IsFailure);
        Assert.Equal(Features.Failures.PerformanceErrors.Codes.CycleNotActivatable, launched.Error.Code);
    }

    [Fact]
    public async Task Next_year_waits_while_this_one_is_still_running()
    {
        var store = TestStore.ForNewTenant();
        var workforce = new FakeCoreWorkforceClient();
        workforce.Add("Amina", orgUnitId: Guid.NewGuid(), managerId: Guid.NewGuid());
        var today = PerformanceClock.Today;
        var running = PerformanceCycle.CreateDraft(store.TenantId, "FY2026", today.AddDays(-100), today.AddDays(200), today.AddDays(-70)).Activated();
        var next = Draft(store.TenantId, "FY2027", today.AddDays(201));
        await using (var db = store.NewContext())
        {
            db.Cycles.AddRange(running, next);
            await db.SaveChangesAsync();
        }

        var launched = await LaunchAsync(store, workforce, next.Id, await VersionAsync(store, next.Id));

        Assert.True(launched.IsFailure);
        Assert.Contains("still running", launched.Error.Message, StringComparison.Ordinal);
        await using var check = store.NewContext();
        Assert.Equal(CycleLifecycleState.Active, (await check.Cycles.AsNoTracking().SingleAsync(c => c.Id == running.Id)).State);
    }

    [Fact]
    public async Task Launch_ends_last_year_and_carries_its_unfinished_goals_and_kept_company_goals()
    {
        var store = TestStore.ForNewTenant();
        var tenant = store.TenantId;
        var workforce = new FakeCoreWorkforceClient();
        var lina = workforce.Add("Lina", orgUnitId: Guid.NewGuid(), managerId: Guid.NewGuid()).EmployeeId;
        var nour = workforce.Add("Nour", orgUnitId: Guid.NewGuid(), managerId: lina).EmployeeId;
        var lastStart = new DateOnly(2025, 1, 1);
        var lastEnd = new DateOnly(2025, 12, 31);
        var last = PerformanceCycle.CreateDraft(tenant, "FY2025", lastStart, lastEnd, lastStart.AddDays(30)).Activated();
        var kept = Objective.CreateStrategic(tenant, last.Id, "Grow repeat business", null, lina, lastStart, lastEnd,
            ObjectiveMeasurement.NumericTarget(0m, 10m, "clients"), lastStart, lastEnd);
        kept.Publish();
        var dropped = Objective.CreateStrategic(tenant, last.Id, "Open the Sousse office", null, lina, lastStart, lastEnd,
            ObjectiveMeasurement.ManualPercentage(), lastStart, lastEnd);
        dropped.Publish();
        var participant = Participant.Create(tenant, last.Id, nour, "Nour", "Engineer", null, "Platform", lina, "Lina", false, lastStart);
        var plan = EmployeePlan.Create(tenant, last.Id, participant.Id, nour, "Nour", "Platform", lina, "Lina");
        var unfinished = Objective.CreateEmployee(tenant, last.Id, plan.Id, nour, "Automate the regression suite", null, null, lastStart, lastEnd,
            ObjectiveMeasurement.NumericTarget(20m, 85m, "%"), 50m, null, null, lastStart, lastEnd);
        unfinished.ApplyNumericActual(66m);
        var done = Objective.CreateEmployee(tenant, last.Id, plan.Id, nour, "Document the runbooks", null, null, lastStart, lastEnd,
            ObjectiveMeasurement.ManualPercentage(), 50m, null, null, lastStart, lastEnd);
        done.ApplyManualPercentage(100m);
        plan.Submit(nour, new PlanSubmissionFacts(2, true, 100m, true, false, PlanAlignmentPolicy.Optional));
        plan.Approve(lina);
        var next = Draft(tenant, "FY2026", Start, [dropped.Id]);
        await using (var db = store.NewContext())
        {
            db.Cycles.AddRange(last, next);
            db.Objectives.AddRange(kept, dropped, unfinished, done);
            db.Participants.Add(participant);
            db.EmployeePlans.Add(plan);
            await db.SaveChangesAsync();
        }

        var launched = await LaunchAsync(store, workforce, next.Id, await VersionAsync(store, next.Id));

        Assert.True(launched.IsSuccess, launched.IsFailure ? launched.Error.Message : null);
        Assert.Equal(last.Id, launched.Value.EndedCycleId);
        await using var check = store.NewContext();
        Assert.Equal(CycleLifecycleState.Closed, (await check.Cycles.AsNoTracking().SingleAsync(c => c.Id == last.Id)).State);
        // The kept company goal comes along as a draft; the dropped one stays behind.
        var company = await check.Objectives.AsNoTracking().Where(o => o.CycleId == next.Id && o.OwnershipScope == ObjectiveOwnershipScope.Company).ToListAsync();
        var carriedCompany = Assert.Single(company);
        Assert.Equal(kept.Id, carriedCompany.CarriedFromObjectiveId);
        Assert.Equal(ObjectiveLifecycleState.Draft, carriedCompany.State);
        // Nour's unfinished goal waits in his draft, picking up where it stood; the finished one doesn't come.
        var draftPlan = await check.EmployeePlans.AsNoTracking().SingleAsync(p => p.CycleId == next.Id);
        Assert.Equal(nour, draftPlan.EmployeeId);
        Assert.Equal(PlanLifecycleState.Draft, draftPlan.State);
        var goal = Assert.Single(await check.Objectives.AsNoTracking().Where(o => o.EmployeePlanId == draftPlan.Id).ToListAsync());
        Assert.Equal(unfinished.Id, goal.CarriedFromObjectiveId);
        Assert.Equal(66m, goal.Measurement!.Baseline);
        Assert.Equal(100m, goal.PlanWeight);
        Assert.Equal(1, launched.Value.CarriedGoals);
    }

    [Fact]
    public async Task Leave_out_rules_and_exceptions_by_name_decide_who_launches()
    {
        var store = TestStore.ForNewTenant();
        var workforce = new FakeCoreWorkforceClient();
        var company = Guid.NewGuid();
        var engineering = Guid.NewGuid();
        var platform = Guid.NewGuid(); // under Engineering
        var sales = Guid.NewGuid();
        workforce.OrgUnits[engineering] = new WorkforceOrgUnitContext(engineering, "Engineering", company, true, [company]);
        workforce.OrgUnits[platform] = new WorkforceOrgUnitContext(platform, "Platform", engineering, true, [engineering, company]);
        workforce.OrgUnits[sales] = new WorkforceOrgUnitContext(sales, "Sales", company, true, [company]);
        workforce.OrgUnits[company] = new WorkforceOrgUnitContext(company, "Carthage", null, true, []);
        var manager = Guid.NewGuid();
        WorkforceSnapshot In(string name, Guid unit, string unitName) => workforce.Add(name, orgUnitId: unit, orgUnitName: unitName, managerId: manager);
        In("Amina", sales, "Sales");
        workforce.Replace(In("Lotfi", sales, "Sales") with { EmploymentType = "Contractor" });
        var hela = workforce.Replace(In("Hela", sales, "Sales") with { EmploymentType = "contractor" });
        var wafa = workforce.Replace(In("Wafa", sales, "Sales") with { Leave = new WorkforceLeaveSnapshot(Start.AddDays(-10), Start.AddMonths(4), null, false) });
        var rim = In("Rim", platform, "Platform"); // in a unit under the ruled one
        var sana = In("Sana", sales, "Sales");
        workforce.Replace(In("Omar", sales, "Sales") with { EmploymentStart = Start.AddDays(-3) });
        var cycle = Draft(store.TenantId, "FY2026", Start);
        var definition = PopulationDefinition.Create(store.TenantId, cycle.Id, Start);
        definition.SetWhoIsIn(
            new[] { "employmentType:Contractor", "onLeave", $"unit:{engineering}", $"startedAfter:{Start.AddDays(-7):yyyy-MM-dd}" }.Select(LeaveOutRule.Parse),
            [(hela.EmployeeId, true, "Runs the finance close"), (sana.EmployeeId, false, "On secondment until June")]);
        await using (var db = store.NewContext())
        {
            db.CycleSettings.Add(CycleSettings.CreateDefault(store.TenantId));
            db.Cycles.Add(cycle);
            db.PopulationDefinitions.Add(definition);
            await db.SaveChangesAsync();
        }

        await using (var read = store.NewContext())
        {
            var setup = await new GetYearSetupHandler(read, store.Tenant, new PopulationResolutionService(workforce), workforce)
                .Handle(new GetYearSetupQuery(), default);
            Assert.True(setup.IsSuccess, setup.IsFailure ? setup.Error.Message : null);
            Assert.Equal(2, setup.Value.PeopleCount);
            Assert.Equal(7, setup.Value.Everyone.Count); // everyone who can be in, with their facts
            Assert.True(setup.Value.Everyone.Single(p => p.EmployeeId == wafa.EmployeeId).OnLeave);
            Assert.Equal(engineering, setup.Value.Everyone.Single(p => p.EmployeeId == rim.EmployeeId).DivisionId);
            Assert.Equal(["Sales", "Engineering"], setup.Value.Divisions.Select(d => d.Name));
            Assert.Equal(4, setup.Value.LeaveOut.Count);
            Assert.Contains(setup.Value.Exceptions, e => e.EmployeeId == hela.EmployeeId && e.In && e.Reason == "Runs the finance close");
        }

        var launched = await LaunchAsync(store, workforce, cycle.Id, await VersionAsync(store, cycle.Id));

        Assert.True(launched.IsSuccess, launched.IsFailure ? launched.Error.Message : null);
        await using var check = store.NewContext();
        var names = (await check.Participants.AsNoTracking().Select(p => p.DisplayName).ToListAsync()).Order().ToList();
        // Amina has no rule; Hela is a contractor brought in by name. Lotfi (contractor), Wafa (on leave on day one), Rim
        // (a unit under Engineering), Omar (started after the date) and Sana (out by name) stay out.
        Assert.Equal(["Amina", "Hela"], names);
    }

    [Fact]
    public async Task Saving_a_year_keeps_who_is_in_and_refuses_a_rule_it_cannot_read()
    {
        var store = TestStore.ForNewTenant();
        var end = Start.AddYears(1).AddDays(-1);
        var person = Guid.NewGuid();
        var plan = Plan(Start, end) with { WhoIsIn = new WhoIsInInput(["employmentType:Intern"], [new WhoIsInExceptionDto(person, false, "On secondment")]) };
        var created = await new CreateCycleHandler(store.NewContext(), store.Tenant)
            .Handle(new CreateCycleCommand(new CreateCycleRequest("FY2026", Start, end, Start.AddDays(30)) { Plan = plan }), default);
        Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
        await using (var db = store.NewContext())
        {
            var definition = await db.PopulationDefinitions.Include(d => d.Exclusions).AsNoTracking().SingleAsync();
            Assert.Equal(["employmentType:Intern"], definition.LeaveOut);
            Assert.Equal("On secondment", Assert.Single(definition.Exclusions).Reason);
        }

        var refused = await new UpdateCycleHandler(store.NewContext(), store.Tenant).Handle(new UpdateCycleCommand(created.Value.Id,
            new UpdateCycleRequest("FY2026", Start, end, Start.AddDays(30)) { ExpectedVersion = await VersionAsync(store, created.Value.Id),
                Plan = plan with { WhoIsIn = new WhoIsInInput(["salary:high"], []) } }), default);
        Assert.True(refused.IsFailure);
        Assert.Equal(Features.Failures.PerformanceErrors.Codes.CycleInvalid, refused.Error.Code);
    }

    [Fact]
    public async Task Setup_reads_last_years_goals_coming_along()
    {
        var store = TestStore.ForNewTenant();
        var tenant = store.TenantId;
        var workforce = new FakeCoreWorkforceClient();
        var lina = workforce.Add("Lina", orgUnitId: Guid.NewGuid(), managerId: Guid.NewGuid()).EmployeeId;
        var lastStart = new DateOnly(2025, 1, 1);
        var lastEnd = new DateOnly(2025, 12, 31);
        var last = PerformanceCycle.CreateDraft(tenant, "FY2025", lastStart, lastEnd, lastStart.AddDays(30)).Activated();
        var goal = Objective.CreateStrategic(tenant, last.Id, "Grow repeat business", null, lina, lastStart, lastEnd,
            ObjectiveMeasurement.ManualPercentage(), lastStart, lastEnd);
        goal.Publish();
        await using (var db = store.NewContext())
        {
            db.Cycles.Add(last);
            db.Objectives.Add(goal);
            await db.SaveChangesAsync();
        }

        await using var read = store.NewContext();
        var setup = await new GetYearSetupHandler(read, store.Tenant, new PopulationResolutionService(workforce), workforce).Handle(new GetYearSetupQuery(), default);

        Assert.True(setup.IsSuccess, setup.IsFailure ? setup.Error.Message : null);
        Assert.Null(setup.Value.DraftId);
        Assert.Equal("FY2026", setup.Value.Year.Name);
        Assert.Equal(lastStart.AddYears(1), setup.Value.Year.StartDate);
        Assert.Equal("FY2025", setup.Value.LastYearName);
        Assert.Null(setup.Value.LaunchBlocker); // last year ended on its own date
        Assert.Equal(1, setup.Value.PeopleCount);
        Assert.Equal(goal.Id, Assert.Single(setup.Value.CompanyGoals).Id);
    }

    [Fact]
    public async Task Cycles_are_tenant_isolated_and_fail_closed()
    {
        var store = TestStore.ForNewTenant();

        await using (var db = store.NewContext())
        {
            db.Cycles.Add(PerformanceCycle.CreateDraft(store.TenantId, "FY2026", Start, End, Start.AddDays(30)));
            await db.SaveChangesAsync();
            Assert.Single(await db.Cycles.ToListAsync());
        }

        // A different tenant sees nothing in the same store.
        await using (var db = store.NewContext(TestTenantContext.WithTenant(Guid.NewGuid())))
        {
            Assert.Empty(await db.Cycles.ToListAsync());
        }

        // An unresolved tenant context is fail-closed.
        await using (var db = store.NewContext(TestTenantContext.Unresolved()))
        {
            Assert.Empty(await db.Cycles.ToListAsync());
        }
    }
}

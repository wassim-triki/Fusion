using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Cycles;
using EY.HRPlatform.Performance.Features.Population;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

public sealed class BehaviorTests
{
    private static readonly DateOnly Start = new(2026, 1, 1);
    private static readonly DateOnly End = new(2026, 12, 31);

    private static async Task<(TestStore Store, FakeCoreWorkforceClient Workforce, Guid CycleId)> ArrangeAsync()
    {
        var store = TestStore.ForNewTenant();
        var cycle = PerformanceCycle.CreateDraft(store.TenantId, "FY2026", Start, End, Start.AddDays(30));
        await using var db = store.NewContext();
        db.Cycles.Add(cycle);
        await db.SaveChangesAsync();
        return (store, new FakeCoreWorkforceClient(), cycle.Id);
    }

    [Fact]
    public async Task Eligibility_is_resolved_as_of_the_cycle_start_date()
    {
        var (store, workforce, cycleId) = await ArrangeAsync();
        workforce.Add("Amina", orgUnitId: Guid.NewGuid());

        await using var db = store.NewContext();
        var result = await new GetPopulationHandler(db, store.Tenant, new PopulationResolutionService(workforce))
            .Handle(new GetPopulationQuery(cycleId), default);

        Assert.True(result.IsSuccess);
        Assert.Equal(Start.ToDateTime(TimeOnly.MinValue), workforce.LastAsOf);
        Assert.Single(result.Value.Candidates);
    }

    [Fact]
    public async Task Inclusion_cannot_override_invalid_employment_or_assignment()
    {
        var (store, workforce, cycleId) = await ArrangeAsync();
        workforce.Add("Amina", orgUnitId: Guid.NewGuid());
        workforce.AddIneligible("Ghost", inactive: true, noAssignment: true, out var ghostId);
        var resolver = new PopulationResolutionService(workforce);

        await using (var db = store.NewContext())
        {
            var set = await new SetPopulationHandler(db, store.Tenant, resolver).Handle(
                new SetPopulationCommand(cycleId, new SetPopulationRequest(PopulationMode.AllActive, [], [ghostId], [])), default);
            Assert.True(set.IsSuccess);
            var ghost = set.Value.Candidates.Single(candidate => candidate.EmployeeId == ghostId);
            Assert.False(ghost.IsEligible);
            Assert.False(ghost.CountsToRoster);
        }

        await using (var db = store.NewContext())
        {
            var confirm = await new ConfirmPopulationHandler(db, store.Tenant, resolver).Handle(
                new ConfirmPopulationCommand(cycleId), default);
            Assert.True(confirm.IsFailure);
            Assert.Contains("attention", confirm.Error.Message, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task Setting_scope_then_adding_units_on_an_existing_definition_persists()
    {
        var (store, workforce, cycleId) = await ArrangeAsync();
        var org = Guid.NewGuid();
        workforce.Add("Amina", orgUnitId: org);
        var resolver = new PopulationResolutionService(workforce);

        // GET first persists a default definition, so the next Set mutates an existing one.
        await using (var db = store.NewContext())
        {
            await new GetPopulationHandler(db, store.Tenant, resolver).Handle(new GetPopulationQuery(cycleId), default);
        }

        // Switching to ByScope with no units is a valid empty intermediate state.
        await using (var db = store.NewContext())
        {
            var empty = await new SetPopulationHandler(db, store.Tenant, resolver).Handle(
                new SetPopulationCommand(cycleId, new SetPopulationRequest(PopulationMode.ByScope, [], [], [])), default);
            Assert.True(empty.IsSuccess);
            Assert.Empty(empty.Value.Candidates);
        }

        // Then adding a unit to the existing definition must persist and resolve.
        await using (var db = store.NewContext())
        {
            var scoped = await new SetPopulationHandler(db, store.Tenant, resolver).Handle(
                new SetPopulationCommand(cycleId, new SetPopulationRequest(
                    PopulationMode.ByScope, [new OrgUnitSelectionInput(org, true)], [], [])), default);
            Assert.True(scoped.IsSuccess, scoped.IsFailure ? scoped.Error.Message : null);
            Assert.Single(scoped.Value.Candidates);
        }
    }

    [Fact]
    public async Task Activation_is_blocked_without_a_confirmed_population()
    {
        var (store, _, cycleId) = await ArrangeAsync();

        await using var db = store.NewContext();
        var result = await new ActivateCycleHandler(db, new TestPerformanceAudit(db)).Handle(new ActivateCycleCommand(cycleId), default);

        Assert.True(result.IsFailure);
        // Strategy is no longer a launch prerequisite; the population gate is what blocks here.
        Assert.Contains("population", result.Error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("strategic", result.Error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Activation_succeeds_without_any_published_strategy()
    {
        var (store, workforce, cycleId) = await ArrangeAsync();
        var resolver = new PopulationResolutionService(workforce);
        workforce.Add("Amina", orgUnitId: Guid.NewGuid(), managerId: Guid.NewGuid());

        await using (var db = store.NewContext())
        {
            await new SetPopulationHandler(db, store.Tenant, resolver).Handle(
                new SetPopulationCommand(cycleId, new SetPopulationRequest(PopulationMode.AllActive, [], [], [])), default);
        }
        await using (var db = store.NewContext())
        {
            var confirm = await new ConfirmPopulationHandler(db, store.Tenant, resolver).Handle(new ConfirmPopulationCommand(cycleId), default);
            Assert.True(confirm.IsSuccess, confirm.IsFailure ? confirm.Error.Message : null);
        }

        await using (var db = store.NewContext())
        {
            var activate = await new ActivateCycleHandler(db, new TestPerformanceAudit(db)).Handle(new ActivateCycleCommand(cycleId), default);
            Assert.True(activate.IsSuccess, activate.IsFailure ? activate.Error.Message : null);
            Assert.Equal(CycleLifecycleState.Active, activate.Value.Cycle.State);
            await AuditAssertions.RecordedAsync(db, "Cycle.Activated", cycleId, cycleId);
        }
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
    public async Task Moving_the_start_date_reopens_a_confirmed_population_and_drops_participants()
    {
        var (store, workforce, cycleId) = await ArrangeAsync();
        var resolver = new PopulationResolutionService(workforce);
        workforce.Add("Amina", orgUnitId: Guid.NewGuid(), managerId: Guid.NewGuid());

        await using (var db = store.NewContext())
        {
            await new SetPopulationHandler(db, store.Tenant, resolver).Handle(
                new SetPopulationCommand(cycleId, new SetPopulationRequest(PopulationMode.AllActive, [], [], [])), default);
        }
        await using (var db = store.NewContext())
        {
            var confirm = await new ConfirmPopulationHandler(db, store.Tenant, resolver).Handle(new ConfirmPopulationCommand(cycleId), default);
            Assert.True(confirm.IsSuccess, confirm.IsFailure ? confirm.Error.Message : null);
        }

        var newStart = Start.AddDays(7);
        await using (var db = store.NewContext())
        {
            var update = await new UpdateCycleHandler(db).Handle(
                new UpdateCycleCommand(cycleId, new UpdateCycleRequest("FY2026", newStart, End, newStart.AddDays(30))), default);
            Assert.True(update.IsSuccess, update.IsFailure ? update.Error.Message : null);
        }

        await using (var db = store.NewContext())
        {
            var definition = await db.PopulationDefinitions.AsNoTracking().FirstAsync(d => d.CycleId == cycleId);
            Assert.False(definition.IsConfirmed);
            Assert.Equal(newStart, definition.EligibilityDate);
            Assert.Empty(await db.Participants.AsNoTracking().Where(p => p.CycleId == cycleId).ToListAsync());
        }
    }

    [Fact]
    public async Task Editing_only_name_or_description_keeps_the_population_confirmed()
    {
        var (store, workforce, cycleId) = await ArrangeAsync();
        var resolver = new PopulationResolutionService(workforce);
        workforce.Add("Amina", orgUnitId: Guid.NewGuid(), managerId: Guid.NewGuid());

        await using (var db = store.NewContext())
        {
            await new SetPopulationHandler(db, store.Tenant, resolver).Handle(
                new SetPopulationCommand(cycleId, new SetPopulationRequest(PopulationMode.AllActive, [], [], [])), default);
        }
        await using (var db = store.NewContext())
        {
            await new ConfirmPopulationHandler(db, store.Tenant, resolver).Handle(new ConfirmPopulationCommand(cycleId), default);
        }

        await using (var db = store.NewContext())
        {
            var update = await new UpdateCycleHandler(db).Handle(
                new UpdateCycleCommand(cycleId, new UpdateCycleRequest("Renamed", Start, End, Start.AddDays(30), Description: "A new note")), default);
            Assert.True(update.IsSuccess, update.IsFailure ? update.Error.Message : null);
        }

        await using (var db = store.NewContext())
        {
            var definition = await db.PopulationDefinitions.AsNoTracking().FirstAsync(d => d.CycleId == cycleId);
            Assert.True(definition.IsConfirmed);
            Assert.Single(await db.Participants.AsNoTracking().Where(p => p.CycleId == cycleId).ToListAsync());
        }
    }

    [Fact]
    public async Task A_participant_without_a_manager_blocks_confirmation_until_excluded()
    {
        var (store, workforce, cycleId) = await ArrangeAsync();
        var resolver = new PopulationResolutionService(workforce);
        var org = Guid.NewGuid();
        var noManager = workforce.Add("Amina", orgUnitId: org, managerId: null);
        workforce.Add("Bilel", orgUnitId: org, managerId: Guid.NewGuid());

        await using (var db = store.NewContext())
        {
            var set = await new SetPopulationHandler(db, store.Tenant, resolver).Handle(
                new SetPopulationCommand(cycleId, new SetPopulationRequest(PopulationMode.AllActive, [], [], [])), default);
            Assert.True(set.IsSuccess);
            var amina = set.Value.Candidates.Single(c => c.EmployeeId == noManager.EmployeeId);
            Assert.False(amina.IsEligible);
            Assert.False(amina.CountsToRoster);
        }

        await using (var db = store.NewContext())
        {
            var confirm = await new ConfirmPopulationHandler(db, store.Tenant, resolver).Handle(new ConfirmPopulationCommand(cycleId), default);
            Assert.True(confirm.IsFailure);
            Assert.Contains("attention", confirm.Error.Message, StringComparison.OrdinalIgnoreCase);
        }

        // Excluding the reviewer-less participant with a reason clears the blocker.
        await using (var db = store.NewContext())
        {
            await new SetPopulationHandler(db, store.Tenant, resolver).Handle(
                new SetPopulationCommand(cycleId, new SetPopulationRequest(
                    PopulationMode.AllActive, [], [], [new ExclusionInput(noManager.EmployeeId, "No reviewer")])), default);
        }
        await using (var db = store.NewContext())
        {
            var confirm = await new ConfirmPopulationHandler(db, store.Tenant, resolver).Handle(new ConfirmPopulationCommand(cycleId), default);
            Assert.True(confirm.IsSuccess, confirm.IsFailure ? confirm.Error.Message : null);
        }
    }

    [Fact]
    public async Task An_inactive_manager_is_a_reviewer_issue_that_blocks_confirmation()
    {
        var (store, workforce, cycleId) = await ArrangeAsync();
        var resolver = new PopulationResolutionService(workforce);
        var org = Guid.NewGuid();
        var inactiveMgr = workforce.Add("Mila", orgUnitId: org, managerId: Guid.NewGuid(), managerActive: false);
        workforce.Add("Bilel", orgUnitId: org, managerId: Guid.NewGuid());

        await using (var db = store.NewContext())
        {
            var set = await new SetPopulationHandler(db, store.Tenant, resolver).Handle(
                new SetPopulationCommand(cycleId, new SetPopulationRequest(PopulationMode.AllActive, [], [], [])), default);
            Assert.True(set.IsSuccess);
            var mila = set.Value.Candidates.Single(c => c.EmployeeId == inactiveMgr.EmployeeId);
            Assert.False(mila.IsEligible);
            Assert.False(mila.HasValidReviewer);
            Assert.Contains(mila.Issues, i => i.Code == ReadinessIssueCode.InactiveManager && i.IsHard);
            // The manager is still named (with inactive state) so the surface can show who it is.
            Assert.NotNull(mila.ManagerDisplayName);
            Assert.False(mila.ManagerIsActive);
        }

        await using (var db = store.NewContext())
        {
            var confirm = await new ConfirmPopulationHandler(db, store.Tenant, resolver).Handle(new ConfirmPopulationCommand(cycleId), default);
            Assert.True(confirm.IsFailure);
        }
    }

    [Fact]
    public async Task A_self_referential_manager_is_not_a_valid_reviewer()
    {
        var (store, workforce, cycleId) = await ArrangeAsync();
        var resolver = new PopulationResolutionService(workforce);
        var selfMgr = workforce.Add("Sole", orgUnitId: Guid.NewGuid(), managerIsSelf: true);

        await using var db = store.NewContext();
        var set = await new SetPopulationHandler(db, store.Tenant, resolver).Handle(
            new SetPopulationCommand(cycleId, new SetPopulationRequest(PopulationMode.AllActive, [], [], [])), default);
        Assert.True(set.IsSuccess);
        var sole = set.Value.Candidates.Single(c => c.EmployeeId == selfMgr.EmployeeId);
        Assert.False(sole.IsEligible);
        Assert.False(sole.HasValidReviewer);
        Assert.Contains(sole.Issues, i => i.Code == ReadinessIssueCode.MissingManager);
        // A self-manager is not surfaced as a resolved reviewer.
        Assert.Null(sole.ManagerEmployeeId);
    }

    [Fact]
    public async Task Reviewer_coverage_counts_only_valid_reviewers_among_non_excluded()
    {
        var (store, workforce, cycleId) = await ArrangeAsync();
        var resolver = new PopulationResolutionService(workforce);
        var org = Guid.NewGuid();
        workforce.Add("Ready1", orgUnitId: org, managerId: Guid.NewGuid());
        workforce.Add("Ready2", orgUnitId: org, managerId: Guid.NewGuid());
        workforce.Add("BadReviewer", orgUnitId: org, managerId: Guid.NewGuid(), managerActive: false);
        var toExclude = workforce.Add("Contractor", orgUnitId: org, managerId: Guid.NewGuid());

        await using var db = store.NewContext();
        var set = await new SetPopulationHandler(db, store.Tenant, resolver).Handle(
            new SetPopulationCommand(cycleId, new SetPopulationRequest(
                PopulationMode.AllActive, [], [], [new ExclusionInput(toExclude.EmployeeId, "External contractor")])), default);
        Assert.True(set.IsSuccess);
        // 4 resolved, 1 excluded => 3 in scope; 2 have a valid reviewer (the inactive-manager one does not).
        Assert.Equal(3, set.Value.ReviewerRequiredCount);
        Assert.Equal(2, set.Value.ReviewerReadyCount);
        Assert.Equal(1, set.Value.ExcludedCount);
    }

    [Fact]
    public async Task Re_sending_an_equivalent_population_rule_preserves_confirmation()
    {
        var (store, workforce, cycleId) = await ArrangeAsync();
        var resolver = new PopulationResolutionService(workforce);
        var org = Guid.NewGuid();
        workforce.Add("Amina", orgUnitId: org, managerId: Guid.NewGuid());
        workforce.Add("Bilel", orgUnitId: org, managerId: Guid.NewGuid());

        await using (var db = store.NewContext())
        {
            await new SetPopulationHandler(db, store.Tenant, resolver).Handle(
                new SetPopulationCommand(cycleId, new SetPopulationRequest(
                    PopulationMode.ByScope, [new OrgUnitSelectionInput(org, true)], [], [])), default);
        }
        await using (var db = store.NewContext())
        {
            var confirm = await new ConfirmPopulationHandler(db, store.Tenant, resolver).Handle(new ConfirmPopulationCommand(cycleId), default);
            Assert.True(confirm.IsSuccess, confirm.IsFailure ? confirm.Error.Message : null);
        }

        // Re-send the same normalized rule: confirmation and the participant snapshot survive.
        await using (var db = store.NewContext())
        {
            var resent = await new SetPopulationHandler(db, store.Tenant, resolver).Handle(
                new SetPopulationCommand(cycleId, new SetPopulationRequest(
                    PopulationMode.ByScope, [new OrgUnitSelectionInput(org, true)], [], [])), default);
            Assert.True(resent.IsSuccess);
            Assert.True(resent.Value.Selection.IsConfirmed);
        }
        await using (var db = store.NewContext())
        {
            Assert.Equal(2, await db.Participants.CountAsync(p => p.CycleId == cycleId));
        }

        // A real change (drop descendant intent) reopens confirmation and clears the snapshot.
        await using (var db = store.NewContext())
        {
            var changed = await new SetPopulationHandler(db, store.Tenant, resolver).Handle(
                new SetPopulationCommand(cycleId, new SetPopulationRequest(
                    PopulationMode.ByScope, [new OrgUnitSelectionInput(org, false)], [], [])), default);
            Assert.True(changed.IsSuccess);
            Assert.False(changed.Value.Selection.IsConfirmed);
        }
        await using (var db = store.NewContext())
        {
            Assert.Equal(0, await db.Participants.CountAsync(p => p.CycleId == cycleId));
        }
    }

    [Fact]
    public async Task Full_setup_activates_and_freezes_an_immutable_snapshot()
    {
        var (store, workforce, cycleId) = await ArrangeAsync();
        var resolver = new PopulationResolutionService(workforce);
        var aminaUnit = Guid.NewGuid();
        var aminaManager = Guid.NewGuid();
        workforce.Add("Amina", orgUnitId: aminaUnit, managerId: aminaManager);

        // Settings + published strategy.
        await using (var db = store.NewContext())
        {
            db.CycleSettings.Add(CycleSettings.CreateDefault(store.TenantId));
            var strategy = Objective.CreateStrategic(store.TenantId, cycleId, "Grow revenue", null, Guid.NewGuid(),
                Start, End, ObjectiveMeasurement.NumericTarget(1000m, 1300m, "k€"), Start, End);
            strategy.Publish();
            db.Objectives.Add(strategy);
            await db.SaveChangesAsync();
        }

        // Population: one eligible employee, then confirm.
        await using (var db = store.NewContext())
        {
            await new SetPopulationHandler(db, store.Tenant, resolver).Handle(
                new SetPopulationCommand(cycleId, new SetPopulationRequest(PopulationMode.AllActive, [], [], [])), default);
        }
        await using (var db = store.NewContext())
        {
            var confirm = await new ConfirmPopulationHandler(db, store.Tenant, resolver).Handle(new ConfirmPopulationCommand(cycleId), default);
            Assert.True(confirm.IsSuccess);
        }

        // Confirmation records who reviews each participant, why, and as of when.
        await using (var db = store.NewContext())
        {
            var participant = await db.Participants.AsNoTracking().SingleAsync(p => p.CycleId == cycleId);
            Assert.Equal(aminaManager, participant.ManagerEmployeeId);
            Assert.Equal(ReviewerBasis.CoreManagerAtCycleStart, participant.ReviewerBasis);
            Assert.Equal(Start, participant.ReviewerAsOf);
        }

        // Activate.
        string frozenSettings;
        await using (var db = store.NewContext())
        {
            var activate = await new ActivateCycleHandler(db, new TestPerformanceAudit(db)).Handle(new ActivateCycleCommand(cycleId), default);
            Assert.True(activate.IsSuccess, activate.IsFailure ? activate.Error.Message : null);
            Assert.Equal(CycleLifecycleState.Active, activate.Value.Cycle.State);
            await AuditAssertions.RecordedAsync(db, "Cycle.Activated", cycleId, cycleId);
        }

        await using (var db = store.NewContext())
        {
            var activated = await db.Cycles.Include(c => c.ActivationSnapshot).AsNoTracking().FirstAsync(c => c.Id == cycleId);
            Assert.NotNull(activated.ActivationSnapshot);
            Assert.Equal(1, activated.ActivationSnapshot!.ConfirmedParticipantCount);
            frozenSettings = activated.ActivationSnapshot.SettingsJson;

            // The frozen roster carries identities and reviewer responsibility, not names only.
            using var roster = System.Text.Json.JsonDocument.Parse(activated.ActivationSnapshot.RosterJson);
            var entry = roster.RootElement.EnumerateArray().Single();
            Assert.Equal(aminaUnit, entry.GetProperty("OrgUnitId").GetGuid());
            Assert.Equal(aminaManager, entry.GetProperty("ReviewerEmployeeId").GetGuid());
            Assert.Equal("CoreManagerAtCycleStart", entry.GetProperty("ReviewerBasis").GetString());
            Assert.True(entry.TryGetProperty("EmployeeId", out _));
        }

        // Later settings change must not alter the frozen snapshot.
        await using (var db = store.NewContext())
        {
            var settings = await db.CycleSettings.FirstAsync();
            settings.Update(MeasurementMethod.ManualPercentage, 1, 2, 15, PlanAlignmentPolicy.EveryObjectiveConnected);
            await db.SaveChangesAsync();
        }

        await using (var db = store.NewContext())
        {
            var reread = await db.Cycles.Include(c => c.ActivationSnapshot).AsNoTracking().FirstAsync(c => c.Id == cycleId);
            Assert.Equal(frozenSettings, reread.ActivationSnapshot!.SettingsJson);
        }
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
    [Fact]
    public async Task Activation_retry_preserves_its_single_snapshot_even_with_an_old_version()
    {
        var (store, _, cycleId) = await ArrangeAsync();
        await using (var db = store.NewContext())
        {
            var cycle = await db.Cycles.FindAsync(cycleId);
            var snapshot = ActivationSnapshot.Capture(store.TenantId, cycleId, "FY2026", Start, End, Start.AddDays(30), Start, 1, "{}", "{}", "[]", "[]");
            cycle!.Activate(snapshot);
            db.Entry(snapshot).State = EntityState.Added;
            await db.SaveChangesAsync();
        }
        CycleDetailDto first;
        await using (var db = store.NewContext())
        {
            var result = await new ActivateCycleHandler(db, new TestPerformanceAudit(db)).Handle(new(cycleId), default);
            Assert.True(result.IsSuccess);
            first = result.Value;
        }
        await using (var db = store.NewContext())
        {
            var result = await new ActivateCycleHandler(db, new TestPerformanceAudit(db)).Handle(new(cycleId, 1), default);
            Assert.True(result.IsSuccess);
            Assert.Equal(System.Text.Json.JsonSerializer.Serialize(first), System.Text.Json.JsonSerializer.Serialize(result.Value));
            Assert.Single(await db.Set<ActivationSnapshot>().ToListAsync());
        }
    }
}

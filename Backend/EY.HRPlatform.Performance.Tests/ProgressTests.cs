using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Progress;
using EY.HRPlatform.Performance.Features.Goals;
using EY.HRPlatform.Performance.Features.Progress;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// Chunk D — measurement-specific append-only progress, required context, owner-only recording,
/// derived plan progress with the overachievement cap, and truthful calculated roll-up with coverage
/// distinct from progress. Domain math is exercised directly; the recording rules through the handler.
/// </summary>
public sealed class ProgressTests
{
    private static readonly DateOnly Start = new(2026, 1, 1);
    private static readonly DateOnly End = new(2026, 12, 31);

    // ── Measurement math ──────────────────────────────────────────────────

    [Fact]
    public void Numeric_progress_derives_from_actual_against_baseline_and_target()
    {
        // Decrease 24 → 12; an actual of 18 is halfway = 50%.
        var m = ObjectiveMeasurement.NumericTarget(24m, 12m, "hours");
        Assert.Equal(50m, m.DerivedProgress(null, 18m));
        // Reaching the target is 100%; beyond it overachieves past 100.
        Assert.Equal(100m, m.DerivedProgress(null, 12m));
        Assert.True(m.DerivedProgress(null, 6m) > 100m);
        // Never reported yields 0 (the caller treats it as missing).
        Assert.Equal(0m, m.DerivedProgress(null, null));
    }

    [Fact]
    public void Manual_progress_is_the_reported_percentage_and_floors_at_zero()
    {
        var m = ObjectiveMeasurement.ManualPercentage();
        Assert.Equal(40m, m.DerivedProgress(40m, null));
        Assert.Equal(0m, m.DerivedProgress(null, null));
    }

    [Fact]
    public void Plan_progress_caps_each_objective_at_100_but_preserves_overachievement_on_the_objective()
    {
        var tenant = Guid.NewGuid();
        var cycleId = Guid.NewGuid();
        var planId = Guid.NewGuid();
        var over = Objective.CreateEmployee(tenant, cycleId, planId, Guid.NewGuid(), "A", null, null, Start, End,
            ObjectiveMeasurement.NumericTarget(0m, 100m, "u"), 50m, null, null, Start, End);
        over.ApplyNumericActual(120m); // 120%
        var half = Objective.CreateEmployee(tenant, cycleId, planId, Guid.NewGuid(), "B", null, null, Start, End,
            ObjectiveMeasurement.ManualPercentage(), 50m, null, null, Start, End);
        half.ApplyManualPercentage(40m);

        // Objective keeps 120%; plan uses capped 100% * 0.5 + 40% * 0.5 = 70%.
        Assert.True(over.DerivedProgress > 100m);
        Assert.Equal(70m, ProgressCalc.PlanProgress([over, half]));
    }

    // ── Calculated roll-up & coverage ─────────────────────────────────────

    [Fact]
    public void Calculated_rollup_counts_only_contributors_and_a_missing_child_reduces_coverage_not_progress()
    {
        BuildCalculatedGraph(out var parent, out var childA, out var childB, out var alignedNonContributor);

        // childA (60%) reports 50%; childB (40%) never reports; the aligned non-contributor reports 100%.
        childA.ApplyManualPercentage(50m);
        alignedNonContributor.ApplyManualPercentage(100m);

        var graph = BuildGraph(parent, childA, childB, alignedNonContributor);
        var reported = ProgressCalc.For(parent, graph);

        // Progress = min(50,100)*0.6 = 30; the non-contributor is ignored; missing childB is not 0-counted.
        Assert.Equal(30m, reported.Progress);
        Assert.Equal(60m, reported.Coverage); // only childA reported
        Assert.True(reported.HasProgress);
    }

    [Fact]
    public void Aligned_but_unconfigured_child_never_rolls_into_a_calculated_parent()
    {
        BuildCalculatedGraph(out var parent, out var childA, out var childB, out var alignedNonContributor);
        alignedNonContributor.ApplyManualPercentage(100m); // aligned, not a contributor
        var graph = BuildGraph(parent, childA, childB, alignedNonContributor);

        var reported = ProgressCalc.For(parent, graph);
        Assert.Equal(0m, reported.Progress); // no configured contributor reported
        Assert.False(reported.HasProgress);
    }

    // ── Recording rules through the handler ───────────────────────────────

    private sealed record Fx(TestStore Store, FakeCoreWorkforceClient Workforce, Guid CycleId, Guid StrategicId, Guid OwnerId);

    private static async Task<Fx> ArrangeStrategicAsync(bool closed = false)
    {
        var store = TestStore.ForNewTenant();
        var workforce = new FakeCoreWorkforceClient();
        var owner = workforce.Add("Olga Owner");
        var cycle = PerformanceCycle.CreateDraft(store.TenantId, "FY2026", Start, End, Start.AddDays(30));
        var strategic = Objective.CreateStrategic(store.TenantId, cycle.Id, "Company goal", null, owner.EmployeeId,
            Start, End, ObjectiveMeasurement.ManualPercentage(), Start, End);
        strategic.Publish();

        await using (var db = store.NewContext())
        {
            db.Cycles.Add(cycle);
            db.Objectives.Add(strategic);
            await db.SaveChangesAsync();
            var tracked = await db.Cycles.FirstAsync();
            var snapshot = ActivationSnapshot.Capture(store.TenantId, cycle.Id, "FY2026", Start, End, Start.AddDays(30), Start, 1, "{}", "{}", "[]", "[]");
            tracked.Activate(snapshot);
            db.Entry(snapshot).State = EntityState.Added;
            if (closed) tracked.Close();
            await db.SaveChangesAsync();
        }
        return new Fx(store, workforce, cycle.Id, strategic.Id, owner.EmployeeId);
    }

    private static ProgressActorContext Owner(Guid id) => new(id, IsAdmin: false, CanReviewReports: false);

    private static Task<Result<ObjectiveProgressDto>> Submit(Fx f, PerformanceDbContext db, Guid objectiveId, SubmitProgressRequest req, ProgressActorContext actor)
        => new SubmitProgressHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db), new TestEvidenceStore(Guid.NewGuid()), new PerformanceNotifications(db)).Handle(new SubmitProgressCommand(f.CycleId, objectiveId, req, actor), default);

    private static SubmitProgressRequest Manual(decimal pct, string? context = null, bool correction = false)
        => new(pct, null, null, ObjectiveStatus.OnTrack, context, correction, null);

    [Theory]
    [InlineData(-1)]
    [InlineData(100.01)]
    [InlineData(150)]
    public async Task Invalid_manual_percentage_cannot_change_progress_or_append_history(decimal percentage)
    {
        var f = await ArrangeStrategicAsync();
        await using (var db = f.Store.NewContext()) Assert.True((await Submit(f, db, f.StrategicId, Manual(30m), Owner(f.OwnerId))).IsSuccess);
        await using (var db = f.Store.NewContext()) Assert.True((await Submit(f, db, f.StrategicId, Manual(percentage), Owner(f.OwnerId))).IsFailure);
        await using var verify = f.Store.NewContext();
        Assert.Equal(30m, (await verify.Objectives.SingleAsync(o => o.Id == f.StrategicId)).CurrentPercentage);
        Assert.Single(await verify.ProgressUpdates.ToListAsync());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(100)]
    public async Task Manual_percentage_accepts_both_inclusive_boundaries(decimal percentage)
    {
        var f = await ArrangeStrategicAsync();
        await using var db = f.Store.NewContext();
        Assert.True((await Submit(f, db, f.StrategicId, Manual(percentage), Owner(f.OwnerId))).IsSuccess);
    }

    [Fact]
    public void Direct_objective_progress_rejects_manual_overachievement()
    {
        var objective = Objective.CreateStrategic(Guid.NewGuid(), Guid.NewGuid(), "Direction", null, Guid.NewGuid(), Start, End, ObjectiveMeasurement.ManualPercentage(), Start, End);
        Assert.Throws<ArgumentOutOfRangeException>(() => objective.ApplyManualPercentage(100.01m));
        Assert.Null(objective.CurrentPercentage);
    }

    [Fact]
    public async Task Only_the_accountable_owner_records_progress()
    {
        var f = await ArrangeStrategicAsync();
        var stranger = Guid.NewGuid();
        await using var db = f.Store.NewContext();
        var result = await Submit(f, db, f.StrategicId, Manual(30m), Owner(stranger));
        Assert.True(result.IsFailure);
        Assert.Contains("Forbidden", result.Error.Code, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Progress_is_append_only_and_the_latest_update_sets_current_state()
    {
        var f = await ArrangeStrategicAsync();
        await using (var db = f.Store.NewContext())
            Assert.True((await Submit(f, db, f.StrategicId, Manual(30m), Owner(f.OwnerId))).IsSuccess);
        await using (var db = f.Store.NewContext())
        {
            var r = await Submit(f, db, f.StrategicId, Manual(55m), Owner(f.OwnerId));
            Assert.True(r.IsSuccess, r.IsFailure ? r.Error.Message : null);
            Assert.Equal(55m, r.Value.DerivedProgress);
            Assert.Equal(2, r.Value.History.Count); // both entries preserved
        }
    }

    [Fact]
    public async Task A_manual_decrease_requires_a_context_note()
    {
        var f = await ArrangeStrategicAsync();
        await using (var db = f.Store.NewContext())
            await Submit(f, db, f.StrategicId, Manual(60m), Owner(f.OwnerId));

        await using (var db = f.Store.NewContext())
        {
            var noContext = await Submit(f, db, f.StrategicId, Manual(40m), Owner(f.OwnerId));
            Assert.True(noContext.IsFailure);
        }
        await using (var db = f.Store.NewContext())
        {
            var withContext = await Submit(f, db, f.StrategicId, Manual(40m, "Scope was reduced after a re-plan."), Owner(f.OwnerId));
            Assert.True(withContext.IsSuccess, withContext.IsFailure ? withContext.Error.Message : null);
            Assert.Equal(40m, withContext.Value.DerivedProgress);
        }
    }

    [Fact]
    public async Task Progress_is_rejected_on_a_closed_cycle()
    {
        var f = await ArrangeStrategicAsync(closed: true);
        await using var db = f.Store.NewContext();
        var result = await Submit(f, db, f.StrategicId, Manual(30m), Owner(f.OwnerId));
        Assert.True(result.IsFailure);
        Assert.Contains("Closed", result.Error.Code, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Governing_manager_can_read_delegated_team_objective_progress_but_another_manager_cannot()
    {
        var store = TestStore.ForNewTenant();
        var workforce = new FakeCoreWorkforceClient();
        var teamId = Guid.NewGuid();
        var otherTeamId = Guid.NewGuid();
        var manager = workforce.Add("Mina Manager", orgUnitId: teamId, orgUnitName: "Talent");
        var owner = workforce.Add("Omar Owner", orgUnitId: teamId, orgUnitName: "Talent");
        var otherManager = workforce.Add("Other Manager", orgUnitId: otherTeamId, orgUnitName: "Finance");
        workforce.OrgUnits[teamId] = new WorkforceOrgUnitContext(teamId, "Talent", null, true, []);
        workforce.OrgUnits[otherTeamId] = new WorkforceOrgUnitContext(otherTeamId, "Finance", null, true, []);

        var cycle = PerformanceCycle.CreateDraft(store.TenantId, "FY2026", Start, End, Start.AddDays(30));
        var objective = Objective.CreateOrganizational(
            store.TenantId, cycle.Id, teamId, "Talent", "Grow leaders", null, owner.EmployeeId, null,
            Start, End, ObjectiveProgressSource.Direct, ObjectiveMeasurement.ManualPercentage(), null, null, Start, End);
        objective.Publish();
        objective.ApplyManualPercentage(35m);
        await using (var db = store.NewContext())
        {
            db.Cycles.Add(cycle);
            db.Objectives.Add(objective);
            await db.SaveChangesAsync();
        }

        await using var readDb = store.NewContext();
        var handler = new GetObjectiveProgressHandler(readDb, workforce);
        var governed = await handler.Handle(
            new GetObjectiveProgressQuery(cycle.Id, objective.Id,
                new ProgressActorContext(manager.EmployeeId, false, false, HasOrgManageGrant: true)), default);
        var outside = await handler.Handle(
            new GetObjectiveProgressQuery(cycle.Id, objective.Id,
                new ProgressActorContext(otherManager.EmployeeId, false, false, HasOrgManageGrant: true)), default);

        Assert.True(governed.IsSuccess, governed.IsFailure ? governed.Error.Message : null);
        Assert.Equal(35m, governed.Value.DerivedProgress);
        Assert.True(outside.IsFailure);
        Assert.Equal("Progress.ViewForbidden", outside.Error.Code);
    }

    // ── Graph builders ────────────────────────────────────────────────────

    private static void BuildCalculatedGraph(out Objective parent, out Objective childA, out Objective childB, out Objective alignedNonContributor)
    {
        var tenant = Guid.NewGuid();
        var cycleId = Guid.NewGuid();
        var strategicId = Guid.NewGuid();

        parent = Objective.CreateOrganizational(tenant, cycleId, Guid.NewGuid(), "Ops", "Excellence", null, Guid.NewGuid(), strategicId,
            Start, End, ObjectiveProgressSource.Calculated, null, Start, End, Start, End);
        childA = Objective.CreateOrganizational(tenant, cycleId, Guid.NewGuid(), "A", "A", null, Guid.NewGuid(), parent.Id,
            Start, End, ObjectiveProgressSource.Direct, ObjectiveMeasurement.ManualPercentage(), Start, End, Start, End);
        childB = Objective.CreateOrganizational(tenant, cycleId, Guid.NewGuid(), "B", "B", null, Guid.NewGuid(), parent.Id,
            Start, End, ObjectiveProgressSource.Direct, ObjectiveMeasurement.ManualPercentage(), Start, End, Start, End);
        alignedNonContributor = Objective.CreateOrganizational(tenant, cycleId, Guid.NewGuid(), "C", "C", null, Guid.NewGuid(), parent.Id,
            Start, End, ObjectiveProgressSource.Direct, ObjectiveMeasurement.ManualPercentage(), Start, End, Start, End);

        // Configure only A (60%) and B (40%) as contributors — C is aligned but not a contributor.
        parent.ConfigureContribution([(childA.Id, 60m), (childB.Id, 40m)]);
    }

    private static GoalsComposer.Graph BuildGraph(params Objective[] objectives)
        => new()
        {
            All = objectives,
            ById = objectives.ToDictionary(o => o.Id),
            ChildrenByParent = objectives.Where(o => o.ParentObjectiveId is not null).ToLookup(o => o.ParentObjectiveId!.Value),
            Names = new Dictionary<Guid, string>(),
        };
}

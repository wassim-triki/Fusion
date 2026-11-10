using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Population;

namespace EY.HRPlatform.Performance.Tests;

public sealed class DomainTests
{
    private static readonly Guid Tenant = Guid.NewGuid();
    private static readonly DateOnly Start = new(2026, 1, 1);
    private static readonly DateOnly End = new(2026, 12, 31);

    [Fact]
    public void Cycle_rejects_end_on_or_before_start()
    {
        var ex = Assert.Throws<ArgumentException>(() =>
            PerformanceCycle.CreateDraft(Tenant, "FY2026", End, Start, Start));
        Assert.Contains("end date", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Cycle_rejects_planning_deadline_outside_dates()
        => Assert.Throws<ArgumentException>(() =>
            PerformanceCycle.CreateDraft(Tenant, "FY2026", Start, End, End.AddDays(1)));

    [Fact]
    public void Activation_sets_single_active_slot_to_tenant()
    {
        var cycle = PerformanceCycle.CreateDraft(Tenant, "FY2026", Start, End, Start.AddDays(30));
        cycle.Activate(ActivationSnapshot.Capture(Tenant, cycle.Id, "FY2026", Start, End, Start.AddDays(30), Start, 1, "{}", "{}", "[]", "[]"));
        Assert.True(cycle.IsActive);
        Assert.Equal(Tenant, cycle.ActiveTenantSlot);
    }

    [Fact]
    public void Closing_clears_the_active_slot()
    {
        var cycle = PerformanceCycle.CreateDraft(Tenant, "FY2026", Start, End, Start.AddDays(30));
        cycle.Activate(ActivationSnapshot.Capture(Tenant, cycle.Id, "FY2026", Start, End, Start.AddDays(30), Start, 1, "{}", "{}", "[]", "[]"));
        cycle.Close();
        Assert.True(cycle.IsClosed);
        Assert.Null(cycle.ActiveTenantSlot);
    }

    [Fact]
    public void Numeric_measurement_rejects_equal_baseline_and_target()
        => Assert.Throws<ArgumentException>(() =>
            ObjectiveMeasurement.NumericTarget(100m, 100m, "%"));

    [Fact]
    public void Weighted_measurement_locks_only_at_100_percent()
    {
        var underweight = ObjectiveMeasurement.WeightedMilestones([
            ObjectiveMilestone.Create(Tenant, "A", 40m, null),
            ObjectiveMilestone.Create(Tenant, "B", 40m, null),
        ]);
        Assert.False(underweight.WeightsAreCompleteForLock());

        var complete = ObjectiveMeasurement.WeightedMilestones([
            ObjectiveMilestone.Create(Tenant, "A", 60m, null),
            ObjectiveMilestone.Create(Tenant, "B", 40m, null),
        ]);
        Assert.True(complete.WeightsAreCompleteForLock());
    }

    [Fact]
    public void Strategic_objective_rejects_dates_outside_cycle()
        => Assert.Throws<ArgumentException>(() =>
            Objective.CreateStrategic(Tenant, Guid.NewGuid(), "Grow", null, Guid.NewGuid(),
                Start.AddDays(-1), End, ObjectiveMeasurement.ManualPercentage(), Start, End));

    [Fact]
    public void Publishing_a_weighted_objective_below_100_is_blocked()
    {
        var objective = Objective.CreateStrategic(Tenant, Guid.NewGuid(), "Grow", null, Guid.NewGuid(),
            Start, End,
            ObjectiveMeasurement.WeightedMilestones([ObjectiveMilestone.Create(Tenant, "A", 40m, null)]),
            Start, End);
        Assert.Throws<InvalidOperationException>(objective.Publish);
    }

    [Fact]
    public void Publishing_transitions_draft_to_published()
    {
        var objective = Objective.CreateStrategic(Tenant, Guid.NewGuid(), "Grow", null, Guid.NewGuid(),
            Start, End, ObjectiveMeasurement.ManualPercentage(), Start, End);
        objective.Publish();
        Assert.Equal(ObjectiveLifecycleState.Published, objective.State);
        Assert.NotNull(objective.PublishedAt);
    }

    [Fact]
    public void Exclusion_requires_a_reason()
    {
        var definition = PopulationDefinition.Create(Tenant, Guid.NewGuid(), Start);
        Assert.Throws<InvalidOperationException>(() =>
            definition.SetSelection(PopulationMode.AllActive, [], [], [(Guid.NewGuid(), "  ")]));
    }

    [Fact]
    public void ByScope_allows_an_empty_intermediate_selection()
    {
        var definition = PopulationDefinition.Create(Tenant, Guid.NewGuid(), Start);
        definition.SetSelection(PopulationMode.ByScope, [], [], []);
        Assert.Equal(PopulationMode.ByScope, definition.Mode);
        Assert.Empty(definition.OrgUnitSelections);
    }
}

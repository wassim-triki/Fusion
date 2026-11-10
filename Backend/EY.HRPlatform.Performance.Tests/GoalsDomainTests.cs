using EY.HRPlatform.Performance.Domain.Objectives;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// Goals' bookkeeping (B-406 slice 4, D-38, D-40): a measure's direction from its numbers, weights shared evenly until
/// someone sets one and always totalling 100, and a goal's grade read from its measure.
/// </summary>
public sealed class GoalsDomainTests
{
    [Fact]
    public void A_numeric_measure_reads_its_direction_from_baseline_and_target()
    {
        var fewer = ObjectiveMeasurement.NumericTarget(25m, 15m, "incidents");
        Assert.Equal(ImprovementDirection.Decrease, fewer.Direction);
        Assert.Equal(50m, fewer.DerivedProgress(null, 20m));
        var more = ObjectiveMeasurement.NumericTarget(20m, 85m, "%");
        Assert.Equal(ImprovementDirection.Increase, more.Direction);
        Assert.Null(ObjectiveMeasurement.ManualPercentage().Direction);
        Assert.Throws<ArgumentException>(() => ObjectiveMeasurement.NumericTarget(10m, 10m, "%"));
    }

    [Fact]
    public void Unchosen_weights_share_what_the_chosen_ones_leave_and_always_total_the_rest_exactly()
    {
        Assert.Equal([33.33m, 33.33m, 33.34m], PlanWeights.Shares(100m, 3));
        Assert.Equal(100m, PlanWeights.Shares(100m, 7).Sum());
        Assert.Equal([20m, 20m], PlanWeights.Shares(40m, 2));
        Assert.Equal([0m, 0m], PlanWeights.Shares(-10m, 2));
        Assert.Empty(PlanWeights.Shares(100m, 0));
    }

    [Fact]
    public void Contributors_given_no_weight_share_what_the_weighted_ones_leave()
    {
        var start = new DateOnly(2026, 1, 1);
        var end = new DateOnly(2026, 12, 31);
        var parent = Objective.CreateOrganizational(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), "Ops", "Excellence", null, Guid.NewGuid(), Guid.NewGuid(),
            start, end, ObjectiveProgressSource.Calculated, null, start, end, start, end);
        Guid a = Guid.NewGuid(), b = Guid.NewGuid(), c = Guid.NewGuid();
        parent.ConfigureContribution([(a, 40m), (b, null), (c, null)]);
        Assert.Equal([40m, 30m, 30m], parent.ContributionLinks.Select(link => link.Weight));
        Assert.Equal(100m, parent.ContributionWeightTotal);
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(71.4, 0.71)]
    [InlineData(100, 1)]
    [InlineData(130, 1)]
    public void A_grade_is_the_share_of_the_measure_done_capped_at_one(decimal progress, decimal grade)
        => Assert.Equal(grade, GoalGrades.Of(progress));
}

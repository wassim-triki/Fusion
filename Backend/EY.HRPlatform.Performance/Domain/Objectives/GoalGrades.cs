namespace EY.HRPlatform.Performance.Domain.Objectives;

/// <summary>
/// A goal's grade, read from its measure (D-38): 0.0 to 1.0, the share of the measure done, capped at 1.0. A percent
/// measure grades its progress; baseline to target, the share of the way covered; milestones, the weighted share done.
/// All three are the measure's derived progress, so one rule serves them. Nobody rates a goal by hand.
/// </summary>
public static class GoalGrades
{
    public static decimal Of(Objective objective)
        => objective.HasProgress ? Of(objective.DerivedProgress) : 0m;

    public static decimal Of(decimal derivedProgress)
        => decimal.Round(Math.Clamp(derivedProgress / 100m, 0m, 1m), 2);

    /// <summary>The plan's grade: its goals' grades weighted by their plan weights, the D-25 attainment.</summary>
    public static decimal Plan(IReadOnlyCollection<Objective> planObjectives)
    {
        var weight = planObjectives.Sum(o => o.PlanWeight ?? 0m);
        if (weight <= 0m) return 0m;
        return decimal.Round(planObjectives.Sum(o => (o.PlanWeight ?? 0m) * Of(o)) / weight, 2);
    }
}

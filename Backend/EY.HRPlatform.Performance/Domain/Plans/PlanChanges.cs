namespace EY.HRPlatform.Performance.Domain.Plans;

/// <summary>One goal of a plan as its reviewer saw it when they returned the plan.</summary>
public sealed record PlanGoalSnapshot(Guid Id, string Title, string Measure, decimal? Weight);

/// <summary>A field of a goal that changed since the return, with its value then and now.</summary>
public sealed record PlanGoalFieldChange(string Field, string? Before, string? After);

/// <summary>A goal added, removed or changed since the reviewer returned the plan.</summary>
public sealed record PlanGoalChange(Guid ObjectiveId, string Title, string Kind, IReadOnlyList<PlanGoalFieldChange> Fields);

/// <summary>
/// What changed in a plan since its reviewer returned it, so approving a resubmitted plan reads the difference, not the
/// whole plan again (B-406): goals added, removed, and changed in their title, measure or weight.
/// </summary>
public static class PlanChanges
{
    public const string Added = "added";
    public const string Removed = "removed";
    public const string Changed = "changed";

    public const string Title = "title";
    public const string Measure = "measure";
    public const string Weight = "weight";

    public static IReadOnlyList<PlanGoalChange> Since(IReadOnlyList<PlanGoalSnapshot> then, IReadOnlyList<PlanGoalSnapshot> now)
    {
        var before = then.ToDictionary(goal => goal.Id);
        var changes = new List<PlanGoalChange>();
        foreach (var goal in now)
        {
            if (!before.TryGetValue(goal.Id, out var old))
            {
                changes.Add(new(goal.Id, goal.Title, Added, []));
                continue;
            }
            var fields = new List<PlanGoalFieldChange>();
            if (old.Title != goal.Title) fields.Add(new(Title, old.Title, goal.Title));
            if (old.Measure != goal.Measure) fields.Add(new(Measure, old.Measure, goal.Measure));
            if (old.Weight != goal.Weight) fields.Add(new(Weight, Percent(old.Weight), Percent(goal.Weight)));
            if (fields.Count > 0) changes.Add(new(goal.Id, goal.Title, Changed, fields));
        }
        var kept = now.Select(goal => goal.Id).ToHashSet();
        changes.AddRange(then.Where(goal => !kept.Contains(goal.Id)).Select(goal => new PlanGoalChange(goal.Id, goal.Title, Removed, [])));
        return changes;
    }

    private static string? Percent(decimal? weight) => weight is decimal value ? $"{value.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture)}%" : null;
}

namespace EY.HRPlatform.Performance.Domain.Objectives;

/// <summary>
/// A directly-measured objective's measurement configuration — exactly one of the three
/// methods. This is an owned value on <see cref="Objective"/>. Chunk A configures it for
/// strategic objectives; the same value object serves organizational (Chunk B) and
/// employee (Chunk C) objectives. Progress derivation and post-lock immutability enforcement
/// arrive with the chunks that record progress; the configuration invariants live here.
/// </summary>
public sealed class ObjectiveMeasurement
{
    private readonly List<ObjectiveMilestone> _milestones = [];

    private ObjectiveMeasurement() { }

    public MeasurementMethod Method { get; private set; }

    // Numeric target.
    public decimal? Baseline { get; private set; }
    public decimal? Target { get; private set; }
    public string? Unit { get; private set; }

    /// <summary>
    /// Which way the number should move, read from the numbers (D-40): down when the target is below the baseline,
    /// else up. Nobody picks it; only a numeric measure has one.
    /// </summary>
    public ImprovementDirection? Direction => Method == MeasurementMethod.NumericTarget && Baseline is decimal baseline && Target is decimal target
        ? target < baseline ? ImprovementDirection.Decrease : ImprovementDirection.Increase
        : null;

    // Weighted milestones.
    public IReadOnlyList<ObjectiveMilestone> Milestones => _milestones;

    public static ObjectiveMeasurement ManualPercentage()
        => new() { Method = MeasurementMethod.ManualPercentage };

    public static ObjectiveMeasurement NumericTarget(
        decimal baseline,
        decimal target,
        string unit)
    {
        if (string.IsNullOrWhiteSpace(unit))
            throw new ArgumentException("A numeric-target measurement requires a unit.", nameof(unit));

        if (baseline == target)
            throw new ArgumentException("A numeric-target baseline and target must differ.", nameof(target));

        return new ObjectiveMeasurement
        {
            Method = MeasurementMethod.NumericTarget,
            Baseline = baseline,
            Target = target,
            Unit = unit.Trim(),
        };
    }

    public static ObjectiveMeasurement WeightedMilestones(IEnumerable<ObjectiveMilestone> milestones)
    {
        var list = milestones?.ToList() ?? [];
        if (list.Count == 0)
            throw new ArgumentException("A weighted-milestones measurement requires at least one milestone.", nameof(milestones));

        var measurement = new ObjectiveMeasurement { Method = MeasurementMethod.WeightedMilestones };
        measurement._milestones.AddRange(list);
        return measurement;
    }

    /// <summary>
    /// The measure carried into next year (D-57), picking up where it stood: a number starts from where it reached, the
    /// milestones keep what's done but lose last year's due dates. A percent measure starts again.
    /// </summary>
    public ObjectiveMeasurement CarriedOn(Guid tenantId, decimal? currentActual)
    {
        switch (Method)
        {
            case MeasurementMethod.NumericTarget:
                var from = currentActual is decimal actual && actual != Target ? actual : Baseline!.Value;
                return NumericTarget(from, Target!.Value, Unit!);
            case MeasurementMethod.WeightedMilestones:
                return WeightedMilestones(_milestones.Select(milestone =>
                {
                    var copy = ObjectiveMilestone.Create(tenantId, milestone.Title, milestone.Weight, null);
                    if (milestone.IsCompleted) copy.SetCompleted(true);
                    return copy;
                }));
            default:
                return ManualPercentage();
        }
    }

    /// <summary>
    /// Whether milestone weights total exactly 100%. A weighted-milestones objective may
    /// only lock (publish/approve) when this holds; other methods are always ready.
    /// </summary>
    public bool WeightsAreCompleteForLock()
        => Method != MeasurementMethod.WeightedMilestones
            || _milestones.Sum(milestone => milestone.Weight) == 100m;

    /// <summary>
    /// The current derived completion percentage from configuration alone (no progress
    /// recorded yet). Manual and numeric start at 0%; weighted reflects completed weight.
    /// Progress recording in later chunks supersedes this for live values.
    /// </summary>
    public decimal DerivedProgressFloor()
        => Method == MeasurementMethod.WeightedMilestones
            ? _milestones.Where(milestone => milestone.IsCompleted).Sum(milestone => milestone.Weight)
            : 0m;

    /// <summary>Toggles a milestone's completion by id; returns whether the milestone was found.</summary>
    public bool ToggleMilestone(Guid milestoneId, bool completed)
    {
        var milestone = _milestones.FirstOrDefault(item => item.Id == milestoneId);
        if (milestone is null) return false;
        milestone.SetCompleted(completed);
        return true;
    }

    /// <summary>
    /// The derived progress percentage from the recorded current state (product-spec §27,
    /// performance-objective-measurement). Manual returns the recorded percentage; numeric derives
    /// from the current actual against baseline/target honoring direction (floored at 0, may exceed
    /// 100%); weighted sums completed milestone weights. A null current value yields 0 — the caller
    /// distinguishes "never reported" (missing) from a reported 0.
    /// </summary>
    public decimal DerivedProgress(decimal? currentPercentage, decimal? currentActual)
    {
        switch (Method)
        {
            case MeasurementMethod.ManualPercentage:
                return currentPercentage is null ? 0m : Math.Max(0m, currentPercentage.Value);

            case MeasurementMethod.NumericTarget:
                if (currentActual is null || Baseline is null || Target is null) return 0m;
                var span = Direction == ImprovementDirection.Decrease ? Baseline.Value - Target.Value : Target.Value - Baseline.Value;
                if (span == 0m) return 0m;
                var achieved = Direction == ImprovementDirection.Decrease ? Baseline.Value - currentActual.Value : currentActual.Value - Baseline.Value;
                var pct = achieved / span * 100m;
                return Math.Max(0m, decimal.Round(pct, 2));

            case MeasurementMethod.WeightedMilestones:
                return _milestones.Where(milestone => milestone.IsCompleted).Sum(milestone => milestone.Weight);

            default:
                return 0m;
        }
    }
}

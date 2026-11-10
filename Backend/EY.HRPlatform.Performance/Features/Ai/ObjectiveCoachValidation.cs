using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Models;

namespace EY.HRPlatform.Performance.Features.Ai;

/// <summary>
/// Keeps only suggestions the composer could save (D7): a changed title within the title limit, a
/// measure the measurement domain accepts, and a parent from the allowed targets. Everything else is
/// dropped silently; the author never sees a suggestion that would fail on save.
/// </summary>
public static class ObjectiveCoachValidation
{
    public const int TitleMax = 300;

    public static ObjectiveCoachResultDto Validate(
        CoachAnswer answer,
        string draftTitle,
        ObjectiveCoachRequest request,
        IReadOnlyDictionary<string, AlignmentTargetDto> allowedByKey,
        Guid tenantId)
    {
        var title = ValidTitle(answer.Title, draftTitle);
        var measure = ValidMeasure(answer.Measure, request.Measurement, tenantId);
        var parent = ValidParent(answer.Parent, allowedByKey, request.ParentObjectiveId);
        var outcome = title is null && measure is null && parent is null
            ? ObjectiveCoachOutcome.NothingToSuggest
            : ObjectiveCoachOutcome.Suggested;
        return new ObjectiveCoachResultDto(outcome, title, measure, parent);
    }

    /// <summary>How many parts the provider suggested that validation dropped (telemetry only).</summary>
    public static int Rejected(CoachAnswer answer, ObjectiveCoachResultDto result)
        => (answer.Title.Disposition == CoachDisposition.Suggest && result.Title is null ? 1 : 0)
            + (answer.Measure.Disposition == CoachDisposition.Suggest && result.Measure is null ? 1 : 0)
            + (answer.Parent?.Disposition == CoachDisposition.Suggest && result.ParentObjectiveId is null ? 1 : 0);

    private static string? ValidTitle(CoachTitleAnswer part, string draftTitle)
    {
        if (part.Disposition != CoachDisposition.Suggest) return null;
        var text = part.Text?.Trim();
        if (string.IsNullOrEmpty(text) || text.Length > TitleMax) return null;
        return Normalize(text) == Normalize(draftTitle) ? null : text;
    }

    private static Guid? ValidParent(CoachParentAnswer? part, IReadOnlyDictionary<string, AlignmentTargetDto> allowedByKey, Guid? currentParent)
    {
        if (part is not { Disposition: CoachDisposition.Suggest, TargetKey: { } key }) return null;
        if (!allowedByKey.TryGetValue(key, out var target)) return null;
        return target.Id == currentParent ? null : target.Id;
    }

    private static CoachMeasureDto? ValidMeasure(CoachMeasureAnswer part, MeasurementInput? draft, Guid tenantId)
    {
        if (part.Disposition != CoachDisposition.Suggest) return null;
        CoachMeasureDto? candidate = part.Method switch
        {
            "numericTarget" => Numeric(part),
            "weightedMilestones" => Milestones(part, tenantId),
            // Manual percentage is only a fallback for a draft that has no measure yet.
            "manualPercentage" when draft is null => new CoachMeasureDto(MeasurementMethod.ManualPercentage, null, null, null, null, null),
            _ => null,
        };
        return candidate is null || SameAs(candidate, draft) ? null : candidate;
    }

    private static CoachMeasureDto? Numeric(CoachMeasureAnswer part)
    {
        var unit = part.Unit?.Trim();
        ImprovementDirection? direction = part.Direction switch
        {
            "increase" => ImprovementDirection.Increase,
            "decrease" => ImprovementDirection.Decrease,
            _ => null,
        };
        if (part.Target is not { } target || string.IsNullOrEmpty(unit) || unit.Length > 40 || direction is null) return null;
        // The baseline is a fact only the author knows; check the measure with a stand-in that differs.
        var baseline = part.Baseline ?? (direction == ImprovementDirection.Increase ? target - 1 : target + 1);
        try
        {
            ObjectiveMeasurement.NumericTarget(baseline, target, unit);
        }
        catch (ArgumentException)
        {
            return null;
        }
        return new CoachMeasureDto(MeasurementMethod.NumericTarget, part.Baseline, target, unit, direction, null);
    }

    private static CoachMeasureDto? Milestones(CoachMeasureAnswer part, Guid tenantId)
    {
        var rows = part.Milestones?
            .Select(milestone => new CoachMilestoneDto(milestone.Title.Trim(), milestone.Weight))
            .ToList();
        if (rows is not { Count: > 0 and <= ObjectiveCoachVersions.MaxMilestones }) return null;
        if (rows.Any(row => row.Title.Length is 0 or > TitleMax || row.Weight <= 0 || row.Weight > 100)) return null;
        if (rows.Sum(row => row.Weight) != 100m) return null;
        try
        {
            ObjectiveMeasurement.WeightedMilestones(rows.Select(row => ObjectiveMilestone.Create(tenantId, row.Title, row.Weight, null)));
        }
        catch (ArgumentException)
        {
            return null;
        }
        return new CoachMeasureDto(MeasurementMethod.WeightedMilestones, null, null, null, null, rows);
    }

    private static bool SameAs(CoachMeasureDto candidate, MeasurementInput? draft)
    {
        if (draft is null || draft.Method != candidate.Method) return false;
        return candidate.Method switch
        {
            MeasurementMethod.ManualPercentage => true,
            MeasurementMethod.NumericTarget => draft.Target == candidate.Target
                && string.Equals(draft.Unit?.Trim(), candidate.Unit, StringComparison.OrdinalIgnoreCase)
                && (candidate.Baseline is null || draft.Baseline == candidate.Baseline),
            MeasurementMethod.WeightedMilestones => (draft.Milestones ?? [])
                .Select(milestone => (Normalize(milestone.Title), milestone.Weight))
                .SequenceEqual(candidate.Milestones!.Select(milestone => (Normalize(milestone.Title), milestone.Weight))),
            _ => false,
        };
    }

    private static string Normalize(string text)
        => string.Join(' ', text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).ToUpperInvariant();
}

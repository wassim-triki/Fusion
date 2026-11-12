using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Population;
using EY.HRPlatform.Performance.Models;

namespace EY.HRPlatform.Performance.Features;

/// <summary>Domain → contract projections shared by the query handlers.</summary>
public static class PerformanceMappers
{
    public static CycleSummaryDto ToSummary(PerformanceCycle cycle)
        => new(cycle.Id, cycle.Name, cycle.Description, cycle.StartDate, cycle.EndDate, cycle.PlanningDeadline, cycle.State, cycle.ActivatedAt) { Version = cycle.Version };

    public static CycleSettingsDto ToDto(CycleSettings settings, IReadOnlyList<int> scale)
    {
        var bands = Calibration.CalibrationSessions.BandsFor(settings, scale);
        var custom = settings.NineBoxLowTop == bands.LowTop && settings.NineBoxMidTop == bands.MidTop;
        return ToDto(settings) with { NineBoxBands = new NineBoxBandsDto(bands.LowTop, bands.MidTop, custom) };
    }

    public static CycleSettingsDto ToDto(CycleSettings settings)
        => new(
            settings.DefaultMeasurementMethod,
            settings.SuggestedObjectiveCountMin,
            settings.SuggestedObjectiveCountMax,
            settings.PlanningDeadlineOffsetDays,
            settings.PlanAlignmentPolicy,
            settings.DefaultSelfAssessmentEnabled,
            settings.DefaultObjectiveRatingsEnabled,
              settings.DefaultCalibrationEnabled,
              settings.EvidenceRetentionMonths,
              settings.AiAssistanceEnabled) {
                  Version = settings.Version, DefaultOneOnOneCadence = settings.DefaultOneOnOneCadence,
                  SelfAssessmentDueDays = settings.SelfAssessmentDueDays, PeerInputDueDays = settings.PeerInputDueDays,
                  ManagerAssessmentDueDays = settings.ManagerAssessmentDueDays,
                  AcknowledgementReminderDays = settings.AcknowledgementReminderDays,
              };

    public static MeasurementDto ToDto(ObjectiveMeasurement measurement)
        => new(
            measurement.Method,
            measurement.Baseline,
            measurement.Target,
            measurement.Unit,
            measurement.Direction,
            measurement.Milestones
                .Select(milestone => new MilestoneDto(milestone.Id, milestone.Title, milestone.Weight, milestone.DueDate, milestone.IsCompleted))
                .ToList());

    public static StrategicObjectiveDto ToDto(Objective objective, string? accountableName)
        => new(
            objective.Id,
            objective.Title,
            objective.Description,
            objective.AccountablePersonId,
            accountableName,
            objective.StartDate,
            objective.EndDate,
            objective.State,
            objective.PublishedAt,
            ToDto(objective.Measurement!)) { Version = objective.Version };

    public static MeasurementDto? ToDtoOrNull(ObjectiveMeasurement? measurement)
        => measurement is null ? null : ToDto(measurement);

    /// <summary>A one-line human summary of an objective's progress source for compact node display.</summary>
    public static string MeasurementSummary(Objective objective)
    {
        if (objective.ProgressSource == ObjectiveProgressSource.Calculated)
        {
            var contributors = objective.ContributionLinks.Count;
            return contributors == 0
                ? "Calculated · contributors not set"
                : $"Calculated · {contributors} contributor{(contributors == 1 ? "" : "s")}";
        }

        var measurement = objective.Measurement;
        if (measurement is null) return "Direct measurement";
        return measurement.Method switch
        {
            MeasurementMethod.NumericTarget =>
                $"{Trim(measurement.Baseline)} → {Trim(measurement.Target)} {measurement.Unit}".Trim(),
            MeasurementMethod.WeightedMilestones =>
                $"{measurement.Milestones.Count} milestone{(measurement.Milestones.Count == 1 ? "" : "s")}",
            _ => "Manual percentage",
        };
    }

    /// <summary>Formats a measurement number without trailing zeros (1200.0000 → "1200").</summary>
    private static string Trim(decimal? value)
        => value?.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture) ?? "?";

    public static ObjectiveMeasurement ToMeasurement(MeasurementInput input, Guid tenantId)
        => input.Method switch
        {
            MeasurementMethod.ManualPercentage => ObjectiveMeasurement.ManualPercentage(),
            MeasurementMethod.NumericTarget => ObjectiveMeasurement.NumericTarget(
                input.Baseline ?? throw new ArgumentException("A numeric-target measurement requires a baseline."),
                input.Target ?? throw new ArgumentException("A numeric-target measurement requires a target."),
                input.Unit ?? throw new ArgumentException("A numeric-target measurement requires a unit.")),
            MeasurementMethod.WeightedMilestones => ObjectiveMeasurement.WeightedMilestones(
                (input.Milestones ?? []).Select(milestone =>
                    ObjectiveMilestone.Create(tenantId, milestone.Title, milestone.Weight, milestone.DueDate))),
            _ => throw new ArgumentOutOfRangeException(nameof(input), "Unsupported measurement method."),
        };
}

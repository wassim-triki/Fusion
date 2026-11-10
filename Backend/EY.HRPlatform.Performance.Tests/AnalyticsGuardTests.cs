using System.Reflection;
using System.Text.RegularExpressions;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// Progress is never averaged across objectives or people (performance-contextual-analytics). Every
/// projection Performance serves is a record named *Dto; none may carry an average-like figure.
/// </summary>
public sealed class AnalyticsGuardTests
{
    private static readonly Regex AverageLike = new("average|avg|mean(?!ing)", RegexOptions.IgnoreCase);

    /// <summary>Calibration insights (D-25), facilitators only: a reviewer's average rating against the session's.</summary>
    private static readonly HashSet<string> CalibrationInsights = ["CalibrationDistributionViewDto", "CalibrationManagerDto"];

    [Fact]
    public void No_Performance_projection_exposes_an_averaged_figure()
    {
        var offenders = typeof(EY.HRPlatform.Performance.Models.YearDto).Assembly.GetTypes()
            .Where(type => type.Name.EndsWith("Dto", StringComparison.Ordinal) && !CalibrationInsights.Contains(type.Name))
            .SelectMany(type => type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Where(property => AverageLike.IsMatch(property.Name))
                .Select(property => $"{type.Name}.{property.Name}"))
            .ToList();

        Assert.True(offenders.Count == 0, $"Averaged figures found: {string.Join(", ", offenders)}");
    }
}

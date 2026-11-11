namespace EY.HRPlatform.Performance.Domain.Calibration;

/// <summary>One arrived review as the flags see it: the manager's rating, the plan's goal grade (0 to 1, D-38) and the last result.</summary>
public sealed record FlagInput(Guid ReviewId, Guid ReviewerId, string ReviewerName, int Rating, decimal? Grade, InsightLastResult? Last);

/// <summary>The person's most recent released result in an earlier cycle, with the size of the scale it used.</summary>
public sealed record InsightLastResult(int Rating, int ScaleLevels, string CycleName);

public enum CalibrationFlagKind { Goals, Moved, RatesHigh, RatesLow }

/// <summary>Why a review is worth a look, as facts the page words and draws (D-70).</summary>
public sealed record CalibrationFlag(CalibrationFlagKind Kind, decimal? Grade = null, decimal? ManagerAverage = null, int? ManagerReviews = null,
    decimal? EveryoneAverage = null, int? EveryoneReviews = null, int? LastRating = null, string? LastCycle = null);

/// <summary>
/// Calibration by exception (D-35): computed from recorded data on each read, never by AI and never stored. Each flag
/// reads the manager's own rating, so a decision never makes its reason vanish. A review carries at most one flag, the
/// first that applies: its rating against its goals' grade, a move of two levels since the last result, then a manager
/// who rates far from everyone (only their top- or bottom-band reviews, the ones the lean could have placed there).
/// </summary>
public static class CalibrationFlags
{
    public const decimal GradeHigh = 0.8m;
    public const decimal GradeLow = 0.5m;
    public const decimal LeanDistance = 0.75m;
    public const int LeanMinimumReviews = 3;
    public const int MoveLevels = 2;

    public static IReadOnlyDictionary<Guid, CalibrationFlag> Compute(IReadOnlyList<FlagInput> reviews, NineBoxBands bands, int scaleLevels)
    {
        var flags = new Dictionary<Guid, CalibrationFlag>();
        if (reviews.Count == 0) return flags;
        var everyone = reviews.Average(r => (decimal)r.Rating);
        var managers = reviews.GroupBy(r => r.ReviewerId).ToDictionary(g => g.Key, g => (Average: g.Average(r => (decimal)r.Rating), Count: g.Count()));
        foreach (var review in reviews)
        {
            var band = bands.BandOf(review.Rating);
            CalibrationFlag? flag = null;
            if (review.Grade is decimal grade && (band == 2 && grade < GradeLow || band == 0 && grade >= GradeHigh))
                flag = new(CalibrationFlagKind.Goals, Grade: grade);
            else if (review.Last is { } last && last.ScaleLevels == scaleLevels && Math.Abs(review.Rating - last.Rating) >= MoveLevels)
                flag = new(CalibrationFlagKind.Moved, LastRating: last.Rating, LastCycle: last.CycleName);
            else
            {
                var (average, count) = managers[review.ReviewerId];
                var lean = average - everyone;
                if (count >= LeanMinimumReviews && Math.Abs(lean) >= LeanDistance && (lean > 0 ? band == 2 : band == 0))
                    flag = new(lean > 0 ? CalibrationFlagKind.RatesHigh : CalibrationFlagKind.RatesLow,
                        ManagerAverage: decimal.Round(average, 2), ManagerReviews: count,
                        EveryoneAverage: decimal.Round(everyone, 2), EveryoneReviews: reviews.Count);
            }
            if (flag is not null) flags[review.ReviewId] = flag;
        }
        return flags;
    }
}

using System.Globalization;
using System.Text;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Reviews;

public sealed record RoundResultsFile(byte[] Content, string FileName);

/// <summary>A round's results as a spreadsheet, for HR (B-434, S6). Administrators only; the controller checks.</summary>
public sealed record ExportRoundResultsQuery(Guid RoundId) : IQuery<Result<RoundResultsFile>>;

/// <summary>
/// One row per person in the round: who, their job and unit, who reviewed them, where the review stands, the result once
/// released, whether calibration changed it, and when they acknowledged it. CSV in UTF-8 with a BOM so spreadsheets read
/// accents; a cell that could start a formula is quoted as text.
/// </summary>
public sealed class ExportRoundResultsHandler(PerformanceDbContext db) : IQueryHandler<ExportRoundResultsQuery, Result<RoundResultsFile>>
{
    public async Task<Result<RoundResultsFile>> Handle(ExportRoundResultsQuery query, CancellationToken token)
    {
        var round = await db.ReviewRounds.AsNoTracking().FirstOrDefaultAsync(r => r.Id == query.RoundId, token);
        if (round is null) return Result.Failure<RoundResultsFile>(PerformanceErrors.NotFound("ReviewRound", query.RoundId));
        var reviews = await db.PerformanceReviews.AsNoTracking().Where(r => r.ReviewRoundId == round.Id)
            .OrderBy(r => r.SubjectOrgUnitName).ThenBy(r => r.SubjectDisplayName).ToListAsync(token);

        var csv = new StringBuilder();
        Row(csv, "Person", "Job", "Unit", "Reviewer", "Stage", "Result", "Changed in calibration", "Released on", "Acknowledged on");
        foreach (var review in reviews)
        {
            var released = review.State == PerformanceReviewState.Finalized;
            Row(csv, review.SubjectDisplayName, review.SubjectJobTitle, review.SubjectOrgUnitName, review.ReviewerDisplayName,
                Stage(review.State),
                released ? ReviewHistoryRating.Label(review.FinalizedSnapshotJson, review.FinalRating) : null,
                released ? (review.CalibrationChangedRating ? "Yes" : "No") : null,
                Day(review.FinalizedAt), Day(review.AcknowledgedAt));
        }
        var name = string.Concat(round.Name.Select(c => char.IsLetterOrDigit(c) ? c : '-')).Trim('-');
        return Result.Success(new RoundResultsFile(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv.ToString())).ToArray(),
            $"{(name.Length > 0 ? name : "round")}-results.csv"));
    }

    private static string Stage(PerformanceReviewState state) => state switch
    {
        PerformanceReviewState.SelfAssessment => "Self-review",
        PerformanceReviewState.ManagerAssessment => "Manager's review",
        PerformanceReviewState.Finalized => "Released",
        PerformanceReviewState.Closed => "Closed",
        _ => "Calibration",
    };

    private static string? Day(DateTime? at) => at?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static void Row(StringBuilder csv, params string?[] cells)
        => csv.Append(string.Join(',', cells.Select(Cell))).Append("\r\n");

    /// <summary>Quoted when it holds a separator or quote; a leading =, +, - or @ is kept as text.</summary>
    public static string Cell(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        if (value[0] is '=' or '+' or '-' or '@' or '\t' or '\r') value = "'" + value;
        return value.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? $"\"{value.Replace("\"", "\"\"")}\"" : value;
    }
}

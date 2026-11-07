using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Features.Goals;
using EY.HRPlatform.Performance.Features.Security;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using EY.HRPlatform.SharedKernel.Text;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Search;

// --- Contracts ------------------------------------------------------------------------------------

/// <param name="Yours">The viewer is accountable for it.</param>
public sealed record PerformanceSearchObjectiveDto(Guid Id, Guid CycleId, string Title, ObjectiveOwnershipScope Scope, bool Yours);

public sealed record PerformanceSearchOneOnOneDto(Guid SeriesId, Guid WithEmployeeId, string WithName);

/// <param name="Administers">The viewer runs review rounds: it opens the round, not their own reviews.</param>
public sealed record PerformanceSearchReviewRoundDto(Guid Id, string Name, bool Administers);

public sealed record PerformanceSearchCycleDto(Guid Id, string Name);

public sealed record PerformanceSearchDto(
    IReadOnlyList<PerformanceSearchObjectiveDto> Objectives,
    IReadOnlyList<PerformanceSearchOneOnOneDto> OneOnOnes,
    IReadOnlyList<PerformanceSearchReviewRoundDto> ReviewRounds,
    IReadOnlyList<PerformanceSearchCycleDto> Cycles)
{
    public static readonly PerformanceSearchDto Empty = new([], [], [], []);
}

/// <summary>
/// The top bar's Performance read (B-211): objectives the viewer may open in cycles that aren't closed (the one
/// objective policy), their active 1:1 series, review rounds they administer or have a review in, and cycles for
/// administrators. Word-start, accent- and case-insensitive.
/// </summary>
public sealed record PerformanceSearchQuery(string Text, GoalActorContext Actor) : IQuery<Result<PerformanceSearchDto>>
{
    public const int Limit = 5;
    public const int MaxTextLength = 100;
}

// --- Handler --------------------------------------------------------------------------------------

public sealed class PerformanceSearchHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, PerformanceViewer? caller = null)
    : IQueryHandler<PerformanceSearchQuery, Result<PerformanceSearchDto>>
{
    public async Task<Result<PerformanceSearchDto>> Handle(PerformanceSearchQuery request, CancellationToken cancellationToken)
    {
        var text = request.Text.Trim();
        if (text.Length > PerformanceSearchQuery.MaxTextLength) text = text[..PerformanceSearchQuery.MaxTextLength];
        var words = SearchText.Words(text);
        if (words.Length == 0) return Result.Success(PerformanceSearchDto.Empty);

        var actor = request.Actor;
        var me = actor.CallerEmployeeId;
        var openCycles = await db.Cycles.AsNoTracking().Where(c => c.State != CycleLifecycleState.Closed).ToListAsync(cancellationToken);

        var objectives = new List<(PerformanceSearchObjectiveDto Dto, int Score)>();
        var viewer = caller ?? new PerformanceViewer(db, workforce);
        foreach (var cycle in openCycles)
        {
            var cycleViewer = await viewer.ForCycleAsync(cycle, actor, cancellationToken);
            var readable = await ObjectivePolicy.Readable(db.Objectives.AsNoTracking(), db.EmployeePlans, cycleViewer)
                .Where(o => o.CycleId == cycle.Id && o.State != ObjectiveLifecycleState.Archived)
                .Select(o => new { o.Id, o.CycleId, o.Title, o.OwnershipScope, o.AccountablePersonId })
                .ToListAsync(cancellationToken);
            objectives.AddRange(readable
                .Where(o => SearchText.MatchesAll(words, o.Title))
                .Select(o => (new PerformanceSearchObjectiveDto(o.Id, o.CycleId, o.Title, o.OwnershipScope, me != Guid.Empty && o.AccountablePersonId == me),
                    SearchText.Score(o.Title, text) + (me != Guid.Empty && o.AccountablePersonId == me ? 15 : 0))));
        }

        var series = await OneOnOnePolicy.Readable(db.OneOnOneSeries.AsNoTracking(), me)
            .Where(s => s.EndedAt == null)
            .Select(s => new { s.Id, s.ManagerEmployeeId, s.ManagerName, s.ReportEmployeeId, s.ReportName })
            .ToListAsync(cancellationToken);
        var withs = series.Select(s => s.ManagerEmployeeId == me
            ? (s.Id, With: s.ReportEmployeeId, Name: s.ReportName)
            : (s.Id, With: s.ManagerEmployeeId, Name: s.ManagerName)).ToList();
        var unnamed = withs.Where(w => string.IsNullOrWhiteSpace(w.Name)).Select(w => w.With).Distinct().ToList();
        var names = unnamed.Count == 0 ? [] : (await workforce.ResolveAsync(PerformanceClock.UtcNow, unnamed, cancellationToken))
            .ToDictionary(s => s.EmployeeId, s => s.DisplayName);
        var oneOnOnes = withs
            .Select(w => new PerformanceSearchOneOnOneDto(w.Id, w.With, string.IsNullOrWhiteSpace(w.Name) ? names.GetValueOrDefault(w.With, "") : w.Name))
            .Where(w => SearchText.MatchesAll(words, w.WithName, "1:1s one-on-one"))
            .OrderBy(w => w.WithName, StringComparer.CurrentCultureIgnoreCase)
            .Take(PerformanceSearchQuery.Limit)
            .ToList();

        // Someone who doesn't run rounds finds the ones they have a review in, as subject or reviewer (the one review policy).
        var reviewActor = new ReviewActor(me, IsAdministrator: false, CanReviewReports: actor.CanReviewReports);
        var withAReview = ReviewPolicy.Readable(db.PerformanceReviews.AsNoTracking(), reviewActor).Select(review => review.ReviewRoundId);
        var rounds = actor.IsAdmin
            ? db.ReviewRounds.AsNoTracking()
            : db.ReviewRounds.AsNoTracking().Where(round => withAReview.Contains(round.Id));
        var reviewRounds = (await rounds.Select(round => new { round.Id, round.Name }).ToListAsync(cancellationToken))
            .Where(round => SearchText.MatchesAll(words, round.Name, "review"))
            .OrderByDescending(round => SearchText.Score(round.Name, text))
            .Take(PerformanceSearchQuery.Limit)
            .Select(round => new PerformanceSearchReviewRoundDto(round.Id, round.Name, actor.IsAdmin))
            .ToList();

        var cycles = actor.IsAdmin
            ? openCycles.Where(c => SearchText.MatchesAll(words, c.Name, "cycle")).Select(c => new PerformanceSearchCycleDto(c.Id, c.Name)).ToList()
            : [];

        return Result.Success(new PerformanceSearchDto(
            objectives.OrderByDescending(o => o.Score).ThenBy(o => o.Dto.Title, StringComparer.CurrentCultureIgnoreCase)
                .Take(PerformanceSearchQuery.Limit).Select(o => o.Dto).ToList(),
            oneOnOnes,
            reviewRounds,
            cycles));
    }
}

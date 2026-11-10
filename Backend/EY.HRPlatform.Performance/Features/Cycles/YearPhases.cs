using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Cycles;

/// <summary>Reads a year's evidence and applies <see cref="YearPhase"/>: the phase every surface shows.</summary>
public static class YearPhases
{
    public static async Task<YearEvidence> EvidenceAsync(PerformanceDbContext db, Guid cycleId, CancellationToken cancellationToken)
    {
        var launched = await db.ReviewRounds.AsNoTracking()
            .AnyAsync(round => round.CycleId == cycleId && round.LaunchedAt != null, cancellationToken);
        var released = launched && await db.PerformanceReviews.AsNoTracking()
            .AnyAsync(review => review.CycleId == cycleId && review.State == PerformanceReviewState.Finalized, cancellationToken);
        return new YearEvidence(launched, released);
    }

    public static async Task<CyclePhase?> ComputeAsync(PerformanceDbContext db, PerformanceCycle cycle, CancellationToken cancellationToken)
        => cycle.IsActive ? YearPhase.Of(cycle, PerformanceClock.Today, await EvidenceAsync(db, cycle.Id, cancellationToken)) : null;
}

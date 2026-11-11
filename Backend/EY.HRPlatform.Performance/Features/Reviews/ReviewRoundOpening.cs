using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Multitenancy;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Reviews;

/// <summary>
/// A drafted round opens by itself on its day (D-74): the same launch as "Open it today", run for every Draft whose
/// <see cref="ReviewRound.OpensOn"/> has come. A round that can't launch yet (a reviewer missing) stays a Draft and is
/// tried again on the next scan; the Year page keeps showing it as coming up.
/// </summary>
public sealed class ReviewRoundOpeningScanner(IServiceScopeFactory scopes, ILogger<ReviewRoundOpeningScanner> logger)
{
    public async Task<int> ScanAsync(DateOnly today, CancellationToken cancellationToken)
    {
        List<Guid> tenants;
        await using (var discovery = scopes.CreateAsyncScope())
        {
            var db = discovery.ServiceProvider.GetRequiredService<PerformanceDbContext>();
            // Discovery reads tenant identifiers only; every read and write after it is tenant-filtered.
            tenants = await db.Database.SqlQuery<Guid>($"""
                SELECT DISTINCT r."TenantId" AS "Value" FROM performance."ReviewRounds" r
                WHERE r."State" = 'Draft' AND r."OpensOn" IS NOT NULL AND r."OpensOn" <= {today}
                """).ToListAsync(cancellationToken);
        }
        var opened = 0;
        foreach (var tenantId in tenants)
        {
            await using var scope = scopes.CreateAsyncScope();
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(tenantId);
            opened += await ScanTenantAsync(scope.ServiceProvider.GetRequiredService<PerformanceDbContext>(),
                scope.ServiceProvider.GetRequiredService<ISender>(), logger, today, cancellationToken);
        }
        return opened;
    }

    /// <summary>One tenant's Drafts whose day has come, launched; returns how many opened.</summary>
    public static async Task<int> ScanTenantAsync(PerformanceDbContext db, ISender sender, ILogger logger, DateOnly today,
        CancellationToken cancellationToken)
    {
        var due = await db.ReviewRounds.AsNoTracking()
            .Where(r => r.State == ReviewRoundState.Draft && r.OpensOn != null && r.OpensOn <= today)
            .Select(r => new { r.Id, r.Version }).ToListAsync(cancellationToken);
        var opened = 0;
        foreach (var round in due)
        {
            var launched = await sender.Send(new LaunchReviewRoundCommand(round.Id, round.Version), cancellationToken);
            if (launched.IsSuccess) opened++;
            else logger.LogInformation("Review round {RoundId} did not open on its day: {Code}", round.Id, launched.Error.Code);
        }
        return opened;
    }
}

using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Infrastructure.Identity;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Notifications;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Goals;

/// <summary>
/// The monthly reminder to update goals (B-407): once a month, on a company working day, everyone with an approved
/// plan in the running year whose goals have gone a month without an update hears about it. Someone who updated in
/// the last month hears nothing; the month in the key keeps it to one reminder per person per month.
/// </summary>
public sealed class GoalUpdateReminderScanner(IServiceScopeFactory scopes)
{
    public static readonly TimeSpan Quiet = TimeSpan.FromDays(30);

    public async Task<int> ScanAsync(DateTime now, CancellationToken cancellationToken)
    {
        List<Guid> tenants;
        await using (var discovery = scopes.CreateAsyncScope())
        {
            var db = discovery.ServiceProvider.GetRequiredService<PerformanceDbContext>();
            // Discovery reads tenant identifiers only; every read and write after it is tenant-filtered.
            tenants = await db.Database.SqlQuery<Guid>($"""
                SELECT DISTINCT c."TenantId" AS "Value" FROM performance."PerformanceCycles" c WHERE c."State" = 'Active'
                """).ToListAsync(cancellationToken);
        }
        var staged = 0;
        foreach (var tenantId in tenants)
        {
            await using var scope = scopes.CreateAsyncScope();
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(tenantId);
            string timeZone;
            try { timeZone = (await scope.ServiceProvider.GetRequiredService<INotificationAudienceClient>().ReadAsync([], cancellationToken)).TimeZone; }
            catch (HttpRequestException) { continue; } // Identity unreachable: this tenant waits for the next scan.
            if (ReminderClock.SendDay(now, timeZone) is not DateOnly sendDay) continue;
            staged += await ScanTenantAsync(scope.ServiceProvider.GetRequiredService<PerformanceDbContext>(),
                scope.ServiceProvider.GetRequiredService<IPerformanceNotifications>(), now, sendDay, cancellationToken);
        }
        return staged;
    }

    /// <summary>One tenant's reminders for <paramref name="sendDay"/>'s month; returns how many were staged.</summary>
    public static async Task<int> ScanTenantAsync(PerformanceDbContext db, IPerformanceNotifications notifications, DateTime now,
        DateOnly sendDay, CancellationToken cancellationToken)
    {
        var cycle = await db.Cycles.AsNoTracking().Where(c => c.State == CycleLifecycleState.Active)
            .OrderByDescending(c => c.StartDate).FirstOrDefaultAsync(cancellationToken);
        if (cycle is null) return 0;
        var quietSince = now - Quiet;
        var plans = await db.EmployeePlans.AsNoTracking()
            .Where(p => p.CycleId == cycle.Id && p.State == PlanLifecycleState.Approved)
            .Select(p => new { p.Id, p.EmployeeId }).ToListAsync(cancellationToken);
        var planIds = plans.Select(p => p.Id).ToList();
        // A plan is quiet when none of its goals has an update in the last month (or since it was approved, if never).
        var lastUpdate = await db.Objectives.AsNoTracking()
            .Where(o => o.EmployeePlanId != null && planIds.Contains(o.EmployeePlanId.Value) && o.ArchivedAt == null)
            .GroupBy(o => o.EmployeePlanId!.Value)
            .Select(g => new { PlanId = g.Key, Last = g.Max(o => o.LastProgressAt ?? o.CreatedAt) })
            .ToDictionaryAsync(x => x.PlanId, x => x.Last, cancellationToken);
        var month = new DateOnly(sendDay.Year, sendDay.Month, 1);
        var reminded = (await db.OutboxMessages.AsNoTracking()
                .Where(m => m.Kind == PerformanceNotificationKind.GoalUpdateReminder && m.CreatedAt >= month.ToDateTime(TimeOnly.MinValue).AddDays(-1))
                .Select(m => m.DedupeKey).ToListAsync(cancellationToken))
            .ToHashSet();
        var transition = PerformanceNotifications.GoalUpdateTransition(month);
        var staged = 0;
        foreach (var plan in plans)
        {
            if (!lastUpdate.TryGetValue(plan.Id, out var last) || last > quietSince) continue;
            if (reminded.Any(key => key.Contains($"{transition:N}:{plan.EmployeeId:N}", StringComparison.Ordinal))) continue;
            notifications.EnqueueGoalUpdateReminder(cycle.TenantId, cycle.Id, plan.Id, plan.EmployeeId, month);
            staged++;
        }
        await db.SaveChangesAsync(cancellationToken);
        return staged;
    }
}

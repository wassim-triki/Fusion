using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.OneOnOnes;

/// <summary>
/// Times two people are both free for a 1:1 (B-434, D-84), from what Fusion knows: neither has a 1:1 then, neither is on
/// leave that day, on a weekday in the company's time zone. One morning and one afternoon time a day, from tomorrow.
/// </summary>
public static class OneOnOneFreeTimes
{
    public const int Offered = 3;
    private const int DaysAhead = 21;
    private static readonly TimeOnly[] Mornings = [new(10, 0), new(9, 0), new(11, 0)];
    private static readonly TimeOnly[] Afternoons = [new(15, 30), new(14, 0), new(16, 0)];

    /// <summary>The company's zone from its IANA or Windows id; UTC when it's unknown.</summary>
    public static TimeZoneInfo Zone(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return TimeZoneInfo.Utc;
        try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException) { return TimeZoneInfo.Utc; }
    }

    /// <summary>
    /// Up to <paramref name="count"/> UTC starts, earliest first. <paramref name="busy"/> are UTC starts of 1:1s either
    /// person already has; <paramref name="leaves"/> each person's current or next leave.
    /// </summary>
    public static IReadOnlyList<DateTime> Find(DateTime now, TimeZoneInfo zone, IReadOnlyCollection<DateTime> busy,
        IReadOnlyCollection<WorkforceLeaveSnapshot?> leaves, int count = Offered)
    {
        var found = new List<DateTime>();
        var day = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(now, DateTimeKind.Utc), zone)).AddDays(1);
        for (var i = 0; i < DaysAhead && found.Count < count; i++, day = day.AddDays(1))
        {
            if (day.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday) continue;
            if (leaves.Any(leave => leave is not null && day >= leave.From && (leave.Until is null || day <= leave.Until))) continue;
            foreach (var part in new[] { Mornings, Afternoons })
            {
                if (found.Count == count) break;
                foreach (var start in part)
                {
                    var at = TimeZoneInfo.ConvertTimeToUtc(day.ToDateTime(start), zone);
                    if (busy.Any(other => Math.Abs((other - at).TotalMinutes) < OneOnOneSchedule.Length.TotalMinutes)) continue;
                    found.Add(at);
                    break;
                }
            }
        }
        return found;
    }

    /// <summary>The free times of two people, reading their upcoming 1:1s.</summary>
    public static async Task<IReadOnlyList<DateTime>> ForAsync(PerformanceDbContext db, TimeZoneInfo zone, WorkforceSnapshot first,
        WorkforceSnapshot second, DateTime now, CancellationToken token)
    {
        var ids = new[] { first.EmployeeId, second.EmployeeId };
        var horizon = now.AddDays(DaysAhead + 2);
        var busy = await (from meeting in db.OneOnOneMeetings.AsNoTracking()
                          join series in db.OneOnOneSeries.AsNoTracking() on meeting.SeriesId equals series.Id
                          where meeting.State == OneOnOneMeetingState.Upcoming && meeting.ScheduledAt > now && meeting.ScheduledAt < horizon
                                && (ids.Contains(series.ManagerEmployeeId) || ids.Contains(series.ReportEmployeeId))
                          select meeting.ScheduledAt).ToListAsync(token);
        return Find(now, zone, busy, [first.Leave, second.Leave]);
    }
}

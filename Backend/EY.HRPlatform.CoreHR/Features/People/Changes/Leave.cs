using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.People.Changes;

/// <summary>
/// A person's leave as the places they appear show it: the leave they are on today, or else their next one.
/// <paramref name="Type"/> is null for viewers who see only that the person is on leave (B-229: HR, the manager and the
/// person see the type). <paramref name="Back"/> is the first working day after <paramref name="Until"/>.
/// </summary>
public sealed record PersonLeaveDto(Guid ChangeId, string? Type, DateOnly From, DateOnly? Until, DateOnly? Back, bool Now)
{
    public PersonLeaveDto WithoutType() => this with { Type = null };
}

public static class LeaveReader
{
    /// <summary>The company's working days (0 = Sunday), Monday to Friday unless set.</summary>
    public static async Task<int[]> WorkWeekAsync(CoreHRDbContext db, CancellationToken cancellationToken)
        => (await new TenantSettingsReadService(db).GetCurrentAsync(cancellationToken)).WorkingDays;

    /// <summary>The first working day after the last day off; null while the last day isn't known.</summary>
    public static DateOnly? Back(DateOnly? lastDay, int[] workWeek)
    {
        if (lastDay is not { } day)
            return null;
        if (workWeek.Length == 0)
            return day.AddDays(1);
        do day = day.AddDays(1);
        while (!workWeek.Contains((int)day.DayOfWeek));
        return day;
    }

    /// <summary>For each person, the leave in effect on <paramref name="today"/>, or else the next one; people without leave are left out.</summary>
    public static async Task<Dictionary<Guid, PersonLeaveDto>> CurrentAsync(
        CoreHRDbContext db, IReadOnlyCollection<Guid> employeeIds, DateOnly today, CancellationToken cancellationToken)
    {
        if (employeeIds.Count == 0)
            return [];
        var leaves = await db.WorkforceChanges.AsNoTracking()
            .Where(item => item.Kind == WorkforceChangeKind.Leave && !item.IsCancelled && employeeIds.Contains(item.EmployeeId)
                && (item.LastDay == null || item.LastDay >= today))
            .OrderBy(item => item.EffectiveDate)
            .ToListAsync(cancellationToken);
        if (leaves.Count == 0)
            return [];
        var week = await WorkWeekAsync(db, cancellationToken);
        return leaves.GroupBy(item => item.EmployeeId).ToDictionary(group => group.Key, group =>
        {
            var leave = group.First();
            return new PersonLeaveDto(leave.Id, WorkforceChangeService.ReadDetails(leave).LeaveType, leave.EffectiveDate,
                leave.LastDay, Back(leave.LastDay, week), leave.EffectiveDate <= today);
        });
    }
}

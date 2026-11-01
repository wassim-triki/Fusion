using System.Globalization;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Infrastructure.Notifications;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Api;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Checklists;

/// <summary>
/// Celebrations in Coming up (B-184, B-146, D-12): work anniversaries for everyone, birthdays only for people who chose
/// to share them, and only the day (the item is dated this year; the year of birth never leaves the server). Shown to the
/// people around the person: themselves, their manager, their reports and the people who share their manager.
/// </summary>
public static class Celebrations
{
    private const string Module = "core";

    public static async Task<IReadOnlyList<FusionUpcomingDto>> UpcomingAsync(CoreHRDbContext db, Guid viewerId, DateOnly today,
        DateOnly horizon, string language, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var lines = db.ManagerRelationships.AsNoTracking().Where(line => line.Type == ReportingRelationshipType.PrimaryManager
            && line.EffectiveFrom <= now && (line.EffectiveTo == null || line.EffectiveTo > now));
        var managers = await lines.Where(line => line.SubjectEmployeeId == viewerId).Select(line => line.ManagerEmployeeId).ToListAsync(cancellationToken);
        var circle = await lines.Where(line => line.ManagerEmployeeId == viewerId || managers.Contains(line.ManagerEmployeeId))
            .Select(line => line.SubjectEmployeeId).ToListAsync(cancellationToken);
        circle.AddRange(managers);
        circle.Add(viewerId);
        var ids = circle.Distinct().ToList();

        var people = await db.Employments.AsNoTracking()
            .Where(employment => ids.Contains(employment.EmployeeId) && employment.EffectiveFrom <= now
                && (employment.EffectiveTo == null || employment.EffectiveTo > now))
            .Join(db.Employees.AsNoTracking(), employment => employment.EmployeeId, employee => employee.Id,
                (employment, employee) => new { employee, Since = employment.EffectiveFrom })
            .ToListAsync(cancellationToken);

        var items = new List<FusionUpcomingDto>();
        foreach (var row in people)
        {
            var person = row.employee;
            var self = person.Id == viewerId;
            var href = self ? "/core/profile" : $"/core/people/{person.StableEmployeeKey}";
            var values = new Dictionary<string, string>(StringComparer.Ordinal) { ["name"] = person.DisplayName };
            string Text(string key) => CoreNotificationRenderer.Catalog.Text(language, key, values) ?? key;

            var start = DateOnly.FromDateTime(row.Since);
            if (Next(start, today) is { } anniversary && anniversary <= horizon && anniversary.Year - start.Year >= 1)
            {
                values["count"] = (anniversary.Year - start.Year).ToString(CultureInfo.InvariantCulture);
                items.Add(new FusionUpcomingDto($"{Module}:anniversary:{person.Id:N}:{anniversary.Year}", Module, "anniversary",
                    Text(self ? "Anniversary.you" : "Anniversary"), Text("Anniversary.context"), anniversary, null, href));
            }
            if (person.SharesBirthday && person.DateOfBirth is { } born && Next(born, today) is { } birthday && birthday <= horizon)
            {
                values.Remove("count");
                items.Add(new FusionUpcomingDto($"{Module}:birthday:{person.Id:N}:{birthday.Year}", Module, "birthday",
                    Text(self ? "Birthday.you" : "Birthday"), null, birthday, null, href));
            }
        }
        return items;
    }

    /// <summary>The next time <paramref name="date"/>'s day and month come round, today included; 29 February falls on the 28th.</summary>
    public static DateOnly? Next(DateOnly date, DateOnly today)
    {
        DateOnly In(int year) => new(year, date.Month, Math.Min(date.Day, DateTime.DaysInMonth(year, date.Month)));
        var next = In(today.Year);
        return next >= today ? next : In(today.Year + 1);
    }
}

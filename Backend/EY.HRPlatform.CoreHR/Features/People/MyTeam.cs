using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.People;

public enum TeamEventKind
{
    Joins = 1,
    MovesIn = 2,
    Leaves = 3,
    MovesOut = 4,
    NewJob = 5,
    Anniversary = 6,
    Birthday = 7,
}

/// <param name="JoinsOn">Set for someone who joins the team later (a hire or a move in); null for today's team.</param>
/// <param name="StartedOn">The first day of their employment: what time with the company counts from.</param>
public sealed record TeamPersonDto(
    Guid EmployeeId,
    string EmployeeKey,
    string DisplayName,
    string? JobTitle,
    string? Place,
    string? PhotoUrl,
    DateOnly? StartedOn,
    DateOnly? JoinsOn);

/// <summary>Something in the team's next 30 days. <paramref name="Years"/> for an anniversary, <paramref name="JobTitle"/> for a new job.</summary>
public sealed record TeamEventDto(TeamEventKind Kind, DateOnly Date, string EmployeeKey, int? Years = null, string? JobTitle = null);

public sealed record TeamOpenRoleDto(Guid Id, string JobTitle, string? PlaceName, DateOnly? TargetStartDate);

/// <summary>
/// The signed-in manager's team for the Team page (B-185): themselves, their own manager, their direct reports today
/// and anyone joining them in the next 30 days, what is coming for each from Core HR, and their open roles.
/// </summary>
public sealed record MyTeamDto(
    TeamPersonDto Manager,
    TeamPersonDto? ReportsTo,
    IReadOnlyList<TeamPersonDto> Members,
    IReadOnlyList<TeamEventDto> ComingUp,
    IReadOnlyList<TeamOpenRoleDto> OpenRoles);

/// <summary>Self-only: the controller passes the caller's own employee id from the token, never a request value.</summary>
public sealed record MyTeamQuery(Guid EmployeeId, DateOnly Today) : IQuery<Result<MyTeamDto>>;

public sealed class MyTeamQueryHandler(CoreHRDbContext dbContext) : IQueryHandler<MyTeamQuery, Result<MyTeamDto>>
{
    public const int WindowDays = 30;

    public async Task<Result<MyTeamDto>> Handle(MyTeamQuery request, CancellationToken cancellationToken)
    {
        var today = request.Today;
        var end = today.AddDays(WindowDays);
        var now = today.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var horizon = end.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);

        // Runs inside the tenant query filter: an employee id from another tenant is simply not found.
        if (!await dbContext.Employees.AnyAsync(item => item.Id == request.EmployeeId, cancellationToken))
            return Result.Failure<MyTeamDto>(new Error("Employee.NotFound", "Employee was not found."));

        var primary = dbContext.ManagerRelationships.AsNoTracking()
            .Where(item => item.Type == ReportingRelationshipType.PrimaryManager);
        // Today's reports, and anyone whose line to the manager starts within the window.
        var lines = await primary
            .Where(item => item.ManagerEmployeeId == request.EmployeeId
                && item.EffectiveFrom < horizon
                && (item.EffectiveTo == null || item.EffectiveTo > now))
            .Select(item => new { item.SubjectEmployeeId, item.EffectiveFrom, item.EffectiveTo })
            .ToListAsync(cancellationToken);
        var lineOf = lines.GroupBy(item => item.SubjectEmployeeId)
            .ToDictionary(group => group.Key, group => group.OrderBy(item => item.EffectiveFrom).First());
        var reportsTo = await primary
            .Where(item => item.SubjectEmployeeId == request.EmployeeId && item.EffectiveFrom <= now
                && (item.EffectiveTo == null || item.EffectiveTo > now))
            .Select(item => (Guid?)item.ManagerEmployeeId)
            .FirstOrDefaultAsync(cancellationToken);

        var ids = lineOf.Keys.Append(request.EmployeeId).Concat(reportsTo is { } boss ? [boss] : []).Distinct().ToList();
        var employees = await dbContext.Employees.AsNoTracking()
            .Where(item => ids.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, cancellationToken);
        var employments = (await dbContext.Employments.AsNoTracking()
                .Where(item => ids.Contains(item.EmployeeId))
                .Select(item => new { item.EmployeeId, item.EffectiveFrom, item.EffectiveTo })
                .ToListAsync(cancellationToken))
            .GroupBy(item => item.EmployeeId)
            .ToDictionary(group => group.Key, group => group.OrderByDescending(item => item.EffectiveFrom).First());
        var assignments = await dbContext.WorkAssignments.AsNoTracking()
            .Where(item => ids.Contains(item.EmployeeId) && item.IsPrimary
                && item.EffectiveFrom < horizon && (item.EffectiveTo == null || item.EffectiveTo > now))
            .Select(item => new { item.EmployeeId, item.EffectiveFrom, item.JobTitle, item.WorkLocation })
            .ToListAsync(cancellationToken);

        TeamPersonDto Person(Guid id, DateOnly? joinsOn)
        {
            var employee = employees[id];
            var on = (joinsOn ?? today).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            var work = assignments.Where(item => item.EmployeeId == id)
                .OrderByDescending(item => item.EffectiveFrom <= on).ThenByDescending(item => item.EffectiveFrom)
                .FirstOrDefault();
            var started = employments.TryGetValue(id, out var employment) ? DateOnly.FromDateTime(employment.EffectiveFrom) : (DateOnly?)null;
            return new TeamPersonDto(employee.Id, employee.StableEmployeeKey, employee.DisplayName,
                string.IsNullOrWhiteSpace(work?.JobTitle) ? null : work.JobTitle, work?.WorkLocation,
                EmployeePhotos.UrlFor(employee.StableEmployeeKey, employee.PhotoKey), started, joinsOn);
        }

        var members = new List<TeamPersonDto>();
        var events = new List<TeamEventDto>();
        foreach (var (id, line) in lineOf)
        {
            if (!employees.ContainsKey(id))
                continue;
            var from = DateOnly.FromDateTime(line.EffectiveFrom);
            var joinsOn = from > today ? from : (DateOnly?)null;
            var person = Person(id, joinsOn);
            members.Add(person);
            var employment = employments.GetValueOrDefault(id);

            if (joinsOn is { } joins)
            {
                var hired = employment is not null && DateOnly.FromDateTime(employment.EffectiveFrom) == joins;
                events.Add(new TeamEventDto(hired ? TeamEventKind.Joins : TeamEventKind.MovesIn, joins, person.EmployeeKey));
            }
            if (line.EffectiveTo is { } to && DateOnly.FromDateTime(to) <= end)
            {
                var gone = DateOnly.FromDateTime(to);
                var leaves = employment?.EffectiveTo is { } last && DateOnly.FromDateTime(last) == gone;
                // A leaver's date is their last day; someone moving away is shown on their first day elsewhere.
                events.Add(leaves
                    ? new TeamEventDto(TeamEventKind.Leaves, gone.AddDays(-1), person.EmployeeKey)
                    : new TeamEventDto(TeamEventKind.MovesOut, gone, person.EmployeeKey));
            }
            if (joinsOn is null)
            {
                foreach (var next in assignments.Where(item => item.EmployeeId == id && item.EffectiveFrom > now))
                    events.Add(new TeamEventDto(TeamEventKind.NewJob, DateOnly.FromDateTime(next.EffectiveFrom), person.EmployeeKey, JobTitle: next.JobTitle));
                if (person.StartedOn is { } start && Next(start, today) is { } anniversary && anniversary <= end && anniversary.Year > start.Year)
                    events.Add(new TeamEventDto(TeamEventKind.Anniversary, anniversary, person.EmployeeKey, anniversary.Year - start.Year));
            }
            // Only the person decides whether colleagues see their birthday (B-184).
            var employee = employees[id];
            if (employee.SharesBirthday && employee.DateOfBirth is { } born && Next(born, today) is { } birthday && birthday <= end)
                events.Add(new TeamEventDto(TeamEventKind.Birthday, birthday, person.EmployeeKey));
        }

        var openRoles = await dbContext.OpenRoles.AsNoTracking()
            .Where(item => item.ManagerEmployeeId == request.EmployeeId
                && (item.Status == OpenRoleStatus.Open || item.Status == OpenRoleStatus.OnHold))
            .OrderBy(item => item.TargetStartDate).ThenBy(item => item.JobTitle)
            .Select(item => new TeamOpenRoleDto(item.Id, item.JobTitle, item.PlaceName, item.TargetStartDate))
            .ToListAsync(cancellationToken);

        return Result.Success(new MyTeamDto(
            Person(request.EmployeeId, null),
            reportsTo is { } managerId && employees.ContainsKey(managerId) ? Person(managerId, null) : null,
            members.OrderBy(item => item.JoinsOn.HasValue).ThenBy(item => item.DisplayName).ToList(),
            events.OrderBy(item => item.Date).ThenBy(item => item.Kind).ToList(),
            openRoles));
    }

    /// <summary>The date's next occurrence on or after today; 29 February falls on 28 February in other years.</summary>
    private static DateOnly? Next(DateOnly date, DateOnly today)
    {
        DateOnly In(int year) => new(year, date.Month, Math.Min(date.Day, DateTime.DaysInMonth(year, date.Month)));
        var next = In(today.Year);
        return next >= today ? next : In(today.Year + 1);
    }
}

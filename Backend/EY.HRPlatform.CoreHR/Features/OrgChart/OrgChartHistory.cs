using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Features.People.Changes;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.OrgChart;

// --- Contracts ------------------------------------------------------------------------------------

/// <summary>
/// The whole company's chart over a window, for HR's time slider and Replay (B-419): each person once, with the stretches
/// over which their card holds and their leave, and each unit's life. The page builds the chart for any day of the window
/// from it, as <see cref="OrgChartQueryHandler"/> builds it for one: counts, the new badge and leave follow the day.
/// </summary>
public sealed record OrgChartHistoryDto(
    DateOnly From,
    DateOnly To,
    IReadOnlyList<OrgChartHistoryPersonDto> People,
    IReadOnlyList<OrgChartHistoryUnitDto> Units);

/// <param name="Stretches">When they're on the chart, oldest first; a gap is a stretch they weren't employed.</param>
/// <param name="Leaves">Leave that hadn't ended by the window's first day, oldest first; the type is left out.</param>
public sealed record OrgChartHistoryPersonDto(
    string EmployeeKey,
    string DisplayName,
    string Initials,
    string? WorkEmail,
    string? PhotoUrl,
    IReadOnlyList<OrgChartStretchDto> Stretches,
    IReadOnlyList<OrgChartHistoryLeaveDto> Leaves);

/// <summary>A person's card from <paramref name="From"/> until the day before <paramref name="Until"/>, as HR reads it.</summary>
/// <param name="Until">The first day it no longer holds; null when it holds to the window's end.</param>
public sealed record OrgChartStretchDto(
    DateOnly From,
    DateOnly? Until,
    string? JobTitle,
    OrgChartUnitDto? Unit,
    string? WorkLocation,
    int? StartYear,
    DateOnly? StartDate,
    string? ManagerKey,
    IReadOnlyList<string> DottedLineManagerKeys);

/// <param name="Back">The first working day after <paramref name="Until"/>.</param>
public sealed record OrgChartHistoryLeaveDto(Guid ChangeId, DateOnly From, DateOnly? Until, DateOnly? Back);

/// <summary>A unit counts on the chart's days before <paramref name="Until"/> (null: it still does).</summary>
public sealed record OrgChartHistoryUnitDto(Guid Id, DateOnly? Until);

public static class OrgChartHistoryErrors
{
    public const string TooLargeCode = "OrgChart.HistoryTooLarge";
}

/// <param name="From">First day of the window, inclusive.</param>
/// <param name="To">Last day of the window, inclusive.</param>
public sealed record OrgChartHistoryQuery(DateOnly From, DateOnly To) : IQuery<Result<OrgChartHistoryDto>>
{
    public const int MaxYears = 100;
}

// --- Handler --------------------------------------------------------------------------------------

public sealed class OrgChartHistoryQueryHandler(
    CoreHRDbContext dbContext,
    ITenantSettingsReadService tenantSettings) : IQueryHandler<OrgChartHistoryQuery, Result<OrgChartHistoryDto>>
{
    public async Task<Result<OrgChartHistoryDto>> Handle(OrgChartHistoryQuery request, CancellationToken cancellationToken)
    {
        // Every read runs inside the tenant query filter, once for the whole window.
        var from = At(request.From);
        var end = At(request.To.AddDays(1));
        static bool Holds(DateTime start, DateTime? until, DateTime day) => start <= day && (until == null || day < until);

        var employments = await dbContext.Employments.AsNoTracking()
            .Where(e => e.EffectiveFrom < end && (e.EffectiveTo == null || e.EffectiveTo > from))
            .Select(e => new { e.EmployeeId, e.EffectiveFrom, e.EffectiveTo })
            .ToListAsync(cancellationToken);
        var spansOf = employments.ToLookup(e => e.EmployeeId);
        var ids = spansOf.Select(g => g.Key).ToList();
        // Above the whole chart's limit the page reads the chart a date at a time, as a window.
        if (ids.Count > OrgChartQuery.WholeChartLimit)
            return Result.Failure<OrgChartHistoryDto>(new Error(OrgChartHistoryErrors.TooLargeCode, "Too many people to send the chart's history at once."));
        bool EmployedOn(Guid id, DateTime day) => spansOf[id].Any(e => Holds(e.EffectiveFrom, e.EffectiveTo, day));

        var employees = await dbContext.Employees.AsNoTracking()
            .Where(e => ids.Contains(e.Id))
            .Select(e => new OrgChartQueryHandler.PersonRow(e.Id, e.StableEmployeeKey, e.FirstName, e.LastName, e.PreferredName, e.Email, e.PhotoKey))
            .ToDictionaryAsync(e => e.Id, cancellationToken);
        var keyOf = employees.ToDictionary(pair => pair.Key, pair => pair.Value.StableEmployeeKey);

        var assignmentsOf = (await dbContext.WorkAssignments.AsNoTracking()
                .Where(w => ids.Contains(w.EmployeeId) && w.IsPrimary && w.EffectiveFrom < end && (w.EffectiveTo == null || w.EffectiveTo > from))
                .Select(w => new { Row = new OrgChartQueryHandler.AssignmentRow(w.EmployeeId, w.OrgUnitId, w.JobTitle, w.WorkLocation, w.EffectiveFrom), w.EffectiveTo })
                .ToListAsync(cancellationToken))
            .ToLookup(w => w.Row.EmployeeId);

        var linesOf = (await dbContext.ManagerRelationships.AsNoTracking()
                .Where(r => ids.Contains(r.SubjectEmployeeId) && ids.Contains(r.ManagerEmployeeId)
                    && (r.Type == ReportingRelationshipType.PrimaryManager || r.Type == ReportingRelationshipType.SecondaryManager)
                    && r.EffectiveFrom < end && (r.EffectiveTo == null || r.EffectiveTo > from))
                .Select(r => new { r.SubjectEmployeeId, r.ManagerEmployeeId, r.Type, r.EffectiveFrom, r.EffectiveTo })
                .ToListAsync(cancellationToken))
            .ToLookup(r => r.SubjectEmployeeId);

        // Units as of each day their states change; a unit's life ends with its last state.
        var unitStates = await OrgChartQueryHandler.LoadUnitStatesAsync(dbContext, request.From, cancellationToken);
        var unitDays = unitStates.SelectMany(s => s.EffectiveTo is { } to ? new[] { s.EffectiveFrom, to } : new[] { s.EffectiveFrom })
            .Where(day => day > request.From && day <= request.To)
            .Append(request.From)
            .Distinct()
            .Order()
            .ToList();
        var unitsOn = unitDays.ToDictionary(day => day, day => OrgChartQueryHandler.UnitsAsOf(unitStates, day));
        Dictionary<Guid, OrgChartUnitDto> UnitsOn(DateOnly day) => unitsOn[unitDays.Last(d => d <= day)];
        var units = unitStates.GroupBy(s => s.OrgUnitId)
            .Select(g => new OrgChartHistoryUnitDto(g.Key, g.Any(s => s.EffectiveTo is null) ? null : g.Max(s => s.EffectiveTo)))
            .ToList();

        var settings = await tenantSettings.GetCurrentAsync(cancellationToken);
        bool Shows(string field) => OrgChartQueryHandler.CanViewField(settings, field, EmployeeReadAudience.HrAdmin);
        var leavesOf = (await dbContext.WorkforceChanges.AsNoTracking()
                .Where(item => item.Kind == WorkforceChangeKind.Leave && !item.IsCancelled && ids.Contains(item.EmployeeId)
                    && (item.LastDay == null || item.LastDay >= request.From))
                .OrderBy(item => item.EffectiveDate)
                .Select(item => new { item.Id, item.EmployeeId, item.EffectiveDate, item.LastDay })
                .ToListAsync(cancellationToken))
            .ToLookup(item => item.EmployeeId);

        // A person's card on a day, as the chart reads it for HR: their current employment, primary assignment and
        // reporting lines to people employed that day. Null while they aren't employed.
        OrgChartStretchDto? CardOn(Guid id, DateOnly day)
        {
            var at = At(day);
            var spans = spansOf[id].Where(e => Holds(e.EffectiveFrom, e.EffectiveTo, at)).ToList();
            if (spans.Count == 0) return null;
            var start = spans.Max(e => e.EffectiveFrom);
            var assignment = assignmentsOf[id].Where(w => Holds(w.Row.EffectiveFrom, w.EffectiveTo, at))
                .OrderByDescending(w => w.Row.EffectiveFrom).FirstOrDefault()?.Row;
            var lines = linesOf[id].Where(r => Holds(r.EffectiveFrom, r.EffectiveTo, at) && EmployedOn(r.ManagerEmployeeId, at)).ToList();
            var manager = lines.Where(r => r.Type == ReportingRelationshipType.PrimaryManager)
                .OrderByDescending(r => r.EffectiveFrom).FirstOrDefault()?.ManagerEmployeeId;
            var dotted = lines.Where(r => r.Type == ReportingRelationshipType.SecondaryManager)
                .Select(r => keyOf[r.ManagerEmployeeId]).Distinct().Order(StringComparer.Ordinal).ToList();
            return new OrgChartStretchDto(
                day,
                null,
                Shows("jobTitle") && !string.IsNullOrWhiteSpace(assignment?.JobTitle) ? assignment!.JobTitle : null,
                assignment is not null && UnitsOn(day).TryGetValue(assignment.OrgUnitId, out var unit) ? unit : null,
                Shows("workLocation") ? assignment?.WorkLocation : null,
                Shows("hireDate") ? start.Year : null,
                Shows("hireDate") ? DateOnly.FromDateTime(start) : null,
                manager is { } m ? keyOf[m] : null,
                dotted);
        }

        static bool Same(OrgChartStretchDto a, OrgChartStretchDto b)
            => a with { From = b.From, Until = b.Until, DottedLineManagerKeys = b.DottedLineManagerKeys } == b
                && a.DottedLineManagerKeys.SequenceEqual(b.DottedLineManagerKeys);

        IEnumerable<DateOnly> Days(DateTime start, DateTime? until)
            => until is { } u ? new[] { DateOnly.FromDateTime(start), DateOnly.FromDateTime(u) } : new[] { DateOnly.FromDateTime(start) };

        var people = new List<OrgChartHistoryPersonDto>();
        foreach (var id in ids.Where(employees.ContainsKey))
        {
            // The card can only change on a day one of its sources does: the person's employment, assignment or
            // lines, their managers' employment, or the units.
            var days = spansOf[id].SelectMany(e => Days(e.EffectiveFrom, e.EffectiveTo))
                .Concat(assignmentsOf[id].SelectMany(w => Days(w.Row.EffectiveFrom, w.EffectiveTo)))
                .Concat(linesOf[id].SelectMany(r => Days(r.EffectiveFrom, r.EffectiveTo)))
                .Concat(linesOf[id].SelectMany(r => spansOf[r.ManagerEmployeeId]).SelectMany(e => Days(e.EffectiveFrom, e.EffectiveTo)))
                .Concat(unitDays)
                .Where(day => day > request.From && day <= request.To)
                .Append(request.From)
                .Distinct()
                .Order();

            var stretches = new List<OrgChartStretchDto>();
            OrgChartStretchDto? open = null;
            foreach (var day in days)
            {
                var card = CardOn(id, day);
                if (open is not null && card is not null && Same(open, card)) continue;
                if (open is not null) stretches.Add(open with { Until = day });
                open = card;
            }
            if (open is not null) stretches.Add(open);
            if (stretches.Count == 0) continue;

            var person = employees[id];
            var name = $"{(string.IsNullOrWhiteSpace(person.PreferredName) ? person.FirstName : person.PreferredName)} {person.LastName}".Trim();
            people.Add(new OrgChartHistoryPersonDto(
                person.StableEmployeeKey,
                name,
                OrgChartQueryHandler.Initials(name),
                Shows("email") ? person.Email : null,
                EmployeePhotos.UrlFor(person.StableEmployeeKey, person.PhotoKey),
                stretches,
                leavesOf[id].Select(leave => new OrgChartHistoryLeaveDto(leave.Id, leave.EffectiveDate, leave.LastDay,
                    LeaveReader.Back(leave.LastDay, settings.WorkingDays))).ToList()));
        }

        return Result.Success(new OrgChartHistoryDto(request.From, request.To,
            people.OrderBy(p => p.DisplayName, StringComparer.Ordinal).ToList(), units));
    }

    private static DateTime At(DateOnly day) => day.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
}

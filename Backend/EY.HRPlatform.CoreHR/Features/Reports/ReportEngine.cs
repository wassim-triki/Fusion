using System.Globalization;
using System.Text.Json;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.EmployeeFields;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.OrgChart;
using EY.HRPlatform.CoreHR.Features.People.Changes;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Reports;

/// <summary>One tenant-filtered engine for Reports, export and the Core HR front page. Reach precedes every aggregation.</summary>
public sealed class ReportEngine(CoreHRDbContext db, ITenantSettingsReadService settings)
{
    public static readonly string[] Measures = ["headcount", "joiners-leavers", "turnover", "tenure", "places", "jobs", "open-roles"];
    private static readonly ReportFieldDto[] BuiltIns = [new("name", "Name"), new("unit", "Unit"), new("division", "Division"),
        new("job", "Job"), new("place", "Place"), new("first-day", "First day"), new("tenure", "Time with the company")];

    public static void Validate(ReportDefinition d)
    {
        if (!Measures.Contains(d.Measure) || d.Mode is not ("date" or "range") || d.Interval is not ("month" or "quarter" or "year")
            || d.From > d.To || d.From.Year < 1900 || d.To.Year > 2200 || d.To.DayNumber - d.From.DayNumber > 366 * 30
            || d.Filters is null || d.Fields is null || d.Filters.Count > 20 || d.Fields.Count > 30
            || d.Filters.Any(f => f.Values is null || f.Values.Count > 100 || f.Values.Any(v => v is null || v.Length > 500)))
            throw new ArgumentException("Choose a report and a date range of up to 30 years.");
        if (Periods(d).Count > 120) throw new ArgumentException("Choose an interval with at most 120 periods.");
    }

    public async Task<IReadOnlyList<ReportFieldDto>> FieldsAsync(ReportViewer viewer, CancellationToken ct)
    {
        if (!viewer.CanSee) throw new UnauthorizedAccessException();
        var policy = await settings.GetCurrentAsync(ct);
        var audience = viewer.Hr ? EmployeeReadAudience.HrAdmin : viewer.Scope == PermissionScopes.DirectReports
            ? EmployeeReadAudience.Manager : EmployeeReadAudience.Employee;
        var jobAudience = viewer.JobHr ? EmployeeReadAudience.HrAdmin : viewer.Scope == PermissionScopes.DirectReports
            ? EmployeeReadAudience.Manager : EmployeeReadAudience.Employee;
        var built = BuiltIns.Where(f => f.Key switch
        {
            "job" => OrgChartQueryHandler.CanViewField(policy, "jobTitle", jobAudience),
            "place" => OrgChartQueryHandler.CanViewField(policy, "workLocation", jobAudience),
            "first-day" or "tenure" => OrgChartQueryHandler.CanViewField(policy, "hireDate", jobAudience),
            _ => true,
        }).ToList();
        var custom = await db.EmployeeFieldDefinitions.AsNoTracking().Where(f => f.IsActive && f.SourceKey == null && f.Type != EmployeeFieldType.Section).ToListAsync(ct);
        built.AddRange(custom.Where(f => EmployeeFieldService.CanSee(f, Guid.Empty, f.Area == EmployeeFieldArea.Job ? jobAudience : audience, null)).Select(f => new ReportFieldDto("field:" + f.Key, f.Label)));
        return built;
    }

    public async Task<ReportRunDto> RunAsync(ReportDefinition d, ReportViewer viewer, CancellationToken ct)
    {
        if (!viewer.CanSee) throw new UnauthorizedAccessException();
        Validate(d);
        var fields = await FieldsAsync(viewer, ct);
        var allowed = fields.Select(f => f.Key).ToHashSet();
        // Refuse hidden fields even in filters: aggregates must not become a visibility oracle.
        if (!allowed.Contains(d.GroupBy) || d.Fields.Any(f => !allowed.Contains(f)) || d.Filters.Any(f => !allowed.Contains(f.Field))
            || d.Measure == "tenure" && !allowed.Contains("tenure"))
            throw new UnauthorizedAccessException("A field is not visible to this viewer.");

        HashSet<Guid>? branch = viewer.Scope == PermissionScopes.DirectReports
            ? await ChangeSupport.BranchAsync(db, viewer.EmployeeId!.Value, ct) : null;
        var peopleQuery = db.Employees.AsNoTracking();
        if (branch is not null) peopleQuery = peopleQuery.Where(p => branch.Contains(p.Id));
        var people = await peopleQuery.ToDictionaryAsync(p => p.Id, ct);
        var ids = people.Keys.ToList();
        var employments = await db.Employments.AsNoTracking().Where(e => ids.Contains(e.EmployeeId)).ToListAsync(ct);
        var assignments = await db.WorkAssignments.AsNoTracking().Where(a => ids.Contains(a.EmployeeId) && a.IsPrimary).ToListAsync(ct);
        var custom = await db.EmployeeFieldDefinitions.AsNoTracking().Where(f => f.IsActive && f.SourceKey == null).ToDictionaryAsync(f => f.Id, ct);
        var customValues = await db.EmployeeFieldValues.AsNoTracking().Where(v => ids.Contains(v.EmployeeId)).ToListAsync(ct);
        var values = customValues.Where(v => custom.ContainsKey(v.FieldId) && allowed.Contains("field:" + custom[v.FieldId].Key))
            .ToDictionary(v => (v.EmployeeId, "field:" + custom[v.FieldId].Key), v => Value(v.ValueJson));
        var unitStates = await OrgChartQueryHandler.LoadUnitStatesAsync(db, d.From.AddDays(-1), ct);
        var periods = Periods(d);
        var series = new Dictionary<string, decimal[]>();
        var totals = new decimal[periods.Count];
        var details = new List<ReportPersonDto>();
        var openRoles = await db.OpenRoles.AsNoTracking().Where(r => r.Status == OpenRoleStatus.Open
            && (branch == null || branch.Contains(r.ManagerEmployeeId) || r.ManagerEmployeeId == viewer.EmployeeId)).ToListAsync(ct);

        for (var index = 0; index < periods.Count; index++)
        {
            var period = periods[index];
            var from = At(period.From);
            var at = At(period.To);
            var next = at.AddDays(1);
            var units = OrgChartQueryHandler.UnitsAsOf(unitStates, period.To);
            var rows = new List<(string Group, string Event, Guid Person, Dictionary<string, string?> Cells, decimal Value)>();
            foreach (var person in people.Values)
            {
                var spans = employments.Where(e => e.EmployeeId == person.Id).OrderByDescending(e => e.EffectiveFrom).ToList();
                Employment? On(DateTime day) => spans.FirstOrDefault(e => e.EffectiveFrom <= day && (e.EffectiveTo == null || day < e.EffectiveTo));
                var active = On(at);
                var starts = spans.Where(e => e.EffectiveFrom >= from && e.EffectiveFrom < next && On(e.EffectiveFrom.AddDays(-1)) is null).ToList();
                // A consecutive renewal is continuous employment, not a departure and another join.
                var ends = spans.Where(e => e.EffectiveTo > from && e.EffectiveTo <= next && On(e.EffectiveTo.Value) is null).ToList();
                var events = new List<(Employment Employment, DateTime Day, string Kind)>();
                if (d.Measure == "joiners-leavers")
                {
                    events.AddRange(starts.Select(e => (e, e.EffectiveFrom, "joiners")));
                    events.AddRange(ends.Select(e => (e, e.EffectiveTo!.Value.AddDays(-1), "leavers")));
                }
                else if (d.Measure == "turnover")
                {
                    if (On(from.AddDays(-1)) is { } opening) events.Add((opening, from.AddDays(-1), "opening"));
                    if (active is not null) events.Add((active, at, "closing"));
                    events.AddRange(ends.Select(e => (e, e.EffectiveTo!.Value.AddDays(-1), "exit")));
                }
                else if (active is not null && d.Measure != "open-roles") events.Add((active, at, ""));
                foreach (var (employment, day, kind) in events)
                {
                    var assignment = assignments.Where(a => a.EmployeeId == person.Id && a.EffectiveFrom <= day && (a.EffectiveTo == null || day < a.EffectiveTo))
                        .OrderByDescending(a => a.EffectiveFrom).FirstOrDefault();
                    var datedUnits = OrgChartQueryHandler.UnitsAsOf(unitStates, DateOnly.FromDateTime(day));
                    var unit = assignment is null ? null : datedUnits.GetValueOrDefault(assignment.OrgUnitId);
                    var cells = new Dictionary<string, string?>
                    {
                        ["name"] = person.DisplayName, ["unit"] = unit?.Name, ["division"] = unit?.DivisionName ?? unit?.Name,
                        ["job"] = assignment?.JobTitle, ["place"] = assignment?.WorkLocation,
                        ["first-day"] = employment.EffectiveFrom.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                        ["tenure"] = Math.Max(0, (day - employment.EffectiveFrom).TotalDays / 365.25).ToString("0.0", CultureInfo.InvariantCulture),
                    };
                    foreach (var key in allowed.Where(k => k.StartsWith("field:", StringComparison.Ordinal))) cells[key] = values.GetValueOrDefault((person.Id, key));
                    if (d.Filters.Any(f => f.Values.Count > 0 && !f.Values.Contains(cells.GetValueOrDefault(f.Field) ?? ""))) continue;
                    rows.Add((cells.GetValueOrDefault(d.GroupBy) ?? "", kind, person.Id, cells,
                        d.Measure == "tenure" ? decimal.Parse(cells["tenure"]!, CultureInfo.InvariantCulture) : 1));
                }
            }

            if (d.Measure == "open-roles" && period.To >= DateOnly.FromDateTime(DateTime.UtcNow))
                foreach (var role in openRoles)
                {
                    var unit = units.GetValueOrDefault(role.OrgUnitId);
                    var cells = new Dictionary<string, string?> { ["name"] = role.JobTitle, ["job"] = role.JobTitle, ["place"] = role.PlaceName,
                        ["unit"] = unit?.Name, ["division"] = unit?.DivisionName ?? unit?.Name };
                    if (!d.Filters.Any(f => f.Values.Count > 0 && !f.Values.Contains(cells.GetValueOrDefault(f.Field) ?? "")))
                        rows.Add((cells.GetValueOrDefault(d.GroupBy) ?? "", "", Guid.Empty, cells, 1));
                }

            decimal Metric(IEnumerable<(string Group, string Event, Guid Person, Dictionary<string, string?> Cells, decimal Value)> source)
            {
                var list = source.ToList();
                if (d.Measure == "tenure") return list.Count == 0 ? 0 : decimal.Round(list.Average(r => r.Value), 1);
                if (d.Measure == "turnover")
                {
                    var opening = list.Count(r => r.Event == "opening");
                    var closing = list.Count(r => r.Event == "closing");
                    var leavers = list.Count(r => r.Event == "exit");
                    return opening + closing == 0 ? 0 : decimal.Round(leavers * 200m / (opening + closing), 1);
                }
                return list.Sum(r => r.Value);
            }

            foreach (var group in rows.GroupBy(r => (r.Group, Event: d.Measure == "joiners-leavers" ? r.Event : "")))
            {
                var key = group.Key.Group + (group.Key.Event.Length > 0 ? " · " + group.Key.Event : "");
                if (!series.TryGetValue(key, out var numbers)) series[key] = numbers = new decimal[periods.Count];
                numbers[index] = Metric(group);
            }
            totals[index] = Metric(rows);
            if (index == periods.Count - 1)
                details.AddRange(rows.Where(r => r.Person != Guid.Empty).DistinctBy(r => r.Person).Select(r => new ReportPersonDto(
                    people[r.Person].StableEmployeeKey, d.Fields.Distinct().ToDictionary(f => f, f => r.Cells.GetValueOrDefault(f)))));
        }
        return new(periods, series.OrderBy(pair => pair.Key).Select(pair => new ReportSeriesDto(pair.Key, pair.Key, pair.Value, pair.Value[^1] - pair.Value[0])).ToList(),
            totals, fields.Where(f => d.Fields.Contains(f.Key)).ToList(), details, d.Measure == "tenure" ? "years" : d.Measure == "turnover" ? "percent" : "people");
    }

    public static List<ReportPeriodDto> Periods(ReportDefinition d)
    {
        if (d.Mode == "date") return [new(d.To, d.To)];
        var periods = new List<ReportPeriodDto>();
        var from = d.From;
        while (from <= d.To && periods.Count <= 120)
        {
            var boundary = d.Interval switch
            {
                "year" => new DateOnly(from.Year, 12, 31),
                "quarter" => new DateOnly(from.Year, ((from.Month - 1) / 3 + 1) * 3, 1).AddMonths(1).AddDays(-1),
                _ => new DateOnly(from.Year, from.Month, 1).AddMonths(1).AddDays(-1),
            };
            var end = boundary < d.To ? boundary : d.To;
            periods.Add(new(from, end));
            from = end.AddDays(1);
        }
        return periods;
    }

    private static DateTime At(DateOnly date) => date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
    private static string Value(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.ValueKind == JsonValueKind.String ? document.RootElement.GetString() ?? "" : document.RootElement.ToString();
    }
}

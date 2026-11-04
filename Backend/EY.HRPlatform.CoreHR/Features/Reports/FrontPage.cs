using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.EmployeeFields;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Reports;

/// <summary>Parent: the unit above the person's department, or, outside every department, the unit they sit in.</summary>
public sealed record FrontPagePersonDto(string EmployeeKey, string Name, string? PhotoUrl, string? Job, string? Place, string? FirstDay,
    Guid? DepartmentId, string? Department, string? Parent, string? ManagerKey);
public sealed record FrontPageSnapshotDto(DateOnly Date, IReadOnlyList<FrontPagePersonDto> People);
public sealed record FrontPageRoleDto(Guid Id, string? Job, string? Place, string? Unit, DateOnly? TargetStartDate);
public sealed record FrontPageDto(DateOnly Today, DateOnly FirstDate, DateOnly LastDate, bool TeamOnly,
    IReadOnlyList<string> Fields, IReadOnlyList<FrontPageSnapshotDto> Snapshots, IReadOnlyList<FrontPageRoleDto> OpenRoles,
    IReadOnlyList<EmployeeFieldMissingPersonDto> RecordsToComplete);

public sealed partial class ReportEngine
{
    public async Task<FrontPageDto> FrontPageAsync(ReportViewer viewer, EmployeeFieldService employeeFields, CancellationToken ct)
    {
        if (!viewer.CanSee) throw new UnauthorizedAccessException();
        var projection = new FrontPageProjection();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        // This internal projection uses the very same reach, field whitelist and dated rows as Reports.
        // Its event dates are not subject to the report builder's 120-column export limit.
        await RunCoreAsync(new("headcount", "division", "range", new(1900, 1, 1), today, "month", [], []), viewer, ct, projection);
        var currentKeys = projection.Snapshots.Single(s => s.Date == today).People.Select(p => p.EmployeeKey).ToList();
        var currentIds = projection.People.Values.Where(p => currentKeys.Contains(p.StableEmployeeKey)).Select(p => p.Id).ToList();
        var audience = viewer.Hr ? EmployeeReadAudience.HrAdmin : viewer.Scope == PermissionScopes.DirectReports
            ? EmployeeReadAudience.Manager : EmployeeReadAudience.Employee;
        var jobAudience = viewer.JobHr ? EmployeeReadAudience.HrAdmin : audience;
        var missing = await employeeFields.VisibleRecordsAsync(currentIds, audience, jobAudience, ct);
        var roles = await db.OpenRoles.AsNoTracking().Where(r => r.Status == OpenRoleStatus.Open
            && (viewer.Scope == PermissionScopes.Tenant || currentIds.Contains(r.ManagerEmployeeId) || r.ManagerEmployeeId == viewer.EmployeeId)).ToListAsync(ct);
        var units = projection.UnitsOn(today);
        return new(today, projection.First, projection.Last, viewer.Scope == PermissionScopes.DirectReports,
            projection.Fields, projection.Snapshots,
            roles.Select(r => new FrontPageRoleDto(r.Id, projection.Fields.Contains("job") ? r.JobTitle : null,
                projection.Fields.Contains("place") ? r.PlaceName : null, units.GetValueOrDefault(r.OrgUnitId)?.Name, r.TargetStartDate)).ToList(), missing);
    }

    private sealed class FrontPageProjection
    {
        public Dictionary<Guid, Employee> People { get; private set; } = [];
        public List<FrontPageSnapshotDto> Snapshots { get; } = [];
        public IReadOnlyList<string> Fields { get; private set; } = [];
        public DateOnly First { get; private set; }
        public DateOnly Last { get; private set; }
        private List<WorkAssignment> assignments = [];
        private List<OrgUnitEffectiveState> states = [];
        private List<ManagerRelationship> managers = [];
        private Dictionary<string, Guid> ids = [];
        private Guid? departmentType;

        public Dictionary<Guid, OrgUnitEffectiveState> UnitsOn(DateOnly date) => states
            .Where(s => s.EffectiveTo == null || date < s.EffectiveTo).GroupBy(s => s.OrgUnitId)
            .ToDictionary(g => g.Key, g => g.Where(s => s.EffectiveFrom <= date).OrderByDescending(s => s.EffectiveFrom).FirstOrDefault()
                ?? g.OrderBy(s => s.EffectiveFrom).First());

        public async Task<List<ReportPeriodDto>> InitializeAsync(CoreHRDbContext db, Dictionary<Guid, Employee> people,
            List<Employment> employments, List<WorkAssignment> work, IReadOnlyList<ReportFieldDto> fields, CancellationToken ct)
        {
            People = people;
            ids = people.Values.ToDictionary(p => p.StableEmployeeKey, p => p.Id);
            assignments = work;
            Fields = fields.Where(f => !f.Key.StartsWith("field:", StringComparison.Ordinal)).Select(f => f.Key).ToList();
            states = await db.OrgUnitEffectiveStates.AsNoTracking().ToListAsync(ct);
            // D-30's company departments are the six Division-level groups in Carthage,
            // above its Department A/B units. Companies with only Departments use that level.
            departmentType = states.Any(s => s.OrganizationalUnitTypeId == OrganizationalUnitTypeCatalog.DivisionId)
                ? OrganizationalUnitTypeCatalog.DivisionId
                : states.Any(s => s.OrganizationalUnitTypeId == OrganizationalUnitTypeCatalog.DepartmentId)
                    ? OrganizationalUnitTypeCatalog.DepartmentId : null;
            var visibleIds = people.Keys.ToList();
            managers = await db.ManagerRelationships.AsNoTracking().Where(r => visibleIds.Contains(r.SubjectEmployeeId)
                && visibleIds.Contains(r.ManagerEmployeeId) && r.Type == ReportingRelationshipType.PrimaryManager).ToListAsync(ct);
            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            First = employments.Count > 0 ? DateOnly.FromDateTime(employments.Min(e => e.EffectiveFrom)) : today;
            if (First > today) First = today;
            var changes = employments.SelectMany(e => new[] { (DateTime?)e.EffectiveFrom, e.EffectiveTo })
                .Concat(work.SelectMany(a => new[] { (DateTime?)a.EffectiveFrom, a.EffectiveTo }))
                .Concat(managers.SelectMany(r => new[] { (DateTime?)r.EffectiveFrom, r.EffectiveTo }))
                .Where(d => d.HasValue).Select(d => DateOnly.FromDateTime(d!.Value)).ToList();
            // Unit dates matter only if they affect an allowed person's unit or ancestors.
            var relevant = work.Select(a => a.OrgUnitId).ToHashSet();
            for (var added = true; added;)
            {
                added = false;
                foreach (var state in states.Where(s => relevant.Contains(s.OrgUnitId)))
                    if (state.ParentOrgUnitId is { } parent && relevant.Add(parent)) added = true;
            }
            states = states.Where(s => relevant.Contains(s.OrgUnitId)).ToList();
            changes.AddRange(states.SelectMany(s => new[] { (DateOnly?)s.EffectiveFrom, s.EffectiveTo }).Where(d => d.HasValue).Select(d => d!.Value));
            Last = changes.Where(d => d > today).DefaultIfEmpty(today.AddDays(90)).Max();
            if (Last < today.AddDays(90)) Last = today.AddDays(90);
            // A snapshot at every actual boundary gives exact daily scrubbing without a request per frame.
            var dates = changes.Where(d => d >= First && d <= Last).ToHashSet();
            dates.UnionWith([First, today, Last]);
            for (var month = new DateOnly(First.Year, First.Month, 1); month <= Last; month = month.AddMonths(1))
            {
                var end = month.AddMonths(1).AddDays(-1);
                if (end >= First && end <= Last) dates.Add(end);
            }
            return dates.Order().Select(d => new ReportPeriodDto(d, d)).ToList();
        }

        public void Capture(DateOnly date, IReadOnlyList<ReportPersonDto> rows)
        {
            var units = UnitsOn(date);
            var at = date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            var assignmentOf = assignments.Where(a => a.EffectiveFrom <= at && (a.EffectiveTo == null || at < a.EffectiveTo))
                .GroupBy(a => a.EmployeeId).ToDictionary(g => g.Key, g => g.OrderByDescending(a => a.EffectiveFrom).First());
            var managerOf = managers.Where(r => r.EffectiveFrom <= at && (r.EffectiveTo == null || at < r.EffectiveTo))
                .GroupBy(r => r.SubjectEmployeeId).ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.EffectiveFrom).First().ManagerEmployeeId);
            var visible = rows.Select(r => r.EmployeeKey).ToHashSet();
            Snapshots.Add(new(date, rows.Select(row =>
            {
                var id = ids[row.EmployeeKey];
                var unit = assignmentOf.TryGetValue(id, out var assignment) ? units.GetValueOrDefault(assignment.OrgUnitId) : null;
                var ownUnit = unit;
                OrgUnitEffectiveState? department = null;
                var seen = new HashSet<Guid>();
                while (unit is not null && seen.Add(unit.OrgUnitId))
                {
                    if (unit.OrganizationalUnitTypeId == departmentType) { department = unit; break; }
                    unit = unit.ParentOrgUnitId is { } parent ? units.GetValueOrDefault(parent) : null;
                }
                // Only companies without either company grouping use Reports' division grouping.
                // Someone above the department level (a division's own team, the company itself) is in no
                // department; Parent then names the unit they sit in, so the page can say where they are.
                var parentName = department is not null
                    ? department.ParentOrgUnitId is { } parentId ? units.GetValueOrDefault(parentId)?.Name : null
                    : departmentType is not null ? ownUnit?.Name : null;
                var manager = managerOf.TryGetValue(id, out var managerId) ? People[managerId].StableEmployeeKey : null;
                return new FrontPagePersonDto(row.EmployeeKey, row.Values["name"] ?? "", EmployeePhotos.UrlFor(row.EmployeeKey, People[id].PhotoKey), row.Values.GetValueOrDefault("job"),
                    row.Values.GetValueOrDefault("place"), row.Values.GetValueOrDefault("first-day"), department?.OrgUnitId,
                    department?.Name ?? (departmentType is null ? row.Values.GetValueOrDefault("division") : null), parentName, manager is not null && visible.Contains(manager) ? manager : null);
            }).OrderBy(p => p.Name).ToList()));
        }
    }
}

using System.Security.Claims;
using EY.HRPlatform.SharedKernel.Auth;

namespace EY.HRPlatform.CoreHR.Features.Reports;

public sealed record ReportDefinition(string Measure, string GroupBy, string Mode, DateOnly From, DateOnly To,
    string Interval, IReadOnlyList<ReportFilter> Filters, IReadOnlyList<string> Fields);
public sealed record ReportFilter(string Field, IReadOnlyList<string> Values, string? From = null, string? To = null);
public sealed record SaveReportRequest(string Name, ReportDefinition Definition);
public sealed record ShareReportRequest(IReadOnlyList<Guid> RoleIds);
public sealed record ReportFieldDto(string Key, string Label, string Kind = "choice");
public sealed record ReportPeriodDto(DateOnly From, DateOnly To);
public sealed record ReportSeriesDto(string Key, string Label, IReadOnlyList<decimal?> Values, decimal? Change);
public sealed record ReportPersonDto(string EmployeeKey, IReadOnlyDictionary<string, string?> Values);
public sealed record ReportPersonOptionDto(string Key, string Name, string? Detail);
public sealed record ReportRunDto(IReadOnlyList<ReportPeriodDto> Periods, IReadOnlyList<ReportSeriesDto> Series,
    IReadOnlyList<decimal?> Totals, IReadOnlyList<ReportFieldDto> Fields, IReadOnlyList<ReportPersonDto> People, string Unit, IReadOnlyDictionary<string, IReadOnlyList<string>> FilterOptions, IReadOnlyList<ReportPersonOptionDto> PersonOptions);
public sealed record SavedReportDto(Guid Id, string Name, ReportDefinition Definition, bool CanEdit, IReadOnlyList<Guid> RoleIds);
public sealed record ReportSummaryDto(Guid Id, string Name, bool CanEdit);
public sealed record ReportRoleDto(Guid Id, string Name, bool Held);

// Constructed only from authenticated claims. A saved definition never carries authority.
public sealed record ReportViewer(Guid UserId, Guid? EmployeeId, string? Scope, bool Build, bool Hr, bool JobHr = false)
{
    /// <summary>Reads only their team or their unit (B-212), never the whole company.</summary>
    public bool Partial => Scope is PermissionScopes.DirectReports or PermissionScopes.OrgUnit;
    public bool CanSee => Scope == PermissionScopes.Tenant || Partial && EmployeeId.HasValue;
    public static ReportViewer From(ClaimsPrincipal user) => new(user.GetUserId(), user.GetEmployeeId(),
        user.GetCorePermissionScope(CorePermissions.OverviewView), user.HasCorePermission(CorePermissions.ReportsBuild),
        user.HasCorePermission(CorePermissions.PersonalManage, PermissionScopes.Tenant),
        user.HasCorePermission(CorePermissions.EmployeeManage, PermissionScopes.Tenant));
}

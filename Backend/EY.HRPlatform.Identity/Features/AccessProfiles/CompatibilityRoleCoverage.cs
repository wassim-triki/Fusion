using EY.HRPlatform.SharedKernel.Auth;

namespace EY.HRPlatform.Identity.Features.AccessProfiles;

/// <summary>
/// The grants that earn the old token roles HRAdmin and OrgAdmin, frozen as they were when roles became area
/// cells (B-177), so reshaping the seeded roles doesn't move who Learning and Identity's older checks see as an
/// administrator. Retires with the token roles (B-178).
/// </summary>
public static class CompatibilityRoleCoverage
{
    private const string T = PermissionScopes.Tenant;

    public static readonly IReadOnlyList<EffectivePermissionGrant> HrAdmin =
    [
        new(CorePermissions.OverviewView, T),
        new(CorePermissions.SetupView, T),
        new(CorePermissions.OrganizationView, T),
        new(CorePermissions.EmployeeView, T),
        new(CorePermissions.EmployeeManage, T),
        new(CorePermissions.EmployeeImport, T),
        new(CorePermissions.ReportingManage, T),
        new(CorePermissions.OrgChartView, T),
        new(CorePermissions.AccessView, T),
        new(CorePermissions.AccessManage, T),
        new(CorePermissions.SettingsProvisioningView, T),
        new(CorePermissions.SettingsGovernanceView, T),
    ];

    public static readonly IReadOnlyList<EffectivePermissionGrant> OrgAdmin =
    [
        .. HrAdmin,
        new(CorePermissions.SetupManage, T),
        new(CorePermissions.OrganizationManage, T),
        new(CorePermissions.SettingsOrganizationView, T),
        new(CorePermissions.SettingsOrganizationManage, T),
        new(CorePermissions.SettingsPeopleDataView, T),
        new(CorePermissions.SettingsPeopleDataManage, T),
        new(CorePermissions.SettingsStructureView, T),
        new(CorePermissions.SettingsStructureManage, T),
        new(CorePermissions.SettingsProvisioningManage, T),
        new(CorePermissions.AccessProfilesView, T),
        new(CorePermissions.AccessProfilesManageV2, T),
    ];
}

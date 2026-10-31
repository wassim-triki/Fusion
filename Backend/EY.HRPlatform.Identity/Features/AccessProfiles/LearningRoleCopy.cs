using EY.HRPlatform.SharedKernel.Auth;

namespace EY.HRPlatform.Identity.Features.AccessProfiles;

/// <summary>
/// Learning's copy of the old token roles (B-178): its service still authorizes on an HRAdmin role claim, so a token
/// carries one when the person's permissions cover what HR Admin covered when roles became area cells (B-177).
/// Nothing of ours reads it.
/// </summary>
public static class LearningRoleCopy
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

    public static bool Covers(IReadOnlyCollection<EffectivePermissionGrant> permissions)
        => HrAdmin.All(required => permissions.Any(grant =>
            string.Equals(grant.PermissionKey, required.PermissionKey, StringComparison.Ordinal)
            && PermissionScopes.GetRank(grant.Scope) >= PermissionScopes.GetRank(required.Scope)));
}

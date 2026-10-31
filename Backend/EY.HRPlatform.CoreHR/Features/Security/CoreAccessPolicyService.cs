using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.SharedKernel.Auth;
using System.Security.Claims;

namespace EY.HRPlatform.CoreHR.Features.Security;

public interface ICoreAccessPolicyService
{
    bool CanViewOverview(ClaimsPrincipal user);
    bool CanViewSetup(ClaimsPrincipal user);
    bool CanManageSetup(ClaimsPrincipal user);
    bool CanPublishStructure(ClaimsPrincipal user);
    bool CanViewStructure(ClaimsPrincipal user);
    bool CanManageStructure(ClaimsPrincipal user);
    bool CanViewOrganization(ClaimsPrincipal user) => false;
    bool CanManageOrganization(ClaimsPrincipal user) => false;

    /// <summary>Reads the company's jobs, places and lists: whoever works with people or the organization picks from them.</summary>
    bool CanViewCatalog(ClaimsPrincipal user) => false;

    /// <summary>Adds, changes, retires, merges and deletes jobs and places (the structure's owners).</summary>
    bool CanManageJobsAndPlaces(ClaimsPrincipal user) => false;

    /// <summary>Changes the company's lists (Settings › Lists).</summary>
    bool CanManageLists(ClaimsPrincipal user) => false;
    bool CanViewSettings(ClaimsPrincipal user);
    bool CanManageSettings(ClaimsPrincipal user);
    bool CanViewOrganizationSettings(ClaimsPrincipal user);
    bool CanManageOrganizationSettings(ClaimsPrincipal user);
    bool CanViewPeopleDataSettings(ClaimsPrincipal user);
    bool CanManagePeopleDataSettings(ClaimsPrincipal user);
    bool CanViewStructureSettings(ClaimsPrincipal user);
    bool CanManageStructureSettings(ClaimsPrincipal user);
    bool CanViewProvisioningSettings(ClaimsPrincipal user);
    bool CanManageProvisioningSettings(ClaimsPrincipal user);
    bool CanViewGovernanceSettings(ClaimsPrincipal user);
    bool CanViewAccessProfiles(ClaimsPrincipal user);
    bool CanManageAccessProfiles(ClaimsPrincipal user);
    /// <summary>The widest org chart scope held (Tenant, then DirectReports), or null without the permission.</summary>
    string? GetOrgChartScope(ClaimsPrincipal user);
    bool CanViewAccess(ClaimsPrincipal user);
    bool CanManageAccess(ClaimsPrincipal user);
    bool CanViewTenantEmployees(ClaimsPrincipal user);
    bool CanManageEmployees(ClaimsPrincipal user);
    bool CanImportEmployees(ClaimsPrincipal user);
    bool CanManageReporting(ClaimsPrincipal user);
    bool CanViewOwnProfile(ClaimsPrincipal user);
    bool CanUpdateOwnProfile(ClaimsPrincipal user);
    bool CanViewTeam(ClaimsPrincipal user);

    /// <summary>Proposes dated changes for their direct reports (Roles › Approving changes: Propose).</summary>
    bool CanProposeChanges(ClaimsPrincipal user) => false;

    /// <summary>Approves or declines proposed changes, for everyone (Roles › Approving changes: Approve).</summary>
    bool CanApproveChanges(ClaimsPrincipal user) => false;
    EmployeeReadAudience GetEmployeeReadAudience(ClaimsPrincipal user);
    string? GetEmployeeViewScope(ClaimsPrincipal user);
}

public sealed class CoreAccessPolicyService : ICoreAccessPolicyService
{
    public bool CanViewOverview(ClaimsPrincipal user)
        => user.HasCorePermission(CorePermissions.OverviewView, PermissionScopes.Tenant);

    public bool CanViewSetup(ClaimsPrincipal user)
        => user.HasCorePermission(CorePermissions.SetupView, PermissionScopes.Tenant)
            || user.HasCorePermission(CorePermissions.SetupManage, PermissionScopes.Tenant)
            || user.HasCorePermission(CorePermissions.StructureView, PermissionScopes.Tenant)
            || user.HasCorePermission(CorePermissions.StructureManage, PermissionScopes.Tenant)
            || user.HasCorePermission(CorePermissions.StructurePublish, PermissionScopes.Tenant);

    public bool CanManageSetup(ClaimsPrincipal user)
        => user.HasCorePermission(CorePermissions.SetupManage, PermissionScopes.Tenant)
            || user.HasCorePermission(CorePermissions.StructureManage, PermissionScopes.Tenant);

    // Temporary Change 1 compatibility boundary. Change 2 removes the legacy
    // endpoints entirely; they cannot read, publish, or mutate Organization truth.
    public bool CanPublishStructure(ClaimsPrincipal user) => false;

    public bool CanViewStructure(ClaimsPrincipal user) => false;

    public bool CanManageStructure(ClaimsPrincipal user) => false;

    public bool CanViewOrganization(ClaimsPrincipal user)
        => user.HasCorePermission(CorePermissions.OrganizationView, PermissionScopes.Tenant)
            || user.HasCorePermission(CorePermissions.OrganizationManage, PermissionScopes.Tenant);

    public bool CanManageOrganization(ClaimsPrincipal user)
        => user.HasCorePermission(CorePermissions.OrganizationManage, PermissionScopes.Tenant);

    public bool CanViewCatalog(ClaimsPrincipal user)
        => CanViewOrganization(user)
            || CanViewTenantEmployees(user)
            || CanManageEmployees(user)
            || CanViewPeopleDataSettings(user)
            || CanProposeChanges(user);

    public bool CanManageJobsAndPlaces(ClaimsPrincipal user) => CanManageOrganization(user);

    public bool CanManageLists(ClaimsPrincipal user) => CanManagePeopleDataSettings(user);

    public bool CanViewSettings(ClaimsPrincipal user)
        => CanViewOrganizationSettings(user)
            || CanViewPeopleDataSettings(user)
            || CanViewStructureSettings(user)
            || CanViewProvisioningSettings(user)
            || CanViewGovernanceSettings(user)
            || CanViewAccessProfiles(user);

    public bool CanManageSettings(ClaimsPrincipal user)
        => CanManageOrganizationSettings(user)
            || CanManagePeopleDataSettings(user)
            || CanManageStructureSettings(user)
            || CanManageProvisioningSettings(user);

    public bool CanViewOrganizationSettings(ClaimsPrincipal user)
        => HasTenantPermission(user, CorePermissions.SettingsOrganizationView)
            || CanManageOrganizationSettings(user)
            || HasLegacySettingsView(user);

    public bool CanManageOrganizationSettings(ClaimsPrincipal user)
        => HasTenantPermission(user, CorePermissions.SettingsOrganizationManage)
            || HasLegacySettingsManage(user);

    public bool CanViewPeopleDataSettings(ClaimsPrincipal user)
        => HasTenantPermission(user, CorePermissions.SettingsPeopleDataView)
            || CanManagePeopleDataSettings(user)
            || HasLegacySettingsView(user);

    public bool CanManagePeopleDataSettings(ClaimsPrincipal user)
        => HasTenantPermission(user, CorePermissions.SettingsPeopleDataManage)
            || HasLegacySettingsManage(user);

    public bool CanViewStructureSettings(ClaimsPrincipal user)
        => HasTenantPermission(user, CorePermissions.SettingsStructureView)
            || CanManageStructureSettings(user)
            || HasLegacySettingsView(user)
            || user.HasCorePermission(CorePermissions.StructureView, PermissionScopes.Tenant)
            || user.HasCorePermission(CorePermissions.StructureManage, PermissionScopes.Tenant);

    public bool CanManageStructureSettings(ClaimsPrincipal user)
        => HasTenantPermission(user, CorePermissions.SettingsStructureManage)
            || HasLegacySettingsManage(user);

    public bool CanViewProvisioningSettings(ClaimsPrincipal user)
        => HasTenantPermission(user, CorePermissions.SettingsProvisioningView)
            || CanManageProvisioningSettings(user)
            || HasLegacySettingsView(user);

    public bool CanManageProvisioningSettings(ClaimsPrincipal user)
        => HasTenantPermission(user, CorePermissions.SettingsProvisioningManage)
            || HasLegacySettingsManage(user);

    public bool CanViewGovernanceSettings(ClaimsPrincipal user)
        => HasTenantPermission(user, CorePermissions.SettingsGovernanceView)
            || HasLegacySettingsView(user);

    public bool CanViewAccessProfiles(ClaimsPrincipal user)
        => HasTenantPermission(user, CorePermissions.AccessProfilesView)
            || CanManageAccessProfiles(user)
            || user.HasCorePermission(CorePermissions.AccessView, PermissionScopes.Tenant)
            || user.HasCorePermission(CorePermissions.AccessManage, PermissionScopes.Tenant);

    public bool CanManageAccessProfiles(ClaimsPrincipal user)
        => HasTenantPermission(user, CorePermissions.AccessProfilesManageV2)
            || user.HasCorePermission(CorePermissions.AccessProfilesManage, PermissionScopes.Tenant);

    public string? GetOrgChartScope(ClaimsPrincipal user)
        => user.HasCorePermission(CorePermissions.OrgChartView, PermissionScopes.Tenant) ? PermissionScopes.Tenant
            : user.HasCorePermission(CorePermissions.OrgChartView, PermissionScopes.DirectReports) ? PermissionScopes.DirectReports
            : null;

    public bool CanViewAccess(ClaimsPrincipal user)
        => user.HasCorePermission(CorePermissions.AccessView, PermissionScopes.Tenant)
            || user.HasCorePermission(CorePermissions.AccessManage, PermissionScopes.Tenant)
            || user.HasCorePermission(CorePermissions.AccessAssignmentsView, PermissionScopes.Tenant)
            || user.HasCorePermission(CorePermissions.AccessAssignmentsManage, PermissionScopes.Tenant);

    public bool CanManageAccess(ClaimsPrincipal user)
        => user.HasCorePermission(CorePermissions.AccessManage, PermissionScopes.Tenant)
            || user.HasCorePermission(CorePermissions.AccessAssignmentsManage, PermissionScopes.Tenant);

    public bool CanViewTenantEmployees(ClaimsPrincipal user)
        => user.HasCorePermission(CorePermissions.EmployeeView, PermissionScopes.Tenant);

    public bool CanManageEmployees(ClaimsPrincipal user)
        => user.HasCorePermission(CorePermissions.EmployeeManage, PermissionScopes.Tenant);

    public bool CanImportEmployees(ClaimsPrincipal user)
        => user.HasCorePermission(CorePermissions.EmployeeImport, PermissionScopes.Tenant);

    public bool CanManageReporting(ClaimsPrincipal user)
        => user.HasCorePermission(CorePermissions.ReportingManage, PermissionScopes.Tenant);

    public bool CanViewOwnProfile(ClaimsPrincipal user)
        => user.HasCorePermission(CorePermissions.ProfileSelfView, PermissionScopes.Self)
            || user.HasCorePermission(CorePermissions.EmployeeView, PermissionScopes.Self)
            || user.HasCorePermission(CorePermissions.EmployeeView, PermissionScopes.DirectReports)
            || user.HasCorePermission(CorePermissions.EmployeeView, PermissionScopes.Tenant);

    public bool CanUpdateOwnProfile(ClaimsPrincipal user)
        => user.HasCorePermission(CorePermissions.ProfileSelfUpdate, PermissionScopes.Self);

    public bool CanViewTeam(ClaimsPrincipal user)
        => user.HasCorePermission(CorePermissions.TeamView, PermissionScopes.DirectReports)
            || user.HasCorePermission(CorePermissions.EmployeeView, PermissionScopes.DirectReports)
            || user.HasCorePermission(CorePermissions.EmployeeView, PermissionScopes.Tenant);

    public bool CanProposeChanges(ClaimsPrincipal user)
        => user.HasCorePermission(CorePermissions.ChangePropose, PermissionScopes.DirectReports);

    public bool CanApproveChanges(ClaimsPrincipal user)
        => user.HasCorePermission(CorePermissions.ChangeApprove, PermissionScopes.Tenant);

    public EmployeeReadAudience GetEmployeeReadAudience(ClaimsPrincipal user)
    {
        var scope = GetEmployeeViewScope(user);
        return scope switch
        {
            PermissionScopes.Tenant => EmployeeReadAudience.HrAdmin,
            PermissionScopes.DirectReports => EmployeeReadAudience.Manager,
            _ => EmployeeReadAudience.Employee,
        };
    }

    public string? GetEmployeeViewScope(ClaimsPrincipal user)
    {
        if (CanViewTenantEmployees(user))
        {
            return PermissionScopes.Tenant;
        }

        if (user.HasCorePermission(CorePermissions.EmployeeView, PermissionScopes.DirectReports)
            || user.HasCorePermission(CorePermissions.TeamView, PermissionScopes.DirectReports)
            )
        {
            return PermissionScopes.DirectReports;
        }

        if (user.HasCorePermission(CorePermissions.EmployeeView, PermissionScopes.Self)
            || user.HasCorePermission(CorePermissions.ProfileSelfView, PermissionScopes.Self))
        {
            return PermissionScopes.Self;
        }

        return null;
    }

    private static bool HasTenantPermission(ClaimsPrincipal user, string permissionKey)
        => user.HasCorePermission(permissionKey, PermissionScopes.Tenant);

    private static bool HasLegacySettingsView(ClaimsPrincipal user)
        => user.HasCorePermission(CorePermissions.SettingsView, PermissionScopes.Tenant)
            || HasLegacySettingsManage(user);

    private static bool HasLegacySettingsManage(ClaimsPrincipal user)
        => user.HasCorePermission(CorePermissions.SettingsManage, PermissionScopes.Tenant);
}

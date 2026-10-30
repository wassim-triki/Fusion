using System.Collections.ObjectModel;

namespace EY.HRPlatform.SharedKernel.Auth;

public static class PermissionScopes
{
    public const string None = "None";
    public const string Self = "Self";
    public const string DirectReports = "DirectReports";
    public const string OrgUnit = "OrgUnit";
    public const string Tenant = "Tenant";
    public const string Module = "Module";
    public const string Platform = "Platform";

    public static readonly ReadOnlyCollection<string> All =
        Array.AsReadOnly([None, Self, DirectReports, OrgUnit, Tenant, Module, Platform]);

    public static bool IsValid(string scope)
        => All.Contains(scope, StringComparer.Ordinal);

    public static int GetRank(string scope)
        => scope switch
        {
            Self => 1,
            DirectReports => 2,
            OrgUnit => 2,
            Tenant => 3,
            Module => 3,
            Platform => 4,
            _ => 0,
        };

    public static string Max(string left, string right)
        => GetRank(left) >= GetRank(right) ? left : right;
}

public static class CorePermissions
{
    public const string OverviewView = "core.overview.view";

    public const string SetupView = "core.setup.view";
    public const string SetupManage = "core.setup.manage";
    public const string StructureView = "core.structure.view";
    public const string StructureManage = "core.structure.manage";
    public const string StructurePublish = "core.structure.publish";
    public const string OrganizationView = "core.organization.view";
    public const string OrganizationManage = "core.organization.manage";

    public const string EmployeeView = "core.employee.view";
    public const string EmployeeManage = "core.employee.manage";
    public const string EmployeeImport = "core.employee.import";
    public const string ReportingManage = "core.reporting.manage";

    public const string OrgChartView = "core.orgchart.view";

    public const string AccessView = "core.access.view";
    public const string AccessManage = "core.access.manage";

    public const string SettingsOrganizationView = "settings.organization.view";
    public const string SettingsOrganizationManage = "settings.organization.manage";
    public const string SettingsPeopleDataView = "settings.peopleData.view";
    public const string SettingsPeopleDataManage = "settings.peopleData.manage";
    public const string SettingsStructureView = "settings.structure.view";
    public const string SettingsStructureManage = "settings.structure.manage";
    public const string SettingsProvisioningView = "settings.provisioning.view";
    public const string SettingsProvisioningManage = "settings.provisioning.manage";
    public const string SettingsGovernanceView = "settings.governance.view";
    public const string AccessProfilesView = "access.profiles.view";
    public const string AccessProfilesManageV2 = "access.profiles.manage";
    public const string AccessAssignmentsView = "access.assignments.view";
    public const string AccessAssignmentsManage = "access.assignments.manage";

    public const string SettingsView = "core.settings.view";
    public const string SettingsManage = "core.settings.manage";
    public const string AccessProfilesManage = "core.accessprofiles.manage";

    public const string ProfileSelfView = "core.profile.self.view";
    public const string ProfileSelfUpdate = "core.profile.self.update";
    public const string TeamView = "core.team.view";

    /// <summary>Propose dated changes for one's team (Roles › Approving changes); enforced by the change flow (B-179).</summary>
    public const string ChangePropose = "core.change.propose";

    /// <summary>Approve proposed changes (Roles › Approving changes); enforced by the change flow (B-179).</summary>
    public const string ChangeApprove = "core.change.approve";

    public static readonly ReadOnlyCollection<string> All =
        Array.AsReadOnly([
            OverviewView,
            SetupView,
            SetupManage,
            StructureView,
            StructureManage,
            StructurePublish,
            OrganizationView,
            OrganizationManage,
            EmployeeView,
            EmployeeManage,
            EmployeeImport,
            ReportingManage,
            OrgChartView,
            AccessView,
            AccessManage,
            SettingsOrganizationView,
            SettingsOrganizationManage,
            SettingsPeopleDataView,
            SettingsPeopleDataManage,
            SettingsStructureView,
            SettingsStructureManage,
            SettingsProvisioningView,
            SettingsProvisioningManage,
            SettingsGovernanceView,
            AccessProfilesView,
            AccessProfilesManageV2,
            AccessAssignmentsView,
            AccessAssignmentsManage,
            SettingsView,
            SettingsManage,
            AccessProfilesManage,
            ProfileSelfView,
            ProfileSelfUpdate,
            TeamView,
            ChangePropose,
            ChangeApprove,
        ]);
}

public static class ModuleSettingsPermissions
{
    public const string LearningView = "settings.modules.view:learning";
    public const string LearningManage = "settings.modules.manage:learning";
    public const string InterviewView = "settings.modules.view:interview";
    public const string InterviewManage = "settings.modules.manage:interview";

    public static readonly ReadOnlyCollection<string> All =
        Array.AsReadOnly([
            LearningView,
            LearningManage,
            InterviewView,
            InterviewManage,
        ]);
}

public sealed record CorePermissionDefinition(
    string Key,
    string Label,
    string Group,
    IReadOnlyList<string> AllowedScopes,
    string? HelperText = null);

public sealed record EffectivePermissionGrant(string PermissionKey, string Scope);

public static class CorePermissionCatalog
{
    private static readonly ReadOnlyCollection<CorePermissionDefinition> Definitions =
        Array.AsReadOnly<CorePermissionDefinition>([
            new(CorePermissions.OverviewView, "View overview", "Workspace", [PermissionScopes.Tenant]),
            new(CorePermissions.SetupView, "View setup", "Setup & Structure", [PermissionScopes.Tenant]),
            new(CorePermissions.SetupManage, "Manage setup", "Setup & Structure", [PermissionScopes.Tenant]),
            new(CorePermissions.StructureView, "View structure", "Setup & Structure", [PermissionScopes.Tenant]),
            new(CorePermissions.StructureManage, "Manage structure", "Setup & Structure", [PermissionScopes.Tenant]),
            new(CorePermissions.StructurePublish, "Publish structure", "Setup & Structure", [PermissionScopes.Tenant]),
            new(CorePermissions.OrganizationView, "View organization", "Organization", [PermissionScopes.Tenant]),
            new(CorePermissions.OrganizationManage, "Manage organization", "Organization", [PermissionScopes.Tenant]),
            new(CorePermissions.EmployeeView, "View employees", "Employees", [PermissionScopes.Self, PermissionScopes.DirectReports, PermissionScopes.Tenant], "Controls access to employee profiles and roster surfaces."),
            new(CorePermissions.EmployeeManage, "Manage employees", "Employees", [PermissionScopes.Tenant]),
            new(CorePermissions.EmployeeImport, "Import employees", "Employees", [PermissionScopes.Tenant]),
            new(CorePermissions.ReportingManage, "Manage reporting lines", "Employees", [PermissionScopes.Tenant]),
            new(CorePermissions.OrgChartView, "View org chart", "Org Chart", [PermissionScopes.DirectReports, PermissionScopes.Tenant]),
            new(CorePermissions.AccessView, "View access invitations", "Access", [PermissionScopes.Tenant]),
            new(CorePermissions.AccessManage, "Manage access invitations", "Access", [PermissionScopes.Tenant]),
            new(CorePermissions.SettingsOrganizationView, "View organization settings", "Settings", [PermissionScopes.Tenant]),
            new(CorePermissions.SettingsOrganizationManage, "Manage organization settings", "Settings", [PermissionScopes.Tenant]),
            new(CorePermissions.SettingsPeopleDataView, "View people data settings", "Settings", [PermissionScopes.Tenant]),
            new(CorePermissions.SettingsPeopleDataManage, "Manage people data settings", "Settings", [PermissionScopes.Tenant]),
            new(CorePermissions.SettingsStructureView, "View structure settings", "Settings", [PermissionScopes.Tenant]),
            new(CorePermissions.SettingsStructureManage, "Manage structure settings", "Settings", [PermissionScopes.Tenant]),
            new(CorePermissions.SettingsProvisioningView, "View provisioning settings", "Settings", [PermissionScopes.Tenant]),
            new(CorePermissions.SettingsProvisioningManage, "Manage provisioning settings", "Settings", [PermissionScopes.Tenant]),
            new(CorePermissions.SettingsGovernanceView, "View governance and audit", "Settings", [PermissionScopes.Tenant]),
            new(CorePermissions.AccessProfilesView, "View access profiles", "Access profiles", [PermissionScopes.Tenant]),
            new(CorePermissions.AccessProfilesManageV2, "Manage access profiles", "Access profiles", [PermissionScopes.Tenant]),
            new(CorePermissions.AccessAssignmentsView, "View access assignments", "Access", [PermissionScopes.Tenant]),
            new(CorePermissions.AccessAssignmentsManage, "Manage access assignments", "Access", [PermissionScopes.Tenant]),
            new(CorePermissions.SettingsView, "View all Core settings (legacy)", "Settings", [PermissionScopes.Tenant], "Compatibility grant. Prefer section-specific settings permissions."),
            new(CorePermissions.SettingsManage, "Manage all Core settings (legacy)", "Settings", [PermissionScopes.Tenant], "Compatibility grant. Prefer section-specific settings permissions."),
            new(CorePermissions.AccessProfilesManage, "Manage access profiles (legacy)", "Access profiles", [PermissionScopes.Tenant], "Compatibility grant. Prefer access.profiles.manage."),
            new(CorePermissions.ProfileSelfView, "View own profile", "Self & Team", [PermissionScopes.Self]),
            new(CorePermissions.ProfileSelfUpdate, "Update own profile", "Self & Team", [PermissionScopes.Self]),
            new(CorePermissions.TeamView, "View direct team", "Self & Team", [PermissionScopes.DirectReports]),
            new(CorePermissions.ChangePropose, "Propose changes", "Changes", [PermissionScopes.DirectReports]),
            new(CorePermissions.ChangeApprove, "Approve changes", "Changes", [PermissionScopes.Tenant]),
            new(ModuleSettingsPermissions.LearningView, "View Learning module settings", "Module settings", [PermissionScopes.Module]),
            new(ModuleSettingsPermissions.LearningManage, "Manage Learning module settings", "Module settings", [PermissionScopes.Module]),
            new(ModuleSettingsPermissions.InterviewView, "View Interview module settings", "Module settings", [PermissionScopes.Module]),
            new(ModuleSettingsPermissions.InterviewManage, "Manage Interview module settings", "Module settings", [PermissionScopes.Module]),

        ]);

    private static readonly IReadOnlyDictionary<string, CorePermissionDefinition> ByKey =
        Definitions.ToDictionary(definition => definition.Key, StringComparer.Ordinal);

    public static IReadOnlyList<CorePermissionDefinition> All => Definitions;

    public static CorePermissionDefinition Get(string key)
        => ByKey.TryGetValue(key, out var definition)
            ? definition
            : throw new InvalidOperationException($"Unknown Core permission '{key}'.");

    public static bool TryGet(string key, out CorePermissionDefinition? definition)
        => ByKey.TryGetValue(key, out definition);

    public static bool IsKnown(string key)
        => ByKey.ContainsKey(key);

    public static bool IsValidScope(string key, string scope)
        => TryGet(key, out var definition)
            && !string.IsNullOrWhiteSpace(scope)
            && definition!.AllowedScopes.Contains(scope, StringComparer.Ordinal);

    public static EffectivePermissionGrant? NormalizeGrant(string permissionKey, string scope)
    {
        if (!IsKnown(permissionKey) || !IsValidScope(permissionKey, scope))
        {
            return null;
        }

        return new EffectivePermissionGrant(permissionKey, scope);
    }
}

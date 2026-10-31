import type { OrgChartAudience, PermissionScope } from "@repo/api";
import type { AuthUser } from "./types";

/** The operator marker: Fusion's own staff. The only role claim our apps read; tenant roles retired (B-178). */
export const PLATFORM_ADMIN_ROLE = "PlatformAdmin";
/** Learning's copy of the old HR Admin token role, which its service still authorizes on. Nothing of ours reads it. */
export const HR_ADMIN_ROLE = "HRAdmin";

const SELF_SCOPE_RANK = 1;
const DIRECT_REPORTS_SCOPE_RANK = 2;
const ORG_UNIT_SCOPE_RANK = 2;
const TENANT_SCOPE_RANK = 3;
const MODULE_SCOPE_RANK = 3;
const PLATFORM_SCOPE_RANK = 4;

const CORE_PERMISSION = {
  overviewView: "core.overview.view",
  setupView: "core.setup.view",
  setupManage: "core.setup.manage",
  structureView: "core.structure.view",
  structureManage: "core.structure.manage",
  structurePublish: "core.structure.publish",
  employeeView: "core.employee.view",
  employeeManage: "core.employee.manage",
  employeeImport: "core.employee.import",
  reportingManage: "core.reporting.manage",
  orgChartView: "core.orgchart.view",
  organizationView: "core.organization.view",
  organizationManage: "core.organization.manage",
  accessView: "core.access.view",
  accessManage: "core.access.manage",
  accessAssignmentsView: "access.assignments.view",
  accessAssignmentsManage: "access.assignments.manage",
  settingsOrganizationView: "settings.organization.view",
  settingsOrganizationManage: "settings.organization.manage",
  settingsPeopleDataView: "settings.peopleData.view",
  settingsPeopleDataManage: "settings.peopleData.manage",
  settingsStructureView: "settings.structure.view",
  settingsStructureManage: "settings.structure.manage",
  settingsProvisioningView: "settings.provisioning.view",
  settingsProvisioningManage: "settings.provisioning.manage",
  settingsGovernanceView: "settings.governance.view",
  accessProfilesView: "access.profiles.view",
  accessProfilesManageV2: "access.profiles.manage",
  settingsView: "core.settings.view",
  settingsManage: "core.settings.manage",
  accessProfilesManage: "core.accessprofiles.manage",
  profileSelfView: "core.profile.self.view",
  profileSelfUpdate: "core.profile.self.update",
  teamView: "core.team.view",
} as const;


export function hasAnyRole(
  user: AuthUser | null,
  roles: readonly string[]
): boolean {
  if (!user) {
    return false;
  }

  return roles.some((role) => user.roles.includes(role));
}

export function canAccessPlatform(user: AuthUser | null): boolean {
  return hasAnyRole(user, [PLATFORM_ADMIN_ROLE]);
}

function getScopeRank(scope: PermissionScope | null | undefined): number {
  switch (scope) {
    case "Tenant":
      return TENANT_SCOPE_RANK;
    case "DirectReports":
      return DIRECT_REPORTS_SCOPE_RANK;
    case "OrgUnit":
      return ORG_UNIT_SCOPE_RANK;
    case "Self":
      return SELF_SCOPE_RANK;
    case "Module":
      return MODULE_SCOPE_RANK;
    default:
      return scope === "Platform" ? PLATFORM_SCOPE_RANK : 0;
  }
}

function getEffectivePermissionScope(
  user: AuthUser | null,
  permissionKey: string
): PermissionScope | null {
  if (!user?.effectivePermissions?.length) {
    return null;
  }

  let bestScope: PermissionScope | null = null;
  let bestRank = 0;

  for (const grant of user.effectivePermissions) {
    if (grant.permissionKey !== permissionKey) {
      continue;
    }

    const rank = getScopeRank(grant.scope);
    if (rank > bestRank) {
      bestRank = rank;
      bestScope = grant.scope;
    }
  }

  return bestScope;
}

export function hasCorePermission(
  user: AuthUser | null,
  permissionKey: string,
  requiredScope?: PermissionScope
): boolean {
  const grantedScope = getEffectivePermissionScope(user, permissionKey);
  if (!grantedScope) {
    return false;
  }

  if (!requiredScope) {
    return true;
  }

  return getScopeRank(grantedScope) >= getScopeRank(requiredScope);
}

export function hasAnyCorePermission(
  user: AuthUser | null,
  permissions: readonly string[]
): boolean {
  return permissions.some((permission) => hasCorePermission(user, permission));
}

function hasAnyTenantPermission(
  user: AuthUser | null,
  permissions: readonly string[]
): boolean {
  return permissions.some((permission) =>
    hasCorePermission(user, permission, "Tenant")
  );
}

export function canAccessCoreSetup(user: AuthUser | null): boolean {
  return (
    hasCorePermission(user, CORE_PERMISSION.setupView, "Tenant") ||
    hasCorePermission(user, CORE_PERMISSION.setupManage, "Tenant") ||
    hasCorePermission(user, CORE_PERMISSION.structureView, "Tenant") ||
    hasCorePermission(user, CORE_PERMISSION.structureManage, "Tenant") ||
    hasCorePermission(user, CORE_PERMISSION.structurePublish, "Tenant")
  );
}

export function canSeeCoreSetupNavigation(user: AuthUser | null): boolean {
  return canAccessCoreSetup(user);
}

export function canAccessCoreSettings(user: AuthUser | null): boolean {
  return hasAnyTenantPermission(user, [
    CORE_PERMISSION.settingsOrganizationView,
    CORE_PERMISSION.settingsOrganizationManage,
    CORE_PERMISSION.settingsPeopleDataView,
    CORE_PERMISSION.settingsPeopleDataManage,
    CORE_PERMISSION.settingsStructureView,
    CORE_PERMISSION.settingsStructureManage,
    CORE_PERMISSION.settingsProvisioningView,
    CORE_PERMISSION.settingsProvisioningManage,
    CORE_PERMISSION.settingsGovernanceView,
    CORE_PERMISSION.settingsView,
    CORE_PERMISSION.settingsManage,
  ]);
}

export function canManageCoreSettings(user: AuthUser | null): boolean {
  return hasAnyTenantPermission(user, [
    CORE_PERMISSION.settingsOrganizationManage,
    CORE_PERMISSION.settingsPeopleDataManage,
    CORE_PERMISSION.settingsStructureManage,
    CORE_PERMISSION.settingsProvisioningManage,
    CORE_PERMISSION.settingsManage,
  ]);
}

export function canViewCoreAccessProfiles(user: AuthUser | null): boolean {
  return hasAnyTenantPermission(user, [
    CORE_PERMISSION.accessProfilesView,
    CORE_PERMISSION.accessProfilesManageV2,
    CORE_PERMISSION.accessProfilesManage,
    CORE_PERMISSION.accessView,
    CORE_PERMISSION.accessManage,
  ]);
}

export function canManageCoreAccessProfiles(user: AuthUser | null): boolean {
  return hasAnyTenantPermission(user, [
    CORE_PERMISSION.accessProfilesManageV2,
    CORE_PERMISSION.accessProfilesManage,
  ]);
}

export function canSeeCoreSettingsNavigation(user: AuthUser | null): boolean {
  return (
    canAccessCoreSettings(user) ||
    canViewCoreAccessProfiles(user)
  );
}

export function canAccessCorePeople(user: AuthUser | null): boolean {
  return hasCorePermission(user, CORE_PERMISSION.employeeView, "Tenant");
}

export function canManageCoreEmployees(user: AuthUser | null): boolean {
  return hasCorePermission(user, CORE_PERMISSION.employeeManage, "Tenant");
}

export function canImportCoreEmployees(user: AuthUser | null): boolean {
  return hasCorePermission(user, CORE_PERMISSION.employeeImport, "Tenant");
}

export function canManageCoreReporting(user: AuthUser | null): boolean {
  return hasCorePermission(user, CORE_PERMISSION.reportingManage, "Tenant");
}

export function canSeeCorePeopleNavigation(user: AuthUser | null): boolean {
  return canAccessCorePeople(user);
}

export function canAccessOwnCoreProfile(user: AuthUser | null): boolean {
  if (!user?.employeeId) {
    return false;
  }

  return (
    hasCorePermission(user, CORE_PERMISSION.profileSelfView, "Self") ||
    hasCorePermission(user, CORE_PERMISSION.employeeView, "Self") ||
    hasCorePermission(user, CORE_PERMISSION.employeeView, "DirectReports") ||
    hasCorePermission(user, CORE_PERMISSION.employeeView, "Tenant")
  );
}

export function canSeeOwnCoreProfileNavigation(user: AuthUser | null): boolean {
  return canAccessOwnCoreProfile(user);
}

export function canAccessCoreTeam(user: AuthUser | null): boolean {
  if (!user?.employeeId) {
    return false;
  }

  return (
    hasCorePermission(user, CORE_PERMISSION.teamView, "DirectReports") ||
    hasCorePermission(user, CORE_PERMISSION.employeeView, "DirectReports") ||
    hasCorePermission(user, CORE_PERMISSION.employeeView, "Tenant")
  );
}

export function canSeeCoreTeamNavigation(user: AuthUser | null): boolean {
  return canAccessCoreTeam(user);
}

export function canAccessCoreOrgChart(user: AuthUser | null): boolean {
  return (
    hasCorePermission(user, CORE_PERMISSION.orgChartView, "Tenant") ||
    hasCorePermission(user, CORE_PERMISSION.orgChartView, "DirectReports")
  );
}

/**
 * Whether the org chart is open to the user under the tenant's audience (Core HR settings › Employee fields): with
 * "ManagersAndHr" only people who read the whole workforce and managers (their own line) see it, as Core HR enforces.
 * While the audience is unknown, only they do.
 */
export function canSeeCoreOrgChart(user: AuthUser | null, audience: OrgChartAudience | null | undefined): boolean {
  return canAccessCoreOrgChart(user) && (audience === "Everyone" || canAccessCoreTeam(user));
}

/** Canonical tenant Organization access; intentionally excludes legacy Structure/setup grants. */
export function canViewCoreOrganization(user: AuthUser | null): boolean {
  return (
    hasCorePermission(user, CORE_PERMISSION.organizationView, "Tenant") ||
    hasCorePermission(user, CORE_PERMISSION.organizationManage, "Tenant")
  );
}

export function canManageCoreOrganization(user: AuthUser | null): boolean {
  return hasCorePermission(user, CORE_PERMISSION.organizationManage, "Tenant");
}

export function canSeeCoreOrgChartNavigation(user: AuthUser | null): boolean {
  return canAccessCoreOrgChart(user);
}

export function canAccessCoreOverview(user: AuthUser | null): boolean {
  return hasCorePermission(user, CORE_PERMISSION.overviewView, "Tenant");
}

export function canAccessCoreAccess(user: AuthUser | null): boolean {
  return (
    hasCorePermission(user, CORE_PERMISSION.accessView, "Tenant") ||
    hasCorePermission(user, CORE_PERMISSION.accessManage, "Tenant") ||
    hasCorePermission(user, CORE_PERMISSION.accessAssignmentsView, "Tenant") ||
    hasCorePermission(user, CORE_PERMISSION.accessAssignmentsManage, "Tenant")
  );
}

export function canManageCoreAccess(user: AuthUser | null): boolean {
  return (
    hasCorePermission(user, CORE_PERMISSION.accessManage, "Tenant") ||
    hasCorePermission(user, CORE_PERMISSION.accessAssignmentsManage, "Tenant")
  );
}

/**
 * Seeing the Workforce Access workspace: the workforce invitation/link surface.
 *
 * Gated on the workforce access permissions only — deliberately narrower than
 * {@link canAccessCoreAccess}, which also accepts the Tenant Administrator
 * assignment permissions that belong to Administrators, not Workforce Access.
 */
export function canViewWorkforceAccess(user: AuthUser | null): boolean {
  return (
    hasCorePermission(user, CORE_PERMISSION.accessView, "Tenant") ||
    hasCorePermission(user, CORE_PERMISSION.accessManage, "Tenant")
  );
}

/** Committing workforce access mutations (invite, link, reactivate, connect). */
export function canManageWorkforceAccess(user: AuthUser | null): boolean {
  return hasCorePermission(user, CORE_PERMISSION.accessManage, "Tenant");
}

/**
 * Reading the tenant's administrators, invitations, and access activity.
 *
 * Deliberately narrower than {@link canAccessCoreAccess}: that also accepts the
 * workforce-invitation permissions, which say nothing about who may see how the
 * tenant is administered.
 */
export function canViewTenantAdministration(user: AuthUser | null): boolean {
  return (
    hasCorePermission(user, CORE_PERMISSION.accessAssignmentsView, "Tenant") ||
    hasCorePermission(user, CORE_PERMISSION.accessAssignmentsManage, "Tenant")
  );
}

/** Inviting, suspending, reactivating, and changing Tenant Administrator authority. */
export function canManageTenantAdministration(user: AuthUser | null): boolean {
  return hasCorePermission(user, CORE_PERMISSION.accessAssignmentsManage, "Tenant");
}

export function canSeeCoreAccessNavigation(user: AuthUser | null): boolean {
  return canAccessCoreAccess(user) || canViewCoreAccessProfiles(user);
}

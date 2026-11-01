import { describe, expect, it } from "vitest";
import {
  canAccessPlatform,
  canAccessCorePeople,
  canAccessCoreSettings,
  canManageCoreSettings,
  canAccessCoreSetup,
  canAccessCoreTeam,
  canAccessOwnCoreProfile,
  hasCorePermission,
  canSeeOwnCoreProfileNavigation,
  canSeeCorePeopleNavigation,
  canSeeCoreSettingsNavigation,
  canSeeCoreSetupNavigation,
  canSeeCoreAccessNavigation,
  canSeeCoreTeamNavigation,
  canViewCoreAccessProfiles,
  canManageCoreAccessProfiles,
  canViewCoreOrganization,
  canManageCoreOrganization,
  canSeeCoreOrgChart,
  canViewCoreReports,
  canBuildCoreReports,
} from "../roles";
import type { AuthUser } from "../types";

it("Reports team reach needs a linked person, and Build also needs Reports access", () => {
  const grants = [
    { permissionKey: "core.overview.view", scope: "DirectReports" as const },
    { permissionKey: "core.reports.build", scope: "DirectReports" as const },
  ];
  expect(canViewCoreReports(makeUser([], null, grants))).toBe(false);
  expect(canViewCoreReports(makeUser([], "manager", grants))).toBe(true);
  expect(canBuildCoreReports(makeUser([], "manager", grants))).toBe(true);
  expect(canBuildCoreReports(makeUser([], "manager", grants.slice(1)))).toBe(
    false
  );
});

function makeUser(
  roles: string[],
  employeeId?: string | null,
  effectivePermissions: AuthUser["effectivePermissions"] = []
): AuthUser {
  return {
    userId: "user-1",
    tenantId: "tenant-1",
    email: "user@example.com",
    fullName: "Test User",
    roles,
    employeeId,
    accessProfiles: [],
    effectivePermissions,
  };
}

function grant(
  permissionKey: string,
  scope: AuthUser["effectivePermissions"][number]["scope"]
): AuthUser["effectivePermissions"][number] {
  return {
    permissionKey,
    scope,
    label: permissionKey,
    group: "Test",
    helperText: null,
    allowedScopes: [scope],
  };
}

describe("role helpers", () => {
  it("authorizes Organization only from tenant-scoped canonical grants", () => {
    const viewer = makeUser([], null, [
      grant("core.organization.view", "Tenant"),
    ]);
    const manager = makeUser([], null, [
      grant("core.organization.manage", "Tenant"),
    ]);
    const orgUnitManager = makeUser([], null, [
      grant("core.organization.manage", "OrgUnit"),
    ]);
    const legacy = makeUser(["HRAdmin"], null, [
      grant("core.structure.manage", "Tenant"),
      grant("core.orgchart.view", "Tenant"),
      grant("core.setup.manage", "Tenant"),
    ]);
    const platformOnly = makeUser(["PlatformAdmin"]);

    expect(canViewCoreOrganization(viewer)).toBe(true);
    expect(canManageCoreOrganization(viewer)).toBe(false);
    expect(canViewCoreOrganization(manager)).toBe(true);
    expect(canManageCoreOrganization(manager)).toBe(true);
    expect(canViewCoreOrganization(orgUnitManager)).toBe(false);
    expect(canManageCoreOrganization(orgUnitManager)).toBe(false);
    expect(canViewCoreOrganization(legacy)).toBe(false);
    expect(canManageCoreOrganization(legacy)).toBe(false);
    expect(canViewCoreOrganization(platformOnly)).toBe(false);
    expect(canManageCoreOrganization(platformOnly)).toBe(false);
    expect(canViewCoreOrganization(null)).toBe(false);
  });

  it("grants Platform access only to authenticated platform administrators", () => {
    expect(canAccessPlatform(null)).toBe(false);
    expect(canAccessPlatform(makeUser([]))).toBe(false);
    expect(canAccessPlatform(makeUser(["Employee"]))).toBe(false);
    expect(canAccessPlatform(makeUser(["HRAdmin"]))).toBe(false);
    expect(canAccessPlatform(makeUser(["PlatformAdmin"]))).toBe(true);
  });

  it("does not turn Platform authority into customer workspace access", () => {
    const user = makeUser(["PlatformAdmin"]);

    expect(canAccessPlatform(user)).toBe(true);
    expect(canAccessCorePeople(user)).toBe(false);
    expect(canAccessCoreSettings(user)).toBe(false);
    expect(canAccessCoreSetup(user)).toBe(false);
    expect(canAccessCoreTeam(user)).toBe(false);
    expect(canAccessOwnCoreProfile(user)).toBe(false);
  });

  it("allows tenant HR admins to access setup and setup navigation", () => {
    const user = makeUser(["HRAdmin"], undefined, [
      grant("core.employee.view", "Tenant"),
      grant("core.settings.view", "Tenant"),
      grant("core.setup.view", "Tenant"),
    ]);

    expect(canAccessCorePeople(user)).toBe(true);
    expect(canAccessCoreSettings(user)).toBe(true);
    expect(canAccessCoreSetup(user)).toBe(true);
    expect(canSeeCorePeopleNavigation(user)).toBe(true);
    expect(canSeeCoreSettingsNavigation(user)).toBe(true);
    expect(canSeeCoreSetupNavigation(user)).toBe(true);
    expect(canAccessCoreTeam(user)).toBe(false);
    expect(canAccessOwnCoreProfile(user)).toBe(false);
  });

  it("allows linked managers to access self and team workspaces", () => {
    const user = makeUser(["Manager"], "employee-1", [
      grant("core.profile.self.view", "Self"),
      grant("core.team.view", "DirectReports"),
      grant("core.employee.view", "DirectReports"),
    ]);

    expect(canAccessOwnCoreProfile(user)).toBe(true);
    expect(canSeeOwnCoreProfileNavigation(user)).toBe(true);
    expect(canAccessCoreTeam(user)).toBe(true);
    expect(canSeeCoreTeamNavigation(user)).toBe(true);
    expect(canAccessCorePeople(user)).toBe(false);
  });

  it("allows linked employees to access self workspace but not team workspace", () => {
    const user = makeUser(["Employee"], "employee-1", [
      grant("core.profile.self.view", "Self"),
    ]);

    expect(canAccessOwnCoreProfile(user)).toBe(true);
    expect(canSeeOwnCoreProfileNavigation(user)).toBe(true);
    expect(canAccessCoreTeam(user)).toBe(false);
    expect(canSeeCoreTeamNavigation(user)).toBe(false);
  });

  it("allows platform admins to access Platform but not Core", () => {
    const user = makeUser(["PlatformAdmin"]);

    expect(canAccessPlatform(user)).toBe(true);
    expect(canAccessCorePeople(user)).toBe(false);
    expect(canAccessCoreSettings(user)).toBe(false);
    expect(canAccessCoreSetup(user)).toBe(false);
    expect(canSeeCorePeopleNavigation(user)).toBe(false);
    expect(canSeeCoreSettingsNavigation(user)).toBe(false);
    expect(canSeeCoreSetupNavigation(user)).toBe(false);
  });

  it("does not manufacture Core access from combined role names", () => {
    const user = makeUser(["PlatformAdmin", "HRAdmin"]);

    expect(canAccessPlatform(user)).toBe(true);
    expect(canAccessCorePeople(user)).toBe(false);
    expect(canAccessCoreSettings(user)).toBe(false);
    expect(canAccessCoreSetup(user)).toBe(false);
    expect(canSeeCorePeopleNavigation(user)).toBe(false);
    expect(canSeeCoreSettingsNavigation(user)).toBe(false);
    expect(canSeeCoreSetupNavigation(user)).toBe(false);
  });

  it("allows linked employees to access only their own profile", () => {
    const user = makeUser(["Employee"], "employee-1", [
      grant("core.profile.self.view", "Self"),
    ]);

    expect(canAccessOwnCoreProfile(user)).toBe(true);
    expect(canAccessCoreTeam(user)).toBe(false);
    expect(canAccessCorePeople(user)).toBe(false);
  });

  it("allows linked managers to access team scope", () => {
    const user = makeUser(["Manager"], "employee-1", [
      grant("core.team.view", "DirectReports"),
      grant("core.employee.view", "DirectReports"),
    ]);

    expect(canAccessOwnCoreProfile(user)).toBe(true);
    expect(canAccessCoreTeam(user)).toBe(true);
    expect(canAccessCorePeople(user)).toBe(false);
  });

  it("blocks unlinked managers from team scope", () => {
    const user = makeUser(["Manager"]);

    expect(canAccessOwnCoreProfile(user)).toBe(false);
    expect(canAccessCoreTeam(user)).toBe(false);
  });

  it("uses effective permissions for tenant hr access", () => {
    const user = makeUser([], "employee-1", [
      {
        permissionKey: "core.employee.view",
        scope: "Tenant",
        label: "View employees",
        group: "Employees",
        helperText: null,
        allowedScopes: ["Self", "DirectReports", "Tenant"],
      },
    ]);

    expect(hasCorePermission(user, "core.employee.view", "Tenant")).toBe(true);
    expect(canAccessCorePeople(user)).toBe(true);
  });

  it("uses section settings permissions for settings access", () => {
    const peopleDataAdmin = makeUser([], null, [
      grant("settings.peopleData.manage", "Tenant"),
    ]);
    const auditReader = makeUser([], null, [
      grant("settings.governance.view", "Tenant"),
    ]);

    expect(canAccessCoreSettings(peopleDataAdmin)).toBe(true);
    expect(canManageCoreSettings(peopleDataAdmin)).toBe(true);
    expect(canSeeCoreSettingsNavigation(peopleDataAdmin)).toBe(true);
    expect(canAccessCoreSettings(auditReader)).toBe(true);
    expect(canManageCoreSettings(auditReader)).toBe(false);
  });

  it("separates access profile view and manage capabilities", () => {
    const profileViewer = makeUser([], null, [
      grant("access.profiles.view", "Tenant"),
    ]);
    const profileManager = makeUser([], null, [
      grant("access.profiles.manage", "Tenant"),
    ]);

    expect(canViewCoreAccessProfiles(profileViewer)).toBe(true);
    expect(canManageCoreAccessProfiles(profileViewer)).toBe(false);
    expect(canSeeCoreSettingsNavigation(profileViewer)).toBe(true);
    expect(canViewCoreAccessProfiles(profileManager)).toBe(true);
    expect(canManageCoreAccessProfiles(profileManager)).toBe(true);
  });

  it("does not give platform admins tenant settings or profile management", () => {
    const user = makeUser(["PlatformAdmin"]);

    expect(canAccessCoreSettings(user)).toBe(false);
    expect(canManageCoreAccessProfiles(user)).toBe(false);
    expect(canSeeCoreSettingsNavigation(user)).toBe(false);
  });

  it("shows access navigation for access-only and profile managers", () => {
    const accessViewer = makeUser([], null, [
      grant("core.access.view", "Tenant"),
    ]);
    const profileManager = makeUser([], null, [
      grant("core.accessprofiles.manage", "Tenant"),
    ]);

    expect(canSeeCoreAccessNavigation(accessViewer)).toBe(true);
    expect(canSeeCoreAccessNavigation(profileManager)).toBe(true);
    expect(canSeeCoreSettingsNavigation(profileManager)).toBe(true);
  });

  it("leaves the org chart to managers and HR when the company says so", () => {
    const chart = grant("core.orgchart.view", "Tenant");
    const employee = makeUser(["Employee"], "employee-1", [
      chart,
      grant("core.employee.view", "Self"),
    ]);
    const manager = makeUser(["Manager"], "employee-2", [
      chart,
      grant("core.team.view", "DirectReports"),
    ]);
    const hr = makeUser(["HRAdmin"], "employee-3", [
      chart,
      grant("core.employee.view", "Tenant"),
    ]);
    const noChart = makeUser(["HRAdmin"], "employee-4", [
      grant("core.employee.view", "Tenant"),
    ]);

    expect(
      [employee, manager, hr, noChart].map((user) =>
        canSeeCoreOrgChart(user, "Everyone")
      )
    ).toEqual([true, true, true, false]);
    expect(
      [employee, manager, hr, noChart].map((user) =>
        canSeeCoreOrgChart(user, "ManagersAndHr")
      )
    ).toEqual([false, true, true, false]);
    expect(canSeeCoreOrgChart(employee, undefined)).toBe(false);
  });
});

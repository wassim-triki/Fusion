export type PermissionScope =
  | "None"
  | "Self"
  | "DirectReports"
  | "OrgUnit"
  | "Tenant"
  | "Module"
  | "Platform";

export interface EffectivePermissionGrantDto {
  permissionKey: string;
  scope: PermissionScope;
  label: string;
  group: string;
  helperText: string | null;
  allowedScopes: PermissionScope[];
}

export interface AccessProfileAssignmentSummaryDto {
  id: string;
  name: string;
  type: "SystemSeeded" | "Custom";
  isSystemProtected: boolean;
}

export interface AccessProfileSummaryDto
  extends AccessProfileAssignmentSummaryDto {
  description: string | null;
  assignedUserCount: number;
  createdAt: string;
  updatedAt: string | null;
  version: number;
  grants: EffectivePermissionGrantDto[];
}

export interface CurrentUserAccessDto {
  tenantId: string;
  accessProfiles: AccessProfileAssignmentSummaryDto[];
  effectivePermissions: EffectivePermissionGrantDto[];
}

export interface AccessAuditEventDto {
  id: string;
  occurredAt: string;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  summary: string;
  beforeJson: string | null;
  afterJson: string | null;
  correlationId: string | null;
}

// ── Roles (B-177, D-25): ten plain areas × level × reach, over access profiles and their grants ──

export type RoleAreaId =
  | "job"
  | "personal"
  | "org"
  | "approve"
  | "reports"
  | "signin"
  | "plans"
  | "cycles"
  | "brand"
  | "roles";
export type RoleLevel = "none" | "see" | "change" | "propose" | "approve";
export type RoleReach = "self" | "team" | "everyone";
/** How people come to hold a role besides being chosen. */
export type RoleHolderKind = "chosen" | "everyone" | "team" | "rule";
export type RoleConditionKind = "department" | "job" | "place" | "unit";

export interface RoleGrantDto {
  key: string;
  scope: PermissionScope;
}

/** One setting an area offers, with the grants behind it (defining ones decide, companions come along). */
export interface RoleAreaOptionDto {
  level: Exclude<RoleLevel, "none">;
  reach: RoleReach | null;
  defining: RoleGrantDto[];
  companions: RoleGrantDto[];
}

export interface RoleAreaDto {
  id: RoleAreaId;
  group: "core" | "performance" | "company";
  administratorsOnly: boolean;
  options: RoleAreaOptionDto[];
}

export interface RoleCellDto {
  areaId: RoleAreaId;
  level: RoleLevel;
  reach: RoleReach | null;
}

export interface RoleConditionDto {
  kind: RoleConditionKind;
  targetId: string;
}

export interface RoleFaceDto {
  userId: string;
  employeeId: string | null;
  name: string;
}

export interface RoleSummaryDto {
  id: string;
  name: string;
  description: string | null;
  isBuiltIn: boolean;
  isAdministrators: boolean;
  /** A retiring role (Org Admin) that can't be changed. */
  isLocked: boolean;
  holderKind: RoleHolderKind;
  conditions: RoleConditionDto[];
  holderCount: number;
  faces: RoleFaceDto[];
  cells: RoleCellDto[];
  version: number;
  updatedAt: string | null;
}

export interface RolesOverviewDto {
  areas: RoleAreaDto[];
  roles: RoleSummaryDto[];
  lastChange: { at: string; actorName: string; roleName: string } | null;
}

export interface RoleHolderDto {
  userId: string;
  employeeId: string | null;
  name: string;
  email: string | null;
  isChosen: boolean;
  byRule: boolean;
}

export interface RoleDetailDto {
  role: RoleSummaryDto;
  areas: RoleAreaDto[];
  holders: RoleHolderDto[];
}

export interface CreateRoleRequest {
  name: string;
  description?: string | null;
}

export interface SaveRoleRequest {
  name: string;
  description: string | null;
  cells: RoleCellDto[];
  holderKind: RoleHolderKind;
  conditions: RoleConditionDto[];
  /** The accounts chosen by name. */
  chosenUserIds: string[];
}

export type PersonRoleReasonKind = "everyone" | "team" | "rule" | "chosen" | "administrator";

export interface PersonRoleReasonDto {
  kind: PersonRoleReasonKind;
  conditions: RoleConditionDto[];
  directReports: number | null;
}

export interface PersonRoleDto {
  roleId: string;
  name: string;
  isAdministrators: boolean;
  reasons: PersonRoleReasonDto[];
}

export interface RoleCandidateDto {
  userId: string;
  employeeId: string;
  name: string;
  email: string | null;
}

export const coreAccessPaths = {
  me: () => "/identity/core-access/me",
  profiles: () => "/identity/core-access/profiles",
  profile: (profileId: string) => `/identity/core-access/profiles/${profileId}`,
  audit: () => "/identity/core-access/audit",
  roles: () => "/identity/core-access/roles",
  role: (roleId: string) => `/identity/core-access/roles/${roleId}`,
  roleCandidates: (search: string) =>
    `/identity/core-access/roles/candidates?search=${encodeURIComponent(search)}`,
  personRoles: (employeeId: string) =>
    `/identity/core-access/people/${employeeId}/roles`,
} as const;

export const coreAccessQueryKeys = {
  all: () => ["core-access"] as const,
  me: () => [...coreAccessQueryKeys.all(), "me"] as const,
  profiles: () => [...coreAccessQueryKeys.all(), "profiles"] as const,
  profile: (profileId: string) =>
    [...coreAccessQueryKeys.profiles(), profileId] as const,
  audit: () => [...coreAccessQueryKeys.all(), "audit"] as const,
  roles: () => [...coreAccessQueryKeys.all(), "roles"] as const,
  role: (roleId: string) => [...coreAccessQueryKeys.roles(), roleId] as const,
  roleCandidates: (search: string) =>
    [...coreAccessQueryKeys.roles(), "candidates", search] as const,
  personRoles: (employeeId: string) =>
    [...coreAccessQueryKeys.all(), "person", employeeId] as const,
} as const;

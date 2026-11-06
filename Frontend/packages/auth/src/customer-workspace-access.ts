import type { FusionAttentionModuleKey } from "@repo/api";
import {
  canAccessCoreAccess,
  canAccessCoreOrgChart,
  canAccessCoreOverview,
  canAccessCorePeople,
  canAccessCoreSettings,
  canAccessCoreTeam,
  canAccessOwnCoreProfile,
  canAccessPlatform,
  canManageCoreAccessProfiles,
  hasAnyCorePermission,
} from "./roles";
import type { AuthUser } from "./types";

/**
 * Entry decision shared by every customer workspace (Core HR, Performance).
 *
 * `forbidden` is returned for any account holding the Platform Administrator
 * role, not only for accounts whose sole authority is that role. A Platform
 * Administrator account is never an eligible customer tenant member: tenant
 * provisioning refuses to grant it a bootstrap invitation or membership, so a
 * combined Platform-plus-tenant account is not a state the product can reach.
 * Denying on the role therefore matches the product rule rather than
 * over-restricting a legitimate account.
 *
 * This decision governs entry only. Everything past it stays permission-aware:
 * an allowed account still sees just the workspace its tenant-scoped
 * permissions grant.
 */
export type CustomerWorkspaceAccessState =
  | "loading"
  | "sign-in-required"
  | "forbidden"
  | "module-unavailable"
  | "allowed";

/** Modules a customer workspace can require. */
export const CUSTOMER_MODULES = {
  coreHr: "CoreHR",
  performance: "Performance",
  learning: "Learning",
  recruitment: "Recruitment",
  interview: "Interview",
} as const;

export type CustomerModule =
  (typeof CUSTOMER_MODULES)[keyof typeof CUSTOMER_MODULES];

export function hasModuleEntitlement(
  user: AuthUser | null,
  module: CustomerModule,
): boolean {
  // Entitlement is meaningful only inside a customer tenant, so an account
  // without one never satisfies it regardless of what the array contains.
  return Boolean(user?.tenantId) && (user?.moduleEntitlements ?? []).includes(module);
}

export function resolveCustomerWorkspaceAccessState({
  isLoading,
  user,
  module,
}: {
  isLoading: boolean;
  user: AuthUser | null;
  /** When given, entry also requires this module to be enabled for the tenant. */
  module?: CustomerModule;
}): CustomerWorkspaceAccessState {
  if (isLoading) {
    return "loading";
  }

  if (!user) {
    return "sign-in-required";
  }

  if (canAccessPlatform(user)) {
    return "forbidden";
  }

  // Customer authority comes from exactly one Active membership. Without a
  // tenant the session carries no customer context at all — the zero, multiple,
  // and inactive-membership cases all arrive here.
  if (!user.tenantId) {
    return "forbidden";
  }

  if (module && !hasModuleEntitlement(user, module)) {
    return "module-unavailable";
  }

  return "allowed";
}

/** Performance's entry permissions; the service refuses a caller holding neither. */
const PERFORMANCE_ENTRY_PERMISSIONS = [
  "performance.cycle.view",
  "performance.objective.self.manage",
] as const;

/**
 * Whether the user can enter Performance: the customer-workspace entry rule for
 * the Performance module, plus one of the permissions the Performance service
 * requires to enter at all. Use it wherever another surface offers a way into
 * Performance (the Fusion home, the Core HR person record), so no door leads to
 * a refusal.
 */
export function canEnterPerformance(user: AuthUser | null): boolean {
  return (
    resolveCustomerWorkspaceAccessState({ isLoading: false, user, module: CUSTOMER_MODULES.performance }) ===
      "allowed" && hasAnyCorePermission(user, PERFORMANCE_ENTRY_PERMISSIONS)
  );
}

/** Whether the user can enter Core HR: the customer-workspace rule plus at least one Core HR workspace. */
export function canEnterCoreHr(user: AuthUser | null): boolean {
  return (
    resolveCustomerWorkspaceAccessState({ isLoading: false, user, module: CUSTOMER_MODULES.coreHr }) === "allowed" &&
    (canAccessCoreOverview(user) ||
      canAccessCoreAccess(user) ||
      canManageCoreAccessProfiles(user) ||
      canAccessCoreSettings(user) ||
      canAccessCorePeople(user) ||
      canAccessCoreOrgChart(user) ||
      canAccessOwnCoreProfile(user) ||
      canAccessCoreTeam(user))
  );
}

/**
 * The attention modules (work items, notifications) the user's tenant is
 * entitled to and the user can enter. The `@repo/api/query` attention hooks
 * read exactly these.
 */
export function resolveFusionAttentionModules(user: AuthUser | null): FusionAttentionModuleKey[] {
  const modules: FusionAttentionModuleKey[] = [];
  if (canEnterCoreHr(user)) modules.push("core");
  if (canEnterPerformance(user)) modules.push("performance");
  return modules;
}

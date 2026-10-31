import type { AuthUser } from "@repo/auth";
import {
  canAccessCorePeople,
  canAccessCoreSetup,
  canViewTenantAdministration,
  canViewCoreOrganization,
  canViewWorkforceAccess,
} from "@repo/auth";

/**
 * The setup launchpad's capability catalog.
 *
 * Deliberately a small typed list rather than a workflow engine: the launchpad
 * composes truth it does not own. Readiness and progress stay with the capability
 * that owns them, and anything this file asserts is either a product fact
 * (a title, a route, a real prerequisite) or roadmap metadata for work that has
 * no owner yet.
 */

/** Whether the capability exists in the product today. */
export type CapabilityAvailability = "implemented" | "planned";

export type CapabilityGroup = "foundation" | "administration" | "module";

export interface SetupCapability {
  key: string;
  title: string;
  /** One sentence, business-facing, stating what the area is for. */
  purpose: string;
  group: CapabilityGroup;
  availability: CapabilityAvailability;
  /** Required when implemented; a planned capability must never carry a route. */
  route?: string;
  actionLabel?: string;
  /** Module key that must be entitled for this capability to be relevant. */
  requiresEntitlement?: string;
  /** Keys of capabilities that must be ready first. Real dependencies only. */
  prerequisites: string[];
  order: number;
  /** Tenant-scoped authorization, evaluated against permissions rather than labels. */
  isAuthorized: (user: AuthUser | null) => boolean;
}

export const SETUP_CAPABILITIES: SetupCapability[] = [
  {
    key: "administrator-access",
    title: "Administrator access",
    purpose: "Manage who can administer this tenant.",
    group: "foundation",
    availability: "implemented",
    route: "/settings/roles/administrators",
    actionLabel: "Manage access",
    prerequisites: [],
    order: 10,
    isAuthorized: canViewTenantAdministration,
  },
  {
    key: "tenant-configuration",
    title: "Tenant configuration",
    purpose:
      "Set tenant identity, regional, communication, and experience defaults.",
    group: "administration",
    availability: "planned",
    prerequisites: [],
    order: 55,
    isAuthorized: canAccessCoreSetup,
  },
  {
    key: "organization",
    title: "Organization",
    purpose:
      "Define the structure your workforce and future HR processes will build on.",
    group: "foundation",
    availability: "implemented",
    route: "/organization",
    actionLabel: "Open Organization",
    prerequisites: [],
    order: 30,
    isAuthorized: canViewCoreOrganization,
  },
  {
    key: "workforce",
    title: "Workforce",
    purpose: "Add and manage the people who work in this tenant.",
    group: "foundation",
    availability: "implemented",
    route: "/people",
    actionLabel: "Add workforce",
    // The employee roster needs the official Organization hierarchy to place
    // people into, so this is a real dependency rather than a sequencing
    // preference.
    prerequisites: ["organization"],
    order: 40,
    isAuthorized: canAccessCorePeople,
  },
  {
    key: "workforce-access",
    title: "Workforce access",
    purpose: "Connect workforce identities to Fusion accounts and access.",
    group: "foundation",
    availability: "implemented",
    route: "/workforce-access",
    actionLabel: "Manage workforce access",
    prerequisites: ["workforce"],
    order: 50,
    isAuthorized: canViewWorkforceAccess,
  },
  {
    key: "performance",
    title: "Performance",
    purpose:
      "Prepare and run Performance processes using trusted organization and workforce data.",
    group: "module",
    availability: "planned",
    requiresEntitlement: "performance",
    prerequisites: ["workforce"],
    order: 60,
    isAuthorized: canAccessCoreSetup,
  },
];

/**
 * Catches the catalog mistakes that would reach a user as a broken affordance:
 * an actionable entry with nowhere to go, or a planned entry advertising a route
 * that does not exist.
 */
export function findCatalogDefects(
  capabilities: SetupCapability[] = SETUP_CAPABILITIES
): string[] {
  const defects: string[] = [];
  const keys = new Set(capabilities.map((capability) => capability.key));

  for (const capability of capabilities) {
    if (capability.availability === "implemented" && !capability.route) {
      defects.push(`${capability.key}: implemented but has no route`);
    }

    if (capability.availability === "planned" && capability.route) {
      defects.push(`${capability.key}: planned but declares a route`);
    }

    if (capability.route && !capability.actionLabel) {
      defects.push(`${capability.key}: has a route but no action label`);
    }

    for (const prerequisite of capability.prerequisites) {
      if (!keys.has(prerequisite)) {
        defects.push(`${capability.key}: unknown prerequisite "${prerequisite}"`);
      }
    }
  }

  return defects;
}

import { describe, expect, it } from "vitest";
import type { AuthUser } from "@repo/auth";
import type { OrganizationReadinessDto } from "@repo/api";
import { findCatalogDefects, type SetupCapability } from "./catalog";
import {
  capabilitiesInGroup,
  composeSetupCapabilities,
  deriveLaunchpadVariant,
  recommendedNextStep,
} from "./compose";

/**
 * The launchpad's job is to be truthful about five separate things — whether a
 * capability exists, whether the tenant is entitled to it, whether this user may
 * use it, whether its prerequisites are met, and how far it has got. These tests
 * exist mostly to stop those collapsing into one reassuring status.
 */

function grants(...permissionKeys: string[]) {
  return permissionKeys.map((permissionKey) => ({ permissionKey, scope: "Tenant" }));
}

const ADMIN = {
  userId: "user-1",
  effectivePermissions: grants(
    "core.setup.manage",
    "core.structure.publish",
    "core.employee.view",
    "core.organization.manage",
    "core.access.manage",
    "access.assignments.manage"
  ),
  moduleEntitlements: ["core"],
} as unknown as AuthUser;

function setupState(overrides: Partial<OrganizationReadinessDto>): OrganizationReadinessDto {
  return {
    isReady: false,
    reason: "The organization has not been established.",
    hasPermanentRoot: false,
    permanentRootId: null,
    permanentRootFirstEffectiveDate: null,
    isPermanentRootEffective: false,
    ...overrides,
  };
}

function compose(overrides: {
  user?: AuthUser | null;
  entitlements?: string[];
  setupState?: OrganizationReadinessDto | null | undefined;
  workforceTotalCount?: number | null | undefined;
  administratorCount?: number | null | undefined;
  capabilities?: SetupCapability[];
}) {
  return composeSetupCapabilities({
    user: overrides.user ?? ADMIN,
    entitlements: overrides.entitlements ?? ["core"],
    // `??` would swallow an explicit null, which is exactly the failed-to-load
    // case these tests need to express.
    setupState: "setupState" in overrides ? overrides.setupState : setupState({}),
    workforceTotalCount:
      "workforceTotalCount" in overrides
        ? overrides.workforceTotalCount
        : 0,
    administratorCount:
      "administratorCount" in overrides ? overrides.administratorCount : 1,
    capabilities: overrides.capabilities,
  });
}

function byKey(entries: ReturnType<typeof compose>, key: string) {
  const entry = entries.find((item) => item.capability.key === key);
  if (!entry) throw new Error(`No composed capability for ${key}`);
  return entry;
}

describe("setup capability catalog", () => {
  it("has no entry that would render a broken affordance", () => {
    expect(findCatalogDefects()).toEqual([]);
  });

  it("rejects an actionable entry with no route", () => {
    const defects = findCatalogDefects([
      {
        key: "broken",
        title: "Broken",
        purpose: "Has an action but nowhere to go.",
        group: "foundation",
        availability: "implemented",
        prerequisites: [],
        order: 1,
        isAuthorized: () => true,
      },
    ]);

    expect(defects).toContain("broken: implemented but has no route");
  });

  it("rejects a planned entry that advertises a route", () => {
    const defects = findCatalogDefects([
      {
        key: "premature",
        title: "Premature",
        purpose: "Planned but linkable.",
        group: "foundation",
        availability: "planned",
        route: "/nowhere",
        actionLabel: "Open",
        prerequisites: [],
        order: 1,
        isAuthorized: () => true,
      },
    ]);

    expect(defects).toContain("premature: planned but declares a route");
  });

  it("orders capabilities by declared order and groups them", () => {
    const composed = compose({});
    const foundation = capabilitiesInGroup(composed, "foundation");

    // The buildout ladder is the sequential foundation only; tenant
    // configuration is administration, not a rung, so it groups apart.
    expect(foundation.map((entry) => entry.capability.key)).toEqual([
      "administrator-access",
      "organization",
      "workforce",
      "workforce-access",
    ]);
    expect(
      capabilitiesInGroup(composed, "administration").map((e) => e.capability.key)
    ).toEqual(["tenant-configuration"]);
    expect(capabilitiesInGroup(composed, "module").map((e) => e.capability.key)).toEqual([
      "performance",
    ]);
  });
});

describe("composed capability state", () => {
  it("marks administrator access ready once the tenant has an administrator", () => {
    const entry = byKey(compose({ administratorCount: 2 }), "administrator-access");

    expect(entry.state).toBe("ready");
    expect(entry.detail).toBe("2 administrators");
    expect(entry.isActionable).toBe(true);
    expect(entry.capability.route).toBe("/settings/roles/administrators");
  });

  it("stays ready without a count, since a visible reader is an administrator", () => {
    const entry = byKey(compose({ administratorCount: null }), "administrator-access");

    expect(entry.state).toBe("ready");
    expect(entry.detail).toBeNull();
  });

  it("declines to guess administrator access while the count is loading", () => {
    const entry = byKey(compose({ administratorCount: undefined }), "administrator-access");

    expect(entry.state).toBe("unknown");
    expect(entry.isActionable).toBe(true);
  });

  it("reads organization progress from the owning capability", () => {
    expect(byKey(compose({}), "organization").state).toBe("not-started");

    expect(
      byKey(compose({ setupState: setupState({ hasPermanentRoot: true, permanentRootFirstEffectiveDate: "2026-09-01" }) }), "organization")
        .state
    ).toBe("in-progress");

    expect(
      byKey(
        compose({ setupState: setupState({ isReady: true, hasPermanentRoot: true, isPermanentRootEffective: true }) }),
        "organization"
      ).state
    ).toBe("ready");
  });

  it("keeps a planned capability inert", () => {
    const entry = byKey(compose({}), "tenant-configuration");

    expect(entry.state).toBe("planned");
    expect(entry.isActionable).toBe(false);
    expect(entry.capability.route).toBeUndefined();
  });

  it("distinguishes planned from a real unmet prerequisite", () => {
    const composed = compose({});

    // Both are unusable today, but for different reasons, and the page has to
    // say which: one is waiting on the roadmap, the other on the tenant.
    expect(byKey(composed, "tenant-configuration").state).toBe("planned");
    expect(byKey(composed, "workforce").state).toBe("blocked");
    expect(byKey(composed, "workforce").blockedBy).toBe("Organization");
  });

  it("unblocks a dependent capability once its prerequisite is ready", () => {
    const composed = compose({
      setupState: setupState({ isReady: true, hasPermanentRoot: true, isPermanentRootEffective: true }),
    });

    const workforce = byKey(composed, "workforce");
    expect(workforce.state).toBe("not-started");
    expect(workforce.isActionable).toBe(true);
  });

  it("uses the canonical workforce total without displaying invented progress", () => {
    const empty = byKey(
      compose({
        setupState: setupState({ isReady: true, hasPermanentRoot: true, isPermanentRootEffective: true }),
        workforceTotalCount: 0,
      }),
      "workforce"
    );
    const meaningful = byKey(
      compose({
        setupState: setupState({ isReady: true, hasPermanentRoot: true, isPermanentRootEffective: true }),
        workforceTotalCount: 3,
      }),
      "workforce"
    );

    expect(empty.state).toBe("not-started");
    expect(meaningful.state).toBe("ready");
  });

  it("retains the safe workforce route when its progress read fails", () => {
    const workforce = byKey(
      compose({
        setupState: setupState({ isReady: true, hasPermanentRoot: true, isPermanentRootEffective: true }),
        workforceTotalCount: null,
      }),
      "workforce"
    );

    expect(workforce.state).toBe("unknown");
    expect(workforce.isActionable).toBe(true);
  });

  it("does not turn an unknown status into planned or ready", () => {
    const composed = compose({ setupState: null });
    const organization = byKey(composed, "organization");

    expect(organization.state).toBe("unknown");
    expect(organization.isActionable).toBe(false);
    // A capability waiting on an unknown one is also unknown, not blocked:
    // claiming a prerequisite is unmet would assert something we did not read.
    expect(byKey(composed, "workforce").state).toBe("unknown");
  });

  it("treats an unentitled module as excluded rather than unfinished", () => {
    const entry = byKey(compose({ entitlements: ["core"] }), "performance");

    expect(entry.state).toBe("not-included");
    expect(entry.isActionable).toBe(false);
  });

  it("does not let entitlement imply readiness", () => {
    const entry = byKey(
      compose({ entitlements: ["core", "performance"] }),
      "performance"
    );

    expect(entry.state).toBe("planned");
    expect(entry.isActionable).toBe(false);
    expect(entry.blockedBy).toBe("Workforce");
  });

  it("hides capabilities the user is not authorized for", () => {
    const reader = {
      userId: "user-2",
      effectivePermissions: grants("core.setup.view"),
      moduleEntitlements: ["core"],
    } as unknown as AuthUser;

    const composed = compose({ user: reader });

    // Not the same as "not included": the tenant may well have this, the reader
    // simply may not see it — so the row is absent rather than described.
    expect(composed.find((e) => e.capability.key === "administrator-access")).toBeUndefined();
  });
});

describe("recommended next step", () => {
  it("does not recommend administrator access just because one administrator exists", () => {
    const recommendation = recommendedNextStep(compose({}));

    expect(recommendation?.capability.key).not.toBe("administrator-access");
  });

  it("recommends the first real actionable foundation step", () => {
    expect(recommendedNextStep(compose({}))?.capability.key).toBe("organization");
  });

  it("never recommends a planned or blocked capability", () => {
    const recommendation = recommendedNextStep(compose({}));

    expect(recommendation?.capability.availability).toBe("implemented");
    expect(recommendation?.isActionable).toBe(true);
  });

  it("omits the recommendation when nothing meaningful remains", () => {
    const composed = compose({
      setupState: setupState({ isReady: true, hasPermanentRoot: true, isPermanentRootEffective: true }),
      workforceTotalCount: 2,
    });

    // Organization is ready and workforce reports no progress source, so there is
    // no honest "next step" left to emphasize.
    expect(recommendedNextStep(composed)).toBeNull();
  });

  it("omits the recommendation when status is unknown", () => {
    expect(
      recommendedNextStep(
        compose({ setupState: null, workforceTotalCount: null })
      )
    ).toBeNull();
  });

  it("recommends workforce after organization is ready and the roster is empty", () => {
    const recommendation = recommendedNextStep(
      compose({
        setupState: setupState({ isReady: true, hasPermanentRoot: true, isPermanentRootEffective: true }),
        workforceTotalCount: 0,
      })
    );

    expect(recommendation?.capability.key).toBe("workforce");
  });
});

describe("launchpad variant", () => {
  it("derives fresh, underway, mature, and indeterminate from owning data", () => {
    const fresh = compose({ workforceTotalCount: 0 });
    const organizationUnderway = compose({
      setupState: setupState({ hasPermanentRoot: true, permanentRootFirstEffectiveDate: "2026-09-01" }),
      workforceTotalCount: 0,
    });
    const workforceUnderway = compose({
      setupState: setupState({ isReady: true, hasPermanentRoot: true, isPermanentRootEffective: true }),
      workforceTotalCount: 0,
    });
    const mature = compose({
      setupState: setupState({ isReady: true, hasPermanentRoot: true, isPermanentRootEffective: true }),
      workforceTotalCount: 1,
    });
    const indeterminate = compose({
      setupState: null,
      workforceTotalCount: null,
    });

    expect(deriveLaunchpadVariant(fresh, 0)).toBe("fresh");
    expect(deriveLaunchpadVariant(organizationUnderway, 0)).toBe("underway");
    expect(deriveLaunchpadVariant(workforceUnderway, 0)).toBe("underway");
    expect(deriveLaunchpadVariant(mature, 1)).toBe("mature");
    expect(deriveLaunchpadVariant(indeterminate, null)).toBe("indeterminate");
  });
});

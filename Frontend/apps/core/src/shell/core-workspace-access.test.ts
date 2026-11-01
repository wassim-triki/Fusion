import { describe, expect, it } from "vitest";
import type { AuthUser } from "@repo/auth";
import {
  buildCoreCallbackUrl,
  resolveCoreWorkspaceAccessState,
} from "./core-workspace-access";

function grant(permissionKey: string): AuthUser["effectivePermissions"][number] {
  return {
    permissionKey,
    scope: "Tenant",
    label: permissionKey,
    group: "Test",
    helperText: null,
    allowedScopes: ["Tenant"],
  };
}

function createUser(
  roles: string[],
  overrides: Partial<AuthUser> = {}
): AuthUser {
  return {
    userId: "user-1",
    tenantId: "tenant-1",
  tenantMembershipId: "membership-1",
  moduleEntitlements: ["CoreHR", "Performance"],
    email: "user@example.com",
    fullName: "Test User",
    roles,
    employeeId: null,
    accessProfiles: [],
    effectivePermissions: [],
    ...overrides,
  };
}

describe("resolveCoreWorkspaceAccessState", () => {
  it("waits for the authenticated session", () => {
    expect(
      resolveCoreWorkspaceAccessState({ isLoading: true, user: null })
    ).toBe("loading");
  });

  it("requires sign-in when no account is present", () => {
    expect(
      resolveCoreWorkspaceAccessState({ isLoading: false, user: null })
    ).toBe("sign-in-required");
  });

  it("denies Platform Administrator accounts", () => {
    expect(
      resolveCoreWorkspaceAccessState({
        isLoading: false,
        user: createUser(["PlatformAdmin", "HRAdmin"]),
      })
    ).toBe("forbidden");
  });

  it("allows tenant accounts to continue to permission-aware Core routes", () => {
    expect(
      resolveCoreWorkspaceAccessState({
        isLoading: false,
        user: createUser(["HRAdmin"]),
      })
    ).toBe("allowed");
  });

  it("renders Core business routes as module unavailable without CoreHR entitlement", () => {
    expect(resolveCoreWorkspaceAccessState({
      isLoading: false,
      user: createUser(["Employee"], { moduleEntitlements: [] }),
      pathname: "/core/employees",
    })).toBe("module-unavailable");
  });

  it("allows tenant-level Access without CoreHR entitlement when authorized", () => {
    expect(resolveCoreWorkspaceAccessState({
      isLoading: false,
      user: createUser(["HRAdmin"], {
        moduleEntitlements: [],
        effectivePermissions: [grant("access.assignments.view")],
      }),
      pathname: "/core/access",
    })).toBe("allowed");
  });

  it("restores the Core base path for a direct root request", () => {
    expect(buildCoreCallbackUrl("/", "")).toBe("/core");
  });

  it("preserves nested Core paths and their query", () => {
    expect(buildCoreCallbackUrl("/employees/person-1", "tab=job")).toBe(
      "/core/employees/person-1?tab=job"
    );
  });

});

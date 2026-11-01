import { describe, expect, it } from "vitest";
import type { AuthUser } from "@repo/auth";
import { resolveShellEntryState } from "./shell-entry";

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

function makeUser(roles: string[], overrides: Partial<AuthUser> = {}): AuthUser {
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

describe("resolveShellEntryState", () => {
  it("keeps the destination hidden while the session resolves", () => {
    expect(
      resolveShellEntryState({
        isLoading: true,
        user: makeUser(["PlatformAdmin"], {
          tenantId: null,
          tenantMembershipId: null,
          moduleEntitlements: [],
        }),
      }),
    ).toEqual({ kind: "loading" });
  });

  it("routes platform administrators to the control plane", () => {
    expect(
      resolveShellEntryState({
        isLoading: false,
        user: makeUser(["PlatformAdmin"], {
          tenantId: null,
          tenantMembershipId: null,
          moduleEntitlements: [],
        }),
      }),
    ).toEqual({ kind: "redirect", destination: "/platform" });
  });

  it("renders the Fusion home for a Tenant Administrator, where the setup guide lives", () => {
    expect(
      resolveShellEntryState({
        isLoading: false,
        user: makeUser(["HRAdmin"], {
          effectivePermissions: [grant("access.assignments.view")],
        }),
      }),
    ).toEqual({ kind: "home" });
  });

  it("renders the Fusion home for an employee who can enter a module", () => {
    expect(
      resolveShellEntryState({
        isLoading: false,
        user: makeUser([], {
          effectivePermissions: [grant("core.employee.view")],
        }),
      }),
    ).toEqual({ kind: "home" });
  });

  it("shows the no-workspace state when no entitled module can be entered", () => {
    expect(
      resolveShellEntryState({
        isLoading: false,
        user: makeUser([], { moduleEntitlements: ["CoreHR"] }),
      }),
    ).toEqual({ kind: "no-usable-context" });
  });

  it("shows an explicit state instead of the developer catalogue without usable access", () => {
    expect(resolveShellEntryState({
      isLoading: false,
      user: makeUser([], {
        tenantId: null,
        tenantMembershipId: null,
        moduleEntitlements: [],
      }),
    })).toEqual({ kind: "no-usable-context" });
  });
});

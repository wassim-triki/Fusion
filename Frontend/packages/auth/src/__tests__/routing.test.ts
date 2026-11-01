import { describe, expect, it } from "vitest";
import type { AuthUser } from "../types";
import {
  resolveDefaultProductDestination,
  resolvePostSignInDestination,
  sanitizeInternalReturnPath,
} from "../routing";

const ORIGIN = "http://localhost:3000";

function grant(permissionKey: string) {
  return {
    permissionKey,
    scope: "Tenant" as const,
    label: permissionKey,
    group: "Test",
    helperText: null,
    allowedScopes: ["Tenant" as const],
  };
}

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    userId: "user-1",
    tenantId: "tenant-1",
    tenantMembershipId: "membership-1",
    moduleEntitlements: ["CoreHR"],
    email: "user@example.com",
    fullName: "Test User",
    roles: ["Employee"],
    employeeId: null,
    accessProfiles: [],
    effectivePermissions: [],
    ...overrides,
  };
}

describe("sanitizeInternalReturnPath", () => {
  it.each([
    ["/core/access", "/core/access"],
    ["/core/employees?tab=active", "/core/employees?tab=active"],
    ["/setup#section", "/setup#section"],
    ["/core/search?q=a%2Fb%20c", "/core/search?q=a%2Fb%20c"],
    [`${ORIGIN}/platform/tenants`, "/platform/tenants"],
  ])("accepts trusted internal destination %s", (candidate, expected) => {
    expect(sanitizeInternalReturnPath(candidate, ORIGIN)).toBe(expected);
  });

  it.each([
    "//evil.example",
    "/\\evil.example",
    "/\\\\evil.example",
    "/%5cevil.example",
    "/%255cevil.example",
    "https://evil.example",
    "http://evil.example",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "http://user:pass@localhost:3000/core",
    "/core/\u0000access",
    "http://[invalid",
  ])("rejects unsafe destination %s", (candidate) => {
    expect(sanitizeInternalReturnPath(candidate, ORIGIN)).toBeNull();
  });
});

describe("default product destination", () => {
  const admin = () => user({ effectivePermissions: [grant("access.assignments.view")] });

  it("routes a Platform Administrator to Platform", () => {
    expect(resolveDefaultProductDestination(user({
      tenantId: null,
      tenantMembershipId: null,
      moduleEntitlements: [],
      roles: ["PlatformAdmin"],
    }))).toBe("/platform");
  });

  it("lands a Tenant Administrator on the Fusion home, where the setup guide lives", () => {
    expect(resolveDefaultProductDestination(admin())).toBe("/");
  });

  it("lands an employee who can enter a module on the Fusion home", () => {
    expect(resolveDefaultProductDestination(user({
      moduleEntitlements: ["CoreHR", "Performance"],
      effectivePermissions: [grant("core.employee.view")],
    }))).toBe("/");
    expect(resolveDefaultProductDestination(user({
      employeeId: "emp-1",
      effectivePermissions: [
        { ...grant("core.team.view"), scope: "DirectReports", allowedScopes: ["DirectReports"] },
      ],
    }))).toBe("/");
  });

  it("lands a Performance-only tenant user on the Fusion home", () => {
    expect(resolveDefaultProductDestination(user({
      moduleEntitlements: ["Performance"],
      effectivePermissions: [
        { ...grant("performance.objective.self.manage"), scope: "Self", allowedScopes: ["Self"] },
      ],
    }))).toBe("/");
  });

  it("returns no destination when no entitled module can be entered", () => {
    expect(resolveDefaultProductDestination(user({ moduleEntitlements: ["CoreHR"] }))).toBeNull();
    expect(resolveDefaultProductDestination(user({
      moduleEntitlements: ["Performance"],
      effectivePermissions: [grant("core.employee.view")],
    }))).toBeNull();
  });

  it("returns no destination when the account has no usable context", () => {
    expect(resolveDefaultProductDestination(user({
      tenantId: null,
      tenantMembershipId: null,
      moduleEntitlements: [],
    }))).toBeNull();
  });

  it("lets a safe callback win over the Fusion home", () => {
    expect(resolvePostSignInDestination({
      intendedDestination: "/performance/plan",
      user: user({
        moduleEntitlements: ["Performance"],
        effectivePermissions: [{ ...grant("performance.objective.self.manage"), scope: "Self", allowedScopes: ["Self"] }],
      }),
      trustedOrigin: ORIGIN,
    })).toBe("/performance/plan");
  });

  it("lets a safe intended destination override the default", () => {
    expect(resolvePostSignInDestination({
      intendedDestination: "/core/access",
      user: user({ effectivePermissions: [grant("core.employee.view")] }),
      trustedOrigin: ORIGIN,
    })).toBe("/core/access");
  });

  it("lets a safe callback win over the admin landing", () => {
    expect(resolvePostSignInDestination({
      intendedDestination: "/core/organization",
      user: admin(),
      trustedOrigin: ORIGIN,
    })).toBe("/core/organization");
  });

  it("ignores an unsafe intended destination", () => {
    expect(resolvePostSignInDestination({
      intendedDestination: "/\\evil.example",
      user: user({ effectivePermissions: [grant("core.employee.view")] }),
      trustedOrigin: ORIGIN,
    })).toBe("/");
  });
});

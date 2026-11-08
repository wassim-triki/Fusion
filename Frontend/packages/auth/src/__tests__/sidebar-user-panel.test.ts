import { describe, expect, it } from "vitest";
import type { AuthUser } from "../types";
import { getSidebarAccountLabel } from "../components/sidebar-user-panel";

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    userId: "account-1",
    tenantId: "tenant-1",
    tenantMembershipId: "membership-1",
    moduleEntitlements: ["CoreHR"],
    email: "admin@example.test",
    fullName: "Ada Admin",
    roles: ["Employee"],
    employeeId: null,
    accessProfiles: [],
    effectivePermissions: [],
    ...overrides,
  };
}

const tenantAdministratorProfile = {
  id: "profile-1",
  name: "Administrator",
  type: "System",
  isSystemProtected: true,
};

describe("getSidebarAccountLabel", () => {
  it.each(["bootstrap", "additional"])(
    "labels a %s administrator without an Employee link truthfully",
    () => {
      expect(
        getSidebarAccountLabel(user({ accessProfiles: [tenantAdministratorProfile] }))
      ).toBe("Administrator");
    }
  );

  it("keeps Employee for a genuinely employee-linked account", () => {
    expect(getSidebarAccountLabel(user({ employeeId: "employee-1" }))).toBe("Employee");
  });

  it("uses a neutral label after authority removal while membership remains", () => {
    expect(getSidebarAccountLabel(user())).toBe("Account");
  });
});

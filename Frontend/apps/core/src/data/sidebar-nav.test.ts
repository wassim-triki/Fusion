import { describe, expect, it } from "vitest";
import { ADMIN_NAV } from "./sidebar-nav";

describe("tenant administration navigation", () => {
  it("reaches Administrators through Settings › Roles, not a sidebar entry of its own (B-178)", () => {
    const labels = ADMIN_NAV.items.map((item) => item.label);
    expect(labels).not.toContain("administrators");
    expect(labels).toContain("settings");
  });

  it("exposes no retired setup-era navigation", () => {
    for (const item of ADMIN_NAV.items) {
      expect(item.href).not.toBe("/setup");
      expect(item.href).not.toBe("/tenant-setup");
      expect(item.navigateHref).not.toBe("/setup");
    }
  });
});

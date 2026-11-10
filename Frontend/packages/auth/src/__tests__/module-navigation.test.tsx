import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCorePages, usePerformancePages } from "../module-navigation";
import { makeAuthUser } from "./helpers";
import type { AuthUser } from "../types";

const { state } = vi.hoisted(() => ({
  state: { user: null as AuthUser | null, destinations: null as Record<string, boolean> | null, enterable: ["performance"] as string[] },
}));

vi.mock("../auth-context", () => ({ useAuth: () => ({ user: state.user, isLoading: false }) }));
vi.mock("@repo/api/query", () => ({
  useFieldVisibility: () => ({ data: undefined, isLoading: false }),
  useApiQuery: () => ({ data: state.destinations ? { destinations: state.destinations } : undefined, isLoading: !state.destinations }),
}));
vi.mock("@repo/api/react", () => ({
  useFusionViewer: () => ({ viewer: { enterableModules: state.enterable }, isLoading: false }),
}));
vi.mock("@repo/api", async (original) => ({
  ...(await original<typeof import("@repo/api")>()),
  createPlatformApiClient: () => ({}),
  createPerformanceApi: () => ({ getWorkspaceContext: vi.fn() }),
}));

const hrefs = (items: { href: string }[]) => items.map((item) => item.href);

describe("Core HR's pages", () => {
  it("an employee sees Overview, their profile and People; HR sees the whole set and may open Settings", () => {
    state.user = makeAuthUser({
      roles: ["Employee"],
      effectivePermissions: [{ permissionKey: "core.profile.self.view", scope: "Self" }] as AuthUser["effectivePermissions"],
    });
    const employee = renderHook(() => useCorePages()).result.current;
    expect(hrefs(employee.items)).toEqual(["/", "/profile", "/people"]);
    expect(employee.settings).toBe(false);

    const tenant = (permissionKey: string) => ({ permissionKey, scope: "Tenant" as const });
    state.user = makeAuthUser({
      effectivePermissions: [
        "core.profile.self.view", "core.employee.view", "core.organization.view", "core.employee.manage", "core.overview.view", "core.settings.view",
      ].map(tenant) as AuthUser["effectivePermissions"],
    });
    const admin = renderHook(() => useCorePages()).result.current;
    expect(hrefs(admin.items)).toEqual(["/", "/profile", "/team", "/people", "/organization", "/changes", "/reports"]);
    expect(admin.settings).toBe(true);
  });
});

describe("Performance's pages", () => {
  it("follows the server's destinations and carries the year being looked at, except into 1:1s and Feedback", () => {
    state.destinations = { myPlan: true, oneOnOnes: true, feedback: true, reviews: false, settings: true };
    const pages = renderHook(() => usePerformancePages("fy27")).result.current;
    expect(pages.items.map((item) => [item.href, item.navigateHref])).toEqual([
      ["/", "/?cycle=fy27"],
      ["/goals", "/goals?cycle=fy27"],
      ["/one-on-ones", undefined],
      ["/feedback", undefined],
    ]);
    expect(pages.settings).toBe(true);
    expect(pages.pending).toBe(false);
  });

  it("holds its pages while the destinations load, and offers none to someone who can't enter", () => {
    state.destinations = null;
    expect(renderHook(() => usePerformancePages()).result.current.pending).toBe(true);
    state.enterable = [];
    const outside = renderHook(() => usePerformancePages()).result.current;
    expect(outside.pending).toBe(false);
    expect(hrefs(outside.items)).toEqual(["/", "/goals"]);
  });
});

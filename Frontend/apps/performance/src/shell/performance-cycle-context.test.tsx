// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, type AuthUser } from "@repo/auth";
import { IntlTestProvider } from "@repo/ds/testing";
import dsEn from "@repo/ds/messages/en.json";
import { englishMessages } from "@/i18n/messages";
import { PerformanceCycleContext } from "./performance-cycle-context";

const route = vi.hoisted(() => ({ pathname: "" }));
const reads = vi.hoisted(() => ({
  cycle: [] as boolean[],
  context: [] as boolean[],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/features/performance/api/use-performance", () => ({
  useCurrentCycle: (enabled = true) => {
    reads.cycle.push(enabled);
    return { data: undefined, error: null, isLoading: false };
  },
}));
vi.mock("@/features/performance/api/use-workspace", () => ({
  useWorkspaceContext: (enabled = true) => {
    reads.context.push(enabled);
    return { data: undefined, error: null, isLoading: false };
  },
}));

const viewer: AuthUser = {
  userId: "test-viewer",
  tenantId: "tenant-1",
  tenantMembershipId: "membership-1",
  moduleEntitlements: ["Performance"],
  email: "viewer@example.test",
  fullName: "Test Viewer",
  roles: ["Employee"],
  employeeId: null,
  accessProfiles: [],
  effectivePermissions: [
    {
      permissionKey: "performance.cycle.view",
      scope: "Tenant",
      label: "",
      group: "",
      helperText: null,
      allowedScopes: ["Tenant"],
    },
  ],
  language: "en",
};

function store(user: AuthUser) {
  localStorage.setItem(
    "ey_hr_auth",
    JSON.stringify({
      user,
      accessToken: "test-access",
      refreshToken: "test-refresh",
      accessTokenExpiration: new Date(Date.now() + 3600000).toISOString(),
    })
  );
}

function renderHeader() {
  return render(
    <IntlTestProvider locale="en" messages={{ ...dsEn, ...englishMessages }}>
      <AuthProvider>
        <PerformanceCycleContext />
      </AuthProvider>
    </IntlTestProvider>
  );
}

const anyEnabled = () => [...reads.cycle, ...reads.context].some(Boolean);

beforeEach(() => {
  localStorage.clear();
  reads.cycle.length = 0;
  reads.context.length = 0;
});
afterEach(() => localStorage.clear());

describe("PerformanceCycleContext header reads", () => {
  it("reads the cycle once the session may enter Performance", async () => {
    route.pathname = "/performance";
    store(viewer);
    renderHeader();
    await waitFor(() => expect(reads.cycle.at(-1)).toBe(true));
    expect(reads.context.at(-1)).toBe(true);
  });

  it("reads nothing while signed out, before or after the session restores", async () => {
    route.pathname = "/performance";
    // A stale sign-in hint with no stored session.
    document.cookie = "ey_hr_authenticated=true; path=/";
    renderHeader();
    await waitFor(() =>
      expect(document.cookie).not.toContain("ey_hr_authenticated=true")
    );
    expect(reads.cycle.length).toBeGreaterThan(0);
    expect(anyEnabled()).toBe(false);
  });

  it("reads nothing for a session without Performance access", async () => {
    route.pathname = "/performance";
    store({ ...viewer, moduleEntitlements: ["CoreHR"] });
    const { container } = renderHeader();
    await waitFor(() =>
      expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
    );
    expect(anyEnabled()).toBe(false);
  });

  it.each([
    "/performance/one-on-ones",
    "/performance/one-on-ones/series-1",
    "/performance/feedback",
  ])("reads nothing on the cycle-free route %s", async (pathname) => {
    route.pathname = pathname;
    store(viewer);
    renderHeader();
    // Let the session restore and hydration settle before asserting.
    await waitFor(() => expect(reads.cycle.length).toBeGreaterThan(1));
    expect(anyEnabled()).toBe(false);
  });
});

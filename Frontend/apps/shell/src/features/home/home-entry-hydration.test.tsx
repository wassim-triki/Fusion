// @vitest-environment jsdom
import { act, useEffect } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth, type AuthUser } from "@repo/auth";
import { IntlTestProvider } from "@repo/ds/testing";
import { shellMessages } from "@/test/intl";
import HomePage from "@/app/page";
import { HomeSkeleton } from "./home-skeleton";

const probe = vi.hoisted(() => ({
  requests: vi.fn(),
  renders: [] as boolean[],
}));
vi.mock("./home-frame", () => ({
  HomeFrame: ({ children }: { children: React.ReactNode }) => (
    <div>
      <aside>Navigation</aside>
      <header>Fusion</header>
      <main>{children}</main>
    </div>
  ),
}));
vi.mock("./fusion-home", () => ({
  FusionHomeContent: function PendingHome() {
    const auth = useAuth();
    probe.renders.push(auth.isLoading || !auth.user);
    useEffect(() => {
      probe.requests();
    }, []);
    return <HomeSkeleton />;
  },
}));

const viewer: AuthUser = {
  userId: "test-viewer",
  tenantId: "tenant-1",
  tenantMembershipId: "membership-1",
  moduleEntitlements: ["CoreHR"],
  email: "viewer@example.test",
  fullName: "Test Viewer",
  roles: ["Employee"],
  employeeId: null,
  accessProfiles: [],
  language: "en",
  effectivePermissions: [
    {
      permissionKey: "core.employee.view",
      scope: "Tenant",
      label: "",
      group: "",
      helperText: null,
      allowedScopes: ["Tenant"],
    },
  ],
};
let root: Root | undefined;
let container: HTMLDivElement;
function tree() {
  return (
    <IntlTestProvider locale="en" messages={shellMessages.en}>
      <AuthProvider>
        <HomePage />
      </AuthProvider>
    </IntlTestProvider>
  );
}
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
beforeEach(() => {
  localStorage.clear();
  probe.requests.mockClear();
  probe.renders = [];
  container = document.createElement("div");
  document.body.append(container);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Home entry readiness", () => {
  it("keeps frame nodes and pending geometry while admitting Home after hydration", async () => {
    store(viewer);
    container.innerHTML = renderToString(tree());
    const frame = [
      container.querySelector("aside"),
      container.querySelector("header"),
      container.querySelector("main"),
    ];
    const shape = () =>
      Array.from(container.querySelectorAll('[data-slot="skeleton"]')).map(
        (el) => el.className
      );
    const pending = shape();
    expect(pending.length).toBeGreaterThan(0);
    expect(probe.requests).not.toHaveBeenCalled();
    const errors: unknown[] = [];
    await act(async () => {
      root = hydrateRoot(container, tree(), {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    expect(errors).toEqual([]);
    expect([
      container.querySelector("aside"),
      container.querySelector("header"),
      container.querySelector("main"),
    ]).toEqual(frame);
    frame.forEach((node, i) =>
      expect(node).toBe(
        container.querySelector(["aside", "header", "main"][i]!)
      )
    );
    expect(shape()).toEqual(pending);
    expect(probe.requests).toHaveBeenCalledTimes(1);
    expect(probe.renders.every((unresolved) => !unresolved)).toBe(true);
  });

  it("retains the frame without mounting Home data for an account without a workspace", async () => {
    store({
      ...viewer,
      tenantId: null,
      moduleEntitlements: [],
      effectivePermissions: [],
    });
    container.innerHTML = renderToString(tree());
    const frame = container.querySelector("main");
    await act(async () => {
      root = hydrateRoot(container, tree());
    });
    expect(container.querySelector("main")).toBe(frame);
    expect(container.textContent).toContain("No workspace is available");
    expect(probe.requests).not.toHaveBeenCalled();
  });
});

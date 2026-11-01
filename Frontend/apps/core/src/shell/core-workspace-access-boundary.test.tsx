// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@repo/auth";
import { CoreWorkspaceAccessBoundary } from "./core-workspace-access-boundary";

const mocks = vi.hoisted(() => ({
  pathname: "/core/employees",
  user: null as AuthUser | null,
  isLoading: false,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@repo/auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAuth: () => ({ user: mocks.user, isLoading: mocks.isLoading }),
    // The boundary consumes the shared hydration-safe mechanism. Feed it the
    // controlled auth values and run the module's resolver, as it does once
    // hydration has settled (the hydration hold itself is unit-tested in
    // @repo/auth). This keeps the boundary's state→UI mapping under test.
    useHydratedWorkspaceAccess: (
      resolve: (input: { user: AuthUser | null; isLoading: boolean }) => string,
    ) => {
      const state = mocks.isLoading
        ? "loading"
        : resolve({ user: mocks.user, isLoading: mocks.isLoading });
      return {
        state,
        user: mocks.user,
        isLoading: mocks.isLoading,
        hydrated: !mocks.isLoading,
      };
    },
  };
});

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

describe("CoreWorkspaceAccessBoundary", () => {
  beforeEach(() => {
    mocks.pathname = "/core/employees";
    mocks.user = user();
    mocks.isLoading = false;
  });

  it("does not render Core children when the module is unavailable", async () => {
    mocks.user = user({ moduleEntitlements: [] });
    render(<CoreWorkspaceAccessBoundary><div>Protected Core content</div></CoreWorkspaceAccessBoundary>);
    expect(await screen.findByRole("heading", { name: "Core HR is not available" })).toBeTruthy();
    expect(screen.queryByText("Protected Core content")).toBeNull();
  });

  it("renders allowed Core content", async () => {
    render(<CoreWorkspaceAccessBoundary><div>Protected Core content</div></CoreWorkspaceAccessBoundary>);
    expect(await screen.findByText("Protected Core content")).toBeTruthy();
  });

  it("renders a truthful permission denial for a tenant-level route", async () => {
    mocks.pathname = "/access";
    mocks.user = user({ moduleEntitlements: [] });
    render(<CoreWorkspaceAccessBoundary><div>Tenant access content</div></CoreWorkspaceAccessBoundary>);
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
    expect(screen.queryByText("Tenant access content")).toBeNull();
  });

  it("allows authorized tenant Access without CoreHR entitlement", async () => {
    mocks.pathname = "/access";
    mocks.user = user({
      moduleEntitlements: [],
      effectivePermissions: [grant("access.assignments.view")],
    });
    render(<CoreWorkspaceAccessBoundary><div>Tenant access content</div></CoreWorkspaceAccessBoundary>);
    expect(await screen.findByText("Tenant access content")).toBeTruthy();
  });

  it("holds children while authentication is resolving", async () => {
    mocks.isLoading = true;
    render(<CoreWorkspaceAccessBoundary><div>Protected Core content</div></CoreWorkspaceAccessBoundary>);
    await waitFor(() => expect(screen.queryByText("Protected Core content")).toBeNull());
    expect(screen.getAllByLabelText("Checking Core HR access").length).toBeGreaterThan(0);
  });
});

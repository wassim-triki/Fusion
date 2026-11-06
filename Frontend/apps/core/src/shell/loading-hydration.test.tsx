// @vitest-environment jsdom
import { act, useEffect, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth, type AuthUser } from "@repo/auth";
import { IntlTestProvider } from "@repo/ds/testing";
import dsEn from "@repo/ds/messages/en.json";
import authEn from "@repo/auth/messages/en.json";
import { englishMessages } from "@/i18n/messages";
import { CoreWorkspaceAccessBoundary } from "./core-workspace-access-boundary";
import { EmployeesPageSkeleton } from "./route-skeletons";
import { WorkerProfileSkeleton } from "@/features/people/components/worker-profile/worker-profile-skeleton";

const route = vi.hoisted(() => ({ pathname: "" }));
vi.mock("@repo/api/query", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCompanyAdministrators: () => ({ isLoading: false, data: undefined }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(),
}));
const viewer: AuthUser = {
  userId: "test-viewer",
  tenantId: "tenant-1",
  tenantMembershipId: "membership-1",
  moduleEntitlements: ["CoreHR", "Performance"],
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
let root: Root | undefined;
let container: HTMLDivElement;
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
function shape() {
  return Array.from(container.querySelectorAll('[data-slot="skeleton"]')).map(
    (el) => el.className
  );
}
beforeEach(() => {
  localStorage.clear();
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

describe("core loading admission and hydration", () => {
  it.each<[string, ComponentType]>([
    ["/core/people", EmployeesPageSkeleton],
    ["/core/people/E-TEST", WorkerProfileSkeleton],
  ])(
    "keeps one pending shape through admission at %s",
    async (pathname, Pending) => {
      route.pathname = pathname;
      store(viewer);
      const reads = vi.fn();
      const renders: { loading: boolean; user: string | undefined }[] = [];
      function ProtectedPage() {
        const auth = useAuth();
        renders.push({ loading: auth.isLoading, user: auth.user?.userId });
        useEffect(() => {
          reads();
        }, []);
        return <Pending />;
      }
      const tree = (
        <IntlTestProvider
          locale="en"
          messages={{ ...dsEn, ...authEn, ...englishMessages }}
        >
          <AuthProvider>
            <main>
              <CoreWorkspaceAccessBoundary>
                <ProtectedPage />
              </CoreWorkspaceAccessBoundary>
            </main>
          </AuthProvider>
        </IntlTestProvider>
      );
      container.innerHTML = renderToString(tree);
      const pending = shape();
      expect(pending.length).toBeGreaterThan(0);
      expect(renders).toEqual([]);
      expect(reads).not.toHaveBeenCalled();
      const frame = container.querySelector("main");
      const errors: unknown[] = [];
      await act(async () => {
        root = hydrateRoot(container, tree, {
          onRecoverableError: (error) => errors.push(error),
        });
      });
      expect(errors).toEqual([]);
      expect(container.querySelector("main")).toBe(frame);
      expect(shape()).toEqual(pending);
      expect(reads).toHaveBeenCalledTimes(1);
      expect(renders.length).toBeGreaterThan(0);
      expect(
        renders.every((value) => !value.loading && value.user === viewer.userId)
      ).toBe(true);
      expect(container.querySelectorAll("button,a,input,select")).toHaveLength(
        0
      );
    }
  );
  it.each<Partial<AuthUser>>([
    { tenantId: null },
    { moduleEntitlements: [] },
    { roles: ["PlatformAdmin"] },
  ])(
    "never mounts protected queries for a denied session %j",
    async (changes) => {
      route.pathname = "/core/people";
      store({ ...viewer, ...changes });
      const reads = vi.fn();
      function ProtectedPage() {
        reads();
        return <p>Protected tenant record</p>;
      }
      const tree = (
        <IntlTestProvider
          locale="en"
          messages={{ ...dsEn, ...authEn, ...englishMessages }}
        >
          <AuthProvider>
            <CoreWorkspaceAccessBoundary>
              <ProtectedPage />
            </CoreWorkspaceAccessBoundary>
          </AuthProvider>
        </IntlTestProvider>
      );
      container.innerHTML = renderToString(tree);
      expect(reads).not.toHaveBeenCalled();
      await act(async () => {
        root = hydrateRoot(container, tree);
      });
      expect(reads).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain("Protected tenant record");
    }
  );
});

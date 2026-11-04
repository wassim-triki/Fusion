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
import { PlatformAccessBoundary } from "./platform-access-boundary";
import { PageContainer } from "@repo/ds/shell";
import { TenantsPageSkeleton } from "@/features/tenants/overview/tenants-page-skeleton";
import { RecordSkeleton } from "@/features/tenants/record/record-skeleton";
function RecordPagePending() {
  return (
    <PageContainer>
      <RecordSkeleton />
    </PageContainer>
  );
}

const route = vi.hoisted(() => ({ pathname: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(),
}));
const viewer: AuthUser = {
  userId: "test-viewer",
  tenantId: null,
  tenantMembershipId: "membership-1",
  moduleEntitlements: [],
  email: "viewer@example.test",
  fullName: "Test Viewer",
  roles: ["PlatformAdmin"],
  employeeId: null,
  accessProfiles: [],
  effectivePermissions: [],
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

describe("platform loading admission and hydration", () => {
  it.each<[string, ComponentType]>([
    ["/platform/tenants", TenantsPageSkeleton],
    ["/platform/tenants/test-tenant", RecordPagePending],
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
              <PlatformAccessBoundary>
                <ProtectedPage />
              </PlatformAccessBoundary>
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
  it.each<Partial<AuthUser>>([{ roles: ["Employee"], tenantId: "tenant-1" }])(
    "never mounts protected queries for a denied session %j",
    async (changes) => {
      route.pathname = "/platform/tenants";
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
            <PlatformAccessBoundary>
              <ProtectedPage />
            </PlatformAccessBoundary>
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

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { useFusionNavigation } from "../query/useFusionNavigation";
import { FusionViewerProvider, useRecentRecord, useRecentRecords, type FusionViewerState } from "../react/fusion-viewer";
import type { FusionAttentionApi, FusionWorkItem } from "../fusion-attention";
import type { FusionNavigationApi, FusionNavigationViewer } from "../fusion-navigation";
import { ApiError } from "../types";

const MARIAM: FusionNavigationViewer = {
  userId: "u-mariam",
  tenantId: "t-carthage",
  fullName: "Mariam Gharbi",
  employeeId: "e-mariam",
  accountLabel: "Employee",
  moduleEntitlements: ["CoreHR", "Performance"],
  enterableModules: ["core", "performance"],
  canOpenOwnProfile: true,
};

function wrapper(state: FusionViewerState) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        <FusionViewerProvider value={state}>{children}</FusionViewerProvider>
      </QueryClientProvider>
    );
  };
}

function item(id: string, module: "core" | "performance", section: string | null): FusionWorkItem {
  return { id, module, kind: "k", title: id, href: `/${module}`, section };
}

function attention(overrides: Partial<FusionAttentionApi> = {}): FusionAttentionApi {
  return {
    getWork: vi.fn(async (key) =>
      key === "core"
        ? [item("c1", "core", "/core/workforce-access")]
        : [item("p1", "performance", "/performance/team"), item("p2", "performance", "/performance/team")],
    ),
    getNotifications: vi.fn(),
    markNotificationsRead: vi.fn(),
    getUpcoming: vi.fn(async () => []),
    ...overrides,
  };
}

function navigation(overrides: Partial<FusionNavigationApi> = {}): FusionNavigationApi {
  return {
    getMyCard: vi.fn(async () => ({ displayName: "Mariam Gharbi", jobTitle: "VP, Product", orgUnitName: "Product A", photoUrl: null })),
    getTenant: vi.fn(async () => ({ tenantId: "t-carthage", name: "Carthage Digital Group" })),
    ...overrides,
  };
}

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("useFusionNavigation", () => {
  it("counts Home, each module and the section the items name", async () => {
    const { result } = renderHook(
      () => useFusionNavigation("performance", ["/performance/plan", "/performance/team"], {
        api: navigation(),
        attentionApi: attention(),
      }),
      { wrapper: wrapper({ viewer: MARIAM, isLoading: false }) },
    );
    await waitFor(() => expect(result.current.homeCount).toBe(3));
    expect(result.current.modules.find((m) => m.key === "core")?.count).toBe(1);
    expect(result.current.modules.find((m) => m.key === "performance")?.count).toBe(2);
    expect(result.current.modules.find((m) => m.key === "learning")?.count).toBeUndefined();
    expect(result.current.sectionCounts).toEqual({ "/performance/plan": 0, "/performance/team": 2 });
    await waitFor(() => expect(result.current.person.detail).toBe("VP, Product"));
    expect(result.current.tenantName).toBe("Carthage Digital Group");
  });

  it("drops a failing module's counts and keeps the others", async () => {
    const api = attention({
      getWork: vi.fn(async (key) => {
        if (key === "performance") throw new ApiError(503, "Unavailable", ["down"], null);
        return [item("c1", "core", "/core/workforce-access")];
      }),
    });
    const { result } = renderHook(
      () => useFusionNavigation("performance", ["/performance/team"], { api: navigation(), attentionApi: api }),
      { wrapper: wrapper({ viewer: MARIAM, isLoading: false }) },
    );
    await waitFor(() => expect(result.current.homeCount).toBe(1));
    expect(result.current.modules.find((m) => m.key === "performance")?.count).toBeUndefined();
    expect(result.current.modules.find((m) => m.key === "core")?.count).toBe(1);
  });

  it("names the account type when the person has no employee record, without asking Core HR", async () => {
    const api = navigation();
    const admin = { ...MARIAM, fullName: "Sami Admin", employeeId: null, accountLabel: "Tenant Administrator" };
    const { result } = renderHook(() => useFusionNavigation(null, [], { api, attentionApi: attention() }), {
      wrapper: wrapper({ viewer: admin, isLoading: false }),
    });
    expect(result.current.person).toEqual({ name: "Sami Admin", photo: null, detail: "Tenant Administrator", detailPending: false });
    expect(api.getMyCard).not.toHaveBeenCalled();
  });

  it("falls back to the account type when Core HR has no card", async () => {
    const api = navigation({ getMyCard: vi.fn(async () => Promise.reject(new ApiError(404, "Not found", [], null))) });
    const { result } = renderHook(() => useFusionNavigation(null, [], { api, attentionApi: attention() }), {
      wrapper: wrapper({ viewer: MARIAM, isLoading: false }),
    });
    expect(result.current.person.detailPending).toBe(true);
    await waitFor(() => expect(result.current.person.detailPending).toBe(false));
    expect(result.current.person.detail).toBe("Employee");
  });

  it("offers only modules the tenant has and the person can enter", () => {
    const { result } = renderHook(() => useFusionNavigation(null, [], { api: navigation(), attentionApi: attention() }), {
      wrapper: wrapper({ viewer: { ...MARIAM, moduleEntitlements: ["CoreHR"], enterableModules: ["core"] }, isLoading: false }),
    });
    expect(result.current.modules.map((m) => m.key)).toEqual(["core"]);
  });
});

describe("Recent", () => {
  it("lists what was opened, newest first, and nothing for another person", async () => {
    const state = { viewer: MARIAM, isLoading: false };
    const { result, rerender } = renderHook(
      ({ href, label }: { href: string; label: string }) => {
        useRecentRecord("performance", { href, label, kind: "Record" });
        return useRecentRecords("performance");
      },
      { wrapper: wrapper(state), initialProps: { href: "/performance/reviews/rounds/1", label: "Year-end review" } },
    );
    await waitFor(() => expect(result.current.map((r) => r.label)).toEqual(["Year-end review"]));
    act(() => rerender({ href: "/performance/cycles/c/plans/p", label: "Mariam's plan" }));
    await waitFor(() => expect(result.current.map((r) => r.label)).toEqual(["Mariam's plan", "Year-end review"]));

    const other = renderHook(() => useRecentRecords("performance"), {
      wrapper: wrapper({ viewer: { ...MARIAM, userId: "u-other" }, isLoading: false }),
    });
    expect(other.result.current).toEqual([]);
  });
});

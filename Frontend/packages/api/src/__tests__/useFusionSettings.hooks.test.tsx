// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { useFusionSettings } from "../query/useFusionSettings";
import { countChanges, useStagedSettings } from "../react/useStagedSettings";
import { FusionViewerProvider, type FusionViewerState } from "../react/fusion-viewer";
import {
  readSettingsReturn,
  rememberSettingsReturn,
  type FusionSettingsApi,
  type FusionSettingsSection,
} from "../fusion-settings";
import type { FusionNavigationViewer } from "../fusion-navigation";
import { ApiError } from "../types";

const AMIRA: FusionNavigationViewer = {
  userId: "u-amira",
  tenantId: "t-carthage",
  fullName: "Amira Khelifi",
  employeeId: "e-amira",
  accountLabel: "Tenant Administrator",
  moduleEntitlements: ["CoreHR", "Performance"],
  enterableModules: ["core", "performance"],
  canOpenOwnProfile: true,
};

function section(id: string, access: "view" | "manage", path = `/core/settings/${id}`): FusionSettingsSection {
  return { id, label: id, order: 1, path, access, lastChange: null };
}

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

function api(overrides: Partial<FusionSettingsApi> = {}): FusionSettingsApi {
  return {
    getSections: vi.fn(async (module) =>
      module === "core"
        ? [section("company", "manage")]
        : [section("rating-scale", "view", "/performance/settings/rating-scale")],
    ),
    getNotificationPreferences: vi.fn(),
    updateNotificationPreferences: vi.fn(),
    getFieldVisibility: vi.fn(),
    getNotificationDefaults: vi.fn(),
    updateNotificationDefaults: vi.fn(),
    ...overrides,
  };
}

afterEach(() => window.sessionStorage.clear());

describe("useFusionSettings", () => {
  it("puts You first, then each module with sections, marking view-only groups", async () => {
    const { result } = renderHook(() => useFusionSettings({ api: api() }), {
      wrapper: wrapper({ viewer: AMIRA, isLoading: false }),
    });
    await waitFor(() => expect(result.current.groups.every((group) => group.status === "ready")).toBe(true));
    expect(result.current.groups.map((group) => group.key)).toEqual(["you", "core", "performance"]);
    expect(result.current.groups[0]!.sections.map((s) => s.label)).toEqual(["settings.preferences", "settings.notifications"]);
    // @repo/ds message keys: the sidebar shows them in the person's language.
    expect(result.current.groups[0]!.label).toBe("settings.you");
    expect(result.current.groups[1]!.viewOnly).toBe(false);
    expect(result.current.groups[2]!.viewOnly).toBe(true);
  });

  it("keeps the other groups usable when one module fails, and retries it", async () => {
    let fail = true;
    const getSections = vi.fn(async (module: "core" | "performance") => {
      if (module === "performance" && fail) throw new ApiError(502, "Bad Gateway", [], null);
      return module === "core" ? [section("company", "manage")] : [section("planning", "manage")];
    });
    const { result } = renderHook(() => useFusionSettings({ api: api({ getSections }) }), {
      wrapper: wrapper({ viewer: AMIRA, isLoading: false }),
    });
    await waitFor(() => expect(result.current.groups.find((g) => g.key === "performance")?.status).toBe("error"));
    expect(result.current.groups.find((g) => g.key === "core")?.status).toBe("ready");

    fail = false;
    act(() => result.current.groups.find((g) => g.key === "performance")!.retry!());
    await waitFor(() => expect(result.current.groups.find((g) => g.key === "performance")?.status).toBe("ready"));
  });

  it("hides a module with no sections for the person", async () => {
    const { result } = renderHook(() => useFusionSettings({ api: api({ getSections: vi.fn(async () => []) }) }), {
      wrapper: wrapper({ viewer: AMIRA, isLoading: false }),
    });
    await waitFor(() => expect(result.current.groups).toHaveLength(1));
    expect(result.current.groups[0]!.key).toBe("you");
  });

  it("gives a platform administrator Preferences only and asks no module", () => {
    const getSections = vi.fn();
    const { result } = renderHook(() => useFusionSettings({ api: api({ getSections }) }), {
      wrapper: wrapper({
        viewer: { ...AMIRA, tenantId: null, moduleEntitlements: [], enterableModules: [] },
        isLoading: false,
      }),
    });
    expect(result.current.groups.map((group) => group.sections.map((s) => s.id))).toEqual([["preferences"]]);
    expect(getSections).not.toHaveBeenCalled();
  });
});

describe("settings return", () => {
  it("returns to the page the person came from, never to a settings page", () => {
    rememberSettingsReturn(window.sessionStorage, "/core/people?tab=all");
    rememberSettingsReturn(window.sessionStorage, "/performance/settings/reviews");
    expect(readSettingsReturn(window.sessionStorage)).toEqual({ href: "/core/people?tab=all", label: "Core HR" });
  });

  it("falls back to Home, or the Platform console for a platform administrator", () => {
    expect(readSettingsReturn(window.sessionStorage)).toEqual({ href: "/", label: "settings.place.home" });
    expect(readSettingsReturn(window.sessionStorage, { platformAdministrator: true })).toEqual({
      href: "/platform",
      label: "settings.place.platformConsole",
    });
  });

  it("ignores a stored value that leaves Fusion", () => {
    window.sessionStorage.setItem("fusion.settings.back", "//evil.example");
    expect(readSettingsReturn(window.sessionStorage).href).toBe("/");
  });
});

describe("useStagedSettings", () => {
  const saved = { version: 3, selfAssessmentDueDays: 14, managerAssessmentDueDays: 7, bands: { lowTop: 2, midTop: 3 } };

  it("counts each changed value and discards back to the saved ones", () => {
    const { result } = renderHook(() => useStagedSettings(saved, vi.fn(), { ignore: ["version"] }));
    act(() =>
      result.current.update((draft) => ({ ...draft, managerAssessmentDueDays: 10, bands: { lowTop: 2, midTop: 4 } })),
    );
    expect(result.current.changes).toBe(2);
    expect(result.current.dirty).toBe(true);
    act(() => result.current.discard());
    expect(result.current.draft).toBe(saved);
    expect(result.current.dirty).toBe(false);
  });

  it("maps a 409 to the conflict, and reload drops the edit", async () => {
    const onReload = vi.fn();
    const save = vi.fn(async () => {
      throw new ApiError(409, "Conflict", ["This changed since you opened it."], null);
    });
    const { result } = renderHook(() => useStagedSettings(saved, save, { onReload }));
    act(() => result.current.update((draft) => ({ ...draft, selfAssessmentDueDays: 21 })));
    let outcome = true;
    await act(async () => {
      outcome = await result.current.submit();
    });
    expect(outcome).toBe(false);
    expect(result.current.conflict).toBe(true);
    expect(result.current.draft?.selfAssessmentDueDays).toBe(21);
    act(() => result.current.reload());
    expect(result.current.conflict).toBe(false);
    expect(result.current.dirty).toBe(false);
    expect(onReload).toHaveBeenCalledOnce();
  });

  it("keeps other failures as errors, not conflicts", async () => {
    const save = vi.fn(async () => {
      throw new ApiError(400, "Bad Request", ["Days must be 1 to 60."], null);
    });
    const { result } = renderHook(() => useStagedSettings(saved, save));
    act(() => result.current.update((draft) => ({ ...draft, selfAssessmentDueDays: 0 })));
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.conflict).toBe(false);
    expect(result.current.error).toBeInstanceOf(ApiError);
  });

  it("counts a list of plain values as one value, and a list of records per record", () => {
    expect(countChanges({ off: ["a"] }, { off: ["a", "b"] })).toBe(1);
    const levels = [{ value: 1, description: null }, { value: 2, description: null }, { value: 3, description: null }];
    const edited = levels.map((level) => (level.value < 3 ? { ...level, description: "Set" } : level));
    expect(countChanges(levels, edited)).toBe(2);
  });
});

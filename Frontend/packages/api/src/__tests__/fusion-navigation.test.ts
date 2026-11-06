import { describe, expect, it, vi } from "vitest";
import type { FusionWorkItem } from "../fusion-attention";
import {
  countByModule,
  countBySection,
  countHome,
  createFusionNavigationApi,
  findFusionModuleByLabel,
  FUSION_MODULE_REGISTRY,
  fusionNavigationPaths,
  fusionRecentStorageKey,
  readRecentRecords,
  rememberRecentRecord,
  visibleFusionModules,
} from "../fusion-navigation";
import type { ApiClient } from "../types";

function item(module: "core" | "performance", section?: string | null): FusionWorkItem {
  return { id: `${module}:${Math.random()}`, module, kind: "k", title: "t", href: `/${module}`, section };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

describe("FUSION_MODULE_REGISTRY", () => {
  it("lists every tenant module once, Core HR and Performance first, each with a line", () => {
    expect(FUSION_MODULE_REGISTRY.map((m) => m.key)).toEqual([
      "core",
      "performance",
      "learning",
      "recruitment",
      "interview",
    ]);
    expect(FUSION_MODULE_REGISTRY.every((m) => m.description.length > 0 && m.href.startsWith("/"))).toBe(true);
  });

  it("finds a module by the label other contributors pass, including the old 'Core'", () => {
    expect(findFusionModuleByLabel("Learning")?.key).toBe("learning");
    expect(findFusionModuleByLabel("Core")?.key).toBe("core");
    expect(findFusionModuleByLabel("Core HR")?.key).toBe("core");
    expect(findFusionModuleByLabel("Unknown")).toBeUndefined();
  });
});

describe("visibleFusionModules", () => {
  it("offers Core HR and Performance only when entitled and enterable; the rest when entitled", () => {
    const keys = (entitlements: string[], enterable: ("core" | "performance")[]) =>
      visibleFusionModules({ moduleEntitlements: entitlements, enterableModules: enterable }).map((m) => m.key);

    expect(keys(["CoreHR", "Performance"], ["core", "performance"])).toEqual(["core", "performance"]);
    expect(keys(["CoreHR", "Learning", "Recruitment", "Interview"], ["core"])).toEqual([
      "core",
      "learning",
      "recruitment",
      "interview",
    ]);
    expect(keys(["CoreHR"], ["core", "performance"])).not.toContain("performance");
    expect(keys(["CoreHR", "Performance"], ["performance"])).not.toContain("core");
    expect(visibleFusionModules(null)).toEqual([]);
  });
});

describe("counts", () => {
  const items = [
    item("performance", "/performance/team"),
    item("performance", "/performance/team"),
    item("core", "/core/workforce-access"),
    item("performance", null),
  ];

  it("Home counts every item", () => {
    expect(countHome(items)).toBe(4);
    expect(countHome([])).toBe(0);
  });

  it("modules count their own items, only when they answered", () => {
    expect(countByModule(items, ["core", "performance"])).toEqual({ core: 1, performance: 3 });
    expect(countByModule([], ["core"])).toEqual({ core: 0 });
    // Performance failed: no count at all rather than zero.
    expect(countByModule(items.filter((i) => i.module === "core"), ["core"])).toEqual({ core: 1 });
  });

  it("sections count items naming their path; unknown sections and missing ones count nowhere", () => {
    const counts = countBySection(
      [...items, item("performance", "/performance/cycle"), item("performance", "/performance/team/")],
      ["/performance", "/performance/plan", "/performance/team"],
    );
    expect(counts).toEqual({ "/performance": 0, "/performance/plan": 0, "/performance/team": 3 });
  });
});

describe("recent records", () => {
  const viewer = { tenantId: "t1", userId: "u1" };
  const key = fusionRecentStorageKey(viewer, "performance");

  it("keys by tenant, person and module", () => {
    expect(key).toBe("fusion:recent:t1:u1:performance");
    expect(fusionRecentStorageKey({ tenantId: "t1", userId: "u2" }, "performance")).not.toBe(key);
  });

  it("keeps the newest first, deduped by path, three at most", () => {
    const storage = memoryStorage();
    rememberRecentRecord(storage, key, { label: "Year-end review", kind: "Review round", href: "/performance/reviews/rounds/1" });
    rememberRecentRecord(storage, key, { label: "Mariam's plan", kind: "Plan", href: "/performance/cycles/c/plans/p" });
    rememberRecentRecord(storage, key, { label: "Omar Mansour", kind: "Person", href: "/performance/people/o" });
    expect(readRecentRecords(storage, key).map((r) => r.label)).toEqual(["Omar Mansour", "Mariam's plan", "Year-end review"]);

    rememberRecentRecord(storage, key, { label: "Year-end review", kind: "Review round", href: "/performance/reviews/rounds/1" });
    rememberRecentRecord(storage, key, { label: "Calibration", kind: "Calibration", href: "/performance/reviews/rounds/1/calibration" });
    expect(readRecentRecords(storage, key).map((r) => r.label)).toEqual(["Calibration", "Year-end review", "Omar Mansour"]);
  });

  it("another person on the same browser sees nothing of the first", () => {
    const storage = memoryStorage();
    rememberRecentRecord(storage, key, { label: "Plan", kind: "Plan", href: "/performance/plan" });
    expect(readRecentRecords(storage, fusionRecentStorageKey({ tenantId: "t1", userId: "u2" }, "performance"))).toEqual([]);
  });

  it("is empty, never throwing, when storage refuses or holds junk", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readRecentRecords(throwing, key)).toEqual([]);
    expect(() => rememberRecentRecord(throwing, key, { label: "x", kind: "y", href: "/x" })).not.toThrow();
    expect(readRecentRecords(memoryStorage({ [key]: "not json" }), key)).toEqual([]);
    expect(readRecentRecords(memoryStorage({ [key]: JSON.stringify([{ label: 1 }, { label: "a", kind: "b", href: "https://x" }]) }), key)).toEqual([]);
    expect(readRecentRecords(undefined, key)).toEqual([]);
    // Protocol-relative paths would leave Fusion: never stored, never read back.
    const storage = memoryStorage({ [key]: JSON.stringify([{ label: "x", kind: "y", href: "//evil.example" }, { label: "z", kind: "y", href: "/\\evil.example" }]) });
    expect(readRecentRecords(storage, key)).toEqual([]);
    expect(rememberRecentRecord(memoryStorage(), key, { label: "x", kind: "y", href: "//evil.example" })).toEqual([]);
  });
});

describe("identity reads", () => {
  it("reads the caller's card from Core HR and their tenant from Identity", async () => {
    const get = vi.fn(async () => ({}));
    const api = createFusionNavigationApi({ get } as unknown as ApiClient);
    await api.getMyCard();
    await api.getTenant();
    expect(get.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      fusionNavigationPaths.myCard(),
      fusionNavigationPaths.tenant(),
    ]);
    expect(fusionNavigationPaths.myCard()).toBe("/corehr/me/card");
  });
});

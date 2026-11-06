import { describe, expect, it } from "vitest";
import { FUSION_MODULES } from "@repo/ds/shell";
import type { ProvisionableModule } from "../api";
import { buildModuleOptions, selectedModulesFor } from "./module-catalogue";

/** What the service publishes today: Core HR included, Performance selectable. */
const CATALOGUE: ProvisionableModule[] = [
  { module: "CoreHR", mandatory: true },
  { module: "Performance", mandatory: false },
];

describe("buildModuleOptions", () => {
  it("shows every module Fusion has, not only the provisionable ones", () => {
    const options = buildModuleOptions(CATALOGUE);

    // Hiding the rest would make the page look complete while misrepresenting
    // what the platform actually contains.
    expect(options).toHaveLength(FUSION_MODULES.length);
    expect(options.map((option) => option.key).sort()).toEqual(
      FUSION_MODULES.map((module) => module.key).sort()
    );
  });

  it("derives availability from the service, never from a local list", () => {
    const options = buildModuleOptions(CATALOGUE);
    const byKey = Object.fromEntries(options.map((o) => [o.key, o]));

    expect(byKey.core!.availability).toBe("included");
    expect(byKey.performance!.availability).toBe("selectable");

    for (const key of ["learning", "recruitment", "interview"]) {
      expect(byKey[key]!.availability).toBe("unavailable");
    }
  });

  it("makes a module selectable the moment the service accepts it", () => {
    // Adding a module to the backend must need no change here, so a catalogue
    // that grows is simulated rather than a code change.
    const grown = buildModuleOptions([
      ...CATALOGUE,
      { module: "Learning" as never, mandatory: false },
    ]);

    expect(grown.find((option) => option.key === "learning")!.availability).toBe(
      "selectable"
    );
  });

  it("leaves an unavailable module with no identifier to submit", () => {
    const options = buildModuleOptions(CATALOGUE);

    for (const option of options) {
      if (option.availability === "unavailable") {
        expect(option.module).toBeNull();
      } else {
        expect(option.module).not.toBeNull();
      }
    }
  });

  it("treats an empty catalogue as nothing being provisionable", () => {
    // A failed or unloaded catalogue must not quietly present every module as
    // available.
    const options = buildModuleOptions([]);

    expect(options.every((option) => option.availability === "unavailable")).toBe(true);
    expect(options.every((option) => option.module === null)).toBe(true);
  });

  it("cannot be mistaken for a real catalogue that grants nothing", () => {
    // An unread catalogue and a catalogue with no mandatory module produce very
    // different pages, so the workspace must distinguish them by whether the
    // read succeeded rather than by inspecting the options. This asserts the
    // trap: from the options alone, "not loaded" is indistinguishable from
    // "nothing is provisionable" — which is why submission is gated on the
    // query having data, not on this list being non-empty.
    const unread = buildModuleOptions([]);

    expect(unread).not.toHaveLength(0);
    expect(unread.some((option) => option.availability === "included")).toBe(false);
  });

  it("orders included first, then selectable, then unavailable", () => {
    const rank = { included: 0, selectable: 1, unavailable: 2 } as const;
    const order = buildModuleOptions(CATALOGUE).map(
      (option) => rank[option.availability]
    );

    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe("selectedModulesFor", () => {
  const options = buildModuleOptions(CATALOGUE);

  it("sends only what was chosen and is accepted", () => {
    expect(selectedModulesFor(options, ["performance"])).toEqual(["Performance"]);
    expect(selectedModulesFor(options, [])).toEqual([]);
  });

  it("never sends the mandatory module, which the service adds itself", () => {
    // Sending Core HR would be harmless but untruthful about what was chosen.
    expect(selectedModulesFor(options, ["core", "performance"])).toEqual([
      "Performance",
    ]);
  });

  it("never sends an unavailable module, even if its key is selected", () => {
    // The request is the last line of defence against a stale or tampered
    // selection, so it filters rather than trusting the grid.
    expect(
      selectedModulesFor(options, ["learning", "interview", "recruitment"])
    ).toEqual([]);
  });

  it("ignores a key that no longer exists", () => {
    expect(selectedModulesFor(options, ["removed-module"])).toEqual([]);
  });
});

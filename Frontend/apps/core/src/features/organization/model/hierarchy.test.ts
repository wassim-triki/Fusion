import { describe, expect, it } from "vitest";
import { asteriaHierarchy, largeOrganizationHierarchy } from "../test/fixtures";
import {
  buildOrganizationHierarchy,
  deepestBlockingUnit,
  isInvalidMoveTarget,
  organizationAccessibleName,
  revealOrganizationUnit,
} from "./hierarchy";
import { organizationCodeSuggestion, readOrganizationUrlState, writeOrganizationUrlState } from "./workspace-state";

describe("Organization hierarchy model", () => {
  it("indexes ancestry, descendants, depth, and duplicate-name context", () => {
    const model = buildOrganizationHierarchy(asteriaHierarchy);
    expect(model.depthById.get("data-ai")).toBe(3);
    expect(model.descendantsById.get("technology")).toEqual(new Set(["data-ai"]));
    expect(organizationAccessibleName(model, "operations-commercial")).toContain("under Asteria Group / Commercial");
    expect(isInvalidMoveTarget(model, "technology", "data-ai")).toBe(true);
    expect(isInvalidMoveTarget(model, "technology", "commercial")).toBe(false);
  });

  it("reveals collapsed ancestors without changing business data", () => {
    const model = buildOrganizationHierarchy(asteriaHierarchy);
    const collapsed = new Set(["asteria", "consulting", "technology"]);
    const revealed = revealOrganizationUnit(collapsed, model, "data-ai");
    expect(revealed.size).toBe(0);
  });

  it("finds a deterministic actionable leaf beneath a blocked unit", () => {
    const model = buildOrganizationHierarchy(asteriaHierarchy);
    // asteria → consulting → technology → data-ai (leaf) via first-child chain
    expect(deepestBlockingUnit(model, "asteria")).toBe("data-ai");
    expect(deepestBlockingUnit(model, "technology")).toBe("data-ai");
    // A leaf has no actionable descendant.
    expect(deepestBlockingUnit(model, "data-ai")).toBeNull();
  });

  it("builds a representative large hierarchy", () => {
    const model = buildOrganizationHierarchy(largeOrganizationHierarchy());
    expect(model.units).toHaveLength(421);
  });
});

describe("Organization workspace state", () => {
  it("round-trips representation, date, selection, and search", () => {
    const state = readOrganizationUrlState(
      new URLSearchParams("view=list&asOf=2026-09-01&unit=technology&q=tech"),
      "2026-08-09"
    );
    expect(writeOrganizationUrlState(state, "2026-08-09").toString()).toBe(
      "view=list&asOf=2026-09-01&unit=technology&q=tech"
    );
  });

  it("suggests editable compact business codes", () => {
    expect(organizationCodeSuggestion("Asteria Group")).toBe("AG");
    expect(organizationCodeSuggestion("Technology")).toBe("TECHNOLO");
  });
});

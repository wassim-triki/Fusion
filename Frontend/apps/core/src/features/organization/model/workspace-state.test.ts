import { describe, expect, it } from "vitest";
import {
  organizationLocalReducer,
  organizationCodeSuggestion,
  readOrganizationUrlState,
  todayCalendarDate,
  writeOrganizationUrlState,
} from "./workspace-state";
import { buildOrganizationHierarchy } from "./hierarchy";
import { asteriaHierarchy } from "../test/fixtures";

describe("Organization workspace state", () => {
  const today = "2026-08-10";

  it("round-trips representation, temporal context, selection, and search", () => {
    const input = new URLSearchParams("view=list&asOf=2027-01-15&unit=technology&q=tech");
    const state = readOrganizationUrlState(input, today);

    expect(state).toEqual({
      representation: "outline",
      asOf: "2027-01-15",
      selectedId: "technology",
      search: "tech",
    });
    expect(writeOrganizationUrlState(state, today).toString()).toBe(input.toString());
  });

  it("keeps the Today URL quiet while preserving selected workspace context", () => {
    const params = writeOrganizationUrlState({
      representation: "chart",
      asOf: today,
      selectedId: "technology",
      search: "",
    }, today);

    expect(params.toString()).toBe("unit=technology");
  });

  it("uses a UTC calendar date and stable editable code suggestions", () => {
    expect(todayCalendarDate(new Date("2026-08-10T23:30:00-05:00"))).toBe("2026-08-11");
    expect(organizationCodeSuggestion("Asteria Group")).toBe("AG");
    expect(organizationCodeSuggestion("Operations 2026")).toBe("O2");
  });

  it("keeps disclosure and contextual surfaces in one predictable local reducer", () => {
    const model = buildOrganizationHierarchy(asteriaHierarchy);
    const initial = {
      collapsed: new Set(["asteria", "consulting"]), editor: null,
      createType: false, createdTypeId: null,
      upcomingOpen: false, moveProposal: null, inactivateUnit: null,
      cancelChange: null, inspectorOpen: false,
    };

    const revealed = organizationLocalReducer(initial, { type: "reveal", model, id: "technology" });
    expect(revealed.collapsed).not.toContain("asteria");
    expect(revealed.collapsed).not.toContain("consulting");

    const opened = organizationLocalReducer(revealed, { type: "patch", value: { inspectorOpen: true, editor: { kind: "manage-types" } } });
    expect(opened).toMatchObject({ inspectorOpen: true, editor: { kind: "manage-types" } });
    expect(organizationLocalReducer(opened, { type: "toggle-collapse", id: "technology" }).collapsed).toContain("technology");
  });

  it("preserves the complete staged Move after a server conflict", () => {
    const proposal = {
      sourceId: "technology", fromParentId: "consulting", toParentId: "commercial",
      effectiveDate: "2026-09-01", version: 17, subordinateCount: 1,
      entry: "drag" as const, error: null,
    };
    const initial = {
      collapsed: new Set<string>(), editor: null,
      createType: false, createdTypeId: null, upcomingOpen: false,
      moveProposal: proposal, inactivateUnit: null,
      cancelChange: null, inspectorOpen: true,
    };

    const conflicted = organizationLocalReducer(initial, {
      type: "patch",
      value: { moveProposal: { ...proposal, error: "Technology changed while this Move was staged." } },
    });

    expect(conflicted.moveProposal).toMatchObject({
      sourceId: "technology", fromParentId: "consulting", toParentId: "commercial",
      effectiveDate: "2026-09-01", subordinateCount: 1, entry: "drag",
    });
    expect(conflicted.moveProposal?.error).toContain("changed");
  });
});

import { describe, expect, it } from "vitest";
import type { AlignmentMapNodeDto } from "@repo/api";
import { byState, goalTree } from "./goals-company";
import { goalsTab } from "./goals-place";
import { nextToUpdate, planShares } from "./goals-you";

function node(id: string, kind: AlignmentMapNodeDto["kind"], parentId: string | null, orgUnitId: string | null = null): AlignmentMapNodeDto {
  return {
    id, kind, parentId, title: id, orgUnitName: null, ownerName: null, isOwn: false, status: null, statusSince: null,
    hasProgress: false, progress: 0, personal: null, measure: null, orgUnitId, line: [],
  };
}

describe("Goals", () => {
  it("opens on your plan, on the company's goals without one, and on the company for the map", () => {
    expect(goalsTab(null, false, { plan: true, unit: true })).toBe("you");
    expect(goalsTab(null, false, { plan: false, unit: true })).toBe("company");
    expect(goalsTab("unit", false, { plan: true, unit: true })).toBe("unit");
    expect(goalsTab("unit", false, { plan: true, unit: false })).toBe("you");
    expect(goalsTab("you", true, { plan: true, unit: true })).toBe("company");
  });

  it("puts units' goals under their company goal, your unit first, and people's goals under either", () => {
    const tree = goalTree([
      node("c1", "Company", null), node("u1", "OrgUnit", "c1", "platform"), node("u2", "OrgUnit", "c1", "mine"),
      node("p1", "Personal", "u2"), node("p2", "Personal", "c1"),
    ], "mine");
    expect(tree.companies.map((c) => c.id)).toEqual(["c1"]);
    expect(tree.unitsUnder.get("c1")!.map((u) => u.id)).toEqual(["u2", "u1"]);
    expect(tree.peopleUnder.get("u2")!.map((p) => p.id)).toEqual(["p1"]);
    expect(tree.peopleUnder.get("c1")!.map((p) => p.id)).toEqual(["p2"]);
  });

  it("lists a unit's people off track first, then at risk, on track and not yet reported", () => {
    const people = (["OnTrack", null, "OffTrack", "AtRisk"] as const).map((status, i) => ({ ...node(`p${i}`, "Personal", "u1"), status }));
    expect([...people].sort(byState).map((p) => p.status)).toEqual(["OffTrack", "AtRisk", "OnTrack", null]);
  });

  it("shares the plan's bar by weight, evenly before any weight exists", () => {
    expect([...planShares([{ id: "a", planWeight: 40 }, { id: "b", planWeight: 60 }]).values()]).toEqual([40, 60]);
    expect([...planShares([{ id: "a", planWeight: null }, { id: "b", planWeight: null }]).values()]).toEqual([50, 50]);
  });

  it("updates the goal never updated first, then the one updated longest ago", () => {
    const goals = [
      { id: "a", canUpdateProgress: true, lastProgressAt: "2026-10-10" },
      { id: "b", canUpdateProgress: true, lastProgressAt: null },
      { id: "c", canUpdateProgress: false, lastProgressAt: null },
    ];
    expect(nextToUpdate(goals)?.id).toBe("b");
    expect(nextToUpdate([goals[0]!, goals[2]!])?.id).toBe("a");
    expect(nextToUpdate([goals[2]!])).toBeNull();
  });
});

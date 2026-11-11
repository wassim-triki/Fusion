import { describe, expect, it } from "vitest";
import type { AlignmentMapNodeDto } from "@repo/api";
import {
  buildAlignmentMap,
  defaultExpanded,
  focusPath,
  hiddenNodeId,
  nodeAccessibleName,
  personalSummary,
  progressLabel,
  statusLabel,
  visibleMap,
} from "./alignment-map-model";

function node(id: string, kind: AlignmentMapNodeDto["kind"], parentId: string | null, extra: Partial<AlignmentMapNodeDto> = {}): AlignmentMapNodeDto {
  return {
    id, kind, parentId, title: `Objective ${id}`, orgUnitName: kind === "OrgUnit" ? `Unit ${id}` : null,
    ownerName: null, isOwn: false, status: null, statusSince: null, hasProgress: false, progress: 0,
    personal: kind === "Personal" ? null : { total: 0, onTrack: 0, atRisk: 0, offTrack: 0, noStatus: 0, readable: 0 },
    measure: null, orgUnitId: null, line: [],
    ...extra,
  };
}

// company → unit a → unit b → unit c (three deep), plus personal objectives under a.
const dto = {
  cycleId: "c1",
  nodes: [
    node("co", "Company", null),
    node("a", "OrgUnit", "co", { personal: { total: 4, onTrack: 2, atRisk: 1, offTrack: 0, noStatus: 1, readable: 1 } }),
    node("b", "OrgUnit", "a"),
    node("c", "OrgUnit", "b"),
    node("mine", "Personal", "a", { isOwn: true, ownerName: "Sami" }),
  ],
};

const ids = (visible: ReturnType<typeof visibleMap>) => visible.nodes.map((n) => n.id);

describe("alignment map model", () => {
  it("opens company objectives and their direct unit objectives, and collapses deeper", () => {
    const model = buildAlignmentMap(dto);
    const visible = visibleMap(model, defaultExpanded(model), new Set());
    expect(ids(visible)).toEqual(["co", "a", "b"]);
    const b = visible.nodes.find((n) => n.id === "b");
    expect(b).toMatchObject({ kind: "direction", expanded: false, hiddenCount: 1, hasChildren: true });
  });

  it("opens the path to a third-level focus", () => {
    const model = buildAlignmentMap(dto);
    const path = focusPath(model, "c");
    expect(path.expand.sort()).toEqual(["a", "b", "co"]);
    expect(ids(visibleMap(model, new Set(path.expand), new Set()))).toContain("c");
  });

  it("opens the parent's personal objectives for a personal focus", () => {
    const model = buildAlignmentMap(dto);
    expect(focusPath(model, "mine")).toEqual({ expand: ["co"], openPersonal: "a" });
  });

  it("shows readable personal objectives and counts the rest", () => {
    const model = buildAlignmentMap(dto);
    const visible = visibleMap(model, defaultExpanded(model), new Set(["a"]));
    expect(ids(visible)).toContain("mine");
    expect(visible.nodes.find((n) => n.id === hiddenNodeId("a"))).toEqual({ kind: "hidden", id: hiddenNodeId("a"), parentId: "a", count: 3 });
    expect(visible.edges.find((e) => e.target === "mine")).toEqual({ source: "a", target: "mine", personal: true });
  });

  it("never reads a missing status or progress as a value", () => {
    expect(statusLabel(null)).toBe("Not reported");
    expect(progressLabel({ hasProgress: false, progress: 0 })).toBe("No progress yet");
    expect(progressLabel({ hasProgress: true, progress: 39.6 })).toBe("40%");
  });

  it("names nodes and counts for screen readers", () => {
    expect(nodeAccessibleName(node("a", "OrgUnit", "co", { status: "AtRisk", hasProgress: true, progress: 40 })))
      .toBe("Unit a objective, Objective a, At risk, 40%");
    expect(personalSummary({ total: 4, onTrack: 2, atRisk: 1, offTrack: 0, noStatus: 1, readable: 1 }))
      .toBe("4 personal objectives: 2 on track, 1 at risk, 1 not reported");
  });
});

import { describe, expect, it } from "vitest";
import type { GoalDetailDto, GoalNodeDto } from "@repo/api";
import { mapFocusFor, resolveSections, toObjectiveRecord } from "./objective-record-model";
import { parseObjectiveMode, parseObjectiveRef, withObjectiveRef } from "./objective-ref";

function node(overrides: Partial<GoalNodeDto> = {}): GoalNodeDto {
  return {
    version: 0, id: "obj-1",
    ownershipScope: "OrgUnit",
    title: "Grow talent",
    state: "Published",
    parentObjectiveId: "parent-1",
    orgUnitId: "unit-1",
    orgUnitName: "Talent Pod",
    accountablePersonId: "p-1",
    accountablePersonName: "Nour",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    progressSource: "Direct",
    measurementSummary: "Manual percentage",
    isAlignmentBaseline: true,
    isContributionBaselineLocked: false,
    contributionWeightTotal: 0,
    childCount: 0,
    contributorCount: 0,
    contributionToParent: null,
    hasProgress: false,
    derivedProgress: 0,
    progressCoverage: null,
    publishedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: null,
    ...overrides,
  };
}

function detail(overrides: Partial<GoalDetailDto> = {}, nodeOverrides: Partial<GoalNodeDto> = {}): GoalDetailDto {
  return {
    node: node(nodeOverrides),
    description: null,
    accountable: { id: "p-1", name: "Nour" },
    parent: node({ id: "parent-1", ownershipScope: "Company", title: "Grow the company", orgUnitName: null, parentObjectiveId: null }),
    children: [],
    alignedPlanObjectives: [],
    canGiveFeedback: false,
    canAskForFeedback: false,
    measurement: null,
    contribution: [],
    canEdit: false,
    canPublish: false,
    canConfigureContribution: false,
    cycleId: "cycle-2026",
    plan: null,
    canDelete: false,
    canUpdateProgress: false,
    canReadProgressHistory: false,
    canArchive: false,
    archivedAt: null,
    status: null,
    canAcknowledgeStatus: false,
    ...overrides,
  };
}

describe("objective reference", () => {
  it("addresses an objective by its cycle and id, never by the current cycle", () => {
    const params = new URLSearchParams("cycle=c-2026&objective=o-1&mode=record");
    expect(parseObjectiveRef(params)).toEqual({ cycleId: "c-2026", objectiveId: "o-1" });
    expect(parseObjectiveMode(params)).toBe("record");
    expect(parseObjectiveRef(new URLSearchParams("objective=o-1"))).toBeNull();
  });

  it("changes only its own parameters", () => {
    const current = new URLSearchParams("focus=branch-9&scope=unit-2&mode=record");
    expect(withObjectiveRef(current, { cycleId: "c", objectiveId: "o" })).toBe("?focus=branch-9&scope=unit-2&cycle=c&objective=o");
    expect(withObjectiveRef(new URLSearchParams("focus=b&cycle=c&objective=o"), null)).toBe("?focus=b");
    expect(withObjectiveRef(new URLSearchParams(), null)).toBe("");
  });
});

describe("toObjectiveRecord", () => {
  it("keeps the objective's own cycle on itself and its parent", () => {
    const record = toObjectiveRecord(detail());
    expect(record.ref).toEqual({ cycleId: "cycle-2026", objectiveId: "obj-1" });
    expect(record.parent).toEqual({
      ref: { cycleId: "cycle-2026", objectiveId: "parent-1" },
      title: "Grow the company",
      scopeLabel: "Company strategy", archived: false,
    });
    expect(record.kindLabel).toBe("Talent Pod objective");
  });

  it("reads a plan objective by its plan's state and weight", () => {
    const record = toObjectiveRecord(
      detail(
        { plan: { planId: "plan-1", planState: "Approved", planWeight: 60, owner: { id: "p-2", name: "Sami" }, canRequestUpdate: false } },
        { ownershipScope: "Employee", parentObjectiveId: null, orgUnitName: null }
      )
    );
    expect(record.kind).toBe("plan");
    expect(record.kindLabel).toBe("Standalone role objective");
    expect(record.accent).toBe("info");
    expect(record.planWeight).toBe(60);
    expect(record.isExecuting).toBe(true);
    expect(record.status.label).toBe("Approved");
  });
});

describe("resolveSections", () => {
  it("opens on the goal's year, and a draft has nothing more to say", () => {
    expect(resolveSections(toObjectiveRecord(detail({ parent: null }, { state: "Draft", parentObjectiveId: null })))).toEqual(["hero"]);
  });

  it("composes a published, calculated direction goal with the units carrying it", () => {
    const record = toObjectiveRecord(
      detail({ description: "Why it matters", children: [node({ id: "child-1" })] }, { progressSource: "Calculated" })
    );
    expect(resolveSections(record)).toEqual(["hero", "units", "description", "contribution"]);
  });

  it("tells a person's goal through its story of updates", () => {
    const record = toObjectiveRecord(
      detail(
        { plan: { planId: "plan-1", planState: "Submitted", planWeight: 40, owner: { id: "p-2", name: "Sami" }, canRequestUpdate: false } },
        { ownershipScope: "Employee" }
      )
    );
    expect(resolveSections(record)).toEqual(["hero", "story"]);
  });
});

describe("archived direction", () => {
  it("retains the parent's identity and marks the retired alignment", () => {
    const record = toObjectiveRecord(detail({ parent: node({ id: "retired", state: "Archived", isAlignmentBaseline: false }) }));
    expect(record.parent?.ref.objectiveId).toBe("retired");
    expect(record.parent?.archived).toBe(true);
    expect(record.isAligned).toBe(true);
  });
  it("keeps archived progress visible while omitting actions the server disallows", () => {
    const record = toObjectiveRecord(detail({}, { state: "Archived", hasProgress: true, derivedProgress: 65 }));
    expect(record.status.label).toBe("Archived");
    expect(record.isExecuting).toBe(true);
    expect(record.progress.derived).toBe(65);
    expect(record.can.archive).toBe(false);
  });
});

describe("map focus", () => {
  it("is the objective itself for published direction", () => {
    expect(mapFocusFor(toObjectiveRecord(detail()))).toEqual({ focus: "obj-1", near: null });
    expect(mapFocusFor(toObjectiveRecord(detail({}, { ownershipScope: "Company", parentObjectiveId: null })))).toEqual({ focus: "obj-1", near: null });
  });

  it("is nothing for a draft", () => {
    expect(mapFocusFor(toObjectiveRecord(detail({}, { state: "Draft" })))).toBeNull();
  });

  it("is the personal objective near its parent, and nothing when standalone", () => {
    expect(mapFocusFor(toObjectiveRecord(detail({}, { ownershipScope: "Employee", orgUnitId: null, orgUnitName: null }))))
      .toEqual({ focus: "obj-1", near: "parent-1" });
    expect(
      mapFocusFor(toObjectiveRecord(detail({ parent: null }, { ownershipScope: "Employee", parentObjectiveId: null, orgUnitId: null })))
    ).toBeNull();
  });
});

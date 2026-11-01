import { describe, expect, it } from "vitest";
import type { WorkspaceDestinationsDto } from "@repo/api";
import { visibleAdminItems, visiblePrimaryItems } from "./sidebar-nav";

const none: WorkspaceDestinationsDto = {
  overview: true, myPlan: false, team: false, reviews: false, cycleAdmin: false, settings: false, oneOnOnes: false, feedback: false,
};

describe("primary navigation", () => {
  it("shows 1:1s and Feedback only when the workspace offers them, after My Plan (a team is Core HR's Team page)", () => {
    expect(visiblePrimaryItems(none).map((i) => i.label)).toEqual(["overview"]);
    const manager = visiblePrimaryItems({ ...none, myPlan: true, team: true, oneOnOnes: true, feedback: true, reviews: true });
    expect(manager.map((i) => i.label)).toEqual(["overview", "myPlan", "oneOnOnes", "feedback", "reviews"]);
  });

  it("keeps Feedback without 1:1s for someone with no manager and no reports", () => {
    expect(visiblePrimaryItems({ ...none, feedback: true }).map((i) => i.label)).toEqual(["overview", "feedback"]);
  });

  it("shows nothing but Overview before the context loads", () => {
    expect(visiblePrimaryItems(undefined).map((i) => i.label)).toEqual(["overview"]);
  });
});

describe("administration", () => {
  it("shows Settings to whoever can view it and Cycle only to cycle administrators", () => {
    expect(visibleAdminItems(none)).toEqual([]);
    expect(visibleAdminItems({ ...none, settings: true }).map((i) => i.label)).toEqual(["settings"]);
    expect(visibleAdminItems({ ...none, settings: true, cycleAdmin: true }).map((i) => i.label)).toEqual(["cycle", "settings"]);
  });
});

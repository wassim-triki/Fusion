// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EmployeePlanDto, PlanDecisionDto, PlanObjectiveDto } from "@repo/api";
import { PlanRail } from "./plan-rail";
import { formatDate } from "@repo/ds/lib/dates";

vi.mock("@repo/auth", () => ({ useAuth: () => ({ user: { employeeId: "karim" } }) }));
vi.mock("../../api/use-workforce-me", () => ({ useWorkforceMe: () => ({ data: null }) }));
vi.mock("../objective-record/use-objective-record", () => ({ useObjectiveRecord: () => ({ open: vi.fn(), isOpen: () => false }) }));

const objective = (overrides: Partial<PlanObjectiveDto> = {}): PlanObjectiveDto => ({
  version: 1, id: "o1", title: "Integrate the vendor API", description: null, parentObjectiveId: null, directionPath: [], isAligned: false,
  startDate: "2026-10-01", endDate: "2027-09-30", progressSource: "Direct", measurementSummary: "", measurement: null, planWeight: 100,
  hasProgress: false, derivedProgress: 0, currentPercentage: null, currentActual: null, lastProgressAt: null, canUpdateProgress: false,
  status: null, statusReportedAt: null, planWeightIsSet: true, grade: 0, ...overrides,
});

const decision = (kind: PlanDecisionDto["kind"], overrides: Partial<PlanDecisionDto> = {}): PlanDecisionDto => ({
  kind, actorEmployeeId: "karim", actorName: "Karim Haddad", feedback: null, decidedAt: "2026-10-12T09:00:00Z", changeRequests: [], ...overrides,
});

function plan(overrides: Partial<EmployeePlanDto> = {}): EmployeePlanDto {
  return {
    version: 3, id: "p1", cycleId: "c1", cycleName: "FY2027", cycleState: "Active", employee: { id: "nour", name: "Nour Trabelsi" },
    isOwner: true, orgUnitName: "Platform", responsibleManager: { id: "karim", name: "Karim Haddad" }, state: "Draft", submittedAt: null,
    lastSavedAt: "2026-10-10T09:00:00Z", approvedAt: null, approvalKind: null, isLocked: false, planProgress: 0, objectives: [objective()],
    readiness: {
      alignmentPolicy: "Optional", everyObjectiveConnectsToStrategicDirection: false, objectiveCount: 1, weightTotal: 100, weightRemaining: 0,
      everyObjectiveHasWeight: true, connectsToStrategicDirection: false, hasStandaloneObjective: true, standaloneAllowed: true, canSubmit: true,
      blockers: [], openChangeRequests: 0,
    },
    history: [], canAuthor: true, canSubmit: true, canDecide: false, canApproveExceptionally: false, canRequestUpdate: false,
    grade: 0, changesSinceReturn: null,
    ...overrides,
  };
}

function rail(p: EmployeePlanDto | null, lens: "owner" | "reviewer" = "owner") {
  return render(
    <PlanRail plan={p} lens={lens} targets={[]} reviewer={{ id: "karim", name: "Karim Haddad" }} planningDeadline="2026-10-31" subjectFirstName="Nour" />,
  );
}

const sections = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

const ORDER = ["Status", "Plan progress", "Reviewer", "Direction"];

describe("PlanRail", () => {
  it("keeps the same four sections before a plan exists", () => {
    rail(null);
    expect(sections()).toEqual(ORDER);
    expect(screen.getByText("Not started")).toBeTruthy();
    expect(screen.getByText(new RegExp(formatDate("2026-10-31")))).toBeTruthy();
  });

  it("shows the checks while drafting, with no progress figure", () => {
    rail(plan());
    expect(sections()).toEqual(ORDER);
    expect(screen.getByText(/checks? passed/)).toBeTruthy();
    const progressSection = screen.getByRole("heading", { name: "Plan progress" }).parentElement!;
    expect(progressSection.textContent).not.toMatch(/\d+%/);
  });

  it("shows the reviewer's note and how many changes are addressed once returned", () => {
    const requests = [
      { id: "r1", objectiveId: "o1", objectiveTitle: "Integrate the vendor API", text: "Make it measurable", state: "Addressed" as const, reply: null, addressedAt: "2026-10-13T09:00:00Z", objectiveChanged: true },
      { id: "r2", objectiveId: "o2", objectiveTitle: "Docs", text: "Drop it", state: "Open" as const, reply: null, addressedAt: null, objectiveChanged: false },
    ];
    rail(plan({ history: [decision("Submitted"), decision("Returned", { feedback: "Sharpen the plan.", changeRequests: requests })] }));
    expect(sections()).toEqual(ORDER);
    expect(screen.getByText("Returned for changes")).toBeTruthy();
    expect(screen.getByText("Sharpen the plan.")).toBeTruthy();
    expect(screen.getByText("1 of 2 changes addressed")).toBeTruthy();
  });

  it("tells the owner who is reviewing, and the reviewer that it's theirs to decide", () => {
    const submitted = plan({ state: "Submitted", submittedAt: "2026-10-12T09:00:00Z", history: [decision("Submitted")] });
    const { unmount } = rail(submitted);
    expect(sections()).toEqual(ORDER);
    expect(screen.getByText("is reviewing", { exact: false })).toBeTruthy();
    expect(screen.getByText("Read-only while in review")).toBeTruthy();
    unmount();
    rail({ ...submitted, isOwner: false, canDecide: true }, "reviewer");
    expect(sections()).toEqual(ORDER);
    expect(screen.getByText("Waiting for your decision")).toBeTruthy();
  });

  it("shows a resubmission's outcome to the reviewer, including removed objectives", () => {
    const requests = [
      { id: "r1", objectiveId: "o9", objectiveTitle: "Docs", text: "Drop it", state: "ObjectiveRemoved" as const, reply: null, addressedAt: "2026-10-13T09:00:00Z", objectiveChanged: null },
    ];
    rail(plan({ state: "Submitted", canDecide: true, history: [decision("Returned", { changeRequests: requests }), decision("Submitted")] }), "reviewer");
    expect(screen.getByText("Nour addressed 1 of 1 change")).toBeTruthy();
    expect(screen.getByText(/Objective removed/)).toBeTruthy();
  });

  it("reads as approved and locked, normally or by administration", () => {
    const approved = plan({ state: "Approved", isLocked: true, approvedAt: "2026-10-14T09:00:00Z", approvalKind: "Normal", history: [decision("Approved")] });
    const { unmount } = rail(approved);
    expect(sections()).toEqual(ORDER);
    expect(screen.getByText("Approved & locked", { exact: false })).toBeTruthy();
    expect(screen.getByText(/Approved by Karim Haddad/)).toBeTruthy();
    unmount();
    rail({ ...approved, approvalKind: "Exceptional", history: [decision("ApprovedExceptionally", { actorName: "Hana Admin", actorEmployeeId: "hana" })] });
    expect(screen.getByText(/approved it as administrator/)).toBeTruthy();
    expect(screen.queryByText(/Approved by Karim/)).toBeNull();
  });

  it("adds the status mix to progress once approved", () => {
    rail(plan({
      state: "Approved", isLocked: true, approvedAt: "2026-10-14T09:00:00Z", history: [decision("Approved")],
      objectives: [objective({ id: "a", status: "OnTrack" }), objective({ id: "b", status: "AtRisk" }), objective({ id: "c" })],
    }));
    expect(screen.getByText("1 on track")).toBeTruthy();
    expect(screen.getByText("1 at risk")).toBeTruthy();
    expect(screen.getByText("1 not reported")).toBeTruthy();
  });
});

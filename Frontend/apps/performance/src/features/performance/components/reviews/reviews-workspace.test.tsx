// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewsWorkspaceDto } from "@repo/api";
import { ReviewsWorkspace } from "./reviews-workspace";

const state = vi.hoisted(() => ({ data: null as ReviewsWorkspaceDto | null, error: null as Error | null }));
vi.mock("../../api/use-workspace", () => ({ useSelectedCycleId: () => "cycle-1" }));
vi.mock("../../api/use-review-work", () => ({
  useReviewsWorkspace: () => ({ data: state.data, error: state.error, refetch: vi.fn() }),
  useDownloadReviewPdf: () => vi.fn(),
}));
vi.mock("../content-unavailable", () => ({ ContentUnavailable: () => <div>Unavailable</div> }));

function workspace(overrides: Partial<ReviewsWorkspaceDto>): ReviewsWorkspaceDto {
  return {
    cycleId: "cycle-1", cycleName: "FY2027", cycleEnd: "2099-09-30", canAdminister: false, own: null, notIncluded: null, year: null,
    toWrite: [], askedOfYou: [], rounds: [], cycleFacts: null, pastResults: [], sessions: [], ...overrides,
  };
}

const own: NonNullable<ReviewsWorkspaceDto["own"]> = {
  reviewId: "r-aicha", roundId: "round-1", roundName: "Year-end review", state: "SelfAssessment", reviewerName: "Mariam Gharbi",
  periodStart: "2098-10-01", periodEnd: "2099-08-31", dueDate: "2099-09-15", daysLate: 0, selfAssessmentDue: "2099-09-15", managerAssessmentDue: "2099-09-22",
  selfAssessmentEnabled: true, calibrationEnabled: true, selfSubmittedAt: null,
  sections: { objectivesDone: 2, objectives: 2, competenciesDone: 1, competencies: 4, questionsDone: 0, questions: 3 },
  peers: { asked: ["Fares Lachheb", "Khaled Sassi", "Leila Ben Salah"] },
  finalRating: null, finalRatingLabel: null, finalizedAt: null, acknowledgedAt: null,
};

const row = (name: string, overrides: Partial<ReviewsWorkspaceDto["toWrite"][number]> = {}): ReviewsWorkspaceDto["toWrite"][number] => ({
  reviewId: `r-${name}`, subjectEmployeeId: name, subjectDisplayName: name, jobTitle: "Engineer", roundName: "Year-end review", state: "SelfAssessment",
  peerStep: "Asked", peerCount: 3, selfStep: "Writing", selfSubmittedAt: null, peerAnswered: 1, peerTotal: 3, peerDeclined: 0,
  reviewStep: "Waiting", dueDate: "2099-09-15", daysLate: 0, nextAction: "Wait", selfOverallRating: null, selfOverallLabel: null,
  peerNames: [], planProgress: 74, atRisk: 1, feedback: 7, praise: 3,
  managerRating: null, managerPotential: null, finalRating: null, finalPotential: null, calibrationChanged: false, summaryToCheck: false, ...overrides,
});

beforeEach(() => {
  state.data = null;
  state.error = null;
});

describe("Reviews workspace", () => {
  it("leads a facilitator's page with the open session, and shows reviews in and out of calibration", () => {
    state.data = workspace({
      sessions: [{ roundId: "round-1", roundName: "Year-end review", people: 141, discussed: 64, flags: 7, outstanding: 0 }],
      toWrite: [
        row("Tarek Ayari", { state: "ReadyToFinalize", reviewStep: "Submitted", nextAction: "None" as never, managerRating: 4, finalRating: 3, calibrationChanged: true, summaryToCheck: true }),
        row("Fares Lachheb", { state: "Calibration", reviewStep: "Submitted", nextAction: "None" as never, managerRating: 4 }),
      ],
    });
    render(<ReviewsWorkspace />);
    expect(screen.getByRole("link", { name: /Open the session/ }).getAttribute("href")).toContain("/reviews/rounds/round-1/calibration");
    expect(screen.getByText("In calibration")).toBeTruthy();
    expect(screen.getByText("You rated 4")).toBeTruthy();
    expect(screen.getByText("Changed in calibration")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Check summary" }).getAttribute("href")).toContain("/reviews/r-Tarek%20Ayari");
  });

  it("leads an employee's page with their own review, their year, input asked of them and past results", () => {
    state.data = workspace({
      own, year: { planProgress: 74, objectives: 2, feedback: 7, praise: 3, oneOnOnes: 19 },
      askedOfYou: [{ requestId: "p1", subjectDisplayName: "Meriem Hamrouni", roundName: "Year-end review", questions: 3, dueDate: "2099-09-15", daysLate: 0, state: "Open", respondedAt: null }],
      pastResults: [{ reviewId: "old", cycleName: "FY2026", roundName: "Year-end", finalRating: 4, label: "Exceeds expectations", finalizedAt: "2098-09-28T10:00:00Z", acknowledgedAt: "2098-09-29T10:00:00Z" }],
    });
    render(<ReviewsWorkspace />);
    expect(screen.getByRole("link", { name: /Continue self-assessment/ }).getAttribute("href")).toContain("/reviews/r-aicha");
    expect(screen.getByText("Your year, already in the review")).toBeTruthy();
    expect(screen.getByText("74%")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Give input" }).getAttribute("href")).toBe("/reviews/peer-requests/p1");
    expect(screen.getByText("Exceeds expectations")).toBeTruthy();
  });

  it("leads a reviewer's page with the review ready for them and lists the team as steps", () => {
    state.data = workspace({
      own: { ...own, reviewerName: "Amira Khelifi" },
      toWrite: [
        row("Aicha Bouazizi", { state: "ManagerAssessment", selfStep: "Submitted", selfSubmittedAt: "2099-09-08T10:00:00Z", reviewStep: "ReadyToWrite", nextAction: "WriteReview", selfOverallLabel: "Exceeds", peerAnswered: 3 }),
        row("Tarek Ayari", { peerTotal: 3, peerAnswered: 0, nextAction: "Wait" }),
      ],
    });
    render(<ReviewsWorkspace />);
    expect(screen.getByText("Ready for you")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Aicha Bouazizi" })).toBeTruthy();
    // Fusion asked the peers at launch (D-40): nothing to approve.
    expect(screen.getAllByText("3 asked").length).toBe(2);
    expect(screen.getByText("Amira Khelifi reviews you")).toBeTruthy();
  });

  it("leads HR's page with the running round and lists the cycle's rounds", () => {
    state.data = workspace({
      canAdminister: true,
      rounds: [{
        roundId: "round-1", name: "Year-end review", state: "Active", launchedAt: "2099-09-01T08:00:00Z", periodStart: "2098-10-01", periodEnd: "2099-08-31",
        people: 142, components: 7, calibrationEnabled: true, selfAssessmentDue: "2099-09-15", peerInputDue: "2099-09-15", managerAssessmentDue: "2099-09-22",
        stages: [
          { stage: "SelfAssessment", done: 88, total: 142, dueDate: "2099-09-15", open: 54, late: 0, declined: 0, readyToWrite: 0 },
          { stage: "PeerInput", done: 214, total: 281, dueDate: "2099-09-15", open: 58, late: 0, declined: 9, readyToWrite: 0 },
          { stage: "ManagerAssessment", done: 11, total: 142, dueDate: "2099-09-22", open: 131, late: 0, declined: 0, readyToWrite: 38 },
          { stage: "Released", done: 0, total: 142, dueDate: null, open: 142, late: 0, declined: 0, readyToWrite: 0 },
        ],
        released: 0, acknowledged: 0, closedAt: null,
      }],
    });
    render(<ReviewsWorkspace />);
    expect(screen.getByRole("heading", { name: "Year-end review" })).toBeTruthy();
    expect(screen.getByText("54 still open")).toBeTruthy();
    expect(screen.getByText("38 ready to write")).toBeTruthy();
    expect(screen.getByRole("link", { name: /New round/ })).toBeTruthy();
  });

  it("covers the edge states: no review yet, left out of a round, and the first round", () => {
    state.data = workspace({ year: { planProgress: 74, objectives: 2, feedback: 7, praise: 3, oneOnOnes: 4 } });
    const { unmount } = render(<ReviewsWorkspace />);
    expect(screen.getByText("No review yet in FY2027.")).toBeTruthy();
    // No review this cycle: no year figures; the page says so and keeps past results.
    expect(screen.queryByText("Your year so far")).toBeNull();
    unmount();

    state.data = workspace({ notIncluded: { roundId: "round-1", roundName: "Year-end review", reason: "Joined 12 Jul" } });
    const second = render(<ReviewsWorkspace />);
    expect(screen.getByText("You're not in the Year-end review")).toBeTruthy();
    expect(screen.getByText("Joined 12 Jul")).toBeTruthy();
    second.unmount();

    state.data = workspace({ canAdminister: true, cycleFacts: { participants: 145, approvedPlans: 138 } });
    render(<ReviewsWorkspace />);
    expect(screen.getByText("Set up the FY2027 review")).toBeTruthy();
    expect(screen.getByText(/145 in the cycle · 138 approved plans/)).toBeTruthy();
  });

  it("says what failed when the workspace can't load", () => {
    state.error = new Error("Down");
    render(<ReviewsWorkspace />);
    expect(screen.getByText("Unavailable")).toBeTruthy();
  });
});

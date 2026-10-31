// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PerformanceReviewDto } from "@repo/api";
import { ReviewRecordPage } from "./review-record-page";

const mocks = vi.hoisted(() => ({
  record: null as PerformanceReviewDto | null,
  saveSelf: vi.fn(), submitSelf: vi.fn(), saveManager: vi.fn(), submitManager: vi.fn(), close: vi.fn(),
  acknowledge: vi.fn(), moveReview: vi.fn(), draft: vi.fn(), revise: vi.fn(), keep: vi.fn(), ai: true,
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ reviewId: "review-1" }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@repo/ds/shell", async () => {
  const React = await import("react");
  return {
    AsyncButton: ({ children, onClick, disabled }: React.ButtonHTMLAttributes<HTMLButtonElement>) => React.createElement("button", { onClick, disabled }, children),
    PageContainer: ({ children }: React.PropsWithChildren) => React.createElement("main", null, children),
    Said: ({ children }: React.PropsWithChildren) => React.createElement("p", null, children),
    PagePermissionNotice: ({ title }: { title: string }) => React.createElement("div", null, title),
    PageSkeleton: () => React.createElement("div", null, "Loading"),
    StatusBadge: ({ children }: React.PropsWithChildren) => React.createElement("span", null, children),
    PageHeader: ({ title, actions }: { title: React.ReactNode; actions?: React.ReactNode }) =>
      React.createElement("header", null, React.createElement("h1", null, title), actions),
  };
});
vi.mock("../content-unavailable", async () => {
  const React = await import("react");
  return { ContentUnavailable: () => React.createElement("div", null, "Unavailable") };
});
vi.mock("../conversations/colleague-picker", () => ({ ColleaguePicker: () => null }));
vi.mock("@repo/performance-ui", async (original) => {
  const React = await import("react");
  return { ...(await original<object>()), ValueChip: ({ value }: { value: { name: string } }) => React.createElement("span", null, value.name) };
});
vi.mock("../../api/use-workspace", () => ({
  RecordCycleScope: ({ children }: React.PropsWithChildren) => children,
  useWorkspaceContext: () => ({ data: { selected: { id: "cycle-1" }, capabilities: { aiAssistance: mocks.ai } }, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("../../api/use-reviews", () => ({
  useReview: () => ({ data: mocks.record, isLoading: false, error: null, refetch: vi.fn() }),
  useReviewAssessmentMutations: () => ({
    saveSelf: { mutateAsync: mocks.saveSelf, isLoading: false },
    submitSelf: { mutateAsync: mocks.submitSelf, isLoading: false },
    saveManager: { mutateAsync: mocks.saveManager, isLoading: false },
    submitManager: { mutateAsync: mocks.submitManager, isLoading: false },
    close: { mutateAsync: mocks.close, isLoading: false },
  }),
}));
vi.mock("../../api/use-review-work", () => ({
  useAcknowledge: () => ({ mutateAsync: mocks.acknowledge, isLoading: false }),
  useDownloadReviewPdf: () => vi.fn(),
  usePeerCommands: () => ({ nominate: { mutateAsync: vi.fn(), isLoading: false } }),
  useScheduleCommands: () => ({ moveReview: { mutateAsync: mocks.moveReview, isLoading: false } }),
  useReviewsApi: () => ({ draft: mocks.draft }),
  useSummaryRevision: () => ({ revise: { mutateAsync: mocks.revise, isLoading: false, error: null }, keep: { mutateAsync: mocks.keep, isLoading: false, error: null } }),
}));

const scale = [1, 2, 3, 4, 5].map((value) => ({ value, label: ["Below", "Developing", "Meets", "Exceeds", "Outstanding"][value - 1]!, description: null }));
const competency = {
  kind: "Competency" as const, itemId: "comp-1", title: "Ownership", description: "Owns outcomes.",
  behaviors: [], measurement: null, hasProgress: false, progress: null, evidenceCount: 0, evidenceSummary: [],
  selfReflection: null, selfRating: null, selfComment: null, managerAssessment: null, managerRating: null,
};
function review(overrides: Partial<PerformanceReviewDto>): PerformanceReviewDto {
  return {
    id: "review-1", reviewRoundId: "round-1", cycleId: "cycle-1", reviewRoundName: "Year-end review",
    periodStart: "2026-10-01", periodEnd: "2027-08-31", subjectDisplayName: "Aicha Bouazizi", reviewerDisplayName: "Mariam Gharbi",
    state: "SelfAssessment", dueDate: "2099-09-15", selfAssessmentEnabled: true, calibrationEnabled: false,
    canEditSelfAssessment: true, canEditManagerAssessment: false, version: 2,
    ratingScaleVersionId: "scale-version-1", ratingScaleVersion: 1, ratingScale: scale,
    selfAssessment: { summary: "", overallRating: null, savedAt: null, submittedAt: null }, managerAssessment: null,
    hasApprovedPlan: true, objectiveRatingsEnabled: true, items: [competency], finalRating: null, finalRatingSource: null, finalizedAt: null, calibration: null,
    lens: "Subject", subjectEmployeeId: "aicha", reviewerEmployeeId: "mariam", subjectJobTitle: "QA Automation Engineer", subjectOrgUnitName: "Product A",
    roundState: "Active", peerInputEnabled: false, questionsEnabled: true, potentialEnabled: false,
    questions: [
      { questionId: "q-person", audience: "Person", sortOrder: 0, text: "What are you most proud of this year?", selfAnswer: null, managerAnswer: null },
      { questionId: "q-manager", audience: "Manager", sortOrder: 0, text: "What should they keep doing?", selfAnswer: null, managerAnswer: null },
    ],
    potential: null, peers: null, acknowledgement: null,
    schedule: { selfAssessmentDue: "2099-09-15", peerInputDue: null, managerAssessmentDue: "2099-09-22", daysLate: 0, selfOverridden: false, managerOverridden: false, nextReminder: null, remindersSent: [] },
    year: null, activity: [], closeReason: null,
    canAcknowledge: false, canDownloadPdf: false, canNominatePeers: false, canApprovePeers: false, canMoveDueDate: false, canClose: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ai = true;
  mocks.record = review({});
  for (const fn of [mocks.saveSelf, mocks.submitSelf, mocks.saveManager, mocks.submitManager]) fn.mockResolvedValue({ id: "review-1", state: "ManagerAssessment", dueDate: null, version: 3 });
  mocks.acknowledge.mockResolvedValue({ at: "2099-09-29T10:00:00Z", comment: null });
});

describe("the person writing (board 08)", () => {
  it("submits ratings, the answer, the overall view and the summary", async () => {
    render(<ReviewRecordPage />);
    expect(screen.queryByText("What should they keep doing?")).toBeNull();
    fireEvent.click(screen.getAllByRole("radio", { name: "4 Exceeds" })[0]!);
    fireEvent.change(screen.getByLabelText("What are you most proud of this year?"), { target: { value: "The nightly suite." } });
    fireEvent.click(screen.getAllByRole("radio").find((r) => r.textContent?.startsWith("4") && r.textContent.includes("Exceeds"))!);
    fireEvent.change(screen.getByLabelText("Your summary"), { target: { value: "A steady year." } });
    fireEvent.click(screen.getByRole("button", { name: /Submit self-assessment/ }));
    await waitFor(() => expect(mocks.submitSelf).toHaveBeenCalledWith(expect.objectContaining({
      summary: "A steady year.", overallRating: 4,
      answers: [{ questionId: "q-person", text: "The nightly suite." }],
      items: [expect.objectContaining({ kind: "Competency", itemId: "comp-1", rating: 4 })],
    })));
  });
});

describe("the released result (board 13)", () => {
  it("leads with the result, never shows potential, and acknowledges with a comment", async () => {
    mocks.record = review({
      state: "Finalized", canEditSelfAssessment: false, finalRating: 4, finalizedAt: "2099-09-28T10:00:00Z",
      managerAssessment: { summary: "Testing became something the team relies on.", overallRating: null, savedAt: null, submittedAt: "2099-09-20T10:00:00Z" },
      canAcknowledge: true, canDownloadPdf: true,
    });
    render(<ReviewRecordPage />);
    expect(screen.getByRole("heading", { name: "Exceeds" })).toBeTruthy();
    expect(screen.getByText("Testing became something the team relies on.")).toBeTruthy();
    expect(screen.queryByText("Potential")).toBeNull();
    fireEvent.change(screen.getByLabelText("Comment for your reviewer and HR"), { target: { value: "Agreed." } });
    fireEvent.click(screen.getByRole("button", { name: /Acknowledge/ }));
    await waitFor(() => expect(mocks.acknowledge).toHaveBeenCalledWith("Agreed."));
  });
});

describe("the reviewer (board 12)", () => {
  it("writes beside the person's words and submits potential with the review", async () => {
    mocks.record = review({
      lens: "Reviewer", state: "ManagerAssessment", canEditSelfAssessment: false, canEditManagerAssessment: true, potentialEnabled: true,
      selfAssessment: { summary: "My year", overallRating: 4, savedAt: null, submittedAt: "2099-09-08T10:00:00Z" },
      managerAssessment: { summary: "", overallRating: null, savedAt: null, submittedAt: null },
      items: [{ ...competency, selfRating: 3 }],
      questions: [{ questionId: "q-manager", audience: "Manager", sortOrder: 0, text: "What should they keep doing?", selfAnswer: null, managerAnswer: null }],
      peers: { approved: true, approvedAt: null, nominatedAt: null, questions: ["What do they do well?"], people: [
        { employeeId: "fares", displayName: "Fares Lachheb", source: "Subject", requestId: "p1", state: "Answered", declineNote: null, respondedAt: null,
          answers: [{ questionId: "pq", question: "What do they do well?", text: "Turns bug reports into tests." }] },
        { employeeId: "khaled", displayName: "Khaled Sassi", source: "Subject", requestId: "p2", state: "Declined", declineNote: "Haven't worked together", respondedAt: null, answers: [] },
      ] },
    });
    render(<ReviewRecordPage />);
    expect(screen.getByText("Turns bug reports into tests.")).toBeTruthy();
    expect(screen.getByText(/Haven't worked together/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("radio", { name: "5 Outstanding" })[0]!);
    fireEvent.change(screen.getByLabelText("What should they keep doing?"), { target: { value: "Pairing." } });
    fireEvent.change(screen.getByLabelText("Your summary"), { target: { value: "Raised the bar." } });
    fireEvent.click(screen.getAllByRole("radio").find((r) => r.textContent?.startsWith("4") && r.textContent.includes("Exceeds"))!);
    fireEvent.click(screen.getByRole("radio", { name: /High/ }));
    fireEvent.click(screen.getByRole("button", { name: /Submit review/ }));
    await waitFor(() => expect(mocks.submitManager).toHaveBeenCalledWith(expect.objectContaining({
      summary: "Raised the bar.", overallRating: 4, potential: "High",
      answers: [{ questionId: "q-manager", text: "Pairing." }],
      items: [expect.objectContaining({ kind: "Competency", rating: 5 })],
    })));
  });
});

describe("HR's view (board 14)", () => {
  it("shows lateness, reminders and activity with the move and close actions", () => {
    mocks.record = review({
      lens: "Administrator", canEditSelfAssessment: false, canMoveDueDate: true, canClose: true,
      schedule: { selfAssessmentDue: "2020-09-15", peerInputDue: null, managerAssessmentDue: "2020-09-22", daysLate: 2, selfOverridden: false, managerOverridden: false,
        nextReminder: "2020-09-23", remindersSent: ["2020-09-12T09:00:00Z", "2020-09-16T09:00:00Z"] },
      activity: [{ kind: "Opened", at: "2020-09-01T09:00:00Z", text: "Review opened", detail: null }],
    });
    render(<ReviewRecordPage />);
    expect(screen.getByText("Self-assessment 2 days late")).toBeTruthy();
    expect(screen.getByText("Review opened")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Move due date/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Close without a result/ })).toBeTruthy();
  });
});

const drafted = {
  outcome: "Drafted" as const, sourceCount: 5, privateSentenceCount: 1, sourceKinds: ["objective", "feedback"],
  sentences: [
    { text: "Aicha moved regression testing to a nightly suite.", sources: [{ kind: "objective", label: "Automate the regression suite · 92%", path: "/performance/cycles/c/objectives/o", subjectVisible: true, excerpt: "Objective" }] },
    { text: "Hand-offs ran late twice.", sources: [{ kind: "feedback", label: "Fares · feedback 2 Mar", path: null, subjectVisible: false, excerpt: "Manager-only" }] },
  ],
};

describe("AI drafts (boards 12, 13, 16)", () => {
  const writing = () => review({
    lens: "Reviewer", state: "ManagerAssessment", canEditSelfAssessment: false, canEditManagerAssessment: true,
    selfAssessment: { summary: "My year", overallRating: 4, savedAt: null, submittedAt: "2099-09-08T10:00:00Z" },
    managerAssessment: { summary: "", overallRating: null, savedAt: null, submittedAt: null },
  });

  it("drafts the summary with its sources, marks what Aicha can't see, and inserts plain text with undo", async () => {
    mocks.record = writing();
    mocks.draft.mockResolvedValue(drafted);
    render(<ReviewRecordPage />);
    fireEvent.click(screen.getByRole("button", { name: "Draft from Aicha's year" }));
    expect(await screen.findByText("Aicha moved regression testing to a nightly suite.")).toBeTruthy();
    expect(mocks.draft).toHaveBeenCalledWith("review-1", "Summary", undefined);
    expect(screen.getByText("1 sentence uses sources Aicha can't see")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fares · feedback 2 Mar, not visible to Aicha" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect((screen.getByLabelText("Your summary") as HTMLTextAreaElement).value)
      .toBe("Aicha moved regression testing to a nightly suite. Hand-offs ran late twice.");
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    expect((screen.getByLabelText("Your summary") as HTMLTextAreaElement).value).toBe("");
  });

  it("drafts one manager question on request", async () => {
    mocks.record = writing();
    mocks.draft.mockResolvedValue(drafted);
    render(<ReviewRecordPage />);
    fireEvent.click(screen.getByRole("button", { name: "Draft" }));
    await waitFor(() => expect(mocks.draft).toHaveBeenCalledWith("review-1", "Question", "q-manager"));
  });

  it("says when there is too little to draft from, and hides on failure or with AI off", async () => {
    mocks.record = writing();
    mocks.draft.mockResolvedValueOnce({ ...drafted, outcome: "Abstained", sentences: [] }).mockRejectedValueOnce(new Error("unavailable"));
    const { unmount } = render(<ReviewRecordPage />);
    fireEvent.click(screen.getByRole("button", { name: "Draft from Aicha's year" }));
    expect(await screen.findByText("Too little to draft from yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close the draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Draft from Aicha's year" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Draft from Aicha's year" })).toBeNull());
    unmount();
    mocks.ai = false;
    render(<ReviewRecordPage />);
    expect(screen.queryByRole("button", { name: "Draft from Aicha's year" })).toBeNull();
  });

  it("gives the person a starter in their own voice", async () => {
    mocks.draft.mockResolvedValue({ ...drafted, privateSentenceCount: 0, sentences: [drafted.sentences[0]!] , sourceCount: 4 });
    render(<ReviewRecordPage />);
    fireEvent.click(screen.getByRole("button", { name: "Start from your year" }));
    expect(await screen.findByText("4 sources you can see")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use as my starting point" }));
    expect((screen.getByLabelText("Your summary") as HTMLTextAreaElement).value).toBe("Aicha moved regression testing to a nightly suite.");
  });
});

describe("after calibration (board 15)", () => {
  it("shows the reviewer the outcome and reason, and reopens only the summary", async () => {
    mocks.record = review({
      lens: "Reviewer", state: "ReadyToFinalize", canEditSelfAssessment: false, calibrationEnabled: true,
      managerAssessment: { summary: "Went beyond the role this year.", overallRating: 4, savedAt: null, submittedAt: "2099-09-20T10:00:00Z" },
      calibration: { sessionFinalized: true, originalRating: 4, calibratedRating: 3, rationale: "Beyond the role once; the rest met it.",
        originalPotential: null, calibratedPotential: null, changedBy: "Khaled Sassi", changedAt: "2099-09-24T10:00:00Z",
        canReviseSummary: true, summaryRevisedAt: null, summaryCheckedAt: null },
    });
    mocks.revise.mockResolvedValue({});
    mocks.keep.mockResolvedValue({});
    render(<ReviewRecordPage />);
    expect(screen.getByText("You gave 4 · Exceeds")).toBeTruthy();
    expect(screen.getByText("Beyond the role once; the rest met it.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep as is" }));
    await waitFor(() => expect(mocks.keep).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Your summary"), { target: { value: "Met the role, and went beyond it once." } });
    fireEvent.click(screen.getByRole("button", { name: /Save summary/ }));
    await waitFor(() => expect(mocks.revise).toHaveBeenCalledWith({ summary: "Met the role, and went beyond it once.", expectedVersion: 2 }));
  });
});

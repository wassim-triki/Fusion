// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PerformanceReviewDto, ReviewYearItemDto } from "@repo/api";
import { ReviewPage } from "./review-page";

const m = vi.hoisted(() => ({
  record: null as PerformanceReviewDto | null,
  year: [] as ReviewYearItemDto[],
  saveSelf: vi.fn(), submitSelf: vi.fn(), saveManager: vi.fn(), submitManager: vi.fn(), close: vi.fn(),
  acknowledge: vi.fn(), draft: vi.fn(), takeBack: vi.fn(), nudge: vi.fn(), talk: vi.fn(), comment: vi.fn(), change: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ reviewId: "review-1" }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@repo/api/react", () => ({ useRecentRecord: () => undefined }));
vi.mock("../content-unavailable", () => ({ ContentUnavailable: () => <div>Unavailable</div> }));
vi.mock("../conversations/colleague-picker", () => ({ ColleaguePicker: () => null }));
vi.mock("./calibrated-outcome", () => ({ CalibratedOutcome: () => null }));
vi.mock("../../api/use-workspace", () => ({
  RecordCycleScope: ({ children }: React.PropsWithChildren) => children,
  useWorkspaceContext: () => ({ data: { selected: { id: "cycle-1" }, capabilities: { aiAssistance: true } }, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("../../api/use-reviews", () => ({
  useReview: () => ({ data: m.record, isLoading: false, error: null, refetch: vi.fn() }),
  useReviewAssessmentMutations: () => ({
    saveSelf: { mutateAsync: m.saveSelf, isLoading: false }, submitSelf: { mutateAsync: m.submitSelf, isLoading: false },
    saveManager: { mutateAsync: m.saveManager, isLoading: false }, submitManager: { mutateAsync: m.submitManager, isLoading: false },
    close: { mutateAsync: m.close, isLoading: false },
  }),
}));
vi.mock("../../api/use-review-work", () => ({
  useAcknowledge: () => ({ mutateAsync: m.acknowledge, isLoading: false }),
  useDownloadReviewPdf: () => vi.fn(),
  usePeerCommands: () => ({ change: { mutateAsync: m.change, isLoading: false } }),
  useScheduleCommands: () => ({ moveReview: { mutateAsync: vi.fn(), isLoading: false } }),
  useReviewsApi: () => ({ draft: m.draft }),
  useReviewYear: () => ({ data: m.year, isLoading: false }),
  useReviewActions: () => ({
    takeBack: { mutateAsync: m.takeBack, isLoading: false }, nudge: { mutateAsync: m.nudge, isLoading: false },
    talkItOver: { mutateAsync: m.talk, isLoading: false }, comment: { mutateAsync: m.comment, isLoading: false },
  }),
}));

const scale = ["Needs improvement", "Developing", "Effective", "Strong", "Exceptional"].map((label, i) => ({ value: i + 1, label, description: null }));
const goal = {
  kind: "Objective" as const, itemId: "g1", title: "Automate the regression suite", description: null, behaviors: [],
  measurement: { method: "NumericTarget", baseline: 20, target: 85, unit: "%", direction: "Increase", milestones: [] } as never,
  hasProgress: true, progress: 71, evidenceCount: 0, evidenceSummary: [], selfReflection: null, selfRating: null, selfComment: null,
  managerAssessment: null, managerRating: null, grade: 0.71, weight: 40, measurementSummary: "20 → 85 %", currentActual: 66,
  selfGrade: null, selfGradeReason: null, managerGrade: null, managerGradeReason: null,
};
const competency = {
  kind: "Competency" as const, itemId: "c1", title: "Systems Thinking", description: "Identifies dependencies", behaviors: [], measurement: null,
  hasProgress: false, progress: null, evidenceCount: 0, evidenceSummary: [], selfReflection: null, selfRating: 4, selfComment: null,
  managerAssessment: null, managerRating: 4,
};
const praiseKey = "praise:aaaabbbbccccddddeeeeffff00001111";

function review(overrides: Partial<PerformanceReviewDto>): PerformanceReviewDto {
  return {
    id: "review-1", reviewRoundId: "round-1", cycleId: "cycle-1", reviewRoundName: "FY2027 year-end", periodStart: "2026-04-25", periodEnd: "2027-04-24",
    subjectDisplayName: "Aicha Bouazizi", reviewerDisplayName: "Mariam Gharbi", state: "SelfAssessment", dueDate: "2099-03-15",
    selfAssessmentEnabled: true, calibrationEnabled: false, canEditSelfAssessment: true, canEditManagerAssessment: false, version: 2,
    ratingScaleVersionId: "s1", ratingScaleVersion: 1, ratingScale: scale,
    selfAssessment: { summary: "", overallRating: null, savedAt: null, submittedAt: null }, managerAssessment: null,
    hasApprovedPlan: true, objectiveRatingsEnabled: false, items: [goal, competency], finalRating: null, finalRatingSource: null, finalizedAt: null, calibration: null,
    lens: "Subject", subjectEmployeeId: "aicha", reviewerEmployeeId: "mariam", subjectJobTitle: "QA Automation Engineer", subjectOrgUnitName: null,
    roundState: "Active", peerInputEnabled: true, questionsEnabled: true, potentialEnabled: false,
    questions: [
      { questionId: "q-keep", audience: "Person", sortOrder: 0, text: "What went well this year?", selfAnswer: null, managerAnswer: null, selfCitations: [], managerCitations: [] },
      { questionId: "q-m", audience: "Manager", sortOrder: 0, text: "What should Aicha keep doing?", selfAnswer: null, managerAnswer: null, selfCitations: [], managerCitations: [] },
    ],
    potential: null, peers: null, acknowledgement: null,
    schedule: { selfAssessmentDue: "2099-03-15", peerInputDue: null, managerAssessmentDue: "2099-03-29", daysLate: 0, selfOverridden: false, managerOverridden: false, nextReminder: null, remindersSent: [] },
    year: null, activity: [], closeReason: null, canAcknowledge: false, canDownloadPdf: false, canChangePeers: false, canTakeBack: false, talkItOverAt: null,
    canMoveDueDate: false, canClose: false, ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.year = [{ number: 1, key: praiseKey, kind: "praise", at: "2026-10-05T10:00:00Z", who: "Salah Ben Hassine", title: null, body: "The incident drill was the best we have run.", path: null, private: false }];
  for (const fn of [m.saveSelf, m.submitSelf, m.saveManager, m.submitManager]) fn.mockResolvedValue({ id: "review-1", state: "ManagerAssessment", dueDate: null, version: 3 });
});

describe("Writing a review beside the year (H3)", () => {
  it("a self-review opens on empty answers with a draft a click away, each sentence citing its source (D-68)", async () => {
    m.record = review({});
    m.draft.mockResolvedValue({ outcome: "Drafted", sentences: [{ text: "I ran the incident drill.", sources: [{ kind: "praise", key: praiseKey, label: "", path: null, subjectVisible: true, excerpt: "" }] }, { text: "Salah called it the best.", sources: [{ kind: "praise", key: praiseKey, label: "", path: null, subjectVisible: true, excerpt: "" }] }], sourceCount: 4, privateSentenceCount: 0, sourceKinds: [] });
    render(<ReviewPage />);
    expect(screen.getByRole("heading", { name: "Your self-review" })).toBeTruthy();
    expect(m.draft).not.toHaveBeenCalled();
    expect(screen.getAllByText("71%")).toHaveLength(2);
    expect(screen.getByRole("img", { name: "66 % of 85 %" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Draft from my year/ }));
    await waitFor(() => expect(m.draft).toHaveBeenCalledWith("review-1", "Question", "q-keep"));
    expect(await screen.findByText("AI draft from your year")).toBeTruthy();
    fireEvent.click(screen.getByText(/I ran the incident/));
    await waitFor(() => expect(m.saveSelf).toHaveBeenCalledWith(expect.objectContaining({
      answers: [{ questionId: "q-keep", text: "I ran the incident drill. Salah called it the best.", citations: [
        { text: "I ran the incident drill.", key: praiseKey }, { text: "Salah called it the best.", key: praiseKey }] }],
    })));
    fireEvent.click(within(screen.getByRole("group", { name: "Your year overall" })).getByRole("button", { name: "Strong" }));
    fireEvent.click(screen.getByRole("button", { name: /Send to Mariam/ }));
    await waitFor(() => expect(m.submitSelf).toHaveBeenCalledWith(expect.objectContaining({ overallRating: 4 })));
  });

  it("typing an answer keeps the field open past the first character (B-463)", () => {
    m.record = review({});
    render(<ReviewPage />);
    const field = screen.getByRole("textbox", { name: "What went well this year?" });
    fireEvent.change(field, { target: { value: "I" } });
    fireEvent.change(screen.getByRole("textbox", { name: "What went well this year?" }), { target: { value: "I ran" } });
    expect((screen.getByRole("textbox", { name: "What went well this year?" }) as HTMLTextAreaElement).value).toBe("I ran");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("textbox", { name: "What went well this year?" })).toBeNull();
    expect(screen.getByText("I ran")).toBeTruthy();
  });

  it("a draft that doesn't come says why and can be tried again (B-461)", async () => {
    m.record = review({});
    m.draft.mockResolvedValueOnce({ outcome: "Abstained", sentences: [], sourceCount: 4, privateSentenceCount: 0, sourceKinds: [] });
    render(<ReviewPage />);
    fireEvent.click(screen.getByRole("button", { name: /Draft from my year/ }));
    expect(await screen.findByText("Too little in the year to draft this one")).toBeTruthy();
    m.draft.mockRejectedValueOnce(new Error("503"));
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByText("The draft didn't come through")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(m.draft).toHaveBeenCalledTimes(3));
  });

  it("every goal says where it got and its state, graded as a share of its target (B-458, B-459)", () => {
    m.record = review({ items: [{ ...goal, status: "AtRisk" }, competency] });
    render(<ReviewPage />);
    expect(screen.getByText("66 % of 85 %")).toBeTruthy();
    expect(screen.getByText("At risk")).toBeTruthy();
    expect(screen.getAllByText("71%").length).toBe(2); // the goal's grade and the plan's
    expect(screen.queryByText("0.71")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change grade" }));
    expect((screen.getByRole("spinbutton", { name: "Grade" }) as HTMLInputElement).value).toBe("71");
  });

  it("the measure behind a grade shows on hover or focus (B-457)", async () => {
    m.record = review({});
    render(<ReviewPage />);
    fireEvent.focus(screen.getByRole("img", { name: "66 % of 85 %" }));
    expect((await screen.findByRole("tooltip")).textContent).toContain("66 % of 85 %");
  });

  it("a sent self-review can be taken back until the manager sends theirs", async () => {
    m.record = review({ state: "ManagerAssessment", canEditSelfAssessment: false, canTakeBack: true,
      selfAssessment: { summary: "", overallRating: 4, savedAt: null, submittedAt: "2099-03-10T10:00:00Z" } });
    m.takeBack.mockResolvedValue({ id: "review-1", state: "SelfAssessment", dueDate: null, version: 4 });
    render(<ReviewPage />);
    expect(screen.queryByRole("button", { name: /Draft from my year/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Take it back" }));
    await waitFor(() => expect(m.takeBack).toHaveBeenCalled());
  });

  it("the manager's review opens drafted from the year and says what it still waits on, a nudge each (D-60)", async () => {
    m.record = review({ lens: "Reviewer", canEditSelfAssessment: false, canEditManagerAssessment: true, selfAssessment: null,
      peers: { nominatedAt: null, questions: [], people: [
        { employeeId: "leila", displayName: "Leila Ben Salah", source: "Fusion", requestId: "p1", state: "Open", declineNote: null, respondedAt: null, answers: [] },
        { employeeId: "rim", displayName: "Rim Mahjoub", source: "Fusion", requestId: "p2", state: "Answered", declineNote: null, respondedAt: null, answers: [] },
      ] } });
    m.draft.mockResolvedValue({ outcome: "Abstained", sentences: [], sourceCount: 1, privateSentenceCount: 0, sourceKinds: [] });
    m.nudge.mockResolvedValue({ nudged: 1 });
    render(<ReviewPage />);
    await waitFor(() => expect(m.draft).toHaveBeenCalledWith("review-1", "Question", "q-m"));
    expect(await screen.findByText("AI drafts this when Aicha's self-review is in")).toBeTruthy();
    // Where each part comes from, and what the review waits on in plain words (B-454, B-464).
    expect(screen.getByText("Asked by HR in FY2027 year-end")).toBeTruthy();
    expect(screen.getByText("Set by HR for QA Automation Engineer")).toBeTruthy();
    expect(screen.getByText("1 of 2 colleagues answered about Aicha")).toBeTruthy();
    expect(screen.getByText("Still to answer: Leila")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Submit review" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remind Aicha" }));
    await waitFor(() => expect(m.nudge).toHaveBeenCalledWith("self"));
    fireEvent.click(screen.getByRole("button", { name: "Remind Leila" }));
    await waitFor(() => expect(m.nudge).toHaveBeenCalledWith("peers"));
  });
});

describe("Results, read like a letter (D-73)", () => {
  it("leads with the overall rating, reads peers' words with their names, and is acknowledged or talked over in place", async () => {
    m.record = review({ state: "Finalized", canEditSelfAssessment: false, canAcknowledge: true, finalRating: 4, finalizedAt: "2099-04-09T10:00:00Z",
      selfAssessment: { summary: "", overallRating: 4, savedAt: null, submittedAt: "2099-03-10T10:00:00Z" },
      managerAssessment: { summary: "", overallRating: 4, savedAt: null, submittedAt: "2099-03-20T10:00:00Z" },
      questions: [{ questionId: "q-m", audience: "Manager", sortOrder: 0, text: "What you should keep doing", selfAnswer: null, managerAnswer: "You ran the best incident drill the team has had.", selfCitations: [], managerCitations: [] }],
      peers: { nominatedAt: null, questions: ["What should Aicha keep doing?"], people: [
        { employeeId: "leila", displayName: "Leila Ben Salah", source: null, requestId: null, state: null, declineNote: null, respondedAt: null,
          answers: [{ questionId: "pq", question: "What should Aicha keep doing?", text: "Calm in release week." }] },
      ] } });
    m.talk.mockResolvedValue({ meetingId: "m1", at: "2099-04-13T09:00:00Z" });
    m.acknowledge.mockResolvedValue({ at: "2099-04-12T10:00:00Z", comment: null });
    render(<ReviewPage />);
    expect(screen.getByRole("heading", { name: "Your FY2027 year-end" })).toBeTruthy();
    expect(screen.getAllByText("Strong").length).toBeGreaterThan(0);
    expect(screen.getByText("You ran the best incident drill the team has had.")).toBeTruthy();
    expect(screen.getByText("Leila Ben Salah")).toBeTruthy();
    expect(screen.getByText("“Calm in release week.”")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Talk it over in our 1:1/ }));
    await waitFor(() => expect(m.talk).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    await waitFor(() => expect(m.acknowledge).toHaveBeenCalledWith(null));
  });
});

// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PeerRequestDto, PerformanceReviewDto, ReviewQuestionDto, ReviewRoundDto } from "@repo/api";
import { RoundPage } from "./round-page";
import { PeerListDrawer } from "./peer-list-drawer";
import { PeerRequestPage } from "./peer-request-page";

const m = vi.hoisted(() => ({
  round: null as ReviewRoundDto | null,
  review: null as PerformanceReviewDto | null,
  request: null as PeerRequestDto | null,
  questions: [] as ReviewQuestionDto[],
  update: vi.fn(), launch: vi.fn(), approve: vi.fn(), send: vi.fn(), decline: vi.fn(), save: vi.fn(), createQuestion: vi.fn(),
  archive: vi.fn(), remove: vi.fn(), updateSettings: vi.fn(), push: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ roundId: "round-1", requestId: "p1" }), useRouter: () => ({ push: m.push, refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../content-unavailable", () => ({ ContentUnavailable: () => <div>Unavailable</div> }));
vi.mock("../conversations/colleague-picker", () => ({
  ColleaguePicker: ({ onChange }: { onChange: (p: { employeeId: string; displayName: string; subtitle: null }) => void }) =>
    <button type="button" onClick={() => onChange({ employeeId: "leila", displayName: "Leila Ben Salah", subtitle: null })}>Pick Leila</button>,
}));
vi.mock("../../api/use-workspace", () => ({
  RecordCycleScope: ({ children }: React.PropsWithChildren) => children,
  useWorkspaceContext: () => ({ data: { capabilities: { administers: true, canCalibrate: false } }, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("../../api/use-performance", () => ({
  useApis: () => ({ performance: { getReviewRound: vi.fn() } }),
  useCompetencies: () => ({ data: [] }),
  useUpdateSettings: () => ({ mutateAsync: m.updateSettings, isLoading: false }),
  useRatingScale: () => ({ data: { version: 1, scaleVersion: 1, levels: [1, 2, 3, 4, 5].map((value) => ({ value, label: `L${value}`, description: null })) } }),
}));
vi.mock("../../api/use-reviews", () => ({
  useReviewRound: () => ({ data: m.round, isLoading: false, error: null, refetch: vi.fn() }),
  useReview: () => ({ data: m.review }),
  useEligibleReviewers: () => ({ data: [], isLoading: false }),
  useReviewRoundMutations: () => ({
    update: { mutateAsync: m.update }, updatePopulation: { mutateAsync: vi.fn() },
    launch: { mutateAsync: m.launch, isLoading: false },
  }),
  useReviewRoundFinalization: () => ({ mutateAsync: vi.fn(), isLoading: false }),
}));
vi.mock("../../api/use-review-work", () => ({
  useReviewQuestions: () => ({ data: m.questions }),
  useReviewQuestionCommands: () => ({
    create: { mutateAsync: m.createQuestion, isLoading: false }, update: { mutateAsync: vi.fn(), isLoading: false },
    archive: { mutateAsync: m.archive }, remove: { mutateAsync: m.remove }, reorder: { mutateAsync: vi.fn() },
  }),
  useScheduleCommands: () => ({ moveRound: { mutateAsync: vi.fn(), isLoading: false } }),
  usePeerSuggestions: () => ({ data: [{ employeeId: "rim", displayName: "Rim Mahjoub", jobTitle: null, orgUnitName: null, sharedObjective: true, feedbackExchanged: 6, praiseExchanged: 0 }] }),
  usePeerCommands: () => ({ approve: { mutateAsync: m.approve, isLoading: false } }),
  usePeerRequest: () => ({ data: m.request, error: null, refetch: vi.fn() }),
  usePeerRequestCommands: () => ({ save: { mutateAsync: m.save, isLoading: false }, send: { mutateAsync: m.send, isLoading: false }, decline: { mutateAsync: m.decline, isLoading: false } }),
}));

const schedule = (date: string) => ({ date, followsDefault: true, offsetDays: 14 });
function round(overrides: Partial<ReviewRoundDto>): ReviewRoundDto {
  return {
    id: "round-1", cycleId: "cycle-1", name: "Product launch spot review", periodStart: "2099-06-01", periodEnd: "2099-08-31",
    selfAssessmentEnabled: false, objectiveRatingsEnabled: false, calibrationEnabled: false, selfAssessmentDueDate: null, managerAssessmentDueDate: null,
    competencyIds: [], state: "Draft", version: 4, subjects: [], peerInputEnabled: false, questionsEnabled: true, potentialEnabled: false,
    peerInputDueDate: null, cycleName: "FY2027", cycleStart: "2098-10-01", cycleEnd: "2099-09-30", launchedAt: null,
    schedule: { launchDay: "2099-06-01", selfAssessment: schedule("2099-06-15"), peerInput: schedule("2099-06-15"), managerAssessment: { ...schedule("2099-06-08"), offsetDays: 7 }, acknowledgementReminderDays: 7 },
    questions: [{ id: "s1", questionId: "q1", audience: "Manager", sortOrder: 0, text: "What should they keep doing?" }],
    readiness: null, progress: null, outcome: null, configuration: null, activity: [], ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.update.mockResolvedValue(undefined);
  m.approve.mockResolvedValue(undefined);
  m.send.mockResolvedValue(undefined);
  m.decline.mockResolvedValue(undefined);
  m.save.mockResolvedValue(undefined);
  m.createQuestion.mockResolvedValue(undefined);
  m.questions = [];
});

describe("Round page", () => {
  it("names the running round that blocks launch and keeps Launch off (B-060)", () => {
    m.round = round({
      readiness: { ready: false, launchCount: 12, subjectIssueCount: 0, issues: ["RoundRunning"],
        runningRound: { id: "year-end", name: "Year-end review", launchedAt: "2099-09-01T08:00:00Z", reviewCount: 142, selfSubmitted: 88, selfRequired: 142, managerSubmitted: 11, managerRequired: 142 } },
    });
    render(<RoundPage />);
    expect(screen.getByText("Launch this round once the Year-end review is closed.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open Year-end review/ }).getAttribute("href")).toContain("/reviews/rounds/year-end");
    expect((screen.getByRole("button", { name: /Launch round/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("62% self · 8% manager")).toBeTruthy();
  });

  it("saves a component change straight away and launches a ready round", async () => {
    m.round = round({ readiness: { ready: true, launchCount: 12, subjectIssueCount: 0, issues: [], runningRound: null } });
    m.launch.mockResolvedValue({ reviewRoundId: "round-1", state: "Active", reviewCount: 12, reviewIds: [] });
    render(<RoundPage />);
    fireEvent.click(screen.getByRole("switch", { name: "Potential" }));
    await waitFor(() => expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ potentialEnabled: true, expectedVersion: 4, questionIds: ["q1"] })));
    expect(screen.getByText("reviews open at once, each person notified")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Launch round/ }));
    await waitFor(() => expect(m.launch).toHaveBeenCalledWith(4));
  });

  it("shows a running round's teams furthest behind first and its frozen configuration", () => {
    m.round = round({
      name: "Year-end review", state: "Active", launchedAt: "2099-09-01T08:00:00Z", selfAssessmentEnabled: true,
      progress: {
        stages: [
          { stage: "SelfAssessment", done: 88, total: 142, dueDate: "2099-09-15", open: 54, late: 0, declined: 0, readyToWrite: 0 },
          { stage: "ManagerAssessment", done: 11, total: 142, dueDate: "2099-09-22", open: 131, late: 0, declined: 0, readyToWrite: 38 },
          { stage: "Released", done: 0, total: 142, dueDate: null, open: 142, late: 0, declined: 0, readyToWrite: 0 },
        ],
        teams: [
          { reviewerEmployeeId: "omar", reviewerDisplayName: "Omar Mansour", orgUnitName: "Engineering B", people: 18, self: { done: 6, total: 18 }, peers: { done: 0, total: 0 }, manager: { done: 0, total: 18 }, listsToApprove: 2 },
          { reviewerEmployeeId: "leila", reviewerDisplayName: "Leila Ben Salah", orgUnitName: "Product B", people: 14, self: { done: 7, total: 14 }, peers: { done: 0, total: 0 }, manager: { done: 1, total: 14 }, listsToApprove: 0 },
        ],
        nextReminder: { date: "2099-09-12", selfAssessments: 54, peerLists: 0, peerInputs: 67, managerAssessments: 0 }, readyToFinalize: 0, finalized: 0, closed: 0,
      },
      configuration: { selfAssessment: true, peerInput: false, objectiveRatings: true, questions: true, potential: true, calibration: false, competencies: ["Ownership"], ratingScaleVersion: 1 },
      activity: [{ kind: "Launched", at: "2099-09-01T08:00:00Z", actorName: "Amira Khelifi", text: "Launched · 142 reviews opened", detail: null }],
    });
    render(<RoundPage />);
    const rows = screen.getAllByRole("row");
    expect(rows[1]!.textContent).toContain("Engineering B");
    expect(screen.getByText("2 lists to approve")).toBeTruthy();
    expect(screen.getByText("54 self-assessments · 67 peer answers")).toBeTruthy();
    expect(screen.getByText("Launched · 142 reviews opened")).toBeTruthy();
    expect(screen.getByText("Potential")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Due dates/ })).toBeTruthy();
  });

  it("reports a closed round's outcome", () => {
    m.round = round({
      name: "Year-end review", state: "Closed", launchedAt: "2099-09-01T08:00:00Z",
      outcome: {
        released: 140, total: 142, acknowledged: 128, calibratedChanged: 14, calibratedDown: 9, calibratedUp: 5,
        closedWithoutResult: [{ reviewId: "r-sarra", subjectDisplayName: "Sarra Dridi", reason: "Left Carthage on 10 Sep", closedAt: null }],
        distribution: [{ value: 3, label: "Meets expectations", count: 71 }, { value: 4, label: "Exceeds expectations", count: 39 }],
        notAcknowledged: [{ reviewId: "r-na", displayName: "Nabil A" }], nextAcknowledgementReminder: "2099-10-12", releasedAt: "2099-09-28T10:00:00Z",
      },
    });
    render(<RoundPage />);
    expect(screen.getByText("140")).toBeTruthy();
    expect(screen.getByText("ratings changed · 9 down, 5 up")).toBeTruthy();
    expect(screen.getByText("Left Carthage on 10 Sep")).toBeTruthy();
    expect(screen.getByText(/Next reminder/)).toBeTruthy();
  });
});

const peerReview = {
  id: "r-tarek", version: 7, subjectDisplayName: "Tarek Ayari", subjectEmployeeId: "tarek", reviewerEmployeeId: "mariam", canApprovePeers: true,
  schedule: { peerInputDue: "2099-09-15" },
  peers: { approved: false, approvedAt: null, nominatedAt: "2099-09-03T10:00:00Z", questions: [], people: [
    { employeeId: "rim", displayName: "Rim Mahjoub", source: "Subject", requestId: null, state: null, declineNote: null, respondedAt: null, answers: null },
    { employeeId: "yasmine", displayName: "Yasmine Ben Ali", source: "Subject", requestId: null, state: null, declineNote: null, respondedAt: null, answers: null },
  ] },
} as unknown as PerformanceReviewDto;

describe("Peer list drawer (board 10)", () => {
  it("swaps a nominee and approves the edited list", async () => {
    m.review = { ...peerReview, peers: { ...peerReview.peers!, people: [peerReview.peers!.people[1]!] } };
    render(<PeerListDrawer reviewId="r-tarek" open onOpenChange={vi.fn()} />);
    expect(screen.getByText("Tarek asked 1 colleague")).toBeTruthy();
    expect(screen.getByText("Shared objective · 6 feedback exchanged")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Swap/ }));
    fireEvent.click(screen.getByRole("button", { name: "Pick Leila" }));
    fireEvent.click(screen.getByRole("button", { name: /Approve 1 colleague/ }));
    await waitFor(() => expect(m.approve).toHaveBeenCalledWith({ ids: ["leila"], version: 7 }));
  });
});

const peerRequest: PeerRequestDto = {
  id: "p1", subjectEmployeeId: "aicha", subjectDisplayName: "Aicha Bouazizi", reviewRoundName: "Year-end review", dueDate: "2099-09-15", daysLate: 0,
  state: "Open", declineNote: null, respondedAt: null, canAnswer: true, version: 1,
  questions: [
    { questionId: "q1", sortOrder: 0, text: "What is one thing Aicha does really well?", answer: "Turns bug reports into tests." },
    { questionId: "q2", sortOrder: 1, text: "How was it working with her?", answer: null },
  ],
};

describe("Peer input page (board 11)", () => {
  it("says who reads it, names what's missing, then sends", async () => {
    m.request = peerRequest;
    render(<PeerRequestPage />);
    expect(screen.getByText("Not Aicha")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Send input/ }));
    expect(screen.getByText("Answer this question before sending.")).toBeTruthy();
    expect(m.send).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("How was it working with her?"), { target: { value: "Calm in release week." } });
    fireEvent.click(screen.getByRole("button", { name: /Send input/ }));
    await waitFor(() => expect(m.send).toHaveBeenCalledWith([
      { questionId: "q1", text: "Turns bug reports into tests." }, { questionId: "q2", text: "Calm in release week." },
    ]));
  });

  it("declines with a note", async () => {
    m.request = peerRequest;
    render(<PeerRequestPage />);
    fireEvent.click(screen.getByRole("button", { name: /^Decline$/ }));
    fireEvent.change(screen.getByLabelText(/Why you're declining/), { target: { value: "Haven't worked together since March" } });
    fireEvent.click(screen.getByRole("button", { name: "Decline request" }));
    await waitFor(() => expect(m.decline).toHaveBeenCalledWith("Haven't worked together since March"));
  });
});

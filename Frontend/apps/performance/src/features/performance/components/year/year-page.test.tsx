// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FusionWorkItem, YearDto, YearGroupDto, YearStepDto } from "@repo/api";
import { YearPage } from "./year-page";

const m = vi.hoisted(() => ({
  year: null as YearDto | null,
  administers: true,
  work: [] as FusionWorkItem[],
  nudge: vi.fn(),
  move: vi.fn(),
  refetch: vi.fn(),
  plan: null as unknown,
  praise: [] as unknown[],
  search: "",
  release: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(m.search) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../content-unavailable", () => ({ ContentUnavailable: () => <div>Unavailable</div> }));
vi.mock("@repo/api/query", () => ({ useFusionWork: () => ({ items: m.work }), useCompanyValues: () => ({ data: [] }), useApiQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("../../api/use-performance", () => ({
  useMyPlan: () => ({ isLoading: false, data: { participatesInCycle: true, hasPlan: true, preview: null, plan: m.plan } }),
  useApis: () => ({ performance: { finalizeReviewRound: m.release } }),
}));
vi.mock("../../api/use-conversations", () => ({ usePraisePage: () => ({ data: { items: m.praise, next: null } }) }));
vi.mock("../../api/use-workspace", () => ({
  useWorkspaceContext: () => ({
    data: { selected: { id: "fy27", name: "FY2027", state: "Active" }, capabilities: { administers: m.administers } },
    isLoading: false, error: null, refetch: vi.fn(),
  }),
  useYear: () => ({ data: m.year, isLoading: false, error: null, refetch: m.refetch }),
  useYearCommands: () => ({ move: { mutateAsync: m.move, isLoading: false }, nudge: { mutateAsync: m.nudge, isLoading: false } }),
}));

const person = (name: string, standing: YearGroupDto["standing"]) => ({ employeeId: name, name, unitName: "Engineering", standing, since: null });
const group = (standing: YearGroupDto["standing"], names: string[], count = names.length): YearGroupDto =>
  ({ standing, count, people: names.map((name) => person(name, standing)) });
const step = (phase: YearStepDto["phase"], start: string, end: string, state: YearStepDto["state"], groups: YearGroupDto[] = []): YearStepDto =>
  ({ phase, start, end, estimated: phase !== "Planning", state, count: groups.reduce((n, g) => n + g.count, 0), groups });

function year(overrides: Partial<YearDto> & { planning?: YearGroupDto[]; execution?: YearGroupDto[] } = {}): YearDto {
  const { planning = [], execution = [], ...rest } = overrides;
  return {
    cycleId: "fy27", name: "FY2027", startDate: "2026-04-25", endDate: "2027-04-24", today: "2026-05-07", state: "Active",
    phase: "Planning", planningClosedOn: null, scope: "Company", total: 99,
    steps: [
      step("Planning", "2026-04-25", "2026-05-25", "Current", planning),
      step("Execution", "2026-05-26", "2027-03-25", "Ahead", execution),
      step("Review", "2027-03-26", "2027-04-17", "Ahead"),
      step("ResultsOut", "2027-04-18", "2027-04-24", "Ahead"),
    ],
    nextMove: {
      from: "Planning", to: "Execution", kind: "closePlanning", canMove: true, blocker: null, roundId: null,
      planningDeadline: "2026-05-07", affected: 57, people: [person("Mehdi Kacem", "drafting")], opensOn: null, opens: null, release: null,
    },
    me: null, version: 4, review: null, ...rest,
  };
}

beforeEach(() => {
  m.administers = true;
  m.work = [];
  m.nudge.mockReset().mockResolvedValue({ nudged: 36, skipped: [] });
  m.move.mockReset().mockResolvedValue({});
  m.refetch.mockReset().mockResolvedValue({});
  m.search = "";
  m.release.mockReset();
});

describe("The Year page", () => {
  it("first use: everyone in the first step with the real count, the later steps as outlines (D-56)", () => {
    m.year = year({ planning: [group("notStarted", ["Amira Khelifi", "Mariam Gharbi"], 99)] });
    render(<YearPage />);
    expect(screen.getByRole("heading", { name: "FY2027" })).toBeTruthy();
    expect(screen.getByText("99 people haven't put a plan forward")).toBeTruthy();
    expect(screen.getByText("Not started")).toBeTruthy();
    expect(screen.getByText("and 97 more")).toBeTruthy();
    expect(screen.getByText("0 of 99 put forward")).toBeTruthy();
  });

  it("HR nudges everyone still to put a plan forward, by standing, then has nothing to do", async () => {
    m.year = year({ planning: [group("notStarted", ["Elyes Jaziri"], 14), group("drafting", ["Rim Mahjoub"], 22), group("submitted", ["Aicha Bouazizi"], 21)], execution: [group("updated", ["Fares Lachheb"], 42)] });
    render(<YearPage />);
    expect(screen.getByText("36 people haven't put a plan forward")).toBeTruthy();
    expect(screen.getByText("63 of 99 put forward")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Nudge them" }));
    await waitFor(() => expect(m.nudge).toHaveBeenCalledWith({ standings: ["notStarted", "drafting", "returned"] }));
    expect(await screen.findByText("Nothing for you now")).toBeTruthy();
  });

  it("moves the year on from a preview in place, with who it changes for (D-58)", async () => {
    m.year = year({ planning: [group("drafting", ["Mehdi Kacem"], 57)], execution: [group("updated", ["Fares Lachheb"], 42)] });
    render(<YearPage />);
    fireEvent.click(screen.getByRole("button", { name: "Move to Execution" }));
    expect(await screen.findByText("Move to Execution today")).toBeTruthy();
    expect(screen.getByText("Still writing or with a manager")).toBeTruthy();
    expect(screen.getByText("Locked; changes go through the manager")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Move to Execution" }).at(-1)!);
    await waitFor(() => expect(m.move).toHaveBeenCalledWith({ expectedVersion: 4, to: "Execution" }));
  });

  it("a manager sees their people by name, the step they act on lit", () => {
    m.administers = false;
    m.year = year({ scope: "Team", total: 2, nextMove: null, planning: [group("submitted", ["Aicha Bouazizi"]), group("drafting", ["Sofiene Jebali"])] });
    m.work = [{ id: "w1", module: "performance", kind: "plan-approval", title: "Approve Aicha's plan", href: "/performance/cycles/fy27/plans/p1", dueOn: null, context: null }];
    render(<YearPage />);
    expect(screen.getByText("Approve Aicha's plan")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe("/cycles/fy27/plans/p1");
    expect(screen.getByText("Your team")).toBeTruthy();
    expect(screen.getByText("With you")).toBeTruthy();
    expect(screen.getByText("Aicha Bouazizi")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Move to Execution" })).toBeNull();
  });

  it("someone whose step waits on their manager sees who, since when, and may nudge them (D-49)", async () => {
    m.administers = false;
    m.year = year({
      scope: "You", total: 1, nextMove: null, planning: [group("submitted", ["Aicha Bouazizi"])],
      me: { employeeId: "aicha", step: "Planning", standing: "submitted", since: "2026-05-05", managerEmployeeId: "mariam", managerName: "Mariam Gharbi" },
    });
    m.plan = { state: "Submitted", planProgress: 0, objectives: [
      { id: "g1", title: "Automate the regression suite", measurementSummary: "From 20% to 85% of the suite automated", directionPath: ["Build a resilient cloud platform", "Cut production incidents by 40%"],
        planWeight: 34, derivedProgress: 0, status: null, lastProgressAt: null },
    ] };
    m.praise = [{ id: "p1", author: { id: "salah", name: "Salah Ben Hassine" }, recipients: [{ id: "aicha", name: "Aicha Bouazizi" }],
      value: { id: "v1", name: "Ownership" }, message: "The incident drill was the best we have run.", givenAt: "2026-10-05T10:00:00Z", reactions: [], canDelete: false }];
    render(<YearPage />);
    expect(screen.getByText("Waiting on Mariam")).toBeTruthy();
    // Her half under the next step: her goals, weighted while planning, with their line up; then the latest praise.
    expect(screen.getByText("Your goals")).toBeTruthy();
    expect(screen.getByText("Automate the regression suite")).toBeTruthy();
    expect(screen.getByText("34%")).toBeTruthy();
    expect(screen.getByText("Cut production incidents by 40%")).toBeTruthy();
    expect(screen.getByText("Lately")).toBeTruthy();
    expect(screen.getByText(/The incident drill was the best we have run/)).toBeTruthy();
    expect(screen.getByText("Your plan is with Mariam")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Nudge Mariam" }));
    await waitFor(() => expect(m.nudge).toHaveBeenCalledWith({ employeeIds: ["aicha"] }));
  });

  it("a round coming up opens by itself on its day, with what opens; Open it today launches it (D-74)", async () => {
    m.move.mockResolvedValue(undefined);
    m.year = year({
      phase: "Execution", today: "2027-02-22",
      nextMove: {
        from: "Execution", to: "Review", kind: "launchRound", canMove: true, blocker: null, roundId: "round-1", planningDeadline: null,
        affected: 99, people: [], opensOn: "2027-03-01",
        opens: { people: 99, peopleFaces: ["Aicha Bouazizi"], peers: 297, managers: 14, managerFaces: ["Mariam Gharbi"], goals: 297,
          selfReview: true, peerInput: true, selfDue: "2027-03-15", managerDue: "2027-03-29" },
        release: null,
      },
    });
    render(<YearPage />);
    expect(screen.getByText(/The review round opens by itself on/)).toBeTruthy();
    expect(screen.getByText("In 7 days")).toBeTruthy();
    expect(screen.getAllByText("297")).toHaveLength(2);
    expect(screen.getByText("Read on the day it opens")).toBeTruthy();
    // The header's own move button gives way to the card.
    expect(screen.queryByRole("button", { name: /Open the review round|Launch/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open it today" }));
    await waitFor(() => expect(m.move).toHaveBeenCalledWith({ expectedVersion: 4, to: "Review" }));
  });

  it("HR follows the round by manager, furthest behind first, and nudges one manager once (D-74)", async () => {
    m.nudge.mockResolvedValue({ nudged: 3, skipped: [] });
    const face = (name: string) => person(name, "withManager");
    m.year = year({
      phase: "Review", today: "2027-03-24",
      nextMove: { from: "Review", to: "ResultsOut", kind: "release", canMove: false, blocker: "nothingReady", roundId: "round-1", planningDeadline: null, affected: 0, people: [], opensOn: null, opens: null, release: null },
      review: {
        roundId: "round-1", openedOn: "2027-03-01", selfDue: "2027-03-15", managerDue: "2027-03-29", reviewed: 41, total: 99, toLookAt: 0, toLookAtFaces: [],
        reviewers: [
          { employeeId: "mariam", name: "Mariam Gharbi", unitName: "Engineering A Core", people: 6, written: 2, toWrite: 3, waitingOnSelf: 1, onPace: false,
            writtenPeople: [], toWritePeople: [face("Aicha"), face("Fares"), face("Sofiene")], waitingPeople: [] },
          { employeeId: "omar", name: "Omar Mansour", unitName: "Platform", people: 18, written: 15, toWrite: 3, waitingOnSelf: 0, onPace: true,
            writtenPeople: [], toWritePeople: [], waitingPeople: [] },
        ],
      },
    });
    render(<YearPage />);
    expect(screen.getByText("1 manager is behind on reviews")).toBeTruthy();
    expect(screen.getByText("2 of 6 written")).toBeTruthy();
    expect(screen.getByText("On pace")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Nudge" }));
    await waitFor(() => expect(m.nudge).toHaveBeenCalledWith({ employeeIds: ["Aicha", "Fares", "Sofiene"] }));
    expect(await screen.findByText("Nudged today")).toBeTruthy();
  });
  it("HR looks at the flagged reviews before anything else in the round (D-35)", () => {
    m.year = year({
      phase: "Review", today: "2027-03-31",
      nextMove: { from: "Review", to: "ResultsOut", kind: "release", canMove: true, blocker: null, roundId: "round-1", planningDeadline: null, affected: 92, people: [], opensOn: null, opens: null, release: null },
      review: { roundId: "round-1", openedOn: "2027-03-01", selfDue: "2027-03-15", managerDue: "2027-03-29", reviewed: 95, total: 99, reviewers: [],
        toLookAt: 3, toLookAtFaces: [person("Rim Mahjoub", "flagged")] },
    });
    render(<YearPage />);
    expect(screen.getByText("3 reviews to look at")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Look at them" }).getAttribute("href")).toBe("/reviews/rounds/round-1/calibration");
  });

  it("releases what is ready from a preview in place, in batches with a live count (D-72)", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `r${i}`);
    m.release.mockImplementation(async (_round: string, version: number, batch: string[]) =>
      ({ reviewRoundId: "round-1", finalized: batch.map((reviewId) => ({ reviewId })), skipped: [], state: "Active", version: version + 1 }));
    m.year = year({
      phase: "Review", today: "2027-04-02",
      nextMove: {
        from: "Review", to: "ResultsOut", kind: "release", canMove: true, blocker: null, roundId: "round-1", planningDeadline: null, affected: 10, people: [], opensOn: null, opens: null,
        release: { asRated: 9, asRatedFaces: [person("Salah Ben Hassine", "reviewed")], toLookAt: 0, stillWriting: 4, stillWritingFaces: [], reviewIds: ids, roundVersion: 7,
          lookedAt: [{ employeeId: "mouna", name: "Mouna Trabelsi", from: "Developing", to: "Effective", kept: false }] },
      },
      review: { roundId: "round-1", openedOn: "2027-03-01", selfDue: "2027-03-15", managerDue: "2027-03-29", reviewed: 95, total: 99, reviewers: [], toLookAt: 0, toLookAtFaces: [] },
    });
    render(<YearPage />);
    expect(screen.getByRole("heading", { name: "Release results" })).toBeTruthy();
    expect(screen.getByText("Developing to Effective")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Release 10 results" }));
    expect(await screen.findByText("Released now; each person and their manager told")).toBeTruthy();
    expect(screen.getByText("Released when their manager submits")).toBeTruthy();
    expect(screen.getByText("Released results can't be taken back")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Release 10 results" }).at(-1)!);
    await waitFor(() => expect(m.release).toHaveBeenCalledTimes(2));
    expect(m.release).toHaveBeenNthCalledWith(1, "round-1", 7, ids.slice(0, 8));
    expect(m.release).toHaveBeenNthCalledWith(2, "round-1", 8, ids.slice(8));
    expect(m.move).not.toHaveBeenCalled();
  });
});

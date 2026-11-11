// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OneOnOneMeetingDto, OneOnOneRowDto, OneOnOneSeriesDto, OneOnOnesDto } from "@repo/api";
import { OneOnOnesWorkspace } from "./one-on-ones-workspace";
import { SeriesRecord } from "./series-record";
import { formatDate } from "@repo/ds/lib/dates";

const command = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(async () => ({})), isLoading: false, error: null });
const state = vi.hoisted(() => ({
  list: null as unknown,
  series: null as unknown,
  start: null as unknown,
  startMutate: null as unknown as ReturnType<typeof vi.fn>,
  commands: {} as Record<string, { mutate: ReturnType<typeof vi.fn>; mutateAsync: ReturnType<typeof vi.fn>; isLoading: boolean }>,
}));
vi.mock("../../api/use-conversations", () => ({
  useOneOnOnes: () => ({ data: state.list, isLoading: false, error: null, refetch: vi.fn() }),
  useOneOnOne: () => ({ data: state.series, isLoading: false, error: null, refetch: vi.fn() }),
  useOneOnOneStart: () => ({ data: state.start, isLoading: false, error: null }),
  useOneOnOneCommands: () => state.commands,
  useStartOneOnOne: () => ({ mutateAsync: state.startMutate, isLoading: false, error: null }),
  useCalendarFeed: () => ({ data: { on: false, since: null, url: null }, isLoading: false, error: null }),
  useCalendarFeedCommands: () => ({ create: command(), revoke: command() }),
}));
vi.mock("../objective-record/use-objective-record", () => ({ useObjectiveRecord: () => ({ open: vi.fn() }) }));
vi.mock("../../api/use-performance", () => ({ usePersonSummary: () => ({ data: undefined, isLoading: false, error: null }) }));
vi.mock("@repo/auth", () => ({ useAuth: () => ({ user: { employeeId: "nour", fullName: "Nour Trabelsi" } }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/one-on-ones/s1",
}));

const nour = { employeeId: "nour", displayName: "Nour Trabelsi", jobTitle: "Engineer" };
const karim = { employeeId: "karim", displayName: "Karim Haddad", jobTitle: "Engineering manager" };
const soon = new Date(Date.now() + 2 * 3_600_000).toISOString();
const later = new Date(Date.now() + 9 * 86_400_000).toISOString();

function row(overrides: Partial<OneOnOneRowDto> = {}): OneOnOneRowDto {
  return { seriesId: "s1", with: nour, cadence: "Weekly", nextMeetingAt: later, openActions: 0, overdueActions: 0,
    ended: false, endedAt: null, nextMeetingId: "m1", agendaCount: 0, lastMetAt: null, recent: [], ...overrides };
}

function list(overrides: Partial<OneOnOnesDto> = {}): OneOnOnesDto {
  return { withManager: null, startWithManager: null, reports: [], startWithReports: [], ended: [], defaultCadence: "EveryTwoWeeks",
    lineAvailable: true, myActions: [], ...overrides };
}

function meeting(overrides: Partial<OneOnOneMeetingDto> = {}): OneOnOneMeetingDto {
  return { id: "m1", version: 2, scheduledAt: "2030-01-08T10:00:00Z", state: "Upcoming", completedAt: null, agenda: [],
    privateNote: { text: "", revision: 0 }, notesWritable: true, actions: [], suggestions: [], ...overrides };
}

function series(overrides: Partial<OneOnOneSeriesDto> = {}): OneOnOneSeriesDto {
  return { id: "s1", version: 1, manager: karim, report: nour, viewerRole: "Manager", cadence: "Weekly", startedAt: "2029-12-01T10:00:00Z",
    startedByEmployeeId: "karim", ended: false, endedAt: null, endReason: null, upcoming: meeting(), past: [], openActions: 0,
    overdueActions: 0, can: { write: true }, first: false, carriesTo: "2030-01-15T10:00:00Z",
    context: { goals: [], planApproved: false, planDue: null, latestPraise: null, joinedOn: null, unit: null }, ...overrides };
}

beforeEach(() => {
  state.series = series();
  state.start = { with: karim, defaultCadence: "EveryTwoWeeks", suggestions: [] };
  state.startMutate = vi.fn(async () => ({ id: "s9" }));
  state.commands = Object.fromEntries(
    ["changeCadence", "reschedule", "addAgendaItem", "removeAgendaItem", "setAgendaNote", "setPrivateNotes",
      "addAction", "setActionDone"].map((name) => [name, command()]),
  );
});

describe("1:1s workspace", () => {
  it("leads with the next conversation, then the team's rhythm, and offers to start the rest", () => {
    state.list = list({
      withManager: row({ seriesId: "s3", with: karim, nextMeetingAt: later }),
      reports: [
        row({ seriesId: "s1", with: nour, nextMeetingAt: soon, openActions: 2, overdueActions: 1 }),
        row({ seriesId: "s2", with: { employeeId: "sami", displayName: "Sami Kefi", jobTitle: null } }),
      ],
      startWithReports: [{ with: { employeeId: "rim", displayName: "Rim Mahjoub", jobTitle: null } }],
    });
    render(<OneOnOnesWorkspace />);
    const next = screen.getByRole("heading", { name: "Nour Trabelsi", level: 2 }).closest("section")!;
    expect(within(next).getByRole("link", { name: /Open 1:1/ }).getAttribute("href")).toBe("/one-on-ones/s1");
    expect(screen.getAllByRole("link").some((link) => link.getAttribute("href") === "/one-on-ones/s2")).toBe(true);
    expect(screen.getByText(/1 overdue/)).toBeTruthy();
    const rim = screen.getByText("Rim Mahjoub").closest("li")!;
    fireEvent.click(within(rim).getByRole("button", { name: "Start 1:1s" }));
    expect(screen.getByRole("dialog").textContent).toContain("1:1s with Rim Mahjoub");
  });

  it("shows an employee's one series once: the next meeting, not a second table or week list", () => {
    state.list = list({
      withManager: row({ seriesId: "s3", with: karim, nextMeetingAt: soon }),
      myActions: [{ seriesId: "s3", actionId: "a1", text: "Send the estimate", with: karim, dueDate: "2020-01-01", overdue: true }],
    });
    render(<OneOnOnesWorkspace />);
    expect(screen.getByRole("heading", { name: "Karim Haddad", level: 2 })).toBeTruthy();
    expect(screen.queryByText("With your manager")).toBeNull();
    expect(screen.queryByText("This week")).toBeNull();
    expect(screen.queryByText(/open action/)).toBeNull();
    expect(screen.getByText("Send the estimate")).toBeTruthy();
  });

  it("lists the actions the caller owes across series", () => {
    state.list = list({
      reports: [row()],
      myActions: [{ seriesId: "s1", actionId: "a1", text: "Book the vendor review", with: nour, dueDate: "2020-01-01", overdue: true }],
    });
    render(<OneOnOnesWorkspace />);
    expect(screen.getByText("Book the vendor review").closest("a")!.getAttribute("href")).toBe("/one-on-ones/s1");
    expect(screen.getByText("Overdue")).toBeTruthy();
  });

  it("makes starting with the manager the page, with the first agenda picked from the year", async () => {
    state.list = list({ startWithManager: { with: karim } });
    state.start = {
      with: karim,
      defaultCadence: "EveryTwoWeeks",
      suggestions: [{ kind: "Objective", sourceId: "o1", cycleId: "c1", label: "Ship the gateway", status: "AtRisk", href: "/x", at: null, percent: null, by: null, dueDate: null }],
    };
    render(<OneOnOnesWorkspace />);
    expect(screen.getByRole("heading", { name: "1:1s with Karim Haddad" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Put Ship the gateway on the first agenda" }).getAttribute("data-state")).toBe("checked");
    fireEvent.click(screen.getByRole("button", { name: "Start 1:1s" }));
    await vi.waitFor(() => expect(state.startMutate).toHaveBeenCalled());
    const request = state.startMutate.mock.calls[0]![0] as { withEmployeeId: string; agenda: { sourceKind?: string; sourceId?: string }[] };
    expect(request.withEmployeeId).toBe("karim");
    expect(request.agenda).toEqual([expect.objectContaining({ sourceKind: "Objective", sourceId: "o1" })]);
  });
});

const item = (overrides: Partial<OneOnOneMeetingDto["agenda"][number]> = {}): OneOnOneMeetingDto["agenda"][number] => ({
  id: "i1", text: "Training budget", authorEmployeeId: "nour", discussed: false, sourceKind: null, sourceId: null, href: null,
  note: "", noteRevision: 0, addedAt: "2030-01-01T10:00:00Z", carriedFromAt: null, ...overrides,
});

describe("the meeting page", () => {
  it("puts the year's suggestions on the agenda with where they came from, and a note adds one", async () => {
    state.series = series({
      upcoming: meeting({
        agenda: [item()],
        suggestions: [{ kind: "Objective", sourceId: "o1", cycleId: "c1", label: "Integrate the vendor API", status: "AtRisk", href: "/x",
          at: "2030-01-02T10:00:00Z", percent: 42, by: null, dueDate: null }],
      }),
    });
    state.commands.addAgendaItem!.mutateAsync = vi.fn(async () => series());
    render(<SeriesRecord seriesId="s1" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("1:1 with Nour");
    expect(screen.getByText("From goals, actions and requests")).toBeTruthy();
    expect(screen.getByText(/Goal, 42% done/)).toBeTruthy();
    expect(screen.getByText("Nour added it")).toBeTruthy();
    expect(screen.getByText(`What isn't noted carries to ${formatDate("2030-01-15")}`)).toBeTruthy();

    fireEvent.click(screen.getByText("Integrate the vendor API"));
    const note = screen.getByPlaceholderText("Notes, both of you see these");
    fireEvent.change(note, { target: { value: "Pairing with Omar this week." } });
    fireEvent.blur(note);
    await vi.waitFor(() => expect(state.commands.addAgendaItem!.mutateAsync).toHaveBeenCalledWith({
      meetingId: "m1",
      request: expect.objectContaining({ sourceKind: "Objective", sourceId: "o1", note: "Pairing with Omar this week." }),
    }));
    expect(screen.getByRole("button", { name: "Action for Nour" })).toBeTruthy();
  });

  it("saves a note on an item against its revision and shows it noted", async () => {
    state.series = series({ upcoming: meeting({ agenda: [item({ discussed: true, note: "Approved", noteRevision: 3 })] }) });
    state.commands.setAgendaNote!.mutateAsync = vi.fn(async () => series());
    render(<SeriesRecord seriesId="s1" />);
    expect(screen.getByText("Noted")).toBeTruthy();
    fireEvent.click(screen.getByText("Training budget"));
    const note = screen.getByPlaceholderText("Notes, both of you see these");
    fireEvent.change(note, { target: { value: "Approved, 2 courses" } });
    fireEvent.blur(note);
    await vi.waitFor(() => expect(state.commands.setAgendaNote!.mutateAsync).toHaveBeenCalledWith({
      meetingId: "m1", itemId: "i1", text: "Approved, 2 courses", expectedRevision: 3,
    }));
  });

  it("opens a first 1:1 on the starter agenda and says who the person is", () => {
    state.series = series({
      first: true,
      upcoming: meeting({ agenda: [item({ id: "s1", text: "howItsGoing", sourceKind: "Starter" }), item({ id: "s2", text: "feedbackStyle", sourceKind: "Starter" })] }),
      context: { goals: [], planApproved: false, planDue: "2030-01-30", latestPraise: null, joinedOn: "2029-12-01", unit: "Engineering A Core" },
    });
    render(<SeriesRecord seriesId="s1" />);
    expect(screen.getByText("A starter agenda for a first 1:1")).toBeTruthy();
    expect(screen.getByText("How things are going")).toBeTruthy();
    expect(screen.getByText("How you like to get feedback")).toBeTruthy();
    expect(screen.getByText(`No plan yet, due ${formatDate("2030-01-30")}`)).toBeTruthy();
    expect(screen.getByText("Engineering A Core")).toBeTruthy();
    expect(screen.queryByText(/carries to/)).toBeNull();
  });

  it("shows an ended series as what was noted, with nothing to edit", () => {
    state.series = series({
      ended: true,
      endedAt: "2030-01-10T10:00:00Z",
      endReason: "ReportingLineEnded",
      upcoming: null,
      can: { write: false },
      past: [meeting({ id: "m0", state: "Completed", notesWritable: false, agenda: [item({ discussed: true, note: "Agreed the plan" })] })],
    });
    render(<SeriesRecord seriesId="s1" />);
    expect(screen.queryByText("Agenda")).toBeNull();
    expect(screen.queryByText("Move it")).toBeNull();
    expect(screen.getByText(/the reporting line changed/)).toBeTruthy();
    fireEvent.click(screen.getByText("Training budget"));
    expect(screen.getByText("Agreed the plan")).toBeTruthy();
  });
});

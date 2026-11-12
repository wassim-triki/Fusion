// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { YearSetupDto } from "@repo/api";
import { YearSetupPage } from "./year-setup";

const m = vi.hoisted(() => ({
  setup: null as YearSetupDto | null,
  administers: true,
  save: vi.fn(),
  launch: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../content-unavailable", () => ({ ContentUnavailable: () => <div>Unavailable</div> }));
vi.mock("@repo/auth", () => ({ PageRefusal: () => <div>Refused</div> }));
vi.mock("@repo/api/query", () => ({
  useCompanyWorkWeek: () => ({ data: { workingDays: [1, 2, 3, 4, 5] } }),
  useTenantSummary: () => ({ data: { name: "Carthage" } }),
}));
vi.mock("date-holidays", () => ({
  default: class {
    getHolidays(year: number) {
      return year === 2028 ? [{ date: "2028-04-09 00:00:00", name: "Martyrs' Day", type: "public" }] : [];
    }
  },
}));
vi.mock("../../api/use-workspace", () => ({
  useWorkspaceContext: () => ({ data: { selected: null, capabilities: { administers: m.administers } }, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("../../api/use-performance", () => ({
  useYearSetup: () => ({ data: m.setup, isLoading: false, error: null, refetch: vi.fn() }),
  useSaveYear: () => ({ mutateAsync: m.save, isLoading: false }),
  useLaunchYear: () => ({ mutateAsync: m.launch, isLoading: false }),
}));

function setup(overrides: Partial<YearSetupDto> = {}): YearSetupDto {
  return {
    draftId: null, draftVersion: 0,
    year: {
      name: "FY2028", startDate: "2027-04-26", endDate: "2028-04-24", planningEndsOn: "2027-05-26", reviewOpensOn: "2028-03-01",
      // Saturday 8 April 2028, the day before Martyrs' Day.
      resultsOutOn: "2028-04-08", midYearCheckInOn: "2027-11-15", selfReviewsDueOn: "2028-03-15", calibrationOn: "2028-03-29",
      joinersJoin: true, droppedCompanyGoalIds: [],
    },
    lastYearName: "FY2027",
    lastYear: null, lastYearPhase: "ResultsOut", launchBlocker: null,
    peopleCount: 101,
    people: [{ employeeId: "a", name: "Aicha Bouazizi", unitName: "Engineering" }],
    leftOut: [],
    companyGoals: [
      { id: "c1", title: "Build a resilient, secure cloud platform", ownerEmployeeId: "o", ownerName: "Omar Jaziri" },
      { id: "c2", title: "Grow repeat business with our clients", ownerEmployeeId: "m", ownerName: "Mariam Gharbi" },
    ],
    unfinishedGoals: 41,
    unfinishedOwners: [{ employeeId: "a", name: "Aicha Bouazizi", unitName: "Engineering" }],
    ...overrides,
  };
}

beforeEach(() => {
  m.setup = setup();
  m.administers = true;
  m.save.mockReset().mockResolvedValue({ id: "fy28", version: 3 });
  m.launch.mockReset().mockResolvedValue({ cycleId: "fy28", people: 101, companyGoals: 1, carriedGoals: 41, endedCycleId: "fy27" });
  m.push.mockReset();
});

describe("Setting up a year", () => {
  it("launches what was set up, leaving a dropped company goal behind, and lands on the Year", async () => {
    render(<YearSetupPage />);
    expect(screen.getByRole("heading", { name: "Set up FY2028" })).toBeTruthy();
    expect(screen.getByText("41 unfinished goals")).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: /Grow repeat business/ }));
    fireEvent.click(screen.getByRole("button", { name: /Launch FY2028/ }));

    await waitFor(() => expect(m.launch).toHaveBeenCalledWith({ cycleId: "fy28", version: 3 }));
    const sent = m.save.mock.calls[0]![0];
    expect(sent.draftId).toBeNull();
    expect(sent.request.planningDeadline).toBe("2027-05-26");
    expect(sent.request.plan).toMatchObject({ reviewOpensOn: "2028-03-01", resultsOutOn: "2028-04-08", droppedCompanyGoalIds: ["c2"] });
    expect(m.push).toHaveBeenCalledWith("/");
  });

  it("catches results out on a weekend and moves it past the holiday in one click", async () => {
    render(<YearSetupPage />);
    const move = await screen.findByRole("button", { name: /Move to/ });
    expect(screen.getByText(/Martyrs' Day/)).toBeTruthy();
    fireEvent.click(move);
    fireEvent.click(screen.getByRole("button", { name: "Keep as a draft" }));
    await waitFor(() => expect(m.save).toHaveBeenCalled());
    expect(m.save.mock.calls[0]![0].request.plan.resultsOutOn).toBe("2028-04-10");
    expect(m.launch).not.toHaveBeenCalled();
  });

  it("renames the year in its title and moves a date from the year itself, proposing the moments a draft lacks", async () => {
    m.setup = setup({ year: { ...setup().year, midYearCheckInOn: null, selfReviewsDueOn: null, calibrationOn: null } });
    render(<YearSetupPage />);
    const name = screen.getByRole("textbox", { name: "The year's name" });
    name.textContent = "FY2028 pilot";
    fireEvent.blur(name);
    expect(screen.getByRole("button", { name: /Launch FY2028 pilot/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Goals agreed/ }));
    fireEvent.click(await screen.findByRole("button", { name: "+ week" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep as a draft" }));
    await waitFor(() => expect(m.save).toHaveBeenCalled());
    const sent = m.save.mock.calls[0]![0].request;
    expect(sent.name).toBe("FY2028 pilot");
    expect(sent.planningDeadline).toBe("2027-06-02");
    expect(sent.plan.midYearCheckInOn).toBeTruthy();
    expect(sent.plan.calibrationOn! > sent.plan.selfReviewsDueOn!).toBe(true);
  });

  it("waits for last year's results before it can launch", () => {
    m.setup = setup({ launchBlocker: "lastYearRunning" });
    render(<YearSetupPage />);
    expect((screen.getByRole("button", { name: /Launch FY2028/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("FY2027 is still running; launch once its results are out")).toBeTruthy();
  });

  it("is HR's page only", () => {
    m.administers = false;
    render(<YearSetupPage />);
    expect(screen.getByText("Refused")).toBeTruthy();
  });
});

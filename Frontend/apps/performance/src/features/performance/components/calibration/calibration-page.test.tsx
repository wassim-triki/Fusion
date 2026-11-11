// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalibrationCardDto, CalibrationDto } from "@repo/api";
import { CalibrationPage } from "./calibration-page";

const m = vi.hoisted(() => ({ data: null as CalibrationDto | null, decide: vi.fn(), undo: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace: vi.fn() }), usePathname: () => "/reviews/rounds/round-1/calibration" }));
vi.mock("../content-unavailable", () => ({ ContentUnavailable: () => <div>Unavailable</div> }));
vi.mock("../../api/use-workspace", () => ({ useYear: () => ({ data: null }) }));
vi.mock("../../api/use-calibration", () => ({
  useCalibration: () => ({ data: m.data, isLoading: false, error: null, refetch: vi.fn() }),
  useCalibrationEveryone: () => ({ data: null, error: null, refetch: vi.fn() }),
  useCalibrationDecisions: () => ({ decide: { mutateAsync: m.decide, isLoading: false }, undo: { mutateAsync: m.undo, isLoading: false } }),
}));

const scale = ["Needs improvement", "Developing", "Effective", "Strong", "Exceptional"].map((label, i) => ({ value: i + 1, label }));
const card = (name: string, overrides: Partial<CalibrationCardDto> = {}): CalibrationCardDto => ({
  reviewId: `r-${name}`, employeeId: name, name, jobTitle: "Data Engineer", reviewerEmployeeId: "omar", reviewerName: "Omar Mansour", rating: 5,
  flag: { kind: "goals", grade: 0.46, managerAverage: null, managerReviews: null, everyoneAverage: null, everyoneReviews: null, lastRating: null, lastCycle: null },
  words: "Rim carried the data platform move alone for four months.", decision: null, version: 3, ...overrides,
});
const group = (count: number) => ({ count, people: [] });

beforeEach(() => {
  m.decide.mockReset().mockResolvedValue({ reviewId: "r-Rim Mahjoub", rating: 5, decision: null, released: false, version: 4 });
  m.undo.mockReset().mockResolvedValue({});
  m.data = {
    roundId: "round-1", cycleId: "fy27", roundName: "Year-end review", cycleName: "FY2027", scale, bandLowTop: 2, bandMidTop: 3,
    writing: group(4), ready: group(92), toLookAt: group(1), released: 0, canRelease: true,
    flagged: [
      card("Rim Mahjoub"),
      card("Mouna Trabelsi", { rating: 1, flag: { kind: "moved", grade: null, managerAverage: null, managerReviews: null, everyoneAverage: null, everyoneReviews: null, lastRating: 3, lastCycle: "FY2026" },
        decision: { rating: 2, kept: false, reason: "Hiring slipped twice; a plan is agreed.", at: "2027-03-31T10:00:00Z" }, version: 9 }),
    ],
  };
});

describe("Calibration by exception", () => {
  it("shows only the flagged review still to look at, with why, and keeps it in one click (D-35, D-70)", async () => {
    render(<CalibrationPage roundId="round-1" />);
    expect(screen.getByText("Rating and goals disagree")).toBeTruthy();
    expect(screen.getByText("Goals 0.46")).toBeTruthy();
    expect(screen.getByText("Omar's words")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep Exceptional" }));
    await waitFor(() => expect(m.decide).toHaveBeenCalledWith({ reviewId: "r-Rim Mahjoub", rating: 5, reason: null, expectedVersion: 3 }));
  });

  it("changing a rating needs a reason the manager reads", async () => {
    render(<CalibrationPage roundId="round-1" />);
    fireEvent.click(screen.getAllByRole("button", { name: "Strong" })[0]!);
    const change = screen.getByRole("button", { name: "Change to Strong" });
    expect(change.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Why, Omar reads this"), { target: { value: "Carried the move alone" } });
    fireEvent.click(change);
    await waitFor(() => expect(m.decide).toHaveBeenCalledWith({ reviewId: "r-Rim Mahjoub", rating: 4, reason: "Carried the move alone", expectedVersion: 3 }));
  });

  it("a decided review sits above with what was decided, and undoes", async () => {
    render(<CalibrationPage roundId="round-1" />);
    expect(screen.getByText("Needs improvement to Developing")).toBeTruthy();
    expect(screen.getByText("Omar told")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(m.undo).toHaveBeenCalledWith({ reviewId: "r-Mouna Trabelsi", expectedVersion: 9 }));
  });
});

// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CalibrationChangesViewDto,
  CalibrationHeaderDto,
  CalibrationNineBoxViewDto,
  CalibrationPeopleViewDto,
  CalibrationSessionDto,
  CalibrationSubjectDetailDto,
} from "@repo/api";
import { CalibrationSession } from "./calibration-workspace";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/reviews/rounds/round-1/calibration",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("next/link", async () => {
  const React = await import("react");
  return { default: ({ href, children, ...rest }: React.PropsWithChildren<{ href: string }>) => React.createElement("a", { href, ...rest }, children) };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const scale = [
  { value: 1, label: "Below expectations", description: null },
  { value: 2, label: "Developing", description: null },
  { value: 3, label: "Meets expectations", description: null },
  { value: 4, label: "Exceeds expectations", description: null },
  { value: 5, label: "Outstanding", description: null },
];

const karim = {
  reviewId: "karim", name: "Karim Haddad", jobTitle: "Senior Backend Engineer", unit: "Engineering B", reviewerId: "omar", reviewerName: "Omar Mansour",
  originalRating: 5, currentRating: 5, originalPotential: "High" as const, currentPotential: "High" as const, attainment: 41,
  lastResult: { rating: 4, cycleName: "FY2026" }, flags: [{ kind: "RatingVsObjectives" as const, attainment: 41, moved: null, cycle: null }],
  discussed: false, version: 3,
};

const views: {
  people: CalibrationPeopleViewDto;
  nineBox: CalibrationNineBoxViewDto;
  detail: CalibrationSubjectDetailDto;
  changes: CalibrationChangesViewDto;
} = {
  people: { total: 1, groups: [5, 4, 3, 2, 1].map((value) => ({ value, label: scale[value - 1]!.label, count: value === 5 ? 1 : 0, originalCount: value === 5 ? 1 : 0, people: value === 5 ? [karim] : [] })) },
  nineBox: {
    bandLowTop: 2, bandMidTop: 3,
    cells: (["High", "Growing", "Developing"] as const).flatMap((potential) => [0, 1, 2].map((band) => ({
      band: band as 0 | 1 | 2, potential,
      people: band === 1 && potential === "Developing" ? [{ reviewId: "hamza", name: "Hamza Dridi", currentRating: 3, moved: false, version: 9 }] : [],
    }))),
  },
  detail: {
    person: karim,
    objectives: [{ id: "o1", title: "Migrate billing to the event bus", weight: 50, progress: 20, status: "OffTrack" }],
    managerSummary: "Karim carried the team through the outage.", rationale: null, history: [],
    reviewer: { reviewerId: "omar", reviewerName: "Omar Mansour", reviews: 18, originalMix: [0, 0, 1, 5, 12], currentMix: [0, 0, 2, 6, 10], originalAverage: 4.3, currentAverage: 4.0, delta: 0.8, lenient: true },
    scale,
  },
  changes: {
    finalizedAt: "2027-09-27T10:00:00Z",
    levels: scale.map((level) => ({ value: level.value, label: level.label, original: level.value === 5 ? 1 : 0, current: level.value === 4 ? 1 : 0 })),
    changes: [{ reviewId: "karim", name: "Karim Haddad", reviewerName: "Omar Mansour", originalRating: 5, finalRating: 4, originalPotential: "High", finalPotential: "High",
      reason: "Billing migration off track.", changedBy: "Amira Khelifi", changedAt: "2027-09-24T10:00:00Z" }],
  },
};

const query = <T,>(data: T) => ({ data, isLoading: false, error: null, refetch: vi.fn() });
vi.mock("../../api/use-calibration", () => ({
  useCalibrationDistribution: () => query(undefined),
  useCalibrationPeople: () => query(views.people),
  useCalibrationNineBox: () => query(views.nineBox),
  useCalibrationSubject: (_round: string, reviewId: string | null) => query(reviewId ? views.detail : undefined),
  useCalibrationFinalizePreview: () => query(undefined),
  useCalibrationChanges: () => query(views.changes),
  useFacilitatorCandidates: () => query([]),
}));

const header: CalibrationHeaderDto = {
  people: 1, discussed: 0, ratingChanged: 0, potentialChanged: 0, flags: 2, flaggedNotDiscussed: 1, outstanding: 0, potentialEnabled: true,
  bandLowTop: 2, bandMidTop: 3, outstandingByReviewer: [], units: [{ id: "u1", name: "Engineering B", count: 1, flagged: false }],
  managers: [{ id: "omar", name: "Omar Mansour", count: 1, flagged: true }],
};

const session: CalibrationSessionDto = {
  id: "s1", reviewRoundId: "round-1", cycleId: "cycle-1", reviewRoundName: "Year-end review", state: "Open", version: 7,
  openedAt: "2027-09-23T09:00:00Z", finalizedAt: null,
  facilitators: [{ userId: "u1", displayName: "Amira Khelifi", namedAt: "2027-09-23T09:00:00Z" }],
  counts: { subjects: 1, discussed: 0, adjusted: 0, remaining: 1, outstanding: 0 },
  ratingScale: scale, distribution: [], outstanding: [], header,
};

function mutations() {
  const mutation = () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isLoading: false, error: null });
  return { open: mutation(), setFacilitators: mutation(), adjust: mutation(), finalize: mutation() };
}

describe("calibration session", () => {
  beforeEach(() => { replace.mockClear(); search = ""; });

  it("opens a person from People, asks for a reason when the rating moves, and saves rating and potential", async () => {
    const m = mutations();
    render(<CalibrationSession session={session} header={header} roundId="round-1" mutations={m as never} />);
    expect(screen.getByText("Top rating, 41% of objectives")).toBeTruthy();
    fireEvent.click(screen.getAllByText("Karim Haddad")[0]!);

    const rating = await screen.findByRole("radiogroup", { name: "Calibrated rating" });
    expect(screen.getByText("Omar rates 0.8 above the session")).toBeTruthy();
    fireEvent.click(within(rating).getByRole("radio", { name: /Exceeds/ }));
    const save = screen.getByRole("button", { name: "Save 5 → 4" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Why this changes/), { target: { value: "Billing migration off track." } });
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Potential" })).getByRole("radio", { name: "Growing" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(save);

    await waitFor(() => expect(m.adjust.mutateAsync).toHaveBeenCalledWith({
      reviewId: "karim", rating: 4, rationale: "Billing migration off track.", discussionState: "Discussed", expectedVersion: 3, potential: "Growing",
    }));
  });

  it("keeps the view and filters in the address", () => {
    render(<CalibrationSession session={session} header={header} roundId="round-1" mutations={mutations() as never} />);
    fireEvent.click(screen.getByRole("radio", { name: "Distribution" }));
    expect(replace).toHaveBeenLastCalledWith("/reviews/rounds/round-1/calibration?view=distribution", { scroll: false });
    fireEvent.click(screen.getByRole("button", { name: "Flagged" }));
    expect(replace).toHaveBeenLastCalledWith("/reviews/rounds/round-1/calibration?flagged=true", { scroll: false });
  });

  it("moves a person on the nine-box from the keyboard, asking which level the band means", async () => {
    search = "view=nine-box";
    const m = mutations();
    render(<CalibrationSession session={session} header={header} roundId="round-1" mutations={m as never} />);
    fireEvent.keyDown(screen.getByRole("button", { name: /Hamza Dridi/ }), { key: "m" });
    const targets = screen.getAllByRole("button", { name: "Move here" });
    expect(targets).toHaveLength(8);
    // Rows run High, Growing, Developing; the third target of the second row is the top band, Growing.
    fireEvent.click(targets[5]!);

    const levels = await screen.findByRole("radiogroup", { name: "Rating" });
    expect(within(levels).getByRole("radio", { name: /4/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(screen.getByLabelText("Why this changes"), { target: { value: "Led the migration." } });
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    await waitFor(() => expect(m.adjust.mutateAsync).toHaveBeenCalledWith({
      reviewId: "hamza", rating: 4, rationale: "Led the migration.", discussionState: "Discussed", expectedVersion: 9, potential: "Growing",
    }));
  });

  it("holds Finalize while reviews are with managers and lists them by manager", () => {
    const waiting = { ...header, outstanding: 2, outstandingByReviewer: [{ reviewerId: "m", reviewerName: "Mariam Gharbi", count: 2, people: ["Nesrine Ouali", "Tarek Ayari"] }] };
    render(<CalibrationSession session={session} header={waiting} roundId="round-1" mutations={mutations() as never} />);
    expect((screen.getByRole("button", { name: "Finalize calibration" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Still with managers")).toBeTruthy();
    expect(screen.getByText("Nesrine Ouali, Tarek Ayari")).toBeTruthy();
  });

  it("once finalized, shows every change and leads to release", () => {
    render(<CalibrationSession session={{ ...session, state: "Finalized", finalizedAt: "2027-09-27T10:00:00Z" }} header={header} roundId="round-1" mutations={mutations() as never} />);
    expect(screen.getByRole("link", { name: /Open the round to release/ })).toBeTruthy();
    expect(screen.getByText("Billing migration off track.")).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Views" })).toBeNull();
  });
});

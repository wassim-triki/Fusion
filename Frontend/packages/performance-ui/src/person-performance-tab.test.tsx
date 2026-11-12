import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PersonPerformanceSummaryDto } from "@repo/api";
import { PersonPerformanceTab } from "./person-performance-tab";
import type { RenderSummaryLink } from "./summary-lib";

const renderLink: RenderSummaryLink = ({ href, className, children }) => (
  <a href={href} className={className}>
    {children}
  </a>
);

const lane = { startDate: "2027-01-01", endDate: "2027-12-31", measure: null, current: null, statusSince: null };

const aicha: PersonPerformanceSummaryDto = {
  employeeId: "aicha",
  displayName: "Aicha Bouazizi",
  jobTitle: "QA Automation Engineer",
  orgUnitName: "Engineering",
  stableEmployeeKey: "EMP-7",
  relation: "Manager",
  currentCycle: {
    cycleId: "c",
    cycleName: "FY2027",
    cycleState: "Active",
    phase: "Execution",
    isParticipant: true,
    planId: "p",
    planStatus: "Approved",
    overallProgress: 38,
    planHref: "/performance/cycles/c/plans/p",
    startDate: "2027-01-01",
    endDate: "2027-12-31",
    planSince: "2027-05-09T09:00:00Z",
    objectives: [
      { objectiveId: "o1", number: 1, title: "Automate the regression suite", alignedTo: null, weight: 40, progress: 34,
        href: "/performance/cycles/c/objectives/o1", status: "AtRisk", lastProgressAt: "2027-10-07T09:00:00Z",
        line: [{ at: "2027-06-01T09:00:00Z", progress: 20 }, { at: "2027-10-07T09:00:00Z", progress: 34 }], ...lane },
      { objectiveId: "o2", number: 2, title: "First release", alignedTo: null, weight: 60, progress: null,
        href: "/performance/cycles/c/objectives/o2", status: null, lastProgressAt: null, line: [], ...lane },
    ],
  },
  reviews: {
    current: null,
    history: [
      { reviewId: "h", cycleName: "FY2026", reviewRoundName: "Year-end", finalRatingLabel: "Strong", finalizedAt: "2027-01-20T10:00:00Z",
        href: "/performance/reviews/h", reviewerName: "Mariam Gharbi", acknowledgedAt: "2027-01-22T10:00:00Z" },
    ],
  },
  development: null,
  praise: {
    items: [{ id: "p1", author: { id: "salah", name: "Salah Mejri" }, recipients: [], value: { id: "v", name: "Ownership" },
      message: "The incident drill was the best we have run.", givenAt: "2027-10-05T08:00:00Z", reactions: [], canDelete: false }],
    total: 9,
    href: "/performance/feedback?tab=praise&employee=aicha",
  },
  feedback: null,
  oneOnOne: null,
  oneOnOneBooking: { slots: ["2027-11-12T09:00:00Z", "2027-11-12T14:30:00Z", "2027-11-13T09:00:00Z"], path: "/one-on-ones/with/aicha/book" },
};

describe("PersonPerformanceTab", () => {
  it("reads the year in the rail: the plan, the 1:1s, praise and last year's result", () => {
    render(<PersonPerformanceTab state={{ status: "ready", summary: aicha }} renderLink={renderLink} />);
    const rail = screen.getByRole("complementary", { name: "Their year at a glance" });
    expect(within(rail).getByText("Plan approved")).toBeInTheDocument();
    expect(within(rail).getByText("None yet")).toBeInTheDocument();
    expect(within(rail).getByText("9")).toBeInTheDocument();
    expect(within(rail).getByText("Strong")).toBeInTheDocument();
    expect(within(rail).getByText("From Mariam, acknowledged")).toBeInTheDocument();
  });

  it("draws each goal on its year, opening the goal, with only reported states", () => {
    render(<PersonPerformanceTab state={{ status: "ready", summary: aicha }} renderLink={renderLink} />);
    expect(screen.getByText("38% of the plan done")).toBeInTheDocument();
    const goal = screen.getByRole("link", { name: /Automate the regression suite/ });
    expect(goal).toHaveAttribute("href", "/performance/cycles/c/objectives/o1");
    expect(within(goal).getByText("At risk")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: /First release/ })).getByText("No update yet")).toBeInTheDocument();
    expect(screen.getByText("“The incident drill was the best we have run.”")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All 9" })).toHaveAttribute("href", "/performance/feedback?tab=praise&employee=aicha");
  });

  it("books the first 1:1 at the time picked from those both are free", async () => {
    const onBook = vi.fn().mockResolvedValue(undefined);
    render(<PersonPerformanceTab state={{ status: "ready", summary: aicha }} renderLink={renderLink} onBook={onBook} />);
    expect(screen.getByText("No 1:1s with Aicha yet")).toBeInTheDocument();
    const times = within(screen.getByRole("group", { name: "Times you're both free" })).getAllByRole("button");
    expect(times).toHaveLength(3);
    await userEvent.click(times[2]!);
    await userEvent.click(screen.getByRole("button", { name: "Book it" }));
    expect(onBook).toHaveBeenCalledWith("/one-on-ones/with/aicha/book", "2027-11-13T09:00:00Z");
  });

  it("shows what's waiting on the next 1:1 once they meet", () => {
    const meeting = { ...aicha, oneOnOneBooking: null,
      oneOnOne: { seriesId: "s", nextMeetingAt: "2027-11-20T09:00:00Z", href: "/performance/one-on-ones/s", lastMeetingAt: "2027-10-08T09:00:00Z",
        waiting: ["Her update on the regression suite", "First release"] } };
    render(<PersonPerformanceTab state={{ status: "ready", summary: meeting }} renderLink={renderLink} />);
    expect(screen.getByText("2 things waiting: Her update on the regression suite, First release")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the 1:1" })).toHaveAttribute("href", "/performance/one-on-ones/s");
    expect(screen.queryByRole("button", { name: "Book it" })).not.toBeInTheDocument();
  });

  it("says so when there's nothing the viewer may see", () => {
    render(
      <PersonPerformanceTab state={{ status: "ready", summary: { ...aicha, relation: "Other", currentCycle: null, reviews: null, praise: null, oneOnOneBooking: null } }}
        renderLink={renderLink} />,
    );
    expect(screen.getByText("There's nothing here you can see yet.")).toBeInTheDocument();
  });
});

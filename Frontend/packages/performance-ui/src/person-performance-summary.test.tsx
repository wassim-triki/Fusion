import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PersonPerformanceSummaryDto } from "@repo/api";
import { PersonPerformanceSummary } from "./person-performance-summary";
import type { RenderSummaryLink } from "./summary-lib";

vi.mock("@repo/api/query", () => ({ useCompanyValues: () => ({ data: [] }) }));

const renderLink: RenderSummaryLink = ({ href, className, children }) => (
  <a href={href} className={className}>
    {children}
  </a>
);

const lane = { startDate: "2027-01-01", endDate: "2027-12-31", measure: null, current: null, lastProgressAt: null, statusSince: null, line: [] };

const full: PersonPerformanceSummaryDto = {
  employeeId: "nour",
  displayName: "Nour Ben Ali",
  jobTitle: "Learning lead",
  orgUnitName: "Learning",
  stableEmployeeKey: "EMP-1",
  relation: "Manager",
  currentCycle: {
    cycleId: "c",
    cycleName: "FY2027",
    cycleState: "Active",
    phase: "Execution",
    isParticipant: true,
    planId: "p",
    planStatus: "Approved",
    overallProgress: 30,
    planHref: "/performance/cycles/c/plans/p",
    startDate: "2027-01-01",
    endDate: "2027-12-31",
    planSince: "2027-02-01T09:00:00Z",
    objectives: [
      { objectiveId: "o1", number: 1, title: "Ship the playbook", alignedTo: "Grow retention", weight: 60, progress: 50, href: "/performance/cycles/c/objectives/o1", status: "AtRisk", ...lane },
      { objectiveId: "o2", number: 2, title: "Learn Spanish", alignedTo: null, weight: 40, progress: null, href: "/performance/cycles/c/objectives/o2", status: null, ...lane },
    ],
  },
  reviews: {
    current: {
      reviewId: "r",
      reviewRoundName: "Mid-year",
      state: "ManagerAssessment",
      dueDate: "2026-10-30",
      selfAssessmentEnabled: true,
      calibrationEnabled: true,
      href: "/performance/reviews/r",
    },
    history: [
      { reviewId: "h2", cycleName: "FY2026", reviewRoundName: "Year-end", finalRatingLabel: "Strong", finalizedAt: "2026-01-20T10:00:00Z", href: "/performance/reviews/h2", reviewerName: "Karim Haddad", acknowledgedAt: null },
      { reviewId: "h1", cycleName: "FY2025", reviewRoundName: "Year-end", finalRatingLabel: "Solid", finalizedAt: "2025-01-20T10:00:00Z", href: "/performance/reviews/h1", reviewerName: "Karim Haddad", acknowledgedAt: null },
    ],
  },
  development: {
    href: "/performance/cycles/c/plans/p#development",
    goals: [
      { title: "Lead a design review", competencyName: "Collaboration", status: "InProgress", targetDate: "2027-03-31" },
      { title: "Present the migration", competencyName: null, status: "Done", targetDate: "2026-09-01" },
    ],
  },
  praise: null,
  feedback: null,
  oneOnOne: null,
  oneOnOneBooking: null,
};

describe("PersonPerformanceSummary", () => {
  it("renders the glance and the goals, each linking into Performance", () => {
    render(<PersonPerformanceSummary state={{ status: "ready", summary: full }} renderLink={renderLink} />);
    const glance = screen.getByRole("region", { name: "At a glance" });
    expect(within(glance).getByText("30%")).toBeInTheDocument();
    expect(within(glance).getByText("Approved")).toBeInTheDocument();
    expect(within(glance).getByText("Reviewer assessment")).toBeInTheDocument();
    expect(within(glance).getByRole("listitem", { name: "Reviewer assessment" })).toHaveAttribute("aria-current", "step");

    expect(screen.getByRole("link", { name: /Ship the playbook/ })).toHaveAttribute("href", "/performance/cycles/c/objectives/o1");
    expect(screen.getByText("Aligned to Grow retention")).toBeInTheDocument();
    expect(screen.getByText("Standalone")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open plan" })).toHaveAttribute("href", "/performance/cycles/c/plans/p");
  });

  it("shows each reported status and never invents one", () => {
    render(<PersonPerformanceSummary state={{ status: "ready", summary: full }} renderLink={renderLink} />);
    expect(within(screen.getByRole("link", { name: /Ship the playbook/ })).getByText("At risk")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: /Learn Spanish/ })).queryByText(/track|risk/i)).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "At a glance" })).getByText("1 at risk")).toBeInTheDocument();
  });

  it("draws nothing when neither the plan nor reviews are visible", () => {
    const { container } = render(
      <PersonPerformanceSummary
        state={{ status: "ready", summary: { ...full, relation: "Other", currentCycle: null, reviews: null, development: null, praise: null } }}
        renderLink={renderLink}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("states that a person isn't part of the cycle and lists no objectives", () => {
    const outside = {
      ...full,
      currentCycle: { ...full.currentCycle!, isParticipant: false, planId: null, planStatus: null, overallProgress: null, planHref: null, objectives: [] },
    };
    render(<PersonPerformanceSummary state={{ status: "ready", summary: outside }} renderLink={renderLink} />);
    expect(screen.getAllByText("Not part of FY2027").length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /Ship the playbook/ })).not.toBeInTheDocument();
  });

  it("keeps loading and failure in place", async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<PersonPerformanceSummary state={{ status: "loading" }} renderLink={renderLink} />);
    expect(screen.getByLabelText("Loading performance")).toBeInTheDocument();
    rerender(<PersonPerformanceSummary state={{ status: "error", onRetry }} renderLink={renderLink} />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

});

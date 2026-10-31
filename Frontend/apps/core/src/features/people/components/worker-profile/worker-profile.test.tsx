// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PeopleProfileDto, PeopleTimelineEventDto } from "@repo/api";
import { ProfileTimeline } from "./job-tab";
import { nextAnniversary } from "./overview-tab";
import { WorkerProfile } from "./worker-profile";
import { fromPeopleProfile, tenure } from "./worker-profile-view";

vi.mock("@repo/api/query", () => ({ usePhoto: () => null, useTenantSummary: () => ({ data: { name: "Carthage Digital Group" } }) }));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    scroll: _scroll,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { scroll?: boolean }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const person = (overrides: Partial<PeopleProfileDto> = {}): PeopleProfileDto => ({
  identity: {
    employeeKey: "CDG-027",
    employeeNumber: "CDG-027",
    displayName: "Aicha Bouazizi",
    firstName: "Aicha",
    lastName: "Bouazizi",
    preferredName: null,
    workEmail: "aicha.bouazizi@example.test",
    phone: null,
    employeeId: "employee-27",
    photoUrl: null,
  },
  employment: { state: "Active", start: "2021-12-15", end: null, employmentType: "FullTime" },
  work: {
    orgUnitId: "unit-1",
    jobTitle: "QA Automation Engineer",
    organizationName: "Consulting A Core",
    organizationPath: "Carthage / Client Solutions / Consulting A Core",
    location: "Ariana",
    effectiveFrom: "2021-12-15",
    isHistorical: false,
  },
  primaryManager: { employeeKey: "CDG-004", employeeNumber: "CDG-004", displayName: "Mariam Gharbi", employeeId: "employee-4", photoUrl: null },
  directReportCount: 0,
  directReports: [],
  completeness: "Complete",
  version: 3,
  viewedDate: "2026-10-31",
  isAsOf: false,
  comingUp: [],
  dottedLineManagers: [],
  ...overrides,
}) as PeopleProfileDto;

const tabs = [
  { key: "overview" as const, label: "Overview", href: "/people/CDG-027" },
  { key: "job" as const, label: "Job", href: "/people/CDG-027?tab=job" },
  { key: "personal" as const, label: "Personal", href: "/people/CDG-027?tab=personal" },
];

describe("WorkerProfile", () => {
  it("draws the band: name, job, a glance row with manager, team, time with the company and place, and the tabs", () => {
    const view = fromPeopleProfile(person(), undefined, null);
    const mates = ["Fares Labidi", "Meriem Hamrouni", "Salah Jaziri"].map((name, index) => ({ name, href: `/people/CDG-10${index}` }));
    render(<WorkerProfile view={view} tabs={tabs} currentTab="overview" teammates={mates} headerActions={<button type="button">More actions</button>} />);

    expect(screen.getByRole("heading", { level: 1, name: "Aicha Bouazizi" })).toBeInTheDocument();
    expect(screen.getByText("QA Automation Engineer")).toBeInTheDocument();
    expect(screen.getByText("Consulting A Core, in Client Solutions")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Mariam Gharbi/ })[0]).toHaveAttribute("href", "/people/CDG-004");
    expect(screen.getByText("Mariam's team")).toBeInTheDocument();
    expect(screen.getByText("4 people")).toBeInTheDocument();
    expect(screen.getByText("With Carthage Digital Group since 15 Dec 2021")).toBeInTheDocument();
    expect(screen.getByText("Works from")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More actions" })).toBeInTheDocument();
    // An active person carries no status chip; tabs are links, the current one marked.
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Job" })).not.toHaveAttribute("aria-current");
  });

  it("keeps the rail: contact, hire date and employee number", () => {
    const view = fromPeopleProfile(person(), undefined, null);
    render(<WorkerProfile view={view} tabs={tabs} currentTab="job" />);

    expect(screen.getByText("aicha.bouazizi@example.test")).toBeInTheDocument();
    expect(screen.getByText("Hire date")).toBeInTheDocument();
    expect(screen.getByText("15 December 2021")).toBeInTheDocument();
    expect(screen.getByText("Employee number")).toBeInTheDocument();
  });

  it("shows a manager's own team in the glance, and a former person's state", () => {
    const view = fromPeopleProfile(
      person({
        employment: { state: "Former", start: "2020-01-01", end: "2026-01-31", employmentType: "FullTime" },
        directReportCount: 7,
        directReports: [{ employeeKey: "CDG-031", displayName: "Sami Trabelsi", jobTitle: null, photoUrl: null }] as PeopleProfileDto["directReports"],
      }),
      undefined,
      null
    );
    render(<WorkerProfile view={view} tabs={tabs} currentTab="overview" />);

    expect(screen.getByText("Their team")).toBeInTheDocument();
    expect(screen.getByText("7 people")).toBeInTheDocument();
    expect(screen.getByText("Former")).toBeInTheDocument();
  });
});

describe("nextAnniversary", () => {
  it("is the next work anniversary within two months, never the first year", () => {
    expect(nextAnniversary("2021-12-15", new Date(2026, 9, 31))).toEqual({ date: "2026-12-15", years: 5 });
    expect(nextAnniversary("2021-03-15", new Date(2026, 9, 31))).toBeNull();
    expect(nextAnniversary("2026-12-01", new Date(2026, 9, 31))).toBeNull();
    expect(nextAnniversary(null)).toBeNull();
  });
});

describe("ProfileTimeline", () => {
  it("names the sections of a contact details update, never values", () => {
    render(
      <ProfileTimeline
        events={[
          {
            kind: "PersonalDetails",
            employeeKey: "AST-1001",
            effectiveDate: "2026-10-28",
            title: "Updated contact details",
            fields: [
              { label: "Mobile", from: null, to: null },
              { label: "Home address", from: null, to: null },
            ],
            isFuture: false,
          } as PeopleTimelineEventDto,
        ]}
      />
    );
    expect(screen.getByText("Updated contact details")).toBeInTheDocument();
    expect(screen.getByText("Mobile, Home address")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });
});

describe("tenure", () => {
  it("counts whole years, months and days", () => {
    expect(tenure("2020-06-06", new Date(2026, 9, 28))).toEqual({ years: 6, months: 4, days: 22 });
    expect(tenure("2026-10-30", new Date(2026, 9, 28))).toBeNull();
    expect(tenure(null)).toBeNull();
  });
});

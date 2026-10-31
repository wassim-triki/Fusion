// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ApiError,
  type PeopleAccessStatusDto,
  type PeoplePersonalDto,
  type PeopleProfileDto,
  type PeopleTimelineDto,
} from "@repo/api";

const {
  mockPersonal,
  mockJobHistory,
  mockUpdatePersonal,
  mockSearchParams,
  mockProfile,
  mockAccess,
  mockTimeline,
  mockPush,
  mockUpdateWorkEmail,
  mockCanEnterPerformance,
  mockSummary,
} = vi.hoisted(() => ({
  mockCanEnterPerformance: vi.fn(() => true),
  mockSummary: vi.fn(),
  mockSearchParams: { current: new URLSearchParams() },
  mockProfile: vi.fn(),
  mockAccess: vi.fn(),
  mockTimeline: vi.fn(),
  mockPush: vi.fn(),
  mockUpdateWorkEmail: vi.fn(),
  mockPersonal: vi.fn(),
  mockJobHistory: vi.fn(),
  mockUpdatePersonal: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === "string" ? href : String(href)} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams.current,
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/people/E-KEY-1",
}));

vi.mock("@/shell/breadcrumb-overrides", () => ({
  useBreadcrumbLabel: () => undefined,
}));

// The Access tab's roles read Identity and Core HR's catalogue; they're tested on their own.
vi.mock("@/features/settings/roles/person-roles", () => ({ PersonRoles: () => null }));

vi.mock("@repo/auth", () => ({
  useAuth: () => ({
    user: { id: "u1", employeeId: "viewer-1" },
    isAuthenticated: true,
    isLoading: false,
  }),
  canManageCoreEmployees: () => true,
  canManageCoreReporting: () => true,
  canViewWorkforceAccess: () => true,
  canAccessCoreTeam: () => true,
  canAccessCorePeople: () => true,
  canAccessCoreOrgChart: () => true,
  canEnterPerformance: () => mockCanEnterPerformance(),
}));

vi.mock("@repo/api/query", () => ({
  useApiQuery: () => mockSummary(),
  usePhoto: () => null,
  useReactToPraise: () => ({ mutate: vi.fn(), isLoading: false }),
  useCompanyValues: () => ({ data: [] }),
}));

vi.mock("@/features/org-chart/api/use-org-chart-access", () => ({
  useOrgChartAccess: () => ({ canSee: true, isLoading: false }),
}));

vi.mock("../changes/use-changes", () => ({
  useChangeRights: () => ({ people: true, lines: true, seeComing: true }),
  useChangeMutations: () => ({ dottedLine: { isLoading: false, mutateAsync: vi.fn() } }),
  useCancelChange: () => ({ isLoading: false, mutateAsync: vi.fn() }),
  useChangeRequests: () => ({ data: [] }),
  useChangeRequest: () => ({ data: undefined }),
  useRequestDecisions: () => ({ approve: { isLoading: false }, decline: { isLoading: false }, withdraw: { isLoading: false, mutateAsync: vi.fn() } }),
}));

vi.mock("../api/use-people", () => ({
  // The record itself; the manager's record (for teammates) answers empty.
  usePeopleProfile: (key: string) =>
    key === "E-KEY-1" || key === "E-MISSING" ? mockProfile() : { data: undefined, isLoading: false, error: null },
  usePeopleAccessStatus: () => mockAccess(),
  usePeopleTimeline: () => mockTimeline(),
  usePeoplePersonal: () => mockPersonal(),
  usePeopleJobHistory: () => mockJobHistory(),
  useUpdatePeopleWorkEmail: () => mockUpdateWorkEmail(),
  useUpdatePeoplePersonal: () => mockUpdatePersonal(),
  usePhotoMutations: () => ({
    upload: { isLoading: false, mutateAsync: vi.fn() },
    remove: { isLoading: false, mutateAsync: vi.fn() },
  }),
}));

import PeopleProfileWorkspace from "./people-profile-workspace";

function profile(overrides: Partial<PeopleProfileDto> = {}): PeopleProfileDto {
  return {
    identity: {
      employeeKey: "E-KEY-1",
      employeeNumber: "E000123",
      displayName: "Ada Lovelace",
      firstName: "Ada",
      lastName: "Lovelace",
      preferredName: null,
      workEmail: "ada@ey-hr.com",
      phone: "+216 00 000 000",

      employeeId: "employee-1",
      photoUrl: null,
    },
    employment: {
      state: "Active",
      start: "2022-03-01T00:00:00Z",
      end: null,
      employmentType: "Full-time",
    },
    work: {
      orgUnitId: "ORG-1",
      jobTitle: "Principal Engineer",
      organizationName: "Platform",
      organizationPath: "Group / Technology / Platform",
      location: "Tunis",
      effectiveFrom: "2022-03-01T00:00:00Z",
      isHistorical: false,
    },
    primaryManager: {
      employeeKey: "E-KEY-9",
      displayName: "Grace Hopper",
      employeeNumber: "E000001",
    },
    directReportCount: 1,
    directReports: [
      {
        employeeKey: "E-KEY-3",
        displayName: "Alan Turing",
        employeeNumber: "E000456",
        jobTitle: "Analyst",
      },
    ],
    completeness: "Complete",
    version: 1,
    viewedDate: "2026-08-18T00:00:00Z",
    isAsOf: false,
    comingUp: [],
    dottedLineManagers: [],
    ...overrides,
  };
}

function q(over: Record<string, unknown>) {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...over,
  };
}

function access(
  over: Partial<PeopleAccessStatusDto> = {}
): PeopleAccessStatusDto {
  return { state: "Active", label: "Active", detail: "Employee access", ...over };
}

function timeline(over: Partial<PeopleTimelineDto> = {}): PeopleTimelineDto {
  return { upcoming: [], timeline: [], ...over };
}

function personal(over: Partial<PeoplePersonalDto> = {}): PeoplePersonalDto {
  return {
    employeeKey: "E-KEY-1",
    access: "Contact",
    canEdit: false,
    firstName: "Ada",
    lastName: "Lovelace",
    preferredName: "Ada L.",
    mobile: "+216 22 418 907",
    personalEmail: null,
    homeAddress: null,
    dateOfBirth: null,
    emergencyContacts: null,
    version: 7,
    ...over,
  };
}

function full(over: Partial<PeoplePersonalDto> = {}): PeoplePersonalDto {
  return personal({
    access: "Full",
    canEdit: true,
    personalEmail: "ada.home@example.test",
    homeAddress: { street: "14 Rue Ibn Khaldoun", city: "Ariana", postalCode: "2080", country: "Tunisia" },
    dateOfBirth: "1996-08-19",
    emergencyContacts: [{ name: "Karim Lovelace", relationship: "Brother", phone: "+216 98 552 310" }],
    ...over,
  });
}

beforeEach(() => {
  mockSearchParams.current = new URLSearchParams();
  mockPersonal.mockReturnValue(q({ data: personal() }));
  mockJobHistory.mockReturnValue(
    q({
      data: {
        rows: [
          { effectiveDate: "2024-01-01", jobTitle: "Principal Engineer", orgUnitId: "ORG-1", unitName: "Platform", location: "Tunis",
            manager: { employeeKey: "E-KEY-9", displayName: "Grace Hopper", employeeNumber: "E000001" }, isCurrent: true },
          { effectiveDate: "2022-03-01", jobTitle: "Senior Engineer", orgUnitId: "ORG-1", unitName: "Platform", location: "Tunis",
            manager: null, isCurrent: false },
        ],
      },
    })
  );
  mockUpdatePersonal.mockReturnValue({ isLoading: false, mutateAsync: vi.fn().mockResolvedValue(full()) });
  mockProfile.mockReset();
  mockAccess.mockReset();
  mockTimeline.mockReset();
  mockPush.mockReset();
  mockUpdateWorkEmail.mockReset();
  mockAccess.mockReturnValue(q({ data: access() }));
  mockTimeline.mockReturnValue(q({ data: timeline() }));
  mockUpdateWorkEmail.mockReturnValue({
    isLoading: false,
    mutateAsync: vi.fn(),
  });
});

const tab = (name: string) => {
  mockSearchParams.current = new URLSearchParams(`tab=${name}`);
};

describe("PeopleProfileWorkspace", () => {
  it("shows the band with tabs, the rail and HR's actions", () => {
    mockProfile.mockReturnValue(q({ data: profile() }));
    render(<PeopleProfileWorkspace employeeKey="E-KEY-1" />);

    expect(screen.getByRole("heading", { level: 1, name: "Ada Lovelace" })).toBeInTheDocument();
    const tabs = screen.getByRole("navigation", { name: "Profile sections" });
    expect(tabs).toHaveTextContent("JobPersonalPerformanceAccess");
    expect(screen.getByRole("link", { name: "Job" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Personal" })).toHaveAttribute("href", "/people/E-KEY-1?tab=personal");
    expect(screen.getAllByText("E000123").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Show on the org chart/i })).toHaveAttribute("href", "/org-chart?focus=E-KEY-1");
    const rail = screen.getByRole("complementary", { name: "About Ada Lovelace" });
    expect(within(rail).getByRole("link", { name: /Grace Hopper/ })).toHaveAttribute("href", "/people/E-KEY-9");
    expect(screen.getByRole("link", { name: /Alan Turing/ })).toHaveAttribute("href", "/people/E-KEY-3");
    expect(screen.getByRole("button", { name: /Make a change/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /More actions/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change photo" })).toBeInTheDocument();
  });

  it("shows employment figures and Job information on the Job tab", () => {
    mockProfile.mockReturnValue(q({ data: profile() }));
    render(<PeopleProfileWorkspace employeeKey="E-KEY-1" />);
    expect(screen.getByRole("heading", { name: "Employment" })).toBeInTheDocument();
    expect(screen.getByText("With the company")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Job information" })).toBeInTheDocument();
    expect(screen.getByText("Senior Engineer")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("leaves Job information out when the server refuses it", () => {
    mockProfile.mockReturnValue(q({ data: profile() }));
    mockJobHistory.mockReturnValue(q({ error: new ApiError(403, "Forbidden", ["Forbidden"], null) }));
    render(<PeopleProfileWorkspace employeeKey="E-KEY-1" />);
    expect(screen.queryByRole("heading", { name: "Job information" })).not.toBeInTheDocument();
  });

  it("shows a scheduled change under Coming up with Edit and Cancel", () => {
    mockProfile.mockReturnValue(
      q({
        data: profile({
          comingUp: [
            {
              id: "change-1",
              kind: "JobChange",
              effectiveDate: "2099-09-01",
              status: "Scheduled",
              canCancel: true,
              canEdit: true,
              person: { employeeId: "employee-1", employeeKey: "E-KEY-1", displayName: "Ada Lovelace" },
              createdBy: "Amira Khelifi",
              createdAt: "2026-10-26T10:00:00Z",
              note: null,
              details: {
                managerFrom: null, managerTo: null, managerChanged: false,
                unitFromId: "ORG-1", unitFrom: "Platform", unitToId: "ORG-1", unitTo: null,
                titleFrom: "Principal Engineer", titleTo: "Staff Engineer", locationFrom: "Tunis", locationTo: null,
                unitChanged: false, titleChanged: true, locationChanged: false,
                teamOutcome: "Along", teamCount: 1, teamManager: null, reassigned: null, dottedLinesEnded: [],
                lastDay: null, isHire: false, employmentType: null, isReportingOnly: false,
              },
            },
          ],
        }),
      })
    );
    render(<PeopleProfileWorkspace employeeKey="E-KEY-1" />);
    expect(screen.getByRole("heading", { name: "Coming up" })).toBeInTheDocument();
    expect(screen.getByText("Becomes Staff Engineer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancel change/i })).toBeInTheDocument();
  });

  it("offers to schedule a change when nothing is coming up", () => {
    mockProfile.mockReturnValue(q({ data: profile() }));
    render(<PeopleProfileWorkspace employeeKey="E-KEY-1" />);
    expect(screen.getByText("Nothing scheduled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Schedule a change" })).toBeInTheDocument();
  });

  it("shows managerless and incomplete-work truth without inventing current facts", () => {
    mockProfile.mockReturnValue(
      q({
        data: profile({
          primaryManager: null,
          directReportCount: 0,
          directReports: [],
          work: null,
          completeness: "WorkDetailsUnavailable",
        }),
      })
    );
    render(<PeopleProfileWorkspace employeeKey="E-KEY-1" />);
    expect(screen.getAllByText(/No manager/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Work details unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Direct reports")).not.toBeInTheDocument();
  });

  it("presents a Scheduled worker with the planned start as the hire date", () => {
    mockProfile.mockReturnValue(
      q({ data: profile({ employment: { state: "Scheduled", start: "2099-09-15T00:00:00Z", end: null, employmentType: null } }) })
    );
    render(<PeopleProfileWorkspace employeeKey="E-KEY-1" />);
    expect(screen.getAllByText("Scheduled").length).toBeGreaterThan(0);
    expect(screen.getByText("15 September 2099")).toBeInTheDocument();
  });

  it("gives a colleague outside the branch the header, rail and reporting line only", () => {
    mockProfile.mockReturnValue(q({ data: profile() }));
    mockPersonal.mockReturnValue(q({ data: personal({ access: "Directory", mobile: null }) }));
    render(<PeopleProfileWorkspace employeeKey="E-KEY-1" />);
    expect(screen.queryByRole("navigation", { name: "Profile sections" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Reporting line" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Job information" })).not.toBeInTheDocument();
  });

  describe("Personal tab", () => {
    it("shows a branch manager the mobile and nothing private", () => {
      tab("personal");
      mockProfile.mockReturnValue(q({ data: profile() }));
      render(<PeopleProfileWorkspace employeeKey="E-KEY-1" />);
      expect(screen.getByText("+216 22 418 907")).toBeInTheDocument();
      expect(screen.getByText("Ada L.")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Home address" })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Emergency contacts" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Edit/ })).not.toBeInTheDocument();
    });

    it("lets HR edit a section in place and saves the whole tab against the version read", async () => {
      tab("personal");
      mockProfile.mockReturnValue(q({ data: profile() }));
      mockPersonal.mockReturnValue(q({ data: full() }));
      const mutateAsync = vi.fn().mockResolvedValue(full());
      mockUpdatePersonal.mockReturnValue({ isLoading: false, mutateAsync });
      render(<PeopleProfileWorkspace employeeKey="E-KEY-1" />);

      expect(screen.getByText("Karim Lovelace")).toBeInTheDocument();
      expect(screen.getByText(/, Tunisia$/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Edit Contact" }));
      const mobile = screen.getByRole("textbox", { name: "Mobile" });
      await userEvent.clear(mobile);
      await userEvent.type(mobile, "+216 50 000 111");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(mutateAsync).toHaveBeenCalledWith({
        expectedVersion: 7,
        request: expect.objectContaining({
          mobile: "+216 50 000 111",
          personalEmail: "ada.home@example.test",
          dateOfBirth: "1996-08-19",
          emergencyContacts: [{ name: "Karim Lovelace", relationship: "Brother", phone: "+216 98 552 310" }],
        }),
      });
    });

    it("shows the server's refusal next to the form", async () => {
      tab("personal");
      mockProfile.mockReturnValue(q({ data: profile() }));
      mockPersonal.mockReturnValue(q({ data: full() }));
      mockUpdatePersonal.mockReturnValue({
        isLoading: false,
        mutateAsync: vi.fn().mockRejectedValue(new ApiError(400, "Bad Request", ["Personal email is not a valid address."], null)),
      });
      render(<PeopleProfileWorkspace employeeKey="E-KEY-1" />);
      await userEvent.click(screen.getByRole("button", { name: "Edit Contact" }));
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Personal email is not a valid address.");
    });
  });

  describe("Access tab", () => {
    it.each([
      ["InvitationPending", "Invitation pending", "Review workforce access"],
      ["Active", "Active", "Review workforce access"],
      ["Suspended", "Suspended", "Review workforce access"],
      ["NeedsReview", "Needs review", "Review workforce access"],
      ["NoAccess", "No Fusion access", "Set up workforce access"],
    ])("renders truthful %s Fusion access state", (state, label, actionLabel) => {
      tab("access");
      mockProfile.mockReturnValue(q({ data: profile() }));
      mockAccess.mockReturnValue(q({ data: access({ state, label, detail: "Authoritative detail" }) }));
      render(<PeopleProfileWorkspace employeeKey="E-KEY-1" />);
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
      expect(screen.getByText("Authoritative detail")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: actionLabel })).toBeInTheDocument();
    });

    it("makes a missing work email directly resolvable", async () => {
      tab("access");
      mockProfile.mockReturnValue(q({ data: profile({ identity: { ...profile().identity, workEmail: null } }) }));
      mockAccess.mockReturnValue(q({ data: access({ state: "NoAccess", label: "No Fusion access", detail: null }) }));
      render(<PeopleProfileWorkspace employeeKey="E-KEY-1" />);
      expect(screen.getByText("Not set")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: /Add work email/i }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Work email" })).toHaveValue("");
    });

    it("offers a retry when the access state is unavailable", async () => {
      tab("access");
      mockProfile.mockReturnValue(q({ data: profile() }));
      const refetch = vi.fn();
      mockAccess.mockReturnValue(q({ error: new Error("Identity offline"), refetch }));
      render(<PeopleProfileWorkspace employeeKey="E-KEY-1" />);
      expect(screen.getByText("Status unavailable")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(refetch).toHaveBeenCalled();
    });
  });

  it("opens the work-email editor from the recovery deep link", () => {
    mockSearchParams.current = new URLSearchParams("action=work-email&returnTo=%2Fcore%2Fworkforce-access");
    mockProfile.mockReturnValue(q({ data: profile({ identity: { ...profile().identity, workEmail: null } }) }));
    render(<PeopleProfileWorkspace employeeKey="E-KEY-1" />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("presents an as-of view as read-only with a return to Today", () => {
    mockSearchParams.current = new URLSearchParams("asOf=2099-09-01");
    mockProfile.mockReturnValue(q({ data: profile({ isAsOf: true, viewedDate: "2099-09-01T00:00:00Z", comingUp: [] }) }));
    render(<PeopleProfileWorkspace employeeKey="E-KEY-1" />);
    expect(screen.getByText(/As of/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Today/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Make a change/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change photo" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Personal" })).toHaveAttribute("href", "/people/E-KEY-1?asOf=2099-09-01&tab=personal");
  });

  it("renders a non-disclosing not-found state for unknown or cross-tenant keys", () => {
    mockProfile.mockReturnValue(q({ error: new Error("not found") }));
    render(<PeopleProfileWorkspace employeeKey="E-MISSING" />);
    expect(screen.getByText("Worker not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to People/i })).toBeInTheDocument();
  });

  it("announces the committed result after establishment", () => {
    mockSearchParams.current = new URLSearchParams("established=hire");
    mockProfile.mockReturnValue(q({ data: profile() }));
    render(<PeopleProfileWorkspace employeeKey="E-KEY-1" />);
    expect(screen.getByRole("status")).toHaveTextContent(/Employee hired/i);
  });

  describe("Performance tab", () => {
    beforeEach(() => {
      mockCanEnterPerformance.mockReturnValue(true);
      mockProfile.mockReturnValue(q({ data: profile() }));
      mockSummary.mockReturnValue({ data: undefined, error: null, isLoading: true, refetch: vi.fn() });
    });

    it("is a tab when the viewer can enter Performance", () => {
      render(<PeopleProfileWorkspace employeeKey="E-KEY-1" />);
      expect(screen.getByRole("link", { name: "Performance" })).toHaveAttribute("href", "/people/E-KEY-1?tab=performance");
    });

    it("is absent when the tenant or viewer has no Performance", () => {
      mockCanEnterPerformance.mockReturnValue(false);
      tab("performance");
      render(<PeopleProfileWorkspace employeeKey="E-KEY-1" />);
      expect(screen.queryByRole("link", { name: "Performance" })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Job" })).toHaveAttribute("aria-current", "page");
    });

    it("keeps the record header when Performance fails and offers a retry in place", async () => {
      tab("performance");
      const refetch = vi.fn();
      mockSummary.mockReturnValue({ data: undefined, error: new Error("down"), isLoading: false, refetch });
      render(<PeopleProfileWorkspace employeeKey="E-KEY-1" />);
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Performance" })).toHaveAttribute("aria-current", "page");
      expect(screen.getByText("Performance couldn't be loaded.")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(refetch).toHaveBeenCalledOnce();
    });
  });
});

// @vitest-environment happy-dom
import { render as baseRender, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import type { AuthUser } from "@repo/auth";
import type { FusionUpcoming, FusionWorkItem, PersonPerformanceSummaryDto } from "@repo/api";
import { IntlTestProvider } from "@repo/ds/testing";
import { shellMessages } from "@/test/intl";
import { FusionHome } from "./fusion-home";

type ModuleState = { key: string; label: string; status: "loading" | "ready" | "error" };

const mocks = vi.hoisted(() => ({
  user: null as AuthUser | null,
  work: { items: [] as FusionWorkItem[], modules: [] as ModuleState[] },
  requested: [] as string[],
  praise: { data: undefined as unknown, error: null as Error | null },
  praiseEnabled: [] as boolean[],
  react: vi.fn(),
  upcoming: { items: [] as FusionUpcoming[], modules: [] as ModuleState[] },
  card: { jobTitle: "QA Automation Engineer", orgUnitName: "Consulting A" } as { jobTitle: string | null; orgUnitName: string | null } | null,
  summary: null as PersonPerformanceSummaryDto | null,
}));

vi.mock("@repo/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createPerformanceApi: () => ({ getPersonSummary: async () => mocks.summary }),
}));

function render(ui: ReactElement, locale: "en" | "fr" = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return baseRender(
    <IntlTestProvider locale={locale} messages={shellMessages[locale]}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </IntlTestProvider>,
  );
}

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));

vi.mock("@repo/auth", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: mocks.user, isLoading: false, logout: vi.fn() }),
  useNotificationAlerts: () => ({ alerts: { popups: true, sound: true }, save: vi.fn(), saving: false }),
  TopBarPreferences: () => null,
}));

vi.mock("@repo/api/query", () => ({
  useFusionWork: (modules: string[]) => {
    mocks.requested = modules;
    return {
      ...mocks.work,
      isLoading: false,
      failedModules: mocks.work.modules.filter((module) => module.status === "error"),
      refetch: vi.fn(),
    };
  },
  usePraiseFeed: (_query: unknown, options: { enabled?: boolean }) => {
    mocks.praiseEnabled.push(Boolean(options.enabled));
    return mocks.praise;
  },
  useReactToPraise: () => ({ mutate: mocks.react, isLoading: false }),
  useCompanyValues: () => ({ data: [] }),
  useFusionUpcoming: () => ({
    ...mocks.upcoming,
    isLoading: false,
    failedModules: mocks.upcoming.modules.filter((module) => module.status === "error"),
  }),
  useMyCard: () => ({ data: mocks.card ? { displayName: "Nour Ben Ali", ...mocks.card } : undefined }),
  useFusionNavigation: () => ({
    pending: false,
    tenantName: "Carthage Digital Group",
    homeCount: mocks.work.items.length,
    modules: [
      { key: "core", label: "Core HR", description: "People and organization", href: "/core", count: 1 },
      { key: "performance", label: "Performance", description: "Goals, conversations and reviews", href: "/performance", count: 2 },
      { key: "learning", label: "Learning", description: "Training and sessions", href: "/learning" },
    ],
    sectionCounts: {},
    recent: [],
    person: { name: "Nour Ben Ali", detail: "QA Automation Engineer", detailPending: false },
  }),
  usePeoplePhotos: () => new Map(),
  useFusionNotifications: () => ({
    items: [],
    unreadCount: 0,
    modules: [{ key: "performance", label: "Performance", status: "ready" }],
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  }),
}));

function grant(permissionKey: string, scope: "Self" | "Tenant" = "Self") {
  return { permissionKey, scope, label: "", group: "", helperText: null, allowedScopes: [scope] };
}

const employee: AuthUser = {
  userId: "u",
  tenantId: "t",
  tenantMembershipId: "m",
  moduleEntitlements: ["CoreHR", "Performance"],
  email: "nour@example.test",
  fullName: "Nour Ben Ali",
  roles: ["Employee"],
  employeeId: "e",
  accessProfiles: [],
  effectivePermissions: [grant("core.profile.self.view"), grant("performance.objective.self.manage")],
};

const ready: ModuleState[] = [
  { key: "core", label: "Core HR", status: "ready" },
  { key: "performance", label: "Performance", status: "ready" },
];

describe("FusionHome", () => {
  beforeEach(() => {
    mocks.user = employee;
    mocks.praise = { data: { items: [], next: null }, error: null };
    mocks.praiseEnabled = [];
    mocks.react.mockClear();
    mocks.upcoming = { items: [], modules: [{ key: "performance", label: "Performance", status: "ready" }] };
    mocks.summary = null;
  });
  afterEach(() => cleanup());

  it("renders the frame, the greeting and the most important item first for an employee", () => {
    mocks.work = {
      modules: ready,
      items: [
        { id: "a", module: "performance", kind: "self-assessment", title: "Complete your self-assessment", dueOn: "2099-01-02", href: "/performance/reviews/1" },
        { id: "b", module: "performance", kind: "update-request", title: "Update progress on Ship the playbook", href: "/performance/plan" },
      ],
    };
    render(<FusionHome />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/, Nour$/);
    expect(screen.getByText("EY Fusion")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Complete your self-assessment" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Also needs you" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Update progress on Ship the playbook/ }).getAttribute("href")).toBe("/performance/plan");
    expect(mocks.requested).toEqual(["core", "performance"]);
  });

  it("speaks French around the work, which keeps the server's words", () => {
    mocks.work = {
      modules: [ready[0]!, { key: "performance", label: "Performance", status: "error" }],
      items: [{ id: "a", module: "core", kind: "access", title: "12 people don't have Fusion access yet", dueOn: "2099-01-02", href: "/core/workforce-access" }],
    };
    render(<FusionHome />, "fr");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/^(Bonjour|Bon après-midi|Bonsoir), Nour$/);
    expect(screen.getByRole("link", { name: /^Accueil/ })).toBeTruthy();
    expect(screen.getByText("Les deux prochaines semaines")).toBeTruthy();
    expect(screen.getByText(/jours restants/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "12 people don't have Fusion access yet" })).toBeTruthy();
    expect(screen.getByText(/^[A-Z][a-zé]+ \d{1,2} [a-zéû]+ · QA Automation Engineer, Consulting A$/)).toBeTruthy();
  });

  it("says nothing needs the person and nothing is scheduled when there is neither", () => {
    mocks.work = { modules: ready, items: [] };
    render(<FusionHome />);
    expect(screen.getByText("Nothing needs you right now")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "No work and nothing scheduled in the next two weeks" })).toBeTruthy();
    expect(screen.getByText("Nothing is scheduled in the next two weeks")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Also needs you" })).toBeNull();
  });

  it("with no work, leads with the next moment", () => {
    mocks.work = { modules: ready, items: [] };
    const at = new Date(Date.now() + 2 * 86_400_000);
    const date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
    mocks.upcoming.items = [{ id: "m1", module: "performance", kind: "one-on-one", title: "1:1 with Mariam Gharbi", context: "2 on the agenda",
      date, at: at.toISOString(), href: "/performance/one-on-ones/s1" }];
    render(<FusionHome />);
    expect(screen.getByText(/Nothing needs you today/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "1:1 with Mariam Gharbi" })).toBeTruthy();
    // The featured moment isn't repeated in the next two weeks.
    expect(screen.getByText("Nothing is scheduled in the next two weeks")).toBeTruthy();
  });

  it("leads with overdue work, reads it late, and lists dated work and moments for two weeks", () => {
    const day = (offset: number) => {
      const d = new Date(Date.now() + offset * 86_400_000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    mocks.work = {
      modules: ready,
      items: [
        { id: "late", module: "performance", kind: "manager-assessment", title: "Assess Omar", dueOn: day(-1), href: "/performance/reviews/3" },
        { id: "feedback", module: "performance", kind: "feedback-request", title: "Feedback for Rim", dueOn: day(5), href: "/performance/feedback/requests/r" },
      ],
    };
    mocks.upcoming.items = [{ id: "plans", module: "performance", kind: "plans-due", title: "Plans due", date: day(10), href: "/performance/plan" }];
    render(<FusionHome />);
    expect(screen.getByRole("heading", { level: 2, name: "Assess Omar" })).toBeTruthy();
    expect(screen.getByText("day late")).toBeTruthy();
    const agenda = screen.getByRole("heading", { name: "Next two weeks" }).parentElement!;
    const entries = Array.from(agenda.querySelectorAll("a")).map((a) => a.textContent ?? "");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toContain("Feedback for Rim due");
    expect(entries[1]).toContain("Plans due");
  });

  it("names the day and the person's job and unit under the greeting", () => {
    mocks.work = { modules: ready, items: [] };
    render(<FusionHome />);
    expect(screen.getByText(/· QA Automation Engineer, Consulting A$/)).toBeTruthy();
  });

  it("shows the person's year: a draft plan with who approves it", async () => {
    mocks.work = { modules: ready, items: [] };
    mocks.summary = {
      employeeId: "e", displayName: "Nour Ben Ali", jobTitle: null, orgUnitName: null, stableEmployeeKey: null, relation: "Self",
      currentCycle: {
        cycleId: "c", cycleName: "FY2027 Cycle", cycleState: "Active", phase: "Planning", isParticipant: true, planId: "p",
        planStatus: "Draft", overallProgress: null, planHref: "/performance/plan",
        objectives: [
          { objectiveId: "o1", number: 1, title: "A", alignedTo: null, weight: 40, progress: null, href: "#", status: null },
          { objectiveId: "o2", number: 2, title: "B", alignedTo: null, weight: 30, progress: null, href: "#", status: null },
        ],
        reviewerName: "Mariam Gharbi", weightTotal: 70, lastUpdateAt: null,
      },
      reviews: null, development: null, praise: null, feedback: null, oneOnOne: null,
    } as PersonPerformanceSummaryDto;
    render(<FusionHome />);
    expect(await screen.findByText("Your plan is a draft")).toBeTruthy();
    expect(screen.getByText("2 objectives · weights at 70%")).toBeTruthy();
    expect(screen.getByText("Mariam Gharbi approves it")).toBeTruthy();
  });

  it("shows no year for someone outside the current cycle", async () => {
    mocks.work = { modules: ready, items: [] };
    mocks.summary = {
      employeeId: "e", displayName: "Nour Ben Ali", jobTitle: null, orgUnitName: null, stableEmployeeKey: null, relation: "Self",
      currentCycle: { cycleId: "c", cycleName: "FY2027 Cycle", cycleState: "Active", phase: "Planning", isParticipant: false,
        planId: null, planStatus: null, overallProgress: null, planHref: null, objectives: [] },
      reviews: null, development: null, praise: null, feedback: null, oneOnOne: null,
    } as PersonPerformanceSummaryDto;
    render(<FusionHome />);
    await screen.findByRole("heading", { name: "Praise" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("heading", { name: "Your year" })).toBeNull();
  });

  it("keeps Performance's work when Core HR fails, and says so in one line", () => {
    mocks.work = {
      modules: [{ key: "core", label: "Core HR", status: "error" }, ready[1]!],
      items: [{ id: "a", module: "performance", kind: "plan-write", title: "Write your plan", dueOn: "2099-01-02", href: "/performance/plan" }],
    };
    render(<FusionHome />);
    expect(screen.getByRole("heading", { name: "Write your plan" })).toBeTruthy();
    expect(screen.getByText("Core HR work couldn't be loaded")).toBeTruthy();
  });

  it("offers only the modules the person can enter and reads only their work", () => {
    mocks.user = { ...employee, moduleEntitlements: ["CoreHR"] };
    mocks.work = { modules: [ready[0]!], items: [] };
    render(<FusionHome />);
    expect(screen.queryByRole("link", { name: "Performance" })).toBeNull();
    expect(mocks.requested).toEqual(["core"]);
  });

  it("shows the company's praise beside the work and reacts in place", () => {
    mocks.work = { modules: ready, items: [] };
    mocks.praise = {
      data: {
        next: null,
        items: [{
          id: "p1", author: { id: "a", name: "Amine Jaziri" }, recipients: [{ id: "e", name: "Nour Ben Ali" }],
          value: { id: "v", name: "Ownership" }, message: "You ran the cut-over with zero downtime.", givenAt: "2026-10-17T08:00:00Z",
          reactions: [{ kind: "Celebrate", count: 1, mine: false }], canDelete: false,
        }],
      },
      error: null,
    };
    render(<FusionHome />);
    expect(screen.getByRole("heading", { name: "Praise" })).toBeTruthy();
    expect(screen.getByText("Ownership")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Give praise" }).getAttribute("href")).toBe("/performance/feedback?tab=praise&compose=praise");
    expect(screen.getByText("To you")).toBeTruthy();
    expect(screen.getByRole("link", { name: /All praise/ }).getAttribute("href")).toBe("/performance/feedback?tab=praise");
    screen.getByRole("button", { name: "Celebrate, 1" }).click();
    expect(mocks.react).toHaveBeenCalledWith({ praiseId: "p1", kind: "Celebrate", add: true });
  });

  it("keeps the work when praise fails, with one quiet line", () => {
    mocks.work = { modules: ready, items: [{ id: "a", module: "performance", kind: "plan-write", title: "Write your plan", dueOn: "2099-01-02", href: "/performance/plan" }] };
    mocks.praise = { data: undefined, error: new Error("down") };
    render(<FusionHome />);
    expect(screen.getByRole("heading", { name: "Write your plan" })).toBeTruthy();
    expect(screen.getByText("Praise couldn't be loaded")).toBeTruthy();
  });

  it("has no praise and asks for none without Performance", () => {
    mocks.user = { ...employee, moduleEntitlements: ["CoreHR"] };
    mocks.work = { modules: [ready[0]!], items: [] };
    render(<FusionHome />);
    expect(screen.queryByRole("heading", { name: "Praise" })).toBeNull();
    expect(mocks.praiseEnabled.every((enabled) => !enabled)).toBe(true);
    // One column: no side column without a second job.
    expect(screen.queryByRole("complementary", { name: "Your year and praise" })).toBeNull();
  });

  it("lists the person's modules with their waiting work in the sidebar, Home first", () => {
    mocks.user = employee;
    mocks.work = { modules: ready, items: [] };
    render(<FusionHome />);
    const nav = screen.getByRole("complementary", { name: "Fusion navigation" });
    const links = Array.from(nav.querySelectorAll("a")).map((link) => [link.textContent, link.getAttribute("href")]);
    expect(links).toEqual([
      ["Home", "/"],
      ["Core HR1", "/core"],
      ["Performance2", "/performance"],
      ["Learning", "/learning"],
    ]);
    expect(nav.textContent).toContain("Carthage Digital Group");
    expect(nav.textContent).toContain("QA Automation Engineer");
  });
});

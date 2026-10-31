// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import type { AuthUser } from "@repo/auth";
import type { ContinuityState } from "@repo/api";
import { SETUP_CAPABILITIES } from "./catalog";
import type {
  CapabilityState,
  ComposedCapability,
  LaunchpadVariant,
} from "./compose";

const mocks = vi.hoisted(() => ({
  auth: {
    user: null as AuthUser | null,
    isLoading: false,
  },
  setupHook: vi.fn(),
  summaryHook: vi.fn(),
  rosterHook: vi.fn(),
}));

vi.mock("@repo/auth", () => ({
  useAuth: () => mocks.auth,
  canAccessCoreSetup: (user: AuthUser | null) => user?.userId === "admin",
  canAccessCorePeople: (user: AuthUser | null) => user?.userId === "admin",
  canViewTenantAdministration: (user: AuthUser | null) =>
    user?.userId === "admin",
  canViewCoreOrganization: (user: AuthUser | null) => user?.userId === "admin",
  canViewWorkforceAccess: (user: AuthUser | null) => user?.userId === "admin",
}));

vi.mock("@/features/organization/api/use-organization", () => ({
  useOrganizationReadiness: mocks.setupHook,
  // No server readiness in these scenarios: the launchpad falls back to the roster count.
  useCoreHRReadiness: () => ({ data: undefined, isLoading: false, error: null }),
}));

vi.mock("@/features/tenant-access/api/use-tenant-access", () => ({
  useTenantAccessSummary: mocks.summaryHook,
}));

vi.mock("@/features/people/api/use-employees", () => ({
  useEmployeeRoster: mocks.rosterHook,
}));

vi.mock("@/features/workforce-access/api/use-workforce-access", () => ({
  useAccessRosterSummary: () => ({ data: null, isLoading: false, error: null }),
}));

import SetupLaunchpad, {
  LaunchpadSkeleton,
  LaunchpadView,
} from "./setup-launchpad";

function entry(
  key: string,
  state: CapabilityState,
  isActionable = false,
  overrides: Partial<ComposedCapability> = {}
): ComposedCapability {
  const capability = SETUP_CAPABILITIES.find((item) => item.key === key);
  if (!capability) throw new Error(`Missing capability ${key}`);
  return {
    capability,
    state,
    blockedBy: null,
    detail: null,
    isActionable,
    ...overrides,
  };
}

const ADMIN_ACCESS = entry("administrator-access", "available", true);
const TENANT_CONFIGURATION = entry("tenant-configuration", "planned");
const WORKFORCE_ACCESS = entry("workforce-access", "planned");

function renderView({
  variant = "fresh",
  recommendation = entry("organization", "not-started", true),
  entries = [
    ADMIN_ACCESS,
    TENANT_CONFIGURATION,
    entry("workforce", "blocked", false, { blockedBy: "Organization" }),
    WORKFORCE_ACCESS,
  ],
  continuity = "AtRisk" as ContinuityState,
  activeAdministrators = 1 as number | null,
}: {
  variant?: LaunchpadVariant;
  recommendation?: ComposedCapability | null;
  entries?: ComposedCapability[];
  continuity?: ContinuityState | null;
  activeAdministrators?: number | null;
} = {}) {
  return render(
    <LaunchpadView
      tenantName="Demo Path 2"
      variant={variant}
      recommendation={recommendation}
      entries={entries}
      continuity={continuity}
      activeAdministrators={activeAdministrators}
      onRetry={vi.fn()}
    />
  );
}

describe("Tenant Setup launchpad presentation", () => {
  it("renders the fresh welcome, Organization recommendation, and foundation grid", () => {
    renderView();

    expect(
      screen.getByRole("heading", { name: "Welcome, Demo Path 2" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your tenant is ready. Start building the foundation your organization will use."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Set up your organization" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Open Organization/i })
    ).toHaveAttribute("href", "/organization");
    expect(
      screen.getByRole("heading", { name: "Tenant foundation" })
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { name: "Set up your organization" })
    ).toHaveLength(1);
  });

  it("separates administrative continuity from the buildout ladder", () => {
    renderView();

    const administration = screen
      .getByRole("heading", { name: "Administration & configuration" })
      .closest("section");
    expect(administration).not.toBeNull();

    const continuityCard = screen
      .getByRole("heading", { name: "Administrator continuity" })
      .closest("article");
    expect(continuityCard).not.toBeNull();
    expect(
      within(continuityCard as HTMLElement).getByText("At risk")
    ).toBeInTheDocument();
    expect(
      within(continuityCard as HTMLElement).getByText("1 active administrator")
    ).toBeInTheDocument();
    expect(
      within(continuityCard as HTMLElement).getByRole("link", {
        name: /Manage access/i,
      })
    ).toHaveAttribute("href", "/settings/roles/administrators");

    // Administrator access stays a rung, but only as a marker: management is not
    // duplicated onto the ladder.
    const foundation = screen
      .getByRole("heading", { name: "Tenant foundation" })
      .closest("section");
    expect(
      within(foundation as HTMLElement).queryByRole("link", {
        name: /Manage access/i,
      })
    ).not.toBeInTheDocument();

    // Tenant configuration is administration, not a buildout rung.
    expect(
      within(administration as HTMLElement).getByRole("heading", {
        name: "Tenant configuration",
      })
    ).toBeInTheDocument();
  });

  it("renders the underway and mature copy from authoritative variants", () => {
    const { rerender } = render(
      <LaunchpadView
        tenantName="Demo Path 2"
        variant="underway"
        recommendation={entry("organization", "in-progress", true)}
        entries={[ADMIN_ACCESS]}
        continuity={null}
        activeAdministrators={null}
        onRetry={vi.fn()}
      />
    );

    expect(
      screen.getByText("Continue building and managing your tenant foundation.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Continue organization setup" })
    ).toBeInTheDocument();

    rerender(
      <LaunchpadView
        tenantName="Demo Path 2"
        variant="mature"
        recommendation={null}
        entries={[entry("organization", "ready", true)]}
        continuity={null}
        activeAdministrators={null}
        onRetry={vi.fn()}
      />
    );

    expect(
      screen.getByText("Review and manage the foundation your tenant uses.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Review organization/i })
    ).toBeInTheDocument();
  });

  it("promotes Workforce after Organization is ready without duplicating it", () => {
    renderView({
      variant: "underway",
      recommendation: entry("workforce", "not-started", true),
      entries: [entry("organization", "ready", true), ADMIN_ACCESS],
    });

    expect(
      screen.getByRole("heading", { name: "Add your workforce" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Add workforce/i })
    ).toHaveAttribute("href", "/people");
    expect(
      screen.getAllByRole("heading", { name: "Add your workforce" })
    ).toHaveLength(1);
  });

  it("keeps unavailable capabilities readable and non-interactive", () => {
    renderView({
      recommendation: null,
      entries: [
        TENANT_CONFIGURATION,
        WORKFORCE_ACCESS,
        entry("performance", "planned"),
      ],
    });

    const configuration = screen
      .getByRole("heading", { name: "Tenant configuration" })
      .closest("article");
    expect(configuration).not.toBeNull();
    expect(
      within(configuration as HTMLElement).getByText(
        "Not available in this build"
      )
    ).toBeInTheDocument();
    expect(
      within(configuration as HTMLElement).queryByRole("link")
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Performance" })
    ).toBeInTheDocument();
  });

  it("keeps safe navigation available when another capability status fails", () => {
    renderView({
      variant: "indeterminate",
      recommendation: null,
      entries: [
        ADMIN_ACCESS,
        entry("organization", "unknown"),
        entry("workforce", "unknown", true),
      ],
    });

    expect(
      screen.getByText("Review and manage your tenant foundation.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Manage access/i })
    ).toBeInTheDocument();
    expect(screen.getAllByText("Status unavailable")).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "Retry status" })
    ).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: /Add workforce/i })
    ).toBeInTheDocument();
  });

  it("renders a hierarchy-shaped loading skeleton", () => {
    render(<LaunchpadSkeleton />);

    expect(screen.getByLabelText("Loading tenant setup")).toHaveAttribute(
      "aria-busy",
      "true"
    );
  });
});

describe("Tenant Setup authorization boundary", () => {
  beforeEach(() => {
    mocks.auth.user = null;
    mocks.auth.isLoading = false;
    mocks.setupHook.mockReset();
    mocks.summaryHook.mockReset();
    mocks.rosterHook.mockReset();
  });

  it("renders no capability data and invokes no capability reads when unauthorized", () => {
    render(<SetupLaunchpad />);

    expect(
      screen.getByRole("heading", { name: "Getting started" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("You do not have access to this page")
    ).toBeInTheDocument();
    expect(screen.queryByText("Administrator access")).not.toBeInTheDocument();
    expect(mocks.setupHook).not.toHaveBeenCalled();
    expect(mocks.summaryHook).not.toHaveBeenCalled();
    expect(mocks.rosterHook).not.toHaveBeenCalled();
  });
});

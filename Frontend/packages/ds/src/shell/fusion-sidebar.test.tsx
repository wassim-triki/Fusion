import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { BarChart3, BookOpen, BrainCircuit, LayoutDashboard, Users, UserRoundCheck } from "lucide-react";
import { FusionSidebar } from "./fusion-sidebar";
import type { FusionSidebarProps } from "./types";

let narrow = false;
beforeEach(() => {
  narrow = false;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: narrow && query.includes("max-width"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => vi.unstubAllGlobals());

const modules: FusionSidebarProps["modules"] = [
  { key: "core", label: "Core HR", description: "People and organization", icon: BrainCircuit, href: "/core", count: 1 },
  { key: "performance", label: "Performance", description: "Goals, conversations and reviews", icon: BarChart3, href: "/performance", count: 2 },
  { key: "learning", label: "Learning", description: "Training and sessions", icon: BookOpen, href: "/learning" },
];

const sections: FusionSidebarProps["sections"] = [
  {
    items: [
      { label: "Overview", href: "/", icon: LayoutDashboard, exact: true },
      { label: "My Plan", href: "/plan", icon: UserRoundCheck },
      { label: "My Team", href: "/team", icon: Users },
    ],
  },
];

function renderSidebar(props: Partial<FusionSidebarProps> = {}) {
  return render(
    <FusionSidebar
      tenantName="Carthage Digital Group"
      homeCount={3}
      modules={modules}
      currentModuleKey="performance"
      basePath="/performance"
      activePath="/team"
      sections={sections}
      sectionCounts={{ "/performance": 0, "/performance/plan": 0, "/performance/team": 2 }}
      person={{ name: "Mariam Gharbi", detail: "VP, Product", onSignOut: vi.fn() }}
      {...props}
    />,
  );
}

describe("FusionSidebar", () => {
  it("inside a module: tenant, Home first, the switcher naming the module, its sections and the person", () => {
    renderSidebar();
    const nav = screen.getByRole("complementary", { name: "Fusion navigation" });
    expect(within(nav).getByText("Fusion")).toBeInTheDocument();
    expect(within(nav).getByText("Carthage Digital Group")).toBeInTheDocument();
    const links = within(nav).getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/");
    expect(links[0]).toHaveTextContent("Home3");
    expect(within(nav).getByRole("button", { name: /Performance/ })).toBeInTheDocument();
    expect(links.map((link) => link.textContent)).toEqual(["Home3", "Overview", "My Plan", "My Team2"]);
    expect(within(nav).getByRole("link", { name: /My Team/ })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByText("Mariam Gharbi")).toBeInTheDocument();
    expect(within(nav).getByText("VP, Product")).toBeInTheDocument();
    // No module list inside a module: the switcher replaces it.
    expect(within(nav).queryByText("Modules")).not.toBeInTheDocument();
  });

  it("on Home: Home is current and the modules are listed with their counts", () => {
    renderSidebar({ currentModuleKey: undefined, sections: undefined, basePath: undefined });
    const nav = screen.getByRole("complementary", { name: "Fusion navigation" });
    expect(within(nav).getByRole("link", { name: /Home/ })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByText("Modules")).toBeInTheDocument();
    expect(within(nav).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Home3", "/"],
      ["Core HR1", "/core"],
      ["Performance2", "/performance"],
      ["Learning", "/learning"],
    ]);
  });

  it("shows nothing for zero and no Home count before any module answers", () => {
    renderSidebar({ homeCount: undefined, sectionCounts: {} });
    const nav = screen.getByRole("complementary", { name: "Fusion navigation" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(["Home", "Overview", "My Plan", "My Team"]);
  });

  it("lists Recent records newest first, absent when there are none", () => {
    const { unmount } = renderSidebar({
      recent: [
        { label: "Omar Mansour", kind: "Person", href: "/performance/people/o" },
        { label: "Year-end review", kind: "Review round", href: "/performance/reviews/rounds/1" },
      ],
    });
    expect(screen.getByText("Recent")).toBeInTheDocument();
    const recent = screen.getByText("Omar Mansour").closest("ul")!;
    expect(within(recent).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Omar MansourPerson",
      "Year-end reviewReview round",
    ]);
    unmount();
    renderSidebar();
    expect(screen.queryByText("Recent")).not.toBeInTheDocument();
  });

  it("names the account type when there is no job title, and holds a placeholder while it resolves", () => {
    const { unmount } = renderSidebar({ person: { name: "Sami Admin", detail: "Tenant Administrator" } });
    expect(screen.getByText("Tenant Administrator")).toBeInTheDocument();
    unmount();
    renderSidebar({ person: { name: "Mariam Gharbi", detail: "Employee", detailPending: true } });
    expect(screen.queryByText("Employee")).not.toBeInTheDocument();
  });

  it("renders the frame at once while sections resolve", () => {
    renderSidebar({ pending: true });
    expect(screen.getByLabelText("Loading navigation")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Home/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Performance/ })).toBeInTheDocument();
    expect(screen.getByText("Mariam Gharbi")).toBeInTheDocument();
    expect(screen.queryByText("My Plan")).not.toBeInTheDocument();
  });

  it("below 1024px becomes a rail: every destination stays, counts become dots, labels move to tooltips", () => {
    narrow = true;
    renderSidebar();
    const nav = screen.getByRole("complementary", { name: "Fusion navigation" });
    expect(nav).toHaveAttribute("data-collapsed", "true");
    expect(within(nav).getAllByRole("link").map((link) => link.getAttribute("aria-label"))).toEqual([
      "Home",
      "Overview",
      "My Plan",
      "My Team",
    ]);
    expect(within(nav).queryByText("2")).not.toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "My Team" }).querySelector("span.rounded-full")).not.toBeNull();
    expect(within(nav).getByRole("link", { name: "Overview" }).querySelector("span.rounded-full")).toBeNull();
    expect(within(nav).getByRole("button", { name: "Switch module, current: Performance" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  });
});

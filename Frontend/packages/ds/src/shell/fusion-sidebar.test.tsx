import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { BarChart3, BookOpen, BrainCircuit, LayoutDashboard, Users, UserRoundCheck } from "../icons";
import { FusionSidebar } from "./fusion-sidebar";
import type { FusionSidebarProps } from "./types";

let narrow = false;
beforeEach(() => {
  narrow = false;
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: narrow && query.includes("max-width"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => vi.unstubAllGlobals());

const modules: FusionSidebarProps["modules"] = [
  {
    key: "core",
    label: "Core HR",
    icon: BrainCircuit,
    href: "/core",
    count: 1,
    items: [
      { label: "Overview", href: "/", icon: LayoutDashboard, exact: true },
      { label: "People", href: "/people", icon: Users },
    ],
  },
  {
    key: "performance",
    label: "Performance",
    icon: BarChart3,
    href: "/performance",
    count: 2,
    items: [
      { label: "Overview", href: "/", icon: LayoutDashboard, exact: true },
      { label: "My Plan", href: "/plan", icon: UserRoundCheck },
      { label: "My Team", href: "/team", icon: Users },
    ],
  },
  { key: "learning", label: "Learning", icon: BookOpen, href: "/learning" },
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
      sectionCounts={{ "/performance": 0, "/performance/plan": 0, "/performance/team": 2 }}
      {...props}
    />,
  );
}

const links = (nav: HTMLElement) => within(nav).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")]);

describe("FusionSidebar", () => {
  it("one sidebar: Home, then every module as a group with its pages, the other contributors' as one link (D-45)", () => {
    renderSidebar();
    const nav = screen.getByRole("complementary", { name: "Fusion navigation" });
    expect(within(nav).getByText("Carthage Digital Group")).toBeInTheDocument();
    expect(links(nav)).toEqual([
      ["Home3", "/"],
      ["Core HR", "/core"],
      ["Overview", "/core"],
      ["People", "/core/people"],
      ["Performance", "/performance"],
      ["Overview", "/"],
      ["My Plan", "/plan"],
      ["My Team2", "/team"],
      ["Learning", "/learning"],
    ]);
    expect(within(nav).getByRole("link", { name: /My Team/ })).toHaveAttribute("aria-current", "page");
    // Another module's page with the same name is not current.
    expect(within(nav).getAllByRole("link", { name: "Overview" }).map((link) => link.getAttribute("aria-current"))).toEqual([null, null]);
  });

  it("a group folds and remembers it; folded, it carries the module's count", () => {
    const { unmount } = renderSidebar();
    const nav = screen.getByRole("complementary", { name: "Fusion navigation" });
    fireEvent.click(within(nav).getByRole("button", { name: "Fold Core HR" }));
    expect(within(nav).queryByRole("link", { name: "People" })).not.toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: /^Core HR/ }).parentElement).toHaveTextContent("Core HR1");
    expect(within(nav).getByRole("button", { name: "Open Core HR" })).toHaveAttribute("aria-expanded", "false");
    unmount();
    renderSidebar();
    expect(screen.queryByRole("link", { name: "People" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My Plan" })).toBeInTheDocument();
  });

  it("on Home: Home is current and every module is listed with its pages", () => {
    renderSidebar({ currentModuleKey: undefined, basePath: undefined, activePath: "/" });
    const nav = screen.getByRole("complementary", { name: "Fusion navigation" });
    expect(within(nav).getByRole("link", { name: /Home/ })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "My Plan" })).toHaveAttribute("href", "/performance/plan");
    expect(within(nav).getAllByRole("link", { name: "Overview" }).map((link) => link.getAttribute("aria-current"))).toEqual([null, null]);
  });

  it("Insights sits under Home for who has it, current on its pages though Core HR serves them (D-88)", () => {
    const { unmount } = renderSidebar();
    expect(screen.queryByRole("link", { name: "Insights" })).toBeNull();
    unmount();
    renderSidebar({ insights: true, currentModuleKey: "core", basePath: "/core", activePath: "/insights/performance" });
    const nav = screen.getByRole("complementary", { name: "Fusion navigation" });
    const insights = within(nav).getByRole("link", { name: "Insights" });
    expect(insights).toHaveAttribute("href", "/core/insights");
    expect(insights).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: /Home/ })).not.toHaveAttribute("aria-current");
  });

  it("offers Settings at the end only when asked", () => {
    const { unmount } = renderSidebar();
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
    unmount();
    renderSidebar({ showSettings: true });
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("shows nothing for zero and no Home count before any module answers", () => {
    renderSidebar({ homeCount: undefined, sectionCounts: {}, modules: modules.map((module) => ({ ...module, count: undefined })) });
    const nav = screen.getByRole("complementary", { name: "Fusion navigation" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Home", "Core HR", "Overview", "People", "Performance", "Overview", "My Plan", "My Team", "Learning",
    ]);
  });

  it("lists Recent records under the module in view, absent when there are none", () => {
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

  it("holds placeholders under a module whose pages aren't known yet", () => {
    renderSidebar({ modules: modules.map((module) => (module.key === "performance" ? { ...module, items: undefined, pending: true } : module)) });
    expect(screen.getByLabelText("Loading navigation")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "People" })).toBeInTheDocument();
    expect(screen.queryByText("My Plan")).not.toBeInTheDocument();
  });

  it("below 1024px becomes a rail: every destination stays, counts become dots, labels move to tooltips", () => {
    narrow = true;
    renderSidebar();
    const nav = screen.getByRole("complementary", { name: "Fusion navigation" });
    expect(nav).toHaveAttribute("data-collapsed", "true");
    expect(within(nav).getAllByRole("link").map((link) => link.getAttribute("aria-label"))).toEqual([
      "Home", "Core HR", "Overview", "People", "Performance", "Overview", "My Plan", "My Team", "Learning",
    ]);
    expect(within(nav).queryByText("2")).not.toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "My Team" }).querySelector("span.rounded-full")).not.toBeNull();
    expect(within(nav).getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  });

  it("folds from the tab on its edge, opens from the company mark, and Ctrl+B does both outside text fields (B-250)", () => {
    renderSidebar();
    const nav = screen.getByRole("complementary", { name: "Fusion navigation" });
    fireEvent.click(within(nav).getByRole("button", { name: "Collapse sidebar" }));
    expect(nav).toHaveAttribute("data-collapsed", "true");

    fireEvent.click(within(nav).getByRole("button", { name: "Expand sidebar" }));
    expect(nav).toHaveAttribute("data-collapsed", "false");

    act(() => { fireEvent.keyDown(window, { key: "b", ctrlKey: true }); });
    expect(nav).toHaveAttribute("data-collapsed", "true");

    const field = document.createElement("input");
    document.body.appendChild(field);
    act(() => { fireEvent.keyDown(field, { key: "b", ctrlKey: true }); });
    expect(nav).toHaveAttribute("data-collapsed", "true");
    field.remove();
  });
});

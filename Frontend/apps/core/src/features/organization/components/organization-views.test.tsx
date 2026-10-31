// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { OrgChartPersonDto, UnitStaffingDto } from "@repo/api";
import { buildOrganizationHierarchy } from "../model/hierarchy";
import { asteriaHierarchy } from "../test/fixtures";
import OrganizationChart from "./organization-chart";
import { OrganizationList } from "./organization-list";

const model = buildOrganizationHierarchy(asteriaHierarchy);

const head = (name: string) => ({ employeeKey: name, displayName: name, initials: "XX", photoUrl: null }) as unknown as OrgChartPersonDto;
const staffing = new Map<string, UnitStaffingDto>([
  ["asteria", { unitId: "asteria", people: 12, direct: 1, head: head("Sami Ben Youssef"), openRoles: 1 }],
  ["consulting", { unitId: "consulting", people: 8, direct: 2, head: head("Ines Chaabane"), openRoles: 0 }],
  ["commercial", { unitId: "commercial", people: 0, direct: 0, head: null, openRoles: 0 }],
]);

function chart(overrides: Partial<Parameters<typeof OrganizationChart>[0]> = {}) {
  const props = {
    model,
    collapsed: new Set<string>(),
    selectedId: null,
    staffing,
    canManage: true,
    readOnly: false,
    onSelect: vi.fn(),
    onToggle: vi.fn(),
    onAddChild: vi.fn(),
    onStageDragMove: vi.fn(),
    ...overrides,
  };
  render(<OrganizationChart {...props} />);
  return props;
}

describe("Structure view", () => {
  it("draws each unit with its head and headcount, and an empty unit without a head", () => {
    chart();
    const consulting = screen.getByRole("button", { name: /^Consulting/ }).closest("[data-unit-id]") as HTMLElement;
    expect(within(consulting).getByText("Ines Chaabane")).toBeInTheDocument();
    expect(within(consulting).getByText("8")).toBeInTheDocument();
    const commercial = screen.getByRole("button", { name: /^Commercial/ }).closest("[data-unit-id]") as HTMLElement;
    expect(within(commercial).getByText("Nobody yet")).toBeInTheDocument();
  });

  it("opens a unit, folds it and adds a unit under it", () => {
    const props = chart();
    fireEvent.click(screen.getByRole("button", { name: /^Consulting/ }));
    expect(props.onSelect).toHaveBeenCalledWith("consulting");
    fireEvent.click(screen.getByRole("button", { name: "Collapse Consulting" }));
    expect(props.onToggle).toHaveBeenCalledWith("consulting");
    fireEvent.click(screen.getByRole("button", { name: "Add child to Consulting" }));
    expect(props.onAddChild).toHaveBeenCalledWith("consulting");
  });

  it("hides what's folded and offers no editing on another date", () => {
    chart({ collapsed: new Set(["consulting"]), readOnly: true });
    expect(screen.queryByRole("button", { name: /^Technology/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Expand Consulting/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add child/ })).not.toBeInTheDocument();
  });
});

describe("List view", () => {
  it("lists every unit in hierarchy order with its head and people, and a row opens it", () => {
    const onSelect = vi.fn();
    render(<OrganizationList model={model} staffing={staffing} selectedId={null} onSelect={onSelect} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]!.textContent)).toEqual([
      "Asteria Group", "Consulting", "Technology", "Data & AI", "Operations", "Commercial", "Operations",
    ]);
    expect(within(rows[1]!).getByText("Ines Chaabane")).toBeInTheDocument();
    fireEvent.click(rows[1]!);
    expect(onSelect).toHaveBeenCalledWith("consulting");
  });
});

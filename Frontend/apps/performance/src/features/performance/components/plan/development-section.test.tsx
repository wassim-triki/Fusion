// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DevelopmentGoalDto, DevelopmentPlanDto } from "@repo/api";
import { DevelopmentSection } from "./development-section";

const state = vi.hoisted(() => ({
  query: { data: undefined as DevelopmentPlanDto | undefined, isLoading: false, error: null as Error | null, refetch: vi.fn() },
  mutations: {
    add: { mutateAsync: vi.fn(async () => ({})), isLoading: false },
    update: { mutateAsync: vi.fn(async () => ({})), isLoading: false },
    remove: { mutateAsync: vi.fn(async () => ({})), isLoading: false },
    carryOver: { mutateAsync: vi.fn(async () => ({})), isLoading: false },
    dismiss: { mutateAsync: vi.fn(async () => ({})), isLoading: false },
  },
  failure: vi.fn(),
}));
vi.mock("../../api/use-performance", () => ({
  useDevelopmentPlan: () => state.query,
  useDevelopmentMutations: () => state.mutations,
}));
vi.mock("@/features/performance/api/performance-failure", () => ({ reportPerformanceFailure: state.failure }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const goal = (overrides: Partial<DevelopmentGoalDto> = {}): DevelopmentGoalDto => ({
  id: "g1", title: "Lead a design review", competencyId: "c1", competencyName: "Collaboration", actions: ["Pick a service"],
  targetDate: "2027-03-31", status: "InProgress", addedBy: { id: "nour", name: "Nour" }, updatedAt: "2026-10-10T09:00:00Z",
  carriedToCycleName: null, carriedFromEarlierCycle: false, ...overrides,
});

const plan = (overrides: Partial<DevelopmentPlanDto> = {}): DevelopmentPlanDto => ({
  cycleId: "c", employeeId: "nour", exists: true, version: 2, goals: [goal()], room: 4, canEdit: true, carryOver: null,
  competencyOptions: [{ id: "c1", name: "Collaboration" }], ...overrides,
});

beforeEach(() => {
  Object.values(state.mutations).forEach((m) => m.mutateAsync.mockClear());
  state.failure.mockClear();
});

describe("DevelopmentSection", () => {
  it("shows goals with status, competency and date, and lets an editor add one", async () => {
    state.query.data = plan();
    render(<DevelopmentSection cycleId="c" employeeId="nour" />);
    expect(screen.getByText("Lead a design review")).toBeTruthy();
    expect(screen.getByText("Collaboration")).toBeTruthy();
    // The row opens the goal beside the list, with its actions and the edits.
    expect(screen.queryByText("Pick a service")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Lead a design review/ }));
    expect(screen.getByText("Pick a service")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Edit/ })).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /Add goal/ }));
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "Present at the forum" } });
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Add goal" }).at(-1)!);
    });
    expect(state.mutations.add.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 2, title: "Present at the forum", competencyId: null, actions: [], status: "NotStarted",
    }));
  });

  it("is read-only for someone who may only read it", () => {
    state.query.data = plan({ canEdit: false });
    render(<DevelopmentSection cycleId="c" employeeId="nour" />);
    expect(screen.queryByRole("button", { name: /Add goal/ })).toBeNull();
    expect(screen.getByText("In progress")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Lead a design review/ }));
    expect(screen.getByText("Pick a service")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("says when there are no goals, offering the first only to editors", () => {
    state.query.data = plan({ goals: [], room: 5 });
    const { unmount } = render(<DevelopmentSection cycleId="c" employeeId="nour" />);
    expect(screen.getByText("No development goals yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add a goal/ })).toBeTruthy();
    unmount();
    state.query.data = plan({ goals: [], room: 5, canEdit: false });
    render(<DevelopmentSection cycleId="c" employeeId="nour" />);
    expect(screen.queryByRole("button", { name: /Add a goal/ })).toBeNull();
  });

  it("hides Add once five goals are set", () => {
    state.query.data = plan({ goals: [1, 2, 3, 4, 5].map((n) => goal({ id: `g${n}`, title: `Goal ${n}` })), room: 0 });
    render(<DevelopmentSection cycleId="c" employeeId="nour" />);
    expect(screen.queryByRole("button", { name: /Add goal/ })).toBeNull();
  });

  it("offers last cycle's open goals and brings over the chosen ones", async () => {
    state.query.data = plan({ goals: [], room: 5, carryOver: { fromCycleId: "old", fromCycleName: "FY2026", goals: [goal({ id: "old1" }), goal({ id: "old2", title: "Learn Rust" })] } });
    render(<DevelopmentSection cycleId="c" employeeId="nour" />);
    expect(screen.getByText("2 open goals from FY2026")).toBeTruthy();
    // The offer stands in for the empty state; adding a new goal moves to the section heading.
    expect(screen.queryByText("No development goals yet")).toBeNull();
    expect(screen.getByRole("button", { name: /Add goal/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Bring over" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Learn Rust/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Bring over 1" }));
    });
    expect(state.mutations.carryOver.mutateAsync).toHaveBeenCalledWith({ goalIds: ["old1"], expectedVersion: 2 });
  });

  it("marks a carried goal as history", () => {
    state.query.data = plan({ goals: [goal({ carriedToCycleName: "FY2028" })] });
    render(<DevelopmentSection cycleId="c" employeeId="nour" />);
    expect(screen.getByText("Carried to FY2028")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Lead a design review/ }));
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
  });

  it("reports a conflict so the shared recovery reloads the goals", async () => {
    state.query.data = plan();
    state.mutations.dismiss.mutateAsync.mockRejectedValueOnce(new Error("Stale"));
    state.query.data = plan({ carryOver: { fromCycleId: "old", fromCycleName: "FY2026", goals: [goal({ id: "old1" })] } });
    render(<DevelopmentSection cycleId="c" employeeId="nour" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    });
    expect(state.failure).toHaveBeenCalled();
  });

  it("shows loading and failure in place", () => {
    state.query.data = undefined;
    state.query.error = new Error("Down");
    render(<DevelopmentSection cycleId="c" employeeId="nour" />);
    expect(screen.getByText("Development didn't load")).toBeTruthy();
    state.query.error = null;
  });
});

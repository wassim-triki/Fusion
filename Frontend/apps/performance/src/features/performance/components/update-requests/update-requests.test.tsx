// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { setWriteLock } from "@repo/ds";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateRequestDto } from "@repo/api";
import { ObjectiveRequestMarker, RequestBand, RequestUpdateAction, RequestUpdateDialog } from "./update-requests";

const state = vi.hoisted(() => ({
  requests: [] as UpdateRequestDto[],
  request: { mutateAsync: vi.fn(async () => ({})), isLoading: false, error: null as Error | null },
  withdraw: { mutateAsync: vi.fn(async () => ({})), isLoading: false },
}));
vi.mock("../../api/use-update-requests", () => ({
  useUpdateRequests: () => ({ data: state.requests, isLoading: false }),
  useUpdateRequestMutations: () => ({ request: state.request, withdraw: state.withdraw }),
}));
vi.mock("@/features/performance/api/performance-failure", () => ({ reportPerformanceFailure: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

function request(overrides: Partial<UpdateRequestDto> = {}): UpdateRequestDto {
  return {
    id: "r1",
    cycleId: "c1",
    planId: "p1",
    objectiveId: "o1",
    objectiveTitle: "Integrate the vendor API",
    requestedByName: "Karim Haddad",
    requestedAt: "2026-10-02T09:00:00Z",
    note: "Where are we on the sandbox?",
    state: "Open",
    satisfiedAt: null,
    closedAt: null,
    version: 4,
    ...overrides,
  };
}

describe("update requests", () => {
  beforeEach(() => {
    state.requests = [];
    state.request.mutateAsync.mockClear();
    state.withdraw.mutateAsync.mockClear();
  });

  it("shows the owner who asked, when and why", () => {
    render(<RequestBand request={request()} />);
    expect(screen.getByText("Karim Haddad asked for an update")).toBeTruthy();
    expect(screen.getByText("Where are we on the sandbox?")).toBeTruthy();
    expect(screen.getByText("Recording progress answers it.")).toBeTruthy();
  });

  it("marks an objective card with the request", () => {
    render(<ObjectiveRequestMarker request={request()} />);
    expect(screen.getByText(/Karim asked/)).toBeTruthy();
  });

  it("offers the requester a request, then Withdraw once asked", () => {
    const { rerender } = render(<RequestUpdateAction cycleId="c1" planId="p1" personName="Nour" objective={{ id: "o1", title: "Integrate the vendor API" }} />);
    expect(screen.getByRole("button", { name: /Request update/ })).toBeTruthy();

    state.requests = [request()];
    rerender(<RequestUpdateAction cycleId="c1" planId="p1" personName="Nour" objective={{ id: "o1", title: "Integrate the vendor API" }} />);
    expect(screen.queryByRole("button", { name: /Request update/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(state.withdraw.mutateAsync).toHaveBeenCalledWith({ requestId: "r1", expectedVersion: 4 });
  });

  it("keeps Request update greyed while seeing Fusion as someone (B-220)", () => {
    act(() => setWriteLock("You're seeing Fusion as Nour, so nothing can be changed"));
    render(<RequestUpdateAction cycleId="c1" planId="p1" personName="Nour" objective={{ id: "o1", title: "Integrate the vendor API" }} />);
    expect((screen.getByRole("button", { name: /Request update/ }) as HTMLButtonElement).disabled).toBe(true);
    act(() => setWriteLock(null));
  });

  it("keeps a plan request apart from an objective request", () => {
    state.requests = [request()];
    render(<RequestUpdateAction cycleId="c1" planId="p1" personName="Nour" />);
    expect(screen.getByRole("button", { name: /Request update/ })).toBeTruthy();
  });

  it("asks about a fixed target with no picker, and fits narrow screens", () => {
    render(<RequestUpdateDialog cycleId="c1" planId="p1" personName="Nour" onClose={vi.fn()} />);
    expect(screen.getByText("On the whole plan")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("w-[min(32rem,calc(100vw-2rem))]");
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(state.request.mutateAsync).toHaveBeenCalledWith({ objectiveId: null, note: null });
  });
});

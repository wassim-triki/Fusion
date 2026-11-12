// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TeamYearDto } from "@repo/api";
import { TeamPeople, TeamTree } from "./team-year";

const m = vi.hoisted(() => ({ post: vi.fn(), invalidate: vi.fn() }));
vi.mock("@tanstack/react-query", async (original) => ({ ...(await original<object>()), useQueryClient: () => ({ invalidateQueries: m.invalidate }) }));
vi.mock("@repo/api", async (original) => ({ ...(await original<object>()), createPlatformApiClient: () => ({ post: m.post }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const goal = (id: string, owner: string, title: string, progress: number) => ({
  objectiveId: id, ownerEmployeeId: owner, ownerName: owner, title, measure: "Manual percentage", current: null, progress, status: "OnTrack" as const,
});

const year: TeamYearDto = {
  cycleId: "c",
  branches: [{ goal: goal("m1", "Mariam Gharbi", "Cut incidents to 15 a quarter", 40), supports: "Customers trust us", team: [goal("a1", "Aicha Bouazizi", "Automate the regression suite", 34)] }],
  elsewhere: ["Tarek Ben Salem"],
  people: [
    {
      employeeId: "fares", name: "Fares Ayadi", jobTitle: "Engineer", stableEmployeeKey: "EMP-2", photoUrl: null, planStatus: "Approved",
      goals: [{ weight: 100, progress: 20, status: "OffTrack" }], nextOneOnOneAt: null, lastUpdateAt: null,
      due: {
        id: "performance:goals-off-track:p", module: "performance", kind: "goals-off-track", title: "Fares Ayadi has 1 goal off track", href: "/performance/cycles/c/plans/p",
        lines: [{ text: "Launch the portal", meta: "Off track", tone: "bad" }], quote: "Lost two people.",
        actions: [{ label: "Ask for an update", path: "/cycles/c/plans/p/attention/ask-for-update", primary: true }],
      },
    },
    {
      employeeId: "sami", name: "Sami Ben Ali", jobTitle: null, stableEmployeeKey: "EMP-3", photoUrl: null, planStatus: "NotStarted",
      goals: [], nextOneOnOneAt: null, lastUpdateAt: null,
      due: {
        id: "performance:one-on-one-book:sami", module: "performance", kind: "one-on-one-book", title: "No 1:1s with Sami Ben Ali yet", href: "/performance/one-on-ones",
        booking: { slots: ["2099-11-12T10:00:00Z"], path: "/one-on-ones/with/sami/book" },
      },
    },
    {
      employeeId: "meriem", name: "Meriem Trabelsi", jobTitle: null, stableEmployeeKey: "EMP-4", photoUrl: null, planStatus: "Approved",
      goals: [{ weight: 60, progress: 50, status: "OnTrack" }, { weight: 40, progress: 30, status: "OnTrack" }], due: null,
      nextOneOnOneAt: "2099-11-12T10:00:00Z", lastUpdateAt: null,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  m.post.mockResolvedValue(undefined);
});

describe("The Team page's year", () => {
  it("hangs the team's goals under the manager's, each opening its goal", async () => {
    const onOpen = vi.fn();
    render(<TeamTree year={year} onOpen={onOpen} />);
    expect(screen.getByText("Your goal, under Customers trust us")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Automate the regression suite/ }));
    expect(onOpen).toHaveBeenCalledWith("a1");
    expect(screen.getByText("Tarek: their goals support other goals")).toBeInTheDocument();
  });

  it("answers what's due in the row and shows everyone else's plan", async () => {
    render(<TeamPeople year={year} photos={new Map()} cycleId="c" />);
    expect(screen.getByText("2 need you")).toBeInTheDocument();
    expect(screen.getByText("1 goal off track")).toBeInTheDocument();
    expect(screen.getByText("“Lost two people.”")).toBeInTheDocument();
    expect(screen.getByText("2 on track")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Meriem Trabelsi/ })).toHaveAttribute("href", "/core/people/EMP-4?tab=performance");

    await userEvent.click(screen.getByRole("button", { name: "Ask for an update" }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith("/performance/cycles/c/plans/p/attention/ask-for-update", {}));
    await userEvent.click(screen.getByRole("button", { name: /^Book / }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith("/performance/one-on-ones/with/sami/book", { at: "2099-11-12T10:00:00Z" }));
  });
});

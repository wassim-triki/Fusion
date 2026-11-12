// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompetenciesByJobDto, FusionSettingsSection } from "@repo/api";

const m = vi.hoisted(() => ({
  data: undefined as CompetenciesByJobDto | undefined,
  save: vi.fn(),
  draft: vi.fn(),
  read: vi.fn(),
}));

vi.mock("@/features/performance/api/use-performance", () => ({
  useCompetenciesByJob: () => ({ data: m.data, error: null, isLoading: false, refetch: vi.fn() }),
  useCompetencyExpectationMutations: () => ({
    save: { mutateAsync: m.save, isLoading: false },
    draft: { mutateAsync: m.draft, isLoading: false },
    read: { mutateAsync: m.read, isLoading: false },
  }),
  useCompetencyMutations: () => ({
    create: { mutateAsync: vi.fn() },
    update: { mutateAsync: vi.fn() },
    archive: { mutateAsync: vi.fn(), isLoading: false, error: null },
    remove: { mutateAsync: vi.fn(), isLoading: false, error: null },
  }),
}));
vi.mock("../api", () => ({ useRefreshSettingsSections: () => vi.fn() }));
vi.mock("@repo/api/query", () => ({
  useSettingsConflictSaver: () => null,
  useCompanyValues: () => ({ data: [] }),
  useSettingsSections: () => ({ data: undefined, isError: false, refetch: vi.fn() }),
}));

import { CompetenciesSettings } from "./competencies";

const competency = (id: string, name: string) => ({
  id, name, description: `${name} at work.`, behaviors: [], state: "Active" as const, firstUsedAt: null, version: 1, usedIn: [],
});

function grid(written: { competencyId: string; levelId: string; text: string }[] = []): CompetenciesByJobDto {
  return {
    families: [
      {
        id: "eng", label: "Engineering", people: 3,
        levels: [
          { id: "mid", label: "Mid-level", people: 2, example: { employeeId: "a", displayName: "Aicha Ben Ali", photoUrl: null } },
          { id: "senior", label: "Senior", people: 1, example: null },
        ],
      },
    ],
    competencies: [competency("own", "Ownership"), competency("craft", "Craft")],
    expectations: written.map((item) => ({ ...item, familyId: "eng", source: "Written" as const })),
    canDraft: true,
  };
}

const section = (access: "manage" | "view"): FusionSettingsSection =>
  ({ id: "competencies", module: "performance", access, lastChange: null, setUpAt: null }) as unknown as FusionSettingsSection;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Settings › Competencies by job", () => {
  it("opens one competency as a ladder, each level with its people and its words, the empty ones to write", () => {
    m.data = grid([{ competencyId: "own", levelId: "mid", text: "Owns a feature" }, { competencyId: "own", levelId: "senior", text: "Owns a service" }]);
    render(<CompetenciesSettings section={section("manage")} />);

    expect(screen.getByRole("heading", { name: "Engineering, level by level" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ownership" })).toBeTruthy();
    expect(screen.getByText("Owns a feature")).toBeTruthy();
    expect(screen.getByText("Owns a service")).toBeTruthy();
    expect(screen.getByText("2 people")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Craft/ }));
    expect(screen.getByRole("heading", { name: "Craft" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Craft, Mid-level" })).toBeTruthy();
  });

  it("applies a draft one by one, as drafted", async () => {
    m.data = grid([{ competencyId: "own", levelId: "mid", text: "Owns a feature" }]);
    m.draft.mockResolvedValue({ cells: [{ competencyId: "craft", levelId: "mid", text: "Writes tests first" }], fileName: null, of: 0, unread: [] });
    m.save.mockResolvedValue([]);
    render(<CompetenciesSettings section={section("manage")} />);

    fireEvent.click(screen.getByRole("button", { name: "Draft the empty ones" }));
    await screen.findByText("1 draft to look at");
    fireEvent.click(screen.getByRole("button", { name: /^Craft/ }));
    await screen.findByText("Writes tests first");
    expect(screen.getByText("1 draft to look at")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(m.save).toHaveBeenCalledWith({
      familyId: "eng",
      cells: [{ competencyId: "craft", levelId: "mid", text: "Writes tests first", source: "Drafted" }],
    }));
  });

  it("reads your own file and uses all it read at once", async () => {
    m.data = grid([{ competencyId: "own", levelId: "mid", text: "Owns a feature" }]);
    m.read.mockResolvedValue({
      cells: [{ competencyId: "craft", levelId: "mid", text: "Writes tests first" }, { competencyId: "craft", levelId: "senior", text: "Sets the test strategy" }],
      fileName: "framework.xlsx", of: 4, unread: ["Curiosity"],
    });
    m.save.mockResolvedValue([]);
    const { container } = render(<CompetenciesSettings section={section("manage")} />);

    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "framework.xlsx")] } });
    await screen.findByText("2 of 4 read");
    expect(screen.getByText("Not read: Curiosity")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use all 2" }));

    await waitFor(() => expect(m.save).toHaveBeenCalledWith({
      familyId: "eng",
      cells: [
        { competencyId: "craft", levelId: "mid", text: "Writes tests first", source: "File" },
        { competencyId: "craft", levelId: "senior", text: "Sets the test strategy", source: "File" },
      ],
    }));
  });

  it("offers the three ways to start when nothing is written yet", () => {
    m.data = grid();
    render(<CompetenciesSettings section={section("manage")} />);

    expect(screen.getByRole("button", { name: "Draft them from your jobs" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use your own framework" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Write them" })).toBeTruthy();
  });

  it("lets a viewer read without writing, drafting or reading files", () => {
    m.data = grid([{ competencyId: "own", levelId: "mid", text: "Owns a feature" }]);
    render(<CompetenciesSettings section={section("view")} />);

    expect(screen.queryByRole("button", { name: "Draft the empty ones" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Use your own file" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Craft, Mid-level" })).toBeNull();
    expect(screen.queryByText("Write")).toBeNull();
  });
});

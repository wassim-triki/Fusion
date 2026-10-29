// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlignmentTargetDto, CycleSummaryDto, ObjectiveCoachResultDto, PlanObjectiveDto } from "@repo/api";
import { PlanGoalComposer } from "../plan/goal-composer";

const coachObjective = vi.hoisted(() => vi.fn());
const capabilities = vi.hoisted(() => ({ aiAssistance: true }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("../../api/use-performance", () => ({ useApis: () => ({ performance: { coachObjective } }) }));
vi.mock("../../api/use-workspace", () => ({ useWorkspaceContext: () => ({ data: { capabilities } }) }));
vi.mock("@/features/performance/api/performance-failure", () => ({ reportPerformanceFailure: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const cycle = {
  id: "c1", name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31", planningDeadline: "2026-02-01",
  state: "Active", version: 1, description: null, activatedAt: null,
} as CycleSummaryDto;

const talent: AlignmentTargetDto = {
  id: "t-talent", ownershipScope: "OrgUnit", title: "Grow talent", orgUnitName: "Talent Pod",
  accountablePersonId: "p1", accountablePersonName: "Nour Lead", startDate: "2026-01-01", endDate: "2026-12-31",
  directionPath: ["Grow the company", "Grow talent"],
};

function objective(overrides: Partial<PlanObjectiveDto> = {}): PlanObjectiveDto {
  return {
    id: "o1", title: "Improve onboarding", description: null, parentObjectiveId: null, isAligned: true,
    planWeight: 50, startDate: "2026-01-01", endDate: "2026-12-31",
    measurement: { method: "ManualPercentage" }, ...overrides,
  } as unknown as PlanObjectiveDto;
}

const suggested = (overrides: Partial<ObjectiveCoachResultDto> = {}): ObjectiveCoachResultDto => ({
  outcome: "Suggested",
  title: "Cut new-joiner time to productivity to 20 days",
  measure: { method: "NumericTarget", baseline: null, target: 20, unit: "days", direction: "Decrease", milestones: null },
  parentObjectiveId: "t-talent",
  ...overrides,
});

function renderComposer(props: Partial<Parameters<typeof PlanGoalComposer>[0]> = {}) {
  const onUpdate = vi.fn(async () => {});
  render(
    <PlanGoalComposer
      open
      onOpenChange={vi.fn()}
      cycle={cycle}
      targets={[talent]}
      standaloneAllowed
      teamName="Talent Pod"
      objective={objective()}
      otherWeightTotal={50}
      onCreate={vi.fn(async () => {})}
      onUpdate={onUpdate}
      {...props}
    />
  );
  return { onUpdate };
}

async function askCoach() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Suggest improvements/ }));
  });
}

describe("AI coach in the plan composer", () => {
  beforeEach(() => {
    capabilities.aiAssistance = true;
    coachObjective.mockReset();
    toast.error.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("is absent when AI is not available", () => {
    capabilities.aiAssistance = false;
    renderComposer();
    expect(screen.queryByRole("button", { name: /Suggest improvements/ })).toBeNull();
  });

  it("runs once on its own after the title settles, then only on request", async () => {
    coachObjective.mockResolvedValue({ outcome: "NothingToSuggest", title: null, measure: null, parentObjectiveId: null });
    renderComposer();

    await waitFor(() => expect(coachObjective).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(coachObjective.mock.calls[0]?.[1]).toMatchObject({ surface: "Plan", title: "Improve onboarding", measurement: { method: "ManualPercentage" } });

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Improve onboarding for engineers" } });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(coachObjective).toHaveBeenCalledTimes(1);
  });

  it("applies the measure alone, keeps the other suggestions and saves nothing", async () => {
    coachObjective.mockResolvedValue(suggested());
    const { onUpdate } = renderComposer();
    await askCoach();

    const measure = await screen.findByRole("group", { name: "Suggested measure" });
    expect(within(measure).getByText("Number · Decrease · target 20 days")).toBeTruthy();
    fireEvent.click(within(measure).getByRole("button", { name: "Apply suggested measure" }));

    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe("Improve onboarding");
    expect((document.getElementById("me-target") as HTMLInputElement).value).toBe("20");
    // The baseline is the author's to state.
    expect((document.getElementById("me-baseline") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("group", { name: "Suggested title" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Suggested parent" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Suggested measure" })).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("applying a parent in standalone switches the objective to aligned", async () => {
    coachObjective.mockResolvedValue(suggested({ title: null, measure: null }));
    renderComposer({ objective: objective({ isAligned: false }) });
    expect(screen.getByRole("radio", { name: /Standalone role objective/ }).getAttribute("aria-checked")).toBe("true");
    await askCoach();

    fireEvent.click(within(await screen.findByRole("group", { name: "Suggested parent" })).getByRole("button", { name: "Apply suggested parent" }));

    expect(screen.getByRole("radio", { name: /Aligned to direction/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("combobox", { name: "Select organizational objective" }).textContent).toContain("Grow talent");
  });

  it("labels an applied title until the author edits it", async () => {
    coachObjective.mockResolvedValue(suggested({ measure: null, parentObjectiveId: null }));
    renderComposer();
    await askCoach();

    fireEvent.click(within(await screen.findByRole("group", { name: "Suggested title" })).getByRole("button", { name: "Apply suggested title" }));
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe("Cut new-joiner time to productivity to 20 days");
    expect(screen.getByText("AI-suggested")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Cut time to productivity to 18 days" } });
    expect(screen.queryByText("AI-suggested")).toBeNull();
  });

  it("dismisses a suggestion without changing anything", async () => {
    coachObjective.mockResolvedValue(suggested({ measure: null, parentObjectiveId: null }));
    renderComposer();
    await askCoach();

    fireEvent.click(await screen.findByRole("button", { name: "Dismiss suggested title" }));

    expect(screen.queryByRole("group", { name: "Suggested title" })).toBeNull();
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe("Improve onboarding");
  });

  it("says so in one line when there is nothing to suggest", async () => {
    coachObjective.mockResolvedValue({ outcome: "NothingToSuggest", title: null, measure: null, parentObjectiveId: null });
    renderComposer();
    await askCoach();

    expect(await screen.findByText("No suggestions for this objective")).toBeTruthy();
  });

  it("hides quietly when the coach fails", async () => {
    coachObjective.mockRejectedValue(Object.assign(new Error("Suggestions are not available right now."), { status: 503 }));
    renderComposer();
    await askCoach();

    await waitFor(() => expect(screen.queryByRole("button", { name: /Suggest improvements|Suggesting/ })).toBeNull());
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  });
});

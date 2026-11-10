import { formatNumber as formatSharedNumber } from "@repo/ds/lib/numbers";
import type {
  CoachMeasureDto,
  ImprovementDirection,
  MeasurementInput,
  MeasurementMethod,
  ObjectiveCoachResultDto,
} from "@repo/api";
import { parseNumeric } from "../../lib";
import type { MilestoneRow } from "../measurement/milestone-editor";

/** The three parts the coach can suggest, each applied or dismissed on its own. */
export type CoachPart = "title" | "measure" | "parent";

export type CoachSuggestions = {
  title: string | null;
  measure: CoachMeasureDto | null;
  parentObjectiveId: string | null;
};

export type CoachState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ready"; suggestions: CoachSuggestions }
  | { kind: "nothing" }
  /** AI failed or is unavailable: the coach stays out of the way for the rest of the session. */
  | { kind: "hidden" };

export function stateFromResult(result: ObjectiveCoachResultDto): CoachState {
  const suggestions: CoachSuggestions = {
    title: result.title,
    measure: result.measure,
    parentObjectiveId: result.parentObjectiveId,
  };
  return hasAny(suggestions) ? { kind: "ready", suggestions } : { kind: "nothing" };
}

/** Removes one applied or dismissed part; the coach goes quiet once nothing is left. */
export function withoutPart(state: CoachState, part: CoachPart): CoachState {
  if (state.kind !== "ready") return state;
  const next: CoachSuggestions = {
    ...state.suggestions,
    ...(part === "title" ? { title: null } : part === "measure" ? { measure: null } : { parentObjectiveId: null }),
  };
  return hasAny(next) ? { kind: "ready", suggestions: next } : { kind: "idle" };
}

function hasAny(suggestions: CoachSuggestions) {
  return suggestions.title !== null || suggestions.measure !== null || suggestions.parentObjectiveId !== null;
}

const DIRECTION_LABEL: Record<ImprovementDirection, string> = {
  Increase: "Increase",
  Decrease: "Decrease",
};

/** A compact reading of a suggested measure: "Number · Decrease · target 5 days", "3 milestones · 40 / 30 / 30". */
export function measurePreview(measure: CoachMeasureDto): string {
  if (measure.method === "NumericTarget") {
    const parts = ["Number"];
    if (measure.direction) parts.push(DIRECTION_LABEL[measure.direction]);
    const unit = measure.unit ? ` ${measure.unit}` : "";
    const range =
      measure.baseline !== null
        ? `${formatNumber(measure.baseline)} to ${formatNumber(measure.target ?? 0)}${unit}`
        : `target ${formatNumber(measure.target ?? 0)}${unit}`;
    parts.push(range);
    return parts.join(" · ");
  }
  if (measure.method === "WeightedMilestones") {
    const rows = measure.milestones ?? [];
    return `${rows.length} milestone${rows.length === 1 ? "" : "s"} · ${rows.map((row) => formatNumber(row.weight)).join(" / ")}`;
  }
  return "Manual percentage";
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : formatSharedNumber(value, { maximumFractionDigits: 2 });
}

/** The composer's milestone rows for a suggested measure (no dates: the author adds them). */
export function milestoneRows(measure: CoachMeasureDto): MilestoneRow[] {
  return (measure.milestones ?? []).map((row) => ({
    id: crypto.randomUUID(),
    title: row.title,
    weight: String(row.weight),
    dueDate: "",
  }));
}

/**
 * The draft's measure as the composer holds it right now, complete or not, so the coach can judge
 * what is there. Unparseable numbers are sent as missing.
 */
export function draftMeasurement(input: {
  method: MeasurementMethod | null;
  baseline: string;
  target: string;
  unit: string;
  milestones: MilestoneRow[];
}): MeasurementInput | null {
  if (input.method === null) return null;
  if (input.method === "NumericTarget") {
    const baseline = parseNumeric(input.baseline);
    const target = parseNumeric(input.target);
    return {
      method: "NumericTarget",
      baseline: baseline.invalid ? null : baseline.num,
      target: target.invalid ? null : target.num,
      unit: input.unit.trim() || null,
    };
  }
  if (input.method === "WeightedMilestones")
    return {
      method: "WeightedMilestones",
      milestones: input.milestones
        .filter((row) => row.title.trim() !== "")
        .map((row) => ({ title: row.title.trim(), weight: Number(row.weight) || 0 })),
    };
  return { method: "ManualPercentage" };
}

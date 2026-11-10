import type {
  ContributionLinkDto,
  GoalDetailDto,
  GoalNodeDto,
  MeasurementDto,
  ObjectiveProgressSource,
  PersonRefDto,
} from "@repo/api";
import type { ObjectiveRef } from "./objective-ref";
import { english, type Say } from "@/i18n/say";

/**
 * The one shape every objective takes inside the record, whatever its scope. It is built from the
 * canonical objective detail alone (the record never borrows a caller's copy), so an objective reads
 * the same wherever it is opened from, and every action it offers comes from the server's capabilities.
 */
export type ObjectiveRecord = {
  ref: ObjectiveRef;
  kind: "company" | "team" | "plan";
  /** "Company strategic objective", "Talent Pod objective", "Aligned objective"… */
  kindLabel: string;
  title: string;
  description: string | null;
  /** Aligned objectives (and all direction) read in the primary accent; a standalone plan objective in info. */
  accent: "primary" | "info";
  isAligned: boolean;
  status: { label: string; tone: "neutral" | "info" | "success" | "warning" | "muted" };
  accountable: PersonRefDto;
  parent: { ref: ObjectiveRef; title: string; scopeLabel: string; archived: boolean } | null;
  children: GoalNodeDto[];
  measurement: MeasurementDto | null;
  progressSource: ObjectiveProgressSource;
  startDate: string;
  endDate: string;
  /** A plan objective's share of its plan; null for direction. */
  planWeight: number | null;
  /** Execution has begun — the plan is approved, or the direction is published — so progress is meaningful. */
  isExecuting: boolean;
  progress: { has: boolean; derived: number; coverage: number | null };
  contribution: { links: ContributionLinkDto[]; locked: boolean };
  can: {
    edit: boolean;
    publish: boolean;
    archive: boolean;
    remove: boolean;
    updateProgress: boolean;
    readProgressHistory: boolean;
    configureContribution: boolean;
  };
  /** The canonical detail the record was built from, for sections that edit it (contribution). */
  source: GoalDetailDto;
};

/**
 * Where this objective sits on the alignment map: itself when it is published direction; for an aligned
 * personal objective, itself under its parent (`near` is the parent, for when the plan has not been put
 * forward and the objective is not on the map yet). Draft and standalone objectives are not on the map.
 */
export function mapFocusFor(record: ObjectiveRecord): { focus: string; near: string | null } | null {
  if (record.kind === "plan")
    return record.isAligned && record.parent ? { focus: record.ref.objectiveId, near: record.parent.ref.objectiveId } : null;
  return record.source.node.state === "Published" ? { focus: record.ref.objectiveId, near: null } : null;
}

const en = english("objective.model");

export function toObjectiveRecord(detail: GoalDetailDto, say: Say = en): ObjectiveRecord {
  const node = detail.node;
  const kind = node.ownershipScope === "Company" ? "company" : node.ownershipScope === "OrgUnit" ? "team" : "plan";
  const isAligned = node.parentObjectiveId != null;
  const planState = detail.plan?.planState ?? null;

  return {
    ref: { cycleId: detail.cycleId, objectiveId: node.id },
    kind,
    kindLabel:
      kind === "company"
        ? say("kind.company")
        : kind === "team"
          ? say("kind.team", { unit: node.orgUnitName ?? say("organizational") })
          : isAligned
            ? say("kind.aligned")
            : say("kind.standalone"),
    title: node.title,
    description: detail.description,
    accent: kind === "plan" && !isAligned ? "info" : "primary",
    isAligned,
    status:
      kind === "plan"
        ? planState === "Approved"
          ? { label: "Approved", tone: "success" }
          : planState === "Submitted"
            ? { label: "Submitted", tone: "info" }
            : { label: "DraftPlan", tone: "muted" }
        : node.state === "Published"
          ? { label: "Published", tone: "success" }
          : node.state === "Archived" ? { label: "Archived", tone: "muted" } : { label: "Draft", tone: "muted" },
    accountable: detail.accountable,
    parent: detail.parent
      ? {
          ref: { cycleId: detail.cycleId, objectiveId: detail.parent.id },
          title: detail.parent.title,
          scopeLabel: directionScopeLabel(detail.parent, say),
          archived: detail.parent.state === "Archived",
        }
      : null,
    children: detail.children,
    measurement: detail.measurement,
    progressSource: node.progressSource,
    startDate: node.startDate,
    endDate: node.endDate,
    planWeight: kind === "plan" ? (detail.plan?.planWeight ?? null) : null,
    isExecuting: kind === "plan" ? planState === "Approved" : node.state !== "Draft",
    progress: { has: node.hasProgress, derived: node.derivedProgress, coverage: node.progressCoverage },
    contribution: { links: detail.contribution, locked: node.isContributionBaselineLocked },
    can: {
      edit: detail.canEdit,
      publish: detail.canPublish,
      archive: detail.canArchive,
      remove: detail.canDelete,
      updateProgress: detail.canUpdateProgress,
      readProgressHistory: detail.canReadProgressHistory,
      configureContribution: detail.canConfigureContribution,
    },
    source: detail,
  };
}

/** Where a direction objective sits: company strategy, or the unit that owns it. */
export function directionScopeLabel(node: Pick<GoalNodeDto, "ownershipScope" | "orgUnitName">, say: Say = en): string {
  return node.ownershipScope === "Company" ? say("companyStrategy") : (node.orgUnitName ?? say("organizational"));
}

export type RecordSectionId =
  | "hero"
  | "status"
  | "story"
  | "units"
  | "description"
  | "contribution"
  | "feedback";

/** One row of the record's body: a section on its own, or two read side by side. */
export type RecordSectionRow = RecordSectionId | readonly [RecordSectionId, RecordSectionId];

/**
 * Which sections this record shows, in reading order (D-83): the goal's year against its pace, the owner's state for the
 * reviewer to acknowledge, then its story of updates (a person's goal) or the units carrying it (direction), its words, how it's
 * calculated, and feedback about it. A section appears only when it has something true to say.
 */
export function resolveSections(record: ObjectiveRecord): RecordSectionRow[] {
  const rows: RecordSectionRow[] = ["hero"];
  // The owner's state already reads in the head and the story; the reviewer acknowledges a risky one here.
  if (record.source.status && record.source.canAcknowledgeStatus) rows.push("status");
  if (record.kind === "plan") rows.push("story");
  else if (record.children.length > 0) rows.push("units");
  if (record.description) rows.push("description");
  if (record.progressSource === "Calculated") rows.push("contribution");
  // Feedback about the objective (D-13): there's always an action for a person, the owner's or anyone else's.
  if (record.source.canGiveFeedback || record.source.canAskForFeedback) rows.push("feedback");
  return rows;
}

export function measureLabel(measurement: MeasurementDto | null, say: Say = en): string {
  if (!measurement) return "—";
  if (measurement.method === "NumericTarget") {
    if (measurement.unit === "%") return say("measure.percentage");
    return measurement.unit ? say("measure.in", { unit: measurement.unit }) : say("measure.numeric");
  }
  if (measurement.method === "WeightedMilestones") {
    return say("measure.milestones", { count: measurement.milestones.length });
  }
  return say("measure.single");
}

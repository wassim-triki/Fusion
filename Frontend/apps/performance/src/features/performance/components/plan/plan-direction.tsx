"use client";

import { useMemo } from "react";
import { Landmark, SquareArrowEnter } from "@/lib/icons";
import type { AlignmentTargetDto, PlanDecisionDto, PlanObjectiveDto } from "@repo/api";
import { Avatar, AvatarFallback } from "@repo/ds/components/ui/avatar";
import { ScopeMark } from "../scope-mark";
import { useObjectiveRecord } from "../objective-record/use-objective-record";
import { SidebarSection } from "./plan-layout";
import { initials } from "./plan-lib";

import { useWorkforceMe } from "../../api/use-workforce-me";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";
import { useSay } from "@repo/ds/lib/say";
import { english, type Say } from "@/i18n/say";

export interface DirectionLevel {
  key: string;
  scope: string;
  title: string;
}

/**
 * The plan's direction as a sidebar property: the objective the plan serves, linked down a quiet
 * connector to the objective it supports, each with its scope. Same resolution as the banner; read-only,
 * each level opens its objective in the objective record. Renders nothing when there is no direction yet.
 */
export function PlanDirectionSection({
  cycleId,
  objectives,
  targets,
  directionLevels,
}: {
  cycleId: string;
  objectives: PlanObjectiveDto[];
  targets: AlignmentTargetDto[];
  directionLevels?: DirectionLevel[];
}) {
  const tr = useTranslations("plan.PlanDirectionSection");
  const words = useSay("common.words");
  const derived = useMemo(() => resolveDirection(objectives, targets, words), [objectives, targets, words]);
  const levels = (directionLevels ?? derived).slice(0, 2);
  const idByTitle = useMemo(() => new Map(targets.map((t) => [t.title, t.id])), [targets]);
  const record = useObjectiveRecord();
  // The rail keeps its sections in every state, so an undirected plan still says so.
  if (levels.length === 0) {
    return (
      <SidebarSection label={tr("direction")}>
        <p className="mt-3 type-body text-muted-foreground">{tr("noDirectionLinkedYet")}</p>
      </SidebarSection>
    );
  }

  return (
    <SidebarSection label={tr("direction")}>
      <ol className="mt-4">
        {levels.map((level, index) => {
          const leading = index === 0;
          const objectiveId = idByTitle.get(level.title);
          return (
            <li key={level.key} className="relative flex gap-3 pb-5 last:pb-0">
              {index < levels.length - 1 ? (
                <span className="absolute bottom-0 inset-s-4 top-9 w-px -translate-x-1/2 rtl:translate-x-1/2 bg-border" aria-hidden />
              ) : null}
              <span
                className={
                  leading
                    ? "flex size-8 shrink-0 items-center justify-center rounded-control bg-primary-tint text-primary-ink ring-1 ring-primary-ring"
                    : "flex size-8 shrink-0 items-center justify-center rounded-control border border-border text-muted-foreground"
                }
              >
                {leading ? <ScopeMark className="size-5" /> : <Landmark className="size-4" aria-hidden />}
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className={leading ? "type-subsection-title leading-snug text-foreground" : "type-body leading-snug text-foreground/85"}>
                  {level.title}
                </p>
                <p className="mt-0.5 type-meta text-muted-foreground">{level.scope}</p>
              </div>
              {objectiveId ? (
                <button
                  type="button"
                  onClick={() => record.open({ cycleId, objectiveId })}
                  aria-label={tr("open", { title: level.title })}
                  className="flex size-7 shrink-0 items-center justify-center rounded-detail text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <SquareArrowEnter className="size-4 -scale-x-100" aria-hidden />
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
    </SidebarSection>
  );
}

// Approval is stated (with its date) by the Approved & locked section, so only a return is named here.
const DECISION_LABEL: Partial<Record<PlanDecisionDto["kind"], "returned">> = { Returned: "returned" };

/**
 * Who holds the plan's agreement: the reviewer's identity, how they relate to the employee (their own
 * manager, when the workforce record says so), a direct line to reach them, and — once they have acted
 * on this plan — their latest decision. Only facts; nothing the rest of the page already states.
 */
export function PlanReviewerSection({
  reviewerId,
  reviewerName,
  history = [],
}: {
  reviewerId?: string | null;
  reviewerName: string | null;
  history?: PlanDecisionDto[];
}) {
  const format = useFormat();
  const t = useTranslations("plan.PlanReviewerSection");
  const me = useWorkforceMe(Boolean(reviewerName));
  if (!reviewerName) {
    return (
      <SidebarSection label={t("reviewer")}>
        <p className="mt-3 type-body text-muted-foreground">{t("noReviewerAssigned")}</p>
      </SidebarSection>
    );
  }

  const manager = me.data?.employee?.manager ?? null;
  const isManager = Boolean(manager && reviewerId && manager.employeeId === reviewerId);
  const email = isManager ? manager?.email ?? null : null;
  const lastDecision = [...history].reverse().find((h) => DECISION_LABEL[h.kind] && (!reviewerId || h.actorEmployeeId === reviewerId));

  return (
    <SidebarSection label={t("reviewer")}>
      <div className="mt-4 flex items-center gap-3">
        <Avatar className="size-10">
          <AvatarFallback hue={reviewerName} className="type-meta">{initials(reviewerName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate type-subsection-title text-foreground">{reviewerName}</p>
          {email ? (
            <a
              href={`mailto:${email}`}
              className="block truncate rounded-detail type-meta text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {email}
            </a>
          ) : null}
        </div>
      </div>

      {lastDecision ? (
        <dl className="mt-4 flex items-baseline justify-between gap-3 type-body">
          <dt className="text-muted-foreground">{t(DECISION_LABEL[lastDecision.kind]!)}</dt>
          <dd className="shrink-0 tabular-nums text-foreground/85">{format.date(lastDecision.decidedAt.slice(0, 10))}</dd>
        </dl>
      ) : null}
    </SidebarSection>
  );
}

/**
 * The plan's supported direction as a deepest-first chain of {scope, title}. Built from the longest
 * upstream path among the aligned objectives (the deepest connection the plan makes), with each
 * ancestor title matched to a published alignment target to recover its scope label.
 */
function resolveDirection(
  objectives: PlanObjectiveDto[],
  targets: AlignmentTargetDto[],
  say: Say
): DirectionLevel[] {
  const deepest = objectives
    .filter((o) => o.isAligned && o.directionPath.length > 0)
    .sort((a, b) => b.directionPath.length - a.directionPath.length)[0];
  if (!deepest) return [];

  const scopeByTitle = new Map<string, string>();
  for (const target of targets) {
    scopeByTitle.set(
      target.title,
      target.ownershipScope === "Company"
        ? say("companyStrategy")
        : (target.orgUnitName ?? say("organizational"))
    );
  }

  // directionPath is top-down (company → nearest); reverse so the employee's own level leads.
  return deepest.directionPath
    .map((title, index) => ({
      key: `${index}-${title}`,
      scope: scopeByTitle.get(title) ?? say("direction"),
      title,
    }))
    .reverse();
}

/**
 * The direction an employee will plan against before any objective exists: the published objective
 * owned at their own org unit leads (their focus area), with its nearest parent named as what it
 * supports. Falls back to the deepest published objective when no target matches their unit. This
 * mirrors what {@link resolveDirection} recovers from a plan's aligned objectives.
 */
export function directionFromTargets(
  targets: AlignmentTargetDto[],
  orgUnitName: string | null | undefined,
  say: Say = english("common.words")
): DirectionLevel[] {
  if (targets.length === 0) return [];

  const scopeLabel = (t: AlignmentTargetDto) =>
    t.ownershipScope === "Company"
      ? say("companyStrategy")
      : (t.orgUnitName ?? say("organizational"));
  const scopeByTitle = new Map<string, string>();
  for (const t of targets) scopeByTitle.set(t.title, scopeLabel(t));

  const own = orgUnitName
    ? targets.find((t) => t.orgUnitName === orgUnitName)
    : undefined;
  const leading =
    own ??
    [...targets].sort(
      (a, b) => b.directionPath.length - a.directionPath.length
    )[0];
  if (!leading) return [];

  const levels: DirectionLevel[] = [
    {
      key: `own-${leading.id}`,
      scope: scopeLabel(leading),
      title: leading.title,
    },
  ];
  const parentTitle = leading.directionPath.at(-1);
  if (parentTitle) {
    levels.push({
      key: `parent-${parentTitle}`,
      scope: scopeByTitle.get(parentTitle) ?? "Direction",
      title: parentTitle,
    });
  }
  return levels;
}

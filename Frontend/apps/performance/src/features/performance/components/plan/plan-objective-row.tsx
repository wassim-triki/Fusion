"use client";

import {
  formatMilestoneDue,
  isMilestoneOverdue,
  milestoneSchedule,
} from "../measurement/milestone-due";
import {
  SquareArrowEnter,
  CalendarRange,
  LineChart,
  MoreHorizontal,
  SquarePen,
  Target,
  Trash2,
  Unlink,
  Measurement,
  Milestones,
  NumericGoal,
  PercentMeasure,
} from "@/lib/icons";
import { TargetRange } from "./target-range";
import type { ReactNode } from "react";
import type { PlanObjectiveDto } from "@repo/api";
import { ObjectiveStatusBadge } from "@repo/performance-ui";
import { Button } from "@repo/ds/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ds/components/ui/dropdown-menu";
import { cn } from "@repo/ds/lib/utils";
import { formatDateRange } from "../../lib";
import {
  PROGRESS_TONE_BG,
  PROGRESS_TONE_TEXT,
  formatMeasureValue,
  objectiveProgressTone,
  pct,
} from "./plan-lib";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";
import { useSay } from "@repo/ds/lib/say";

/**
 * One objective inside a plan, read as a numbered ledger row rather than a nested card. The title and
 * its alignment lead; a quiet metadata line beneath (measurement, its target, duration) makes the
 * objective legible without reopening the editor; the plan weight is the emphasized figure. Authoring
 * actions live behind a single overflow menu so the reading rhythm stays clean, and the same row
 * serves the manager's read-only review (no menu) and a locked plan's progress (a track appears).
 */
export function PlanObjectiveRow({
  objective,
  alignmentScope,
  showProgress = false,
  active = false,
  onEdit,
  onRemove,
  onOpenProgress,
  onViewDetails,
  onViewAlignment,
  cycle,
  executionAside,
  footer,
}: {
  objective: PlanObjectiveDto;
  /** Resolved scope label of the aligned parent (e.g. "Talent Pod"); falls back to the parent title. */
  alignmentScope?: string;
  showProgress?: boolean;
  /** This row's detail drawer is open — the row lifts to the accent to anchor the inspected objective. */
  active?: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  onOpenProgress?: () => void;
  /** Opens the objective's detail surface. Shown on the reading/authoring rows (not the progress row). */
  onViewDetails?: () => void;
  /** Opens the aligned parent objective's details. */
  onViewAlignment?: (parentId: string) => void;
  /** The plan's cycle window: the year is left to the cycle when the objective sits inside it. */
  cycle?: { startDate: string; endDate: string };
  /** Beside the execution band's actions: an update request's marker or the request action. */
  executionAside?: ReactNode;
  /** Under everything, inside the card: a change request on this objective. */
  footer?: ReactNode;
}) {
  const t = useTranslations("plan.PlanObjectiveRow");
  const words = useSay("common.words");
  const duration = formatObjectiveDuration(objective.startDate, objective.endDate, cycle);
  const weight = objective.planWeight ?? 0;
  const progress = objective.derivedProgress;
  const capped = Math.min(progress, 100);
  const tone = objectiveProgressTone(objective.isAligned, progress);
  const canAuthor = Boolean(onEdit || onRemove);
  const measurement = objective.measurement;

  // An employee objective aligns to an objective, not to an OrgUnit: name the parent objective, keep
  // the owning unit as secondary context.
  const parentObjective = objective.directionPath.at(-1);

  return (
    <div
      // The objective's type accent for everything inside that marks it: amber aligned, blue standalone.
      style={
        {
          "--type-accent": objective.isAligned
            ? "var(--primary)"
            : "var(--info)",
        } as React.CSSProperties
      }
      className={cn(
        "rounded-surface border p-5 transition-colors",
        !active
          ? "border-border bg-card"
          : objective.isAligned
            ? "border-primary/60 bg-card ring-1 ring-primary/25"
            : "border-info/60 bg-card ring-1 ring-info/25"
      )}
    >
      {/* Top line: identity + weight + actions. */}
      <div className="flex items-start gap-4">
        {/* Objectives aren't a sequence: no numbered marker (DESIGN §9); the alignment line below tells them apart. */}
        <div className="min-w-0 flex-1">
          {onViewDetails ? (
            <button
              type="button"
              onClick={onViewDetails}
              // eslint-disable-next-line no-restricted-syntax -- the title opens this objective in the side panel; pressed marks the one open
              aria-pressed={active}
              className="rounded-control text-start font-medium tracking-tight text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {objective.title}
            </button>
          ) : (
            <p className="font-medium tracking-tight text-foreground">
              {objective.title}
            </p>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 type-meta text-muted-foreground">
            {objective.isAligned ? (
              <>
                <Target className="size-4 shrink-0 text-primary-ink" aria-hidden />
                <span>
                  {t("alignedTo")}
                  {onViewAlignment && objective.parentObjectiveId ? (
                    <button
                      type="button"
                      onClick={() =>
                        onViewAlignment(objective.parentObjectiveId!)
                      }
                      className="rounded-control font-medium text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {parentObjective ?? t("direction")}
                    </button>
                  ) : (
                    <span className="font-medium text-primary-ink">
                      {parentObjective ?? t("direction")}
                    </span>
                  )}
                </span>
                {alignmentScope ? (
                  <span className="text-muted-foreground/70">
                    · {alignmentScope}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-info">
                <Unlink className="size-4 shrink-0" aria-hidden />
                {t("standaloneRoleObjective")}
              </span>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-start gap-1">
          {canAuthor ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("actionsFor", { title: objective.title })}
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onEdit ? (
                  <DropdownMenuItem onSelect={onEdit}>
                    <SquarePen className="size-3.5" /> {t("editObjective")}
                  </DropdownMenuItem>
                ) : null}
                {onRemove ? (
                  <DropdownMenuItem onSelect={onRemove} variant="destructive">
                    <Trash2 className="size-3.5" /> {t("removeObjective")}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : onViewDetails ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onViewDetails}
              aria-label={t("view", { title: objective.title })}
              className="text-muted-foreground hover:text-foreground"
            >
              <SquareArrowEnter className="size-4 -scale-x-100" />
            </Button>
          ) : null}
        </div>
      </div>

      {/* Metadata line: measurement, its target, duration — separated cells, only ones that carry meaning.
          The inspect affordance closes the row on the reading/authoring states. */}
      <div className="mt-4 flex items-end gap-3 ps-14">
        <dl className="flex min-w-0 flex-1 flex-col gap-3 type-body sm:flex-row sm:gap-0 sm:divide-x sm:divide-border">
          <MetaCell icon={Measurement} label={t("measurement")}>
            {measurement ? words(`method.${measurement.method}`) : "—"}
          </MetaCell>

          {measurement?.method === "NumericTarget" ? (
            <MetaCell icon={NumericGoal} label={t("target")}>
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <TargetRange
                  baseline={measurement.baseline}
                  target={measurement.target}
                  unit={measurement.unit}
                  direction={measurement.direction}
                />
              </span>
            </MetaCell>
          ) : measurement?.method === "WeightedMilestones" ? (
            <MetaCell icon={Milestones} label={t("milestones")}>
              <MilestoneStrip milestones={measurement.milestones} />
            </MetaCell>
          ) : (
            <MetaCell icon={PercentMeasure} label={t("measure")}>
              {t("singlePercentage")}
            </MetaCell>
          )}

          <MetaCell icon={CalendarRange} label={t("duration")}>
            {cycle ? (
              <CycleWindow start={objective.startDate} end={objective.endDate} cycle={cycle} />
            ) : (
              duration
            )}
          </MetaCell>
        </dl>
        <div className="shrink-0 text-end">
          <p className="type-meta text-muted-foreground/70">{t("weight")}</p>
          <p
            className={cn(
              "mt-1 type-section-title tabular-nums leading-none",
              weight <= 0
                ? "text-muted-foreground/50"
                : objective.isAligned
                  ? "text-primary-ink"
                  : "text-info"
            )}
          >
            {pct(weight)}%
          </p>
        </div>
      </div>

      {/* Execution row for a locked plan: the approved measurement, its latest reported truth, and the
          two actions. Missing progress reads as missing (a dash and "not reported yet"), never as 0%. */}
      {showProgress ? (
        <div className="mt-4 flex items-center gap-4 border-t border-border/60 pt-4">
          <ExecutionState objective={objective} tone={tone} capped={capped} />

          <ObjectiveStatusBadge status={objective.status} className="shrink-0" />

          <div className="flex shrink-0 items-center gap-1.5">
            {executionAside}
            {onOpenProgress ? (
              objective.canUpdateProgress ? (
                <Button variant="outline" size="sm" onClick={onOpenProgress}>
                  <LineChart className="size-3.5" data-icon="inline-start" />{t("updateProgress")}
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={onOpenProgress}>
                  {t("view2")}
                </Button>
              )
            ) : null}
          </div>
        </div>
      ) : null}

      {footer ? <div className="mt-4 border-t border-border/60 pt-4">{footer}</div> : null}
    </div>
  );
}

/**
 * The milestones' structure: one segment each, sized by its weight, beside a plain count. Structure only —
 * it reads the same in every plan state; completion belongs to the execution band, which segments its
 * progress bar the same way. Milestone weights always total 100%, so the total is never stated.
 */
function MilestoneStrip({ milestones }: { milestones: { weight: number; isCompleted: boolean }[] }) {
  const t = useTranslations("plan.MilestoneStrip");
  // Completed milestones fill in the objective's colour; open ones stay as track.
  const done = milestones.filter((m) => m.isCompleted).length;
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="flex h-1.5 w-20 gap-0.5" aria-hidden>
        {milestones.map((m, i) => (
          <span
            key={i}
            className={cn(
              "h-full rounded-full",
              m.isCompleted ? "bg-[var(--type-accent,var(--primary))]" : "bg-muted-foreground/20"
            )}
            style={{ flexGrow: Math.max(m.weight, 1) }}
          />
        ))}
      </span>
      <span className="tabular-nums">
        {done > 0 ? t("ofDone", { done, length: milestones.length }) : (milestones.length === 1 ? t("milestone", { length: milestones.length }) : t("milestones", { length: milestones.length }))}
      </span>
    </span>
  );
}

/**
 * The measurement-aware current-state block: a full-width progress meter over its own vocabulary —
 * numeric shows the raw current value (distinct from the derived progress the bar fills to); manual
 * shows the reported percentage; weighted milestones show completion truth. Missing progress never
 * coerces to 0% — the bar stays empty and it reads as not reported yet.
 */
function ExecutionState({
  objective,
  tone,
  capped,
}: {
  objective: PlanObjectiveDto;
  tone: ReturnType<typeof objectiveProgressTone>;
  capped: number;
}) {
  const format = useFormat();
  const t = useTranslations("plan.ExecutionState");
  const measurement = objective.measurement;
  const method = measurement?.method;
  const has = objective.hasProgress;
  const updated = objective.lastProgressAt
    ? format.date(objective.lastProgressAt.slice(0, 10))
    : null;

  let label: string;
  let value: React.ReactNode;
  if (method === "WeightedMilestones") {
    const total = measurement?.milestones.length ?? 0;
    const done =
      measurement?.milestones.filter((m) => m.isCompleted).length ?? 0;
    const schedule = milestoneSchedule(measurement?.milestones ?? []);
    label = t("milestoneProgress");
    value = (
      <span className="tabular-nums">
        <span
          className={has ? PROGRESS_TONE_TEXT[tone] : "text-muted-foreground/60"}
        >
          {t("ofMilestone", { done, total })}{total === 1 ? "" : t("s")}{" "}
          {has ? t("completed") : t("updated")}
        </span>
        {schedule.overdue > 0 ? (
          <span className="font-medium text-destructive">
            {t("overdue", { overdue: schedule.overdue })}
          </span>
        ) : schedule.nextDue ? (
          <span className="text-muted-foreground">
            {t("nextDue", { nextDue: formatMilestoneDue(schedule.nextDue) })}
          </span>
        ) : null}
      </span>
    );
  } else if (method === "ManualPercentage") {
    label = t("currentProgress");
    value = has ? (
      <span className={cn("tabular-nums", PROGRESS_TONE_TEXT[tone])}>
        {pct(objective.currentPercentage ?? 0)}%
      </span>
    ) : (
      <span className="text-muted-foreground/50">—</span>
    );
  } else {
    label = t("currentValue");
    value = has ? (
      <span className={cn("tabular-nums", PROGRESS_TONE_TEXT[tone])}>
        {formatMeasureValue(objective.currentActual, measurement?.unit ?? null)}
      </span>
    ) : (
      <span className="text-muted-foreground/50">—</span>
    );
  }

  return (
    <div className="min-w-0 flex-1">
      <p className="type-meta text-muted-foreground/70">{label}</p>
      {method === "WeightedMilestones" && measurement ? (
        // Same segments as the Milestones fact above (sized by weight); completed ones fill.
        <div className="mt-2 flex h-2.5 w-full gap-1" aria-hidden>
          {measurement.milestones.map((m, i) => (
            <span
              key={i}
              className={cn(
                "h-full rounded-full",
                m.isCompleted
                  ? PROGRESS_TONE_BG[tone]
                  : isMilestoneOverdue(m)
                    ? "bg-destructive"
                    : "bg-muted-foreground/15"
              )}
              style={{ flexGrow: Math.max(m.weight, 1) }}
            />
          ))}
        </div>
      ) : (
        <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-muted-foreground/15">
          {has ? (
            <span
              className={cn(
                "block h-full rounded-full",
                PROGRESS_TONE_BG[tone]
              )}
              style={{ width: `${capped}%` }}
            />
          ) : null}
        </div>
      )}
      {has ? (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="type-subsection-title">{value}</span>
          {updated ? <span className="type-meta text-muted-foreground">{t("updated2", { updated })}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function MetaCell({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Target;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 sm:px-5 sm:first:ps-0">
      <dt className="flex items-center gap-1.5 type-meta text-muted-foreground/70">
        <Icon className="size-4 shrink-0" aria-hidden />
        {label}
      </dt>
      <dd className="mt-1 whitespace-nowrap text-foreground">{children}</dd>
    </div>
  );
}

function formatObjectiveDuration(
  start: string,
  end: string,
  cycle: { startDate: string; endDate: string } | undefined
): string {
  if (!cycle) return formatDateRange(start, end);
  const year = cycle.startDate.slice(0, 4);
  const sameYear = cycle.endDate.slice(0, 4) === year && start.startsWith(year) && end.startsWith(year);
  return formatDateRange(start, end, { omitYear: sameYear });
}


/**
 * The objective's window drawn on its cycle: the track is the cycle, the fill is when this objective
 * runs (darker for the time already spent), and a tick marks today. A full-cycle objective reads as a full bar; a shorter one shows where it
 * sits at a glance. Exact dates frame the bar and the full range is the accessible label.
 */
function CycleWindow({
  start,
  end,
  cycle,
}: {
  start: string;
  end: string;
  cycle: { startDate: string; endDate: string };
}) {
  const format = useFormat();
  const day = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`).getTime();
  const from = day(cycle.startDate);
  const span = Math.max(day(cycle.endDate) - from, 1);
  const at = (t: number) => Math.min(Math.max(((t - from) / span) * 100, 0), 100);
  const left = at(day(start));
  const right = at(day(end));
  const today = at(Date.now());
  const inCycle = Date.now() >= from && Date.now() <= from + span;
  const elapsed = Math.min(today, right);
  const label = formatObjectiveDuration(start, end, cycle);

  return (
    <span className="flex items-center gap-2 tabular-nums" title={label}>
      <span className="sr-only">{label}</span>
      <span className="type-meta text-muted-foreground" aria-hidden>
        {format.date(start.slice(0, 10))}
      </span>
      <span className="relative h-1.5 w-20 shrink-0 rounded-full bg-muted-foreground/10" aria-hidden>
        {/* The window, neutral so it never reads as progress: time already spent is solid, the rest faint. */}
        <span
          className="absolute inset-y-0 rounded-full bg-foreground/20"
          style={{ left: `${left}%`, width: `${Math.max(right - left, 3)}%` }}
        />
        {elapsed > left ? (
          <span
            className="absolute inset-y-0 rounded-full bg-foreground/55"
            style={{ left: `${left}%`, width: `${elapsed - left}%` }}
          />
        ) : null}
        {inCycle ? (
          <span
            className="absolute top-1/2 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-card"
            style={{ left: `${today}%` }}
          />
        ) : null}
      </span>
      <span className="type-meta text-muted-foreground" aria-hidden>
        {format.date(end.slice(0, 10))}
      </span>
    </span>
  );
}

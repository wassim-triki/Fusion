"use client";

import { CalendarRange } from "@repo/ds/icons";
import type { CyclePhase, CycleSummaryDto } from "@repo/api";
import { StatusBadge, type StatusTone } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";

const STATE_TONE: Record<CycleSummaryDto["state"], StatusTone> = {
  Draft: "info",
  Active: "success",
  Closed: "muted",
};

/** Today as a `YYYY-MM-DD` local date, comparable with DateOnly strings from the API. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The persistent Cycle context every Performance route sits inside — which Cycle, its state, its
 * horizon, and (while it still matters) its planning deadline. Rendered once in the module top bar,
 * a single quiet line that orients without competing with the page title. On narrow widths it
 * collapses to identity alone (the page carries the state).
 */
export function CycleContextBar({
  cycle,
  phase,
  className,
}: {
  cycle: CycleSummaryDto;
  /** The Active Cycle's derived phase; shown in place of "Active" when known. */
  phase?: CyclePhase | null;
  className?: string;
}) {
  const format = useFormat();
  const t = useTranslations("common.CycleContextBar");
  // The planning deadline is guidance only while planning is still open; once it has passed (or the
  // Cycle is not running) it drops out rather than showing a stale date.
  const showPlanningDeadline = cycle.state === "Active" && phase !== "Review" && cycle.planningDeadline >= todayIso();

  return (
    <div className={cn("flex min-w-0 items-center gap-x-2.5 type-body", className)}>
      <span className="truncate font-medium text-foreground">{cycle.name}</span>
      <StatusBadge tone={STATE_TONE[cycle.state]} dot className="hidden shrink-0 sm:inline-flex">
        {cycle.state === "Active" && phase ? t(`phase.${phase}`) : t(`state.${cycle.state}`)}
      </StatusBadge>
      <span aria-hidden className="hidden text-border md:inline">|</span>
      <span className="hidden shrink-0 items-center gap-1.5 text-muted-foreground md:inline-flex">
        <CalendarRange className="size-3.5" aria-hidden />
        {format.range(cycle.startDate, cycle.endDate)}
      </span>
      {showPlanningDeadline ? (
        <>
          <span aria-hidden className="hidden text-border lg:inline">|</span>
          <span className="hidden shrink-0 text-muted-foreground lg:inline">
            {t("planningBy")} <span className="text-foreground/80">{format.date(cycle.planningDeadline)}</span>
          </span>
        </>
      ) : null}
    </div>
  );
}

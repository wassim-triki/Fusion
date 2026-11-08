"use client";

import { ChevronRight, LineChart, MoreHorizontal, SquarePen, Target, Trash2, Unlink } from "@/lib/icons";
import type { ReactNode } from "react";
import type { PlanObjectiveDto } from "@repo/api";
import { ObjectiveStatusBadge } from "@repo/performance-ui";
import { Button } from "@repo/ds/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@repo/ds/components/ui/dropdown-menu";
import { cn } from "@repo/ds/lib/utils";
import { PROGRESS_TONE_BG, PROGRESS_TONE_TEXT, objectiveProgressTone, pct } from "./plan-lib";
import { useTranslations } from "next-intl";

/**
 * One objective in a plan's list, as a row inside the Objectives section (B-228). The title and its alignment lead;
 * on a locked plan its progress and status follow; the plan weight closes the row. The rich detail (measurement,
 * target, window, check-ins) lives in the objective record, which the row opens beside the list. Authoring actions
 * sit behind one overflow menu, and the same row serves the reviewer's read-only view.
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
  executionAside,
  footer,
}: {
  objective: PlanObjectiveDto;
  /** Resolved scope label of the aligned parent (e.g. "Talent Pod"). */
  alignmentScope?: string;
  /** A locked plan: the row shows the objective's progress and status. */
  showProgress?: boolean;
  /** This row's record is open beside the list. */
  active?: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  /** Opens the record in its progress task; offered when the viewer can record progress. */
  onOpenProgress?: () => void;
  /** Opens the objective's record. */
  onViewDetails?: () => void;
  /** Opens the aligned parent objective's record. */
  onViewAlignment?: (parentId: string) => void;
  /** Beside the alignment line: an update request's marker or the request action. */
  executionAside?: ReactNode;
  /** Under the row: a change request on this objective. */
  footer?: ReactNode;
}) {
  const t = useTranslations("plan.PlanObjectiveRow");
  const weight = objective.planWeight ?? 0;
  const progress = objective.derivedProgress;
  const tone = objectiveProgressTone(objective.isAligned, progress);
  const canAuthor = Boolean(onEdit || onRemove);
  const parentObjective = objective.directionPath.at(-1);

  return (
    <li className={cn("transition-colors", active ? "bg-inlay/50 ring-1 ring-inset ring-primary-ring" : "hover:bg-inlay/40")}>
      <div className="relative flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3.5 sm:flex-nowrap">
        <div className="min-w-0 flex-1">
          {onViewDetails ? (
            <button
              type="button"
              onClick={onViewDetails}
              // eslint-disable-next-line no-restricted-syntax -- the row opens this objective in the side panel; pressed marks the one open
              aria-pressed={active}
              // The title's hit area covers the row; the row's own buttons sit above it.
              className="text-start type-label text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
            >
              {objective.title}
            </button>
          ) : (
            <p className="type-label text-foreground">{objective.title}</p>
          )}
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <p className="flex min-w-0 items-center gap-1.5 type-meta text-muted-foreground">
            {objective.isAligned ? (
              <>
                <Target className="size-3.5 shrink-0 text-primary-ink" aria-hidden />
                <span className="min-w-0 truncate">
                  {t("alignedTo")}{" "}
                  {onViewAlignment && objective.parentObjectiveId ? (
                    <button
                      type="button"
                      onClick={() => onViewAlignment(objective.parentObjectiveId!)}
                      className="relative z-10 rounded-control font-medium text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {parentObjective ?? t("direction")}
                    </button>
                  ) : (
                    <span className="font-medium text-primary-ink">{parentObjective ?? t("direction")}</span>
                  )}
                  {alignmentScope ? <span className="text-muted-foreground/70"> · {alignmentScope}</span> : null}
                </span>
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-info">
                <Unlink className="size-3.5 shrink-0" aria-hidden />
                {t("standaloneRoleObjective")}
              </span>
            )}
          </p>
          {executionAside ? <span className="relative z-10 flex items-center gap-1.5">{executionAside}</span> : null}
          </div>
        </div>

        {showProgress ? (
          <div className="flex shrink-0 items-center gap-4">
            <span className="flex w-32 items-center gap-2" title={t("progress")}>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted-foreground/15" aria-hidden>
                {objective.hasProgress ? (
                  <span className={cn("block h-full rounded-full", PROGRESS_TONE_BG[tone])} style={{ width: `${Math.min(progress, 100)}%` }} />
                ) : null}
              </span>
              <span className={cn("w-10 text-end type-meta-strong tabular-nums", objective.hasProgress ? PROGRESS_TONE_TEXT[tone] : "text-muted-foreground/60")}>
                {objective.hasProgress ? `${pct(progress)}%` : "–"}
                <span className="sr-only"> {t("progress")}</span>
              </span>
            </span>
            <span className="hidden w-24 md:flex">
              <ObjectiveStatusBadge status={objective.status} />
            </span>
          </div>
        ) : null}

        <span
          className={cn(
            "w-12 shrink-0 text-end type-label tabular-nums",
            weight <= 0 ? "text-muted-foreground/50" : objective.isAligned ? "text-primary-ink" : "text-info"
          )}
        >
          {pct(weight)}%<span className="sr-only"> {t("weight")}</span>
        </span>

        <div className="relative z-10 flex shrink-0 items-center gap-1">
          {onOpenProgress && objective.canUpdateProgress ? (
            <Button variant="ghost" size="icon-sm" onClick={onOpenProgress} aria-label={t("updateProgressFor", { title: objective.title })} title={t("updateProgress")}>
              <LineChart className="size-4" aria-hidden />
            </Button>
          ) : null}
          {canAuthor ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t("actionsFor", { title: objective.title })}>
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
            <ChevronRight className="size-4 text-muted-foreground rtl:-scale-x-100" aria-hidden />
          ) : null}
        </div>
      </div>

      {footer ? <div className="px-5 pb-4">{footer}</div> : null}
    </li>
  );
}

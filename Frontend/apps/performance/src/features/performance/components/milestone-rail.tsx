"use client";

import { Check } from "@repo/ds/icons";
import type { MilestoneStateDto } from "@repo/api";
import { cn } from "@repo/ds/lib/utils";
import { useTranslations } from "next-intl";
import { useSay } from "@repo/ds/lib/say";

/**
 * Operational orientation, not lifecycle status. Reached milestones read as done; the current
 * frontier is emphasized; later ones stay quiet. The formal state lives in the header badge.
 */
export function MilestoneRail({ milestones }: { milestones: MilestoneStateDto[] }) {
  const t = useTranslations("progress.MilestoneRail");
  const words = useSay("common.words");
  // Once the final milestone is reached there is no frontier left, even if an earlier one was skipped.
  const finished = milestones.at(-1)?.reached ?? false;
  const frontier = finished ? -1 : milestones.findIndex((milestone) => !milestone.reached);
  const next = frontier === -1 ? null : milestones[frontier];
  const reached = milestones.filter((milestone) => milestone.reached).length;

  // Six labels need ~85px each; below that the rail keeps its markers and names only the next milestone.
  return (
    <div className="@container w-full">
      <ol className="flex w-full items-start gap-0 pb-1" aria-label={t("cycleMilestones")}>
        {milestones.map((milestone, index) => {
          const isCurrent = index === frontier;
          const connectorReached = milestone.reached && index < milestones.length - 1;
          return (
            <li key={milestone.milestone} className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
              <div className="flex w-full items-center">
                <span className={cn("h-px flex-1", index === 0 ? "bg-transparent" : milestone.reached || isCurrent ? "bg-primary/40" : "bg-border")} />
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border type-mark transition-colors",
                    milestone.reached
                      ? "border-primary bg-primary text-primary-foreground"
                      : isCurrent
                        ? "border-primary bg-primary-tint text-primary-ink"
                        : "border-border bg-inlay text-muted-foreground"
                  )}
                >
                  {milestone.reached ? <Check className="size-3.5" aria-hidden /> : index + 1}
                </span>
                <span className={cn("h-px flex-1", connectorReached ? "bg-primary/40" : "bg-border", index === milestones.length - 1 && "bg-transparent")} />
              </div>
              <span
                className={cn(
                  "sr-only px-1 type-meta leading-tight @lg:not-sr-only",
                  milestone.reached ? "text-foreground" : isCurrent ? "font-medium text-foreground" : "text-muted-foreground"
                )}
              >
                {words(`milestone.${milestone.milestone}`)}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="type-body-secondary mt-1 text-muted-foreground @lg:hidden" aria-hidden>
        <span className="tabular-nums">
          {t("ofReached", { reached, length: milestones.length })}
        </span>
        {next ? (
          <>
            {" " + t("next") + " "}
            <span className="text-foreground">{words(`milestone.${next.milestone}`)}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}

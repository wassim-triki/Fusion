import type { PersonSummaryCycleDto } from "@repo/api";
import { cn } from "@repo/ds";
import { ObjectiveStatusBadge } from "./objective-status";
import { percent, weightPercent, type RenderSummaryLink } from "./summary-lib";
import { useTranslations } from "next-intl";
import { usePerformanceWords } from "./use-words";

/**
 * The plan's objectives in Performance's own language: a numbered tile in the objective's type colour
 * (amber aligned, blue standalone), its alignment, weight and progress. Each opens its record.
 */
export function SummaryObjectives({ cycle, renderLink }: { cycle: PersonSummaryCycleDto; renderLink: RenderSummaryLink }) {
  const t = useTranslations("performanceUi.SummaryObjectives");
  const words = usePerformanceWords();
  return (
    <section aria-labelledby="summary-objectives-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="summary-objectives-heading" className="type-section-title text-foreground">
          {t("objectives")}
        </h2>
        {cycle.planHref
          ? renderLink({
              href: cycle.planHref,
              className: "type-label text-foreground hover:underline",
              children: words.t("openPlan"),
            })
          : null}
      </div>
      {!cycle.isParticipant ? (
        <p className="type-body-secondary text-muted-foreground">{t("notPartOf", { cycleName: cycle.cycleName })}</p>
      ) : cycle.objectives.length === 0 ? (
        <p className="type-body-secondary text-muted-foreground">{t("noObjectivesSharedYet")}</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-surface bg-card">
          {cycle.objectives.map((objective) => {
            const aligned = objective.alignedTo !== null;
            const row = "group flex items-center gap-4 px-4 py-3.5";
            const content = (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate type-body font-medium text-foreground group-hover:underline">
                          {objective.title}
                        </span>
                        <span className={cn("block truncate type-meta", aligned ? "text-primary-ink" : "text-info")}>
                          {aligned ? t("alignedTo", { alignedTo: objective.alignedTo ?? "" }) : t("standalone")}
                        </span>
                      </span>
                      {objective.weight !== null ? (
                        <span className="w-12 shrink-0 text-end type-meta tabular-nums text-muted-foreground">
                          {weightPercent(objective.weight)}%
                        </span>
                      ) : null}
                      <span className="flex w-28 shrink-0 items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                          <span
                            className={cn("block h-full rounded-full", aligned ? "bg-primary" : "bg-info")}
                            style={{ width: `${Math.min(objective.progress ?? 0, 100)}%` }}
                          />
                        </span>
                        <span className="w-9 text-end type-meta tabular-nums text-foreground">
                          {objective.progress === null ? "–" : `${percent(objective.progress)}%`}
                        </span>
                      </span>
                      <span className="hidden w-20 shrink-0 justify-end sm:flex">
                        <ObjectiveStatusBadge status={objective.status} />
                      </span>
                    </>
            );
            return (
              <li key={objective.objectiveId}>
                {objective.href ? (
                  renderLink({ href: objective.href, className: `${row} transition-colors hover:bg-muted`, children: content })
                ) : (
                  <div className={row}>{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

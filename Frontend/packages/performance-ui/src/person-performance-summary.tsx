import type { PersonPerformanceSummaryDto } from "@repo/api";
import { Button, Skeleton } from "@repo/ds";
import { SummaryGlance } from "./summary-glance";
import { SummaryObjectives } from "./summary-objectives";
import type { RenderSummaryLink } from "./summary-lib";
import { useTranslations } from "next-intl";

export type PersonPerformanceSummaryState =
  | { status: "loading" }
  | { status: "error"; onRetry: () => void }
  | { status: "ready"; summary: PersonPerformanceSummaryDto };

export interface PersonPerformanceSummaryProps {
  state: PersonPerformanceSummaryState;
  renderLink: RenderSummaryLink;
}

function SummarySkeleton() {
  const t = useTranslations("performanceUi.SummarySkeleton");
  return (
    <div aria-busy aria-label={t("loadingPerformance")} className="space-y-8">
      <Skeleton className="h-32 w-full rounded-surface" />
      <div className="space-y-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-40 w-full rounded-surface" />
      </div>
    </div>
  );
}

/**
 * The person page's Overview (B-180): their plan at a glance and its goals, as the viewer may see them. The whole year
 * is the Performance tab (`PersonPerformanceTab`). Loading and failure stay in place, so the page never waits on
 * Performance; with nothing visible, nothing is drawn.
 */
export function PersonPerformanceSummary({ state, renderLink }: PersonPerformanceSummaryProps) {
  const t = useTranslations("performanceUi.PersonPerformanceSummary");
  if (state.status === "loading") return <SummarySkeleton />;
  if (state.status === "error") {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-surface bg-card px-5 py-4">
        <p className="type-body text-foreground">{t("performanceCouldntBeLoaded")}</p>
        <Button variant="outline" size="sm" onClick={state.onRetry}>
          {t("tryAgain")}
        </Button>
      </div>
    );
  }

  const { summary } = state;
  const cycle = summary.currentCycle;
  const reviews = summary.reviews;
  if (!cycle && !reviews) return null;
  return (
    <div className="space-y-3">
      <SummaryGlance cycle={cycle} reviews={reviews} />
      {cycle ? <SummaryObjectives cycle={cycle} renderLink={renderLink} /> : null}
    </div>
  );
}

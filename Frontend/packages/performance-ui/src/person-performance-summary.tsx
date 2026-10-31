import type { PersonPerformanceSummaryDto, PraiseDto, PraiseReactionKind } from "@repo/api";
import { Button, Skeleton } from "@repo/ds";
import { SummaryGlance } from "./summary-glance";
import { SummaryObjectives } from "./summary-objectives";
import { SummaryDevelopment } from "./summary-development";
import { SummaryReviews } from "./summary-reviews";
import type { RenderSummaryLink } from "./summary-lib";
import { SummaryFeedback, SummaryOneOnOne, SummaryPraise } from "./summary-conversations";
import type { PraiseReactionIcons } from "./praise";
import { useTranslations } from "next-intl";

export type PersonPerformanceSummaryState =
  | { status: "loading" }
  | { status: "error"; onRetry: () => void }
  | { status: "ready"; summary: PersonPerformanceSummaryDto };

export interface PersonPerformanceSummaryProps {
  state: PersonPerformanceSummaryState;
  renderLink: RenderSummaryLink;
  /** The host's reaction glyphs; the package carries no icon set. */
  reactionIcons: PraiseReactionIcons;
  onReact?: (praise: PraiseDto, kind: PraiseReactionKind, add: boolean) => void;
  onOpenPraise?: (praise: PraiseDto) => void;
  /** The person page's Overview (B-180): the glance and the plan only; the next 1:1 is in its Coming up. */
  compact?: boolean;
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
 * One person's performance as the viewer may see it: the glance, the current cycle's objectives and
 * the reviews. Only the sections the server returned are rendered; when it returned none, one line
 * says so. Loading and failure stay in place, so the surrounding record never waits on Performance.
 */
export function PersonPerformanceSummary({ state, renderLink, reactionIcons, onReact, onOpenPraise, compact = false }: PersonPerformanceSummaryProps) {
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
  const development = summary.development;
  if (!cycle && !reviews && !development && !summary.praise && !summary.feedback) {
    return <p className="type-body-secondary text-muted-foreground">{t("theresNothingYouCanSee")}</p>;
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-8"}>
      {cycle || reviews ? <SummaryGlance cycle={cycle} reviews={reviews} /> : null}
      {!compact && summary.oneOnOne ? <SummaryOneOnOne oneOnOne={summary.oneOnOne} renderLink={renderLink} /> : null}
      {cycle ? <SummaryObjectives cycle={cycle} renderLink={renderLink} /> : null}
      {compact ? null : reviews ? <SummaryReviews reviews={reviews} renderLink={renderLink} /> : null}
      {!compact && development ? <SummaryDevelopment development={development} renderLink={renderLink} /> : null}
      {!compact && summary.feedback ? <SummaryFeedback feedback={summary.feedback} renderLink={renderLink} /> : null}
      {!compact && summary.praise ? (
        <SummaryPraise praise={summary.praise} renderLink={renderLink} reactionIcons={reactionIcons} onReact={onReact} onOpen={onOpenPraise} />
      ) : null}
    </div>
  );
}

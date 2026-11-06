"use client";

import { Fragment } from "react";
import type { OverviewRowDto } from "@repo/api";
import { PageContainer, PageHeader, PageSkeleton } from "@repo/ds/shell";
import { ContentUnavailable } from "@/features/performance/components/content-unavailable";
import { useOverview, useWorkspaceContext } from "@/features/performance/api/use-workspace";
import { YearBand } from "@/features/performance/components/overview/year-band";
import {
  ConversationsRow,
  CycleRow,
  DevelopmentRow,
  DirectionRow,
  InputOwedRow,
  NextCycleRow,
  NoCycleRow,
  StartConversationsRow,
  NotParticipantRow,
  OwnPlanRow,
  OwnReviewRow,
  ReviewsYouWriteRow,
  TeamRow,
} from "@/features/performance/components/overview/overview-rows";
import { useTranslations } from "next-intl";

/**
 * Overview: where the year stands, then one row per responsibility in a fixed order (the cycle, your team or the
 * reviews you write, your own review and plan, input you owe, development, conversations, organization direction).
 * The server composes the rows from the person's capabilities and recorded responsibility; each ends in a workspace
 * or record.
 */
export default function OverviewPage() {
  const t = useTranslations("overview.OverviewPage");
  const context = useWorkspaceContext();
  const overview = useOverview(!context.isLoading && !context.error);

  if (context.isLoading) return <PageSkeleton rows={4} label={t("loadingPerformance")} />;
  if (context.error) return <ContentUnavailable error={context.error} onRetry={context.refetch} />;
  if (overview.error) {
    return <ContentUnavailable error={overview.error} onRetry={overview.refetch} />;
  }
  if (!overview.data) return <PageSkeleton rows={4} label={t("loadingOverview")} />;

  const { cycle, year, rows } = overview.data;
  const cycleId = cycle?.id ?? "";
  const writesReviews = rows.some((row) => row.kind === "reviewsYouWrite");

  const render = (row: OverviewRowDto) => {
    switch (row.kind) {
      case "nextCycle":
        return <NextCycleRow row={row} />;
      case "cycle":
        return <CycleRow row={row} />;
      case "team":
        return <TeamRow row={row} cycleId={cycleId} quietAfterReviews={writesReviews} />;
      case "reviewsYouWrite":
        return <ReviewsYouWriteRow row={row} />;
      case "ownReview":
        return <OwnReviewRow row={row} own={writesReviews} />;
      case "inputOwed":
        return <InputOwedRow row={row} />;
      case "ownPlan":
        return <OwnPlanRow row={row} />;
      case "development":
        return <DevelopmentRow row={row} />;
      case "conversations":
        return <ConversationsRow row={row} />;
      case "direction":
        return <DirectionRow row={row} cycleId={cycleId} />;
      case "notParticipant":
        return <NotParticipantRow row={row} />;
      case "noCycle":
        return <NoCycleRow row={row} />;
    }
  };

  return (
    <PageContainer width="wide">
      <PageHeader className="mb-4" title={t("overview")} size="display" />
      <div className="mt-8 max-w-5xl space-y-8">
        {year && cycle ? <YearBand year={year} cycleName={cycle.name} /> : null}
        <div className="[&>section:first-child]:border-t-0">
          {rows.map((row, index) => (
            <Fragment key={`${row.kind}-${index}`}>{render(row)}</Fragment>
          ))}
          {/* No cycle and nothing booked yet: 1:1s still start without one (board 16). */}
          {rows.some((row) => row.kind === "noCycle") && !rows.some((row) => row.kind === "conversations") ? <StartConversationsRow /> : null}
        </div>
      </div>
    </PageContainer>
  );
}

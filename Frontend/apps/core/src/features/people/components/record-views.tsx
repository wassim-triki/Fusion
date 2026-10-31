"use client";

import Link from "next/link";
import { createPerformanceApi, createPlatformApiClient, performanceQueryKeys } from "@repo/api";
import { useApiQuery, useReactToPraise } from "@repo/api/query";
import { PersonPerformanceSummary, type PraiseReactionIcons, type RenderSummaryLink } from "@repo/performance-ui";
import { HeartHandshake, Lightbulb, PartyPopper, ThumbsUp } from "lucide-react";

const BASE_PATH = "/core";

/** Core HR paths route inside the app; Performance paths are another app and need a full navigation. */
export const renderCoreLink: RenderSummaryLink = ({ href, className, children }) =>
  href === BASE_PATH || href.startsWith(`${BASE_PATH}/`) ? (
    <Link href={href.slice(BASE_PATH.length) || "/"} className={className}>
      {children}
    </Link>
  ) : (
    <a href={href} className={className}>
      {children}
    </a>
  );

/** Core HR's own icon set for praise reactions; the shared parts carry none. */
const REACTION_ICONS: PraiseReactionIcons = {
  Applause: <ThumbsUp />,
  Celebrate: <PartyPopper />,
  Insightful: <Lightbulb />,
  ThankYou: <HeartHandshake />,
};

/**
 * The person's performance on their Core HR record, read from Performance's viewer-shaped summary.
 * It loads on its own, so the Profile view never waits on Performance and a failure stays in place.
 */
export function PerformanceRecordView({ employeeId, compact = false }: { employeeId: string; compact?: boolean }) {
  const summary = useApiQuery(performanceQueryKeys.personSummary(employeeId), (signal) =>
    createPerformanceApi(createPlatformApiClient()).getPersonSummary(employeeId, null, signal),
  );
  const react = useReactToPraise();
  // The Overview's compact summary shows the plan, the review and the next 1:1; with none of them visible, nothing.
  const data = summary.data;
  if (compact && data && !data.currentCycle && !data.reviews && !data.oneOnOne) return null;
  return (
    <PersonPerformanceSummary
      compact={compact}
      renderLink={renderCoreLink}
      reactionIcons={REACTION_ICONS}
      onReact={(praise, kind, add) => react.mutate({ praiseId: praise.id, kind, add })}
      // Praise opens in Performance's drawer; it's another app, so this is a full navigation.
      onOpenPraise={(praise) => window.location.assign(`/performance/feedback?tab=praise&praise=${praise.id}`)}
      state={
        summary.data
          ? { status: "ready", summary: summary.data }
          : summary.error
            ? { status: "error", onRetry: () => void summary.refetch() }
            : { status: "loading" }
      }
    />
  );
}

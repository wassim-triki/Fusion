"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { createPerformanceApi, createPlatformApiClient, fusionAttentionQueryKeys, performanceQueryKeys } from "@repo/api";
import { useApiQuery } from "@repo/api/query";
import { PersonPerformanceSummary, PersonPerformanceTab, type RenderSummaryLink } from "@repo/performance-ui";

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

/** The person's Performance summary as the viewer may see it; shared with the record view through its query key. */
export function usePerformanceSummary(employeeId: string, enabled = true) {
  return useApiQuery(
    performanceQueryKeys.personSummary(employeeId),
    (signal) => createPerformanceApi(createPlatformApiClient()).getPersonSummary(employeeId, null, signal),
    { enabled: enabled && Boolean(employeeId) },
  );
}

function stateOf(summary: ReturnType<typeof usePerformanceSummary>) {
  return summary.data
    ? ({ status: "ready", summary: summary.data } as const)
    : summary.error
      ? ({ status: "error", onRetry: () => void summary.refetch() } as const)
      : ({ status: "loading" } as const);
}

/**
 * The person's performance on their Core HR record, read from Performance's viewer-shaped summary. It loads on its own,
 * so the page never waits on Performance and a failure stays in place. The Overview shows the plan at a glance.
 */
export function PerformanceRecordView({ employeeId }: { employeeId: string }) {
  const summary = usePerformanceSummary(employeeId);
  return <PersonPerformanceSummary renderLink={renderCoreLink} state={stateOf(summary)} />;
}

/** The Performance tab: the one place for the person's year (D-84), booking a first 1:1 in place. */
export function PerformanceTabView({ employeeId }: { employeeId: string }) {
  const summary = usePerformanceSummary(employeeId);
  const cache = useQueryClient();
  return (
    <PersonPerformanceTab
      renderLink={renderCoreLink}
      state={stateOf(summary)}
      onBook={async (path, at) => {
        await createPlatformApiClient().post(`/performance${path}`, { at });
        await Promise.all([
          cache.invalidateQueries({ queryKey: performanceQueryKeys.personSummary(employeeId) }),
          cache.invalidateQueries({ queryKey: fusionAttentionQueryKeys.all() }),
        ]);
      }}
    />
  );
}

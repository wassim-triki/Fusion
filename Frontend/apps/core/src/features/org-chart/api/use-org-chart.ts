"use client";

import { useCallback, useMemo, useRef } from "react";
import { useQueries, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { coreOrgChartQueryKeys, createCoreOrgChartApi, createPlatformApiClient, createReviewsApi, reviewQueryKeys, type OpenRoleRequest, type OrgChartDto } from "@repo/api";
import { keepPreviousData, useApiMutation, useApiQuery } from "@repo/api/query";
import { canAccessCorePeople, useAuth } from "@repo/auth";
import { todayCalendarDate } from "@/features/organization/model/workspace-state";
import { chartOn, coversDay } from "../model/org-chart-history";
import { useOrgChartAccess } from "@repo/auth";

function useOrgChartApi() {
  return useMemo(() => createCoreOrgChartApi(createPlatformApiClient()), []);
}

/** The days Organization's time slider reaches: the chart's history covers them. */
export interface ChartHistoryWindow {
  from: string;
  to: string;
}

/**
 * The whole company's chart over the slider's reach, each person once with their dated stretches (B-419): HR who see
 * the whole chart, below 3,000 people (today's chart isn't a window). Off while the reach is null; a failure leaves the
 * chart to read each date from Core HR.
 */
export function useOrgChartHistory(reach: ChartHistoryWindow | null) {
  const api = useOrgChartApi();
  const { user } = useAuth();
  const hr = canAccessCorePeople(user);
  const today = useApiQuery(
    coreOrgChartQueryKeys.chart(null),
    useCallback((signal) => api.chart(null, signal), [api]),
    { enabled: reach !== null && hr }
  );
  const wanted = reach !== null && hr && today.data?.scope === "Tenant" && today.data.window === null;
  const from = reach?.from ?? "";
  const to = reach?.to ?? "";
  const history = useApiQuery(
    coreOrgChartQueryKeys.history(from, to),
    useCallback((signal) => api.history(from, to, signal), [api, from, to]),
    { enabled: wanted, staleTime: 60_000, retry: false }
  );
  return { ...history, waiting: reach !== null && hr && (today.isLoading || (history.isFetching && !history.data)) };
}

/**
 * The people org chart as of a date (null = today), shaped for the viewer by Core HR. Another date comes from the
 * chart's history when the slider's reach is given, built in the browser, so moving the date waits on nothing; without
 * it (a windowed chart, or the history failed) each date is read from Core HR. Moving the date keeps the previous chart
 * on screen until the next one is ready, so cards move instead of the stage flashing a skeleton.
 */
export function useOrgChart(asOf: string | null = null, reach: ChartHistoryWindow | null = null) {
  const { isAuthenticated } = useAuth();
  const access = useOrgChartAccess();
  const api = useOrgChartApi();
  const enabled = !access.isLoading && isAuthenticated && access.canSee;
  const today = useApiQuery(
    coreOrgChartQueryKeys.chart(null),
    useCallback((signal) => api.chart(null, signal), [api]),
    { enabled }
  );
  const history = useOrgChartHistory(enabled ? reach : null);
  const local = asOf !== null && history.data !== undefined && coversDay(history.data, asOf);
  // While today's chart and the history load, the date waits for them rather than reading the chart once more.
  const waiting = history.waiting;
  const dated = useApiQuery(
    coreOrgChartQueryKeys.chart(asOf),
    useCallback((signal) => api.chart(asOf, signal), [api, asOf]),
    { enabled: enabled && asOf !== null && !local && !waiting, placeholderData: keepPreviousData }
  );
  const todayDay = useMemo(() => todayCalendarDate(), []);
  const built = useMemo(
    () => (local && history.data && today.data ? chartOn(history.data, today.data, asOf, todayDay) : undefined),
    [local, history.data, today.data, asOf, todayDay]
  );
  const source = asOf === null ? today : dated;
  const data = asOf === null ? today.data : local ? built : dated.data;
  // The last chart shown stays until the next is ready.
  const shown = useRef<OrgChartDto | undefined>(undefined);
  if (data) shown.current = data;
  const result = data ?? shown.current;
  return {
    data: result,
    error: result ? null : source.error,
    isLoading: !result && !source.error,
    refetch: source.refetch,
    /** The chart's history, for the changes coming after the date; `historyWaiting` while it loads. */
    history: history.data,
    historyWaiting: history.waiting,
  };
}

export type BranchStatus = "loading" | "ready" | "failed";

const combineBranches = (results: UseQueryResult<OrgChartDto>[]) => ({
  windows: results.flatMap((result) => (result.data ? [result.data] : [])),
  status: results.map((result): BranchStatus => (result.data ? "ready" : result.isError ? "failed" : "loading")),
});

/**
 * The branches opened on a windowed chart (above 3,000 people): the window rooted at each, for the chart's date.
 * They refresh with the chart, so a change saved elsewhere reaches loaded branches too.
 */
export function useOrgChartBranches(asOf: string | null, roots: string[]) {
  const api = useOrgChartApi();
  return useQueries({
    queries: roots.map((root) => ({
      queryKey: coreOrgChartQueryKeys.branch(asOf, root),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.branch(asOf, root, signal),
      staleTime: 60_000,
      retry: false,
    })),
    combine: combineBranches,
  });
}

/** People on the chart matching the text, from Core HR: a windowed chart doesn't hold everyone to search. */
export function useOrgChartSearch(asOf: string | null, query: string, enabled: boolean) {
  const api = useOrgChartApi();
  return useApiQuery(
    coreOrgChartQueryKeys.search(asOf, query),
    useCallback((signal) => api.search(asOf, query, signal), [api, asOf, query]),
    { enabled: enabled && query.length > 0, placeholderData: keepPreviousData }
  );
}

/** Joins, leavers and moves between two days, both included (HR). */
export function useOrgChartChanges(from: string, to: string, enabled: boolean) {
  const api = useOrgChartApi();
  return useApiQuery(
    coreOrgChartQueryKeys.changes(from, to),
    useCallback((signal) => api.changes(from, to, signal), [api, from, to]),
    { enabled: enabled && from <= to, placeholderData: keepPreviousData }
  );
}

/** Today's review progress from Performance, for the Review progress lens: only the reviews the viewer may read there. */
export function useReviewProgress(enabled: boolean) {
  const api = useMemo(() => createReviewsApi(createPlatformApiClient()), []);
  return useApiQuery(reviewQueryKeys.progress(), useCallback((signal) => api.getProgress(signal), [api]), { enabled });
}

/** Add and edit open roles (people admins); the chart refreshes after each. */
export function useOpenRoleMutations() {
  const queryClient = useQueryClient();
  const api = useOrgChartApi();
  const onSuccess = useCallback(() => void queryClient.invalidateQueries({ queryKey: coreOrgChartQueryKeys.all() }), [queryClient]);
  return {
    create: useApiMutation((request: OpenRoleRequest) => api.createOpenRole(request), { onSuccess }),
    update: useApiMutation(({ id, request }: { id: string; request: OpenRoleRequest }) => api.updateOpenRole(id, request), { onSuccess }),
  };
}

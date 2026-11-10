"use client";

import { performanceQueryKeys } from "@repo/api";
import { useApiMutation, useApiQuery } from "@repo/api/query";
import { useApis } from "./use-performance";

/** A plan's update requests, open and resolved. Readable by the plan's owner and its responsible reviewer. */
export function useUpdateRequests(cycleId: string | null, planId: string | null, enabled = true) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.updateRequests(cycleId ?? "none", planId ?? "none"),
    (signal) => performance.getUpdateRequests(cycleId as string, planId as string, signal),
    { enabled: Boolean(cycleId) && Boolean(planId) && enabled }
  );
}

export function useUpdateRequestMutations(cycleId: string, planId: string) {
  const { performance } = useApis();
  const invalidateQueries = [
    { queryKey: performanceQueryKeys.updateRequests(cycleId, planId) },
    { queryKey: performanceQueryKeys.yourPeople(cycleId) },
    { queryKey: performanceQueryKeys.years() },
  ];
  const request = useApiMutation(
    (input: { objectiveId: string | null; note: string | null }) => performance.requestUpdate(cycleId, planId, input),
    { invalidateQueries }
  );
  const withdraw = useApiMutation((args: { requestId: string; expectedVersion: number }) => performance.withdrawUpdateRequest(args.requestId, args.expectedVersion), { invalidateQueries });
  return { request, withdraw };
}

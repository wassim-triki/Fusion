"use client";

import { fusionAttentionQueryKeys, performanceQueryKeys, reviewQueryKeys, type CalibrationDecisionRequest } from "@repo/api";
import { useApiMutation, useApiQuery, type ApiMutationInvalidation } from "@repo/api/query";
import { useApis } from "./use-performance";

/** A round's calibration by exception (D-35): who is still being written, ready, to look at; the flagged reviews. */
export function useCalibration(roundId: string) {
  const { performance } = useApis();
  return useApiQuery(performanceQueryKeys.calibration(roundId), (signal) => performance.getCalibration(roundId, signal), { retry: false });
}

/** The full view (D-71): everyone's rating against their goals' grade, and the spread against last year. */
export function useCalibrationEveryone(roundId: string, enabled: boolean) {
  const { performance } = useApis();
  return useApiQuery(performanceQueryKeys.calibrationEveryone(roundId), (signal) => performance.getCalibrationEveryone(roundId, signal), { enabled });
}

/**
 * Keep, change with a reason, or undo. Each refreshes the round's calibration, the year (its flagged and ready counts),
 * the Reviews page and Home's work.
 */
export function useCalibrationDecisions(roundId: string) {
  const { performance } = useApis();
  const invalidateQueries: ApiMutationInvalidation[] = [
    { queryKey: performanceQueryKeys.calibration(roundId) },
    { queryKey: performanceQueryKeys.years() },
    { queryKey: reviewQueryKeys.all() },
    { queryKey: fusionAttentionQueryKeys.all() },
  ];
  const decide = useApiMutation(
    ({ reviewId, ...request }: CalibrationDecisionRequest & { reviewId: string }) => performance.decideCalibration(roundId, reviewId, request),
    { invalidateQueries }
  );
  const undo = useApiMutation(
    ({ reviewId, expectedVersion }: { reviewId: string; expectedVersion: number }) => performance.undoCalibrationDecision(roundId, reviewId, expectedVersion),
    { invalidateQueries }
  );
  return { decide, undo };
}

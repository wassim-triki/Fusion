"use client";

import {
  performanceQueryKeys,
  type CreateReviewRoundRequest,
  type UpdateReviewRoundPopulationRequest,
  type UpdateReviewRoundRequest,
  type SaveManagerAssessmentRequest,
  type SaveSelfAssessmentRequest,
} from "@repo/api";
import { useApiMutation, useApiQuery, useApiQueryClient } from "@repo/api/query";
import { useApis } from "./use-performance";
import { recoverPerformanceFailure } from "./performance-failure";

export function useReviewWork(cycleId: string | null, enabled = true) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.reviewWork(cycleId ?? "none"),
    (signal) => performance.getReviewWork(cycleId as string, signal),
    { enabled: Boolean(cycleId) && enabled }
  );
}

export function useReviewHistory(cycleId: string | null, enabled = true) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.reviewHistory(cycleId ?? "all"),
    (signal) => performance.getReviewHistory(cycleId, signal),
    { enabled }
  );
}

export function useReviewRounds(cycleId: string | null, enabled = true) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.reviewRounds(cycleId ?? "none"),
    (signal) => performance.getReviewRounds(cycleId as string, signal),
    { enabled: Boolean(cycleId) && enabled }
  );
}

export function useReviewRound(roundId: string | null, enabled = true) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.reviewRound(roundId ?? "none"),
    (signal) => performance.getReviewRound(roundId as string, signal),
    { enabled: Boolean(roundId) && enabled }
  );
}

export function useReviewRoundStatus(roundId: string | null, enabled = true) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.reviewRoundStatus(roundId ?? "none"),
    (signal) => performance.getReviewRoundStatus(roundId as string, signal),
    { enabled: Boolean(roundId) && enabled }
  );
}

export function useEligibleReviewers(roundId: string | null, enabled = true) {
  const { performance } = useApis();
  return useApiQuery(
    roundId ? performanceQueryKeys.reviewRoundEligibleReviewers(roundId) : [...performanceQueryKeys.all(), "review-round-reviewers", "none"],
    (signal) => performance.getEligibleReviewers(roundId as string, signal),
    { enabled: Boolean(roundId) && enabled }
  );
}

export function useReviewRoundMutations(cycleId: string, roundId?: string) {
  const { performance } = useApis();
  const detailsKey = roundId ? performanceQueryKeys.reviewRound(roundId) : null;
  const invalidations = [
    { queryKey: performanceQueryKeys.reviewRounds(cycleId) },
    { queryKey: performanceQueryKeys.workspaceContext(cycleId) },
    ...(detailsKey ? [
      { queryKey: detailsKey },
      { queryKey: performanceQueryKeys.reviewRoundStatus(roundId as string) },
      { queryKey: performanceQueryKeys.reviewRoundEligibleReviewers(roundId as string) },
    ] : []),
  ];
  const create = useApiMutation(
    (request: CreateReviewRoundRequest) => performance.createReviewRound(cycleId, request),
    { invalidateQueries: invalidations }
  );
  const update = useApiMutation(
    (request: UpdateReviewRoundRequest) => performance.updateReviewRound(roundId as string, request),
    { invalidateQueries: invalidations }
  );
  const updatePopulation = useApiMutation(
    (request: UpdateReviewRoundPopulationRequest) => performance.updateReviewRoundPopulation(roundId as string, request),
    { invalidateQueries: invalidations }
  );
  const launch = useApiMutation(
    (expectedVersion: number) => performance.launchReviewRound(roundId as string, expectedVersion),
    { invalidateQueries: invalidations }
  );
  return { create, update, updatePopulation, launch };
}

export function useReviewRoundFinalization(roundId: string, cycleId: string) {
  const { performance } = useApis();
  return useApiMutation(
    (expectedVersion: number) => performance.finalizeReviewRound(roundId, expectedVersion),
    { invalidateQueries: [
      { queryKey: performanceQueryKeys.reviewRoundStatus(roundId) },
      { queryKey: performanceQueryKeys.reviewWork(cycleId) },
      { queryKey: performanceQueryKeys.reviewHistory("all") },
      { queryKey: performanceQueryKeys.reviewRounds(cycleId) },
      { queryKey: performanceQueryKeys.overview(cycleId) },
    ] }
  );
}

export function useReview(reviewId: string | null, enabled = true) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.review(reviewId ?? "none"),
    (signal) => performance.getReview(reviewId as string, signal),
    { enabled: Boolean(reviewId) && enabled }
  );
}

export function useReviewAssessmentMutations(reviewId: string, cycleId: string) {
  const { performance } = useApis();
  const cache = useApiQueryClient();
  const invalidations = [
    { queryKey: performanceQueryKeys.review(reviewId) },
    { queryKey: performanceQueryKeys.reviewWork(cycleId) },
    { queryKey: performanceQueryKeys.reviewHistory(cycleId) },
    { queryKey: performanceQueryKeys.reviewRounds(cycleId) },
    { queryKey: performanceQueryKeys.workspaceContext(cycleId) },
  ];
  const mutationOptions = {
    invalidateQueries: invalidations,
    onError: async (error: unknown) => {
      await recoverPerformanceFailure(error, () => cache.invalidateQueries({ queryKey: performanceQueryKeys.all() }));
    },
  };
  const saveSelf = useApiMutation(
    (input: SaveSelfAssessmentRequest) => performance.saveSelfAssessment(reviewId, input),
    mutationOptions
  );
  const submitSelf = useApiMutation(
    (input: SaveSelfAssessmentRequest) => performance.submitSelfAssessment(reviewId, input),
    mutationOptions
  );
  const saveManager = useApiMutation(
    (input: SaveManagerAssessmentRequest) => performance.saveManagerAssessment(reviewId, input),
    mutationOptions
  );
  const submitManager = useApiMutation(
    (input: SaveManagerAssessmentRequest) => performance.submitManagerAssessment(reviewId, input),
    mutationOptions
  );
  const finalize = useApiMutation(
    (expectedVersion: number) => performance.finalizeReview(reviewId, expectedVersion),
    mutationOptions
  );
  const close = useApiMutation(
    (input: { expectedVersion: number; reason: string }) => performance.closeReview(reviewId, input.expectedVersion, input.reason),
    mutationOptions
  );
  return { saveSelf, submitSelf, saveManager, submitManager, finalize, close };
}

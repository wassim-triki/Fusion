"use client";

import { useMemo } from "react";
import {
  createPlatformApiClient,
  createReviewsApi,
  fusionAttentionQueryKeys,
  performanceQueryKeys,
  reviewQueryKeys,
  type MoveReviewDueDateRequest,
  type MoveRoundDueDateRequest,
  type ReviewAnswerInput,
  type ReviewQuestionAudience,
} from "@repo/api";
import { useApiMutation, useApiQuery, useApiQueryClient, type ApiMutationInvalidation } from "@repo/api/query";
import { performanceFailure } from "./performance-failure";

/** Slice 4 review transport: the workspace, the question library, peer input, due-date moves, acknowledgement and the PDF. */
export function useReviewsApi() {
  const client = useMemo(() => createPlatformApiClient(), []);
  return useMemo(() => createReviewsApi(client), [client]);
}

/** Everything a review change can move: the reviews tree, rounds, Overview, work items and the bell. */
const REVIEWS: ApiMutationInvalidation[] = [
  { queryKey: reviewQueryKeys.all() },
  { queryKey: performanceQueryKeys.all() },
  { queryKey: fusionAttentionQueryKeys.all() },
];

function useReviewMutation<TData, TArgs>(fn: (args: TArgs) => Promise<TData>) {
  const cache = useApiQueryClient();
  return useApiMutation(fn, {
    invalidateQueries: REVIEWS,
    // Callers say what failed in place; a stale or moved record is refreshed so the next try works.
    onError: async (error: unknown) => {
      if (performanceFailure(error).refresh) await cache.invalidateQueries({ queryKey: reviewQueryKeys.all() });
    },
  });
}

export function useReviewsWorkspace(cycleId: string | null, enabled = true) {
  const api = useReviewsApi();
  return useApiQuery(reviewQueryKeys.workspace(cycleId), (signal) => api.getWorkspace(cycleId, signal), { enabled });
}

export function useReviewQuestions(enabled = true) {
  const api = useReviewsApi();
  return useApiQuery(reviewQueryKeys.questions(), (signal) => api.listQuestions(signal), { enabled });
}

export function useReviewQuestionCommands() {
  const api = useReviewsApi();
  return {
    create: useReviewMutation((input: { text: string; audience: ReviewQuestionAudience }) => api.createQuestion(input.text, input.audience)),
    update: useReviewMutation((input: { id: string; text: string; version: number }) => api.updateQuestion(input.id, input.text, input.version)),
    archive: useReviewMutation((input: { id: string; version: number }) => api.archiveQuestion(input.id, input.version)),
    remove: useReviewMutation((input: { id: string; version: number }) => api.deleteQuestion(input.id, input.version)),
    reorder: useReviewMutation((input: { audience: ReviewQuestionAudience; ids: string[] }) => api.reorderQuestions(input.audience, input.ids)),
  };
}

export function usePeerSuggestions(reviewId: string | null, enabled = true) {
  const api = useReviewsApi();
  return useApiQuery(reviewQueryKeys.peerSuggestions(reviewId ?? "none"), (signal) => api.getPeerSuggestions(reviewId as string, signal), {
    enabled: Boolean(reviewId) && enabled,
  });
}

/** The manager changes who is asked (Fusion picks at launch, D-40). */
export function usePeerCommands(reviewId: string) {
  const api = useReviewsApi();
  return {
    change: useReviewMutation((input: { ids: string[]; version: number }) => api.changePeers(reviewId, input.ids, input.version)),
  };
}

export function usePeerRequest(requestId: string | null) {
  const api = useReviewsApi();
  return useApiQuery(reviewQueryKeys.peerRequest(requestId ?? "none"), (signal) => api.getPeerRequest(requestId as string, signal), {
    enabled: Boolean(requestId),
  });
}

export function usePeerRequestCommands(requestId: string) {
  const api = useReviewsApi();
  const cache = useApiQueryClient();
  // A draft autosave only refreshes the request; sending or declining also moves the peer's work.
  const save = useApiMutation((answers: ReviewAnswerInput[]) => api.savePeerAnswers(requestId, answers), {
    onSuccess: (data) => { cache.setQueryData(reviewQueryKeys.peerRequest(requestId), data); },
  });
  return {
    save,
    send: useReviewMutation((answers: ReviewAnswerInput[]) => api.sendPeerAnswers(requestId, answers)),
    decline: useReviewMutation((note: string | null) => api.declinePeerRequest(requestId, note)),
  };
}

export function useScheduleCommands() {
  const api = useReviewsApi();
  return {
    moveRound: useReviewMutation((input: { roundId: string; request: MoveRoundDueDateRequest }) => api.moveRoundDueDate(input.roundId, input.request)),
    moveReview: useReviewMutation((input: { reviewId: string; request: MoveReviewDueDateRequest }) => api.moveReviewDueDate(input.reviewId, input.request)),
  };
}

export function useAcknowledge(reviewId: string) {
  const api = useReviewsApi();
  return useReviewMutation((comment: string | null) => api.acknowledge(reviewId, comment));
}

/** Downloads the reader's copy of a released review as a file. */
export function useDownloadReviewPdf() {
  const api = useReviewsApi();
  return async (reviewId: string, fileName: string) => {
    const blob = await api.downloadPdf(reviewId);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };
}

/** The person's year beside the review, numbered as drafts cite it (H3), through the reader's own lens. */
export function useReviewYear(reviewId: string | null, enabled = true) {
  const api = useReviewsApi();
  return useApiQuery(reviewQueryKeys.year(reviewId ?? "none"), (signal) => api.getYear(reviewId as string, signal), {
    enabled: Boolean(reviewId) && enabled,
  });
}

/** What a review's people do from its page: take a self-review back, nudge, talk it over in a 1:1, comment after reading. */
export function useReviewActions(reviewId: string) {
  const api = useReviewsApi();
  return {
    takeBack: useReviewMutation(() => api.takeBack(reviewId)),
    nudge: useReviewMutation((who: "self" | "peers") => api.nudge(reviewId, who)),
    talkItOver: useReviewMutation(() => api.talkItOver(reviewId)),
    comment: useReviewMutation((comment: string) => api.commentOnAcknowledgement(reviewId, comment)),
  };
}

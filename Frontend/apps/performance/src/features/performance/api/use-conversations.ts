"use client";

import { useMemo } from "react";
import {
  conversationQueryKeys,
  createConversationsApi,
  createPlatformApiClient,
  fusionAttentionQueryKeys,
  performanceQueryKeys,
  type AddActionRequest,
  type AddAgendaItemRequest,
  type AskForFeedbackRequest,
  type FeedbackListQuery,
  type GiveFeedbackRequest,
  type GivePraiseRequest,
  type OneOnOneCadence,
  type OneOnOneSeriesDto,
  type PraiseListQuery,
  type StartOneOnOneRequest,
} from "@repo/api";
import { useApiMutation, useApiQuery, useApiQueryClient, type ApiMutationInvalidation } from "@repo/api/query";
import { reportPerformanceFailure } from "./performance-failure";

/** Conversations belong to people, not cycles: none of these follow the cycle switcher. */
export function useConversationsApi() {
  const client = useMemo(() => createPlatformApiClient(), []);
  return useMemo(() => createConversationsApi(client), [client]);
}

/** Work items and the bell, which Fusion's attention queries hold. */
const WORK: ApiMutationInvalidation[] = [{ queryKey: fusionAttentionQueryKeys.all() }];
const SUMMARY: ApiMutationInvalidation = { queryKey: [...performanceQueryKeys.all(), "person-summary"] };

// ── 1:1s ───────────────────────────────────────────────────────────────────────

export function useOneOnOnes(enabled = true) {
  const api = useConversationsApi();
  return useApiQuery(conversationQueryKeys.oneOnOnes(), (signal) => api.listOneOnOnes(signal), { enabled });
}

export function useOneOnOne(seriesId: string | null) {
  const api = useConversationsApi();
  return useApiQuery(conversationQueryKeys.oneOnOne(seriesId ?? ""), (signal) => api.getOneOnOne(seriesId!, signal), {
    enabled: Boolean(seriesId),
  });
}

/** Starting 1:1s with someone: the default rhythm and the talking points ready for the first meeting. */
export function useOneOnOneStart(withEmployeeId: string | null) {
  const api = useConversationsApi();
  return useApiQuery(conversationQueryKeys.oneOnOneStart(withEmployeeId ?? ""), (signal) => api.getOneOnOneStart(withEmployeeId!, signal), {
    enabled: Boolean(withEmployeeId),
  });
}

/**
 * Every 1:1 command returns the series as it now stands, so it replaces the cache directly instead of refetching;
 * the list and work items refresh behind it. A failure reports itself unless the caller handles it (notes conflicts).
 */
function useSeriesCommand<TArgs>(seriesId: string, fn: (args: TArgs) => Promise<OneOnOneSeriesDto>, quiet = false) {
  const queryClient = useApiQueryClient();
  return useApiMutation(fn, {
    onSuccess: (series) => {
      queryClient.setQueryData(conversationQueryKeys.oneOnOne(seriesId), series);
    },
    onError: async (error) => {
      if (!quiet) reportPerformanceFailure(error);
      await queryClient.invalidateQueries({ queryKey: conversationQueryKeys.oneOnOne(seriesId) });
    },
    invalidateQueries: [{ queryKey: conversationQueryKeys.oneOnOnes() }, ...WORK],
  });
}

export function useOneOnOneCommands(seriesId: string) {
  const api = useConversationsApi();
  return {
    changeCadence: useSeriesCommand(seriesId, (args: { cadence: OneOnOneCadence; expectedVersion: number }) =>
      api.changeCadence(seriesId, args.cadence, args.expectedVersion)),
    reschedule: useSeriesCommand(seriesId, (args: { meetingId: string; scheduledAt: string; expectedVersion: number }) =>
      api.reschedule(args.meetingId, args.scheduledAt, args.expectedVersion)),
    complete: useSeriesCommand(seriesId, (args: { meetingId: string; expectedVersion: number }) =>
      api.completeMeeting(args.meetingId, args.expectedVersion)),
    addAgendaItem: useSeriesCommand(seriesId, (args: { meetingId: string; request: AddAgendaItemRequest }) =>
      api.addAgendaItem(args.meetingId, args.request)),
    setDiscussed: useSeriesCommand(seriesId, (args: { meetingId: string; itemId: string; discussed: boolean }) =>
      api.setAgendaItemDiscussed(args.meetingId, args.itemId, args.discussed)),
    removeAgendaItem: useSeriesCommand(seriesId, (args: { meetingId: string; itemId: string }) =>
      api.removeAgendaItem(args.meetingId, args.itemId)),
    // Notes saves handle their own conflicts, so they stay quiet.
    setSharedNotes: useSeriesCommand(seriesId, (args: { meetingId: string; text: string; expectedRevision: number }) =>
      api.setSharedNotes(args.meetingId, args.text, args.expectedRevision), true),
    setPrivateNotes: useSeriesCommand(seriesId, (args: { meetingId: string; text: string; expectedRevision: number }) =>
      api.setPrivateNotes(args.meetingId, args.text, args.expectedRevision), true),
    addAction: useSeriesCommand(seriesId, (request: AddActionRequest) => api.addAction(seriesId, request)),
    setActionDone: useSeriesCommand(seriesId, (args: { actionId: string; done: boolean }) => api.setActionDone(seriesId, args.actionId, args.done)),
  };
}

export function useStartOneOnOne() {
  const api = useConversationsApi();
  const queryClient = useApiQueryClient();
  return useApiMutation((request: StartOneOnOneRequest) => api.startOneOnOne(request), {
    onSuccess: (series) => {
      queryClient.setQueryData(conversationQueryKeys.oneOnOne(series.id), series);
    },
    invalidateQueries: [
      { queryKey: conversationQueryKeys.oneOnOnes() },
      { queryKey: [...performanceQueryKeys.all(), "workspace-context"] },
      SUMMARY,
    ],
  });
}

// ── Feedback and requests ──────────────────────────────────────────────────────

export function useFeedbackList(query: FeedbackListQuery, enabled = true) {
  const api = useConversationsApi();
  return useApiQuery(conversationQueryKeys.feedbackList(query), (signal) => api.listFeedback(query, signal), { enabled });
}

export function useFeedbackItem(id: string | null) {
  const api = useConversationsApi();
  return useApiQuery(conversationQueryKeys.feedbackItem(id ?? ""), (signal) => api.getFeedback(id!, signal), { enabled: Boolean(id) });
}

/** The caller's feedback at a glance; refreshes with every feedback and request change. */
export function useFeedbackSummary() {
  const api = useConversationsApi();
  return useApiQuery(conversationQueryKeys.feedbackSummary(), (signal) => api.getFeedbackSummary(signal));
}

export function useGiveFeedback() {
  const api = useConversationsApi();
  return useApiMutation((request: GiveFeedbackRequest) => api.giveFeedback(request), {
    invalidateQueries: [{ queryKey: conversationQueryKeys.feedback() }, SUMMARY, ...WORK],
  });
}

export function useFeedbackRequests(enabled = true) {
  const api = useConversationsApi();
  return useApiQuery(conversationQueryKeys.feedbackRequests(), (signal) => api.listFeedbackRequests(signal), { enabled });
}

export function useFeedbackRequest(id: string | null) {
  const api = useConversationsApi();
  return useApiQuery(conversationQueryKeys.feedbackRequest(id ?? ""), (signal) => api.getFeedbackRequest(id!, signal), { enabled: Boolean(id) });
}

export function useAskForFeedback() {
  const api = useConversationsApi();
  return useApiMutation((request: AskForFeedbackRequest) => api.askForFeedback(request), {
    invalidateQueries: [{ queryKey: conversationQueryKeys.feedbackRequests() }, { queryKey: conversationQueryKeys.feedbackSummary() }],
  });
}

export function useFeedbackRequestCommands(id: string) {
  const api = useConversationsApi();
  const queryClient = useApiQueryClient();
  const options = {
    onSuccess: (request: Awaited<ReturnType<typeof api.getFeedbackRequest>>) => {
      queryClient.setQueryData(conversationQueryKeys.feedbackRequest(id), request);
    },
    invalidateQueries: [{ queryKey: conversationQueryKeys.feedbackRequests() }, { queryKey: conversationQueryKeys.feedback() }, SUMMARY, ...WORK],
  };
  return {
    answer: useApiMutation((args: { feedbackId: string; message: string }) => api.answerFeedbackRequest(id, args.feedbackId, args.message), options),
    decline: useApiMutation((reason: string | null) => api.declineFeedbackRequest(id, reason), options),
    close: useApiMutation(() => api.closeFeedbackRequest(id), options),
  };
}

// ── Praise ─────────────────────────────────────────────────────────────────────

export function usePraiseItem(id: string | null) {
  const api = useConversationsApi();
  return useApiQuery(conversationQueryKeys.praiseItem(id ?? ""), (signal) => api.getPraise(id!, signal), { enabled: Boolean(id) });
}

export function usePraisePage(query: PraiseListQuery) {
  const api = useConversationsApi();
  return useApiQuery(conversationQueryKeys.praiseList(query), (signal) => api.listPraise(query, signal));
}

/** What the company celebrated lately, and the caller's received and given praise. */
export function usePraiseSummary() {
  const api = useConversationsApi();
  return useApiQuery(conversationQueryKeys.praiseSummary(), (signal) => api.getPraiseSummary(signal), { staleTime: 30_000 });
}

export function useGivePraise() {
  const api = useConversationsApi();
  return useApiMutation((request: GivePraiseRequest) => api.givePraise(request), {
    invalidateQueries: [{ queryKey: conversationQueryKeys.praise() }, SUMMARY],
  });
}

export function useDeletePraise() {
  const api = useConversationsApi();
  return useApiMutation((id: string) => api.deletePraise(id), {
    invalidateQueries: [{ queryKey: conversationQueryKeys.praise() }, SUMMARY],
  });
}

// ── Directory ──────────────────────────────────────────────────────────────────

export function useDirectory(term: string, enabled: boolean) {
  const api = useConversationsApi();
  const trimmed = term.trim();
  return useApiQuery(conversationQueryKeys.directory(trimmed), (signal) => api.searchDirectory(trimmed, signal), {
    enabled: enabled && trimmed.length >= 2,
    staleTime: 30_000,
  });
}

/** The company's values, from the shared hook so every surface agrees on their hues. */
export { useCompanyValues } from "@repo/api/query";

"use client";

import { useCallback, useMemo } from "react";
import {
  coreChangesQueryKeys,
  createCoreChangesApi,
  coreOrgChartQueryKeys,
  corePeopleQueryKeys,
  createCorePeopleApi,
  createPlatformApiClient,
  type DottedLineRequestBody,
  type EditChangeRequest,
  type EndEmploymentChangeRequest,
  type JobChangeRequest,
  type JoinChangeRequest,
  type ChangeApprovalType,
  type ProposeChangeRequest,
} from "@repo/api";
import { keepPreviousData, useApiMutation, useApiQuery } from "@repo/api/query";
import { useQueryClient } from "@tanstack/react-query";
import {
  canApproveCoreChanges,
  canProposeCoreChanges,
  canAccessCorePeople,
  canAccessCoreTeam,
  canManageCoreEmployees,
  canManageCoreReporting,
  useAuth,
} from "@repo/auth";

function usePeopleApi() {
  const client = useMemo(() => createPlatformApiClient(), []);
  return useMemo(() => createCorePeopleApi(client), [client]);
}

/** Who may do what with people changes; the server checks the same rules. */
export function useChangeRights() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const ready = !isLoading && isAuthenticated;
  const people = ready && canManageCoreEmployees(user);
  const reporting = ready && canManageCoreReporting(user);
  return {
    /** Any change: job, end, start. */
    people,
    /** Manager and team only (reporting admins), or anything (people admins). */
    lines: people || reporting,
    /** Coming changes: the tenant for People viewers, the branch for managers. */
    seeComing: ready && (canAccessCorePeople(user) || canAccessCoreTeam(user)),
    /** Describes changes for their direct reports; the company's settings say whether they wait for approval. */
    propose: ready && canProposeCoreChanges(user),
    /** Answers requests, for everyone. */
    approve: ready && canApproveCoreChanges(user),
    employeeId: user?.employeeId ?? null,
  };
}

/** Every change made here refreshes what shows people: profiles, lists, the chart and coming changes. */
function useRefresh() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: corePeopleQueryKeys.all() });
    void queryClient.invalidateQueries({ queryKey: coreOrgChartQueryKeys.all() });
  }, [queryClient]);
}

export function useChangeMutations(employeeKey: string) {
  const api = usePeopleApi();
  const onSuccess = useRefresh();
  return {
    changeJob: useApiMutation((request: JobChangeRequest) => api.changeJob(employeeKey, request), { onSuccess }),
    endEmployment: useApiMutation((request: EndEmploymentChangeRequest) => api.endEmployment(employeeKey, request), { onSuccess }),
    startEmployment: useApiMutation((request: JoinChangeRequest) => api.startEmployment(employeeKey, request), { onSuccess }),
    editChange: useApiMutation(({ id, request }: { id: string; request: EditChangeRequest }) => api.editChange(id, request), { onSuccess }),
    dottedLine: useApiMutation(
      ({ end, ...request }: DottedLineRequestBody & { end: boolean }) => api.dottedLine(employeeKey, request, end),
      { onSuccess },
    ),
  };
}

export function useCancelChange() {
  const api = usePeopleApi();
  const onSuccess = useRefresh();
  return useApiMutation((changeId: string) => api.cancelChange(changeId), { onSuccess });
}

// --- Changes and approvals (B-179) ---------------------------------------------------------------

export function useChangesApi() {
  return useMemo(() => createCoreChangesApi(createPlatformApiClient()), []);
}

/** Which change types wait for approval, and who approves. */
export function useApprovalSettings(enabled = true) {
  const api = useChangesApi();
  const { isAuthenticated, isLoading } = useAuth();
  return useApiQuery(coreChangesQueryKeys.approvals(), useCallback((signal) => api.approvals(signal), [api]), {
    enabled: enabled && isAuthenticated && !isLoading,
    staleTime: 60_000,
  });
}

export function useUpdateApprovals() {
  const api = useChangesApi();
  const queryClient = useQueryClient();
  return useApiMutation((required: ChangeApprovalType[]) => api.updateApprovals(required), {
    onSuccess: (settings) => { queryClient.setQueryData(coreChangesQueryKeys.approvals(), settings); },
  });
}

export function useChangeDraft(employeeKey: string) {
  const api = useChangesApi();
  return useApiMutation((text: string) => api.draft(employeeKey, text));
}

/** Requests and changes both show on profiles, lists, the chart and Home's work. */
function useRefreshRequests() {
  const queryClient = useQueryClient();
  const refresh = useRefresh();
  return useCallback(() => {
    refresh();
    void queryClient.invalidateQueries({ queryKey: coreChangesQueryKeys.all() });
    void queryClient.invalidateQueries({ queryKey: ["fusion-attention"] });
  }, [queryClient, refresh]);
}

export function useProposeChange(employeeKey: string) {
  const api = useChangesApi();
  const onSuccess = useRefreshRequests();
  return useApiMutation((request: ProposeChangeRequest) => api.propose(employeeKey, request), { onSuccess });
}

export function useChangeRequests(status: "pending" | "decided", employeeKey?: string | null, enabled = true) {
  const api = useChangesApi();
  const { isAuthenticated, isLoading } = useAuth();
  return useApiQuery(
    coreChangesQueryKeys.requests(status, employeeKey),
    useCallback((signal) => api.requests(status, employeeKey, signal), [api, status, employeeKey]),
    { enabled: enabled && isAuthenticated && !isLoading },
  );
}

export function useChangeRequest(id: string | null) {
  const api = useChangesApi();
  return useApiQuery(
    coreChangesQueryKeys.request(id ?? ""),
    useCallback((signal) => api.request(id ?? "", signal), [api, id]),
    { enabled: Boolean(id), retry: false },
  );
}

export function useRequestDecisions() {
  const api = useChangesApi();
  const onSuccess = useRefreshRequests();
  return {
    approve: useApiMutation((id: string) => api.approve(id), { onSuccess }),
    decline: useApiMutation(({ id, reason }: { id: string; reason: string }) => api.decline(id, reason), { onSuccess }),
    withdraw: useApiMutation((id: string) => api.withdraw(id), { onSuccess }),
  };
}

export function useUpcomingChanges(enabled = true) {
  const api = usePeopleApi();
  const { seeComing } = useChangeRights();
  return useApiQuery(
    corePeopleQueryKeys.upcomingChanges(),
    useCallback((signal) => api.upcomingChanges(signal), [api]),
    { enabled: enabled && seeComing },
  );
}

export function useEndEmploymentPreview(employeeKey: string, lastDay: string, enabled = true) {
  const api = usePeopleApi();
  const { people } = useChangeRights();
  return useApiQuery(
    corePeopleQueryKeys.endEmploymentPreview(employeeKey, lastDay),
    useCallback((signal) => api.endEmploymentPreview(employeeKey, lastDay, signal), [api, employeeKey, lastDay]),
    { enabled: enabled && people && Boolean(employeeKey && lastDay), placeholderData: keepPreviousData },
  );
}

/** What the new line does in Performance; quietly absent when Performance can't say. */
export function useLineEffects(employeeId: string | null, managerId: string | null, enabled = true) {
  const api = usePeopleApi();
  const { lines } = useChangeRights();
  return useApiQuery(
    corePeopleQueryKeys.lineEffects(employeeId ?? "", managerId),
    useCallback((signal) => api.lineEffects(employeeId ?? "", managerId, signal), [api, employeeId, managerId]),
    { enabled: enabled && lines && Boolean(employeeId), retry: false },
  );
}

/** People someone can report to on a date; with `forEmployee`, not them, their branch or their manager. */
export function useManagerOptions(effectiveDate: string, q: string, forEmployee?: string | null) {
  const api = usePeopleApi();
  const { lines } = useChangeRights();
  return useApiQuery(
    corePeopleQueryKeys.managerOptions(effectiveDate, q, forEmployee),
    useCallback((signal) => api.managerOptions(effectiveDate, q, signal, forEmployee), [api, effectiveDate, q, forEmployee]),
    { enabled: lines && Boolean(effectiveDate), placeholderData: keepPreviousData },
  );
}

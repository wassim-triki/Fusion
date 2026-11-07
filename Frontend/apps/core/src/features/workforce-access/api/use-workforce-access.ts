"use client";

import { useCallback, useMemo } from "react";
import {
  coreWorkforceAccessPaths,
  coreWorkforceAccessQueryKeys,
  coreWorkforcePaths,
  coreWorkforceQueryKeys,
  corePeopleQueryKeys,
  createCorePeopleApi,
  createPlatformApiClient,
  type WorkforceAccountHistoryEventDto,
  type WorkforceAccessBulkRequest,
  type WorkforceAccessBulkResultDto,
  type WorkforceAccessCandidateDto,
  type WorkforceAccessCandidatesRequest,
  type WorkforceAccessCommandResultDto,
  type WorkforceAccessCorrectionCommand,
  type WorkforceAccessSubjectPageDto,
  type WorkforceAccessSubjectSummaryDto,
  type WorkforceAccessRosterSummaryDto,
  type WorkforceAccessState,
  type WorkforceAccessDeliveryState,
  type WorkforceBaselineChoice,
} from "@repo/api";
import { useApiMutation, useApiQuery } from "@repo/api/query";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Workforce Access data layer. Every read and mutation is server-resolved: the
 * browser passes an Employee reference, the reviewed baseline, and (for mutations)
 * an optimistic-concurrency token. CoreHR re-resolves the canonical subject and
 * asks Identity for the non-disclosing account state; the frontend never joins
 * untrusted Identity/CoreHR facts itself.
 */

export interface AccessRosterFilters {
  search?: string | null;
  access?: WorkforceAccessState | null;
  profileId?: string | null;
  employeeStatus?: "Active" | "Inactive" | null;
  deliveryState?: WorkforceAccessDeliveryState | null;
  employeeKey?: string | null;
  /** "Employee" | "Manager" — the reviewed baseline recommendation. */
  baseline?: string | null;
  /** Import session id; restricts the roster to exactly that import cohort. */
  cohort?: string | null;
  orgUnitId?: string | null;
  /** "Direct" | "Subtree" — how the Organization filter scopes members. */
  organizationScope?: string | null;
}

function applyRosterQuery(
  query: URLSearchParams,
  filters: AccessRosterFilters
) {
  if (filters.search?.trim()) query.set("search", filters.search.trim());
  if (filters.access) query.set("access", filters.access);
  if (filters.profileId) query.set("profileId", filters.profileId);
  if (filters.employeeStatus)
    query.set("employeeStatus", filters.employeeStatus);
  if (filters.deliveryState) query.set("deliveryState", filters.deliveryState);
  if (filters.employeeKey) query.set("employeeKey", filters.employeeKey);
  if (filters.baseline) query.set("baseline", filters.baseline);
  if (filters.cohort) query.set("cohort", filters.cohort);
  if (filters.orgUnitId) query.set("orgUnitId", filters.orgUnitId);
  if (filters.organizationScope)
    query.set("organizationScope", filters.organizationScope);
}

const MUTATION_INVALIDATIONS = [
  { queryKey: coreWorkforceQueryKeys.all() },
  { queryKey: coreWorkforceAccessQueryKeys.all() },
];

export function useAccessRoster(
  filters: AccessRosterFilters,
  page: number,
  pageSize: number,
  enabled = true
) {
  const client = useMemo(() => createPlatformApiClient(), []);
  const params = useMemo(
    () => ({ ...filters, page, pageSize }),
    [filters, page, pageSize]
  );

  const queryFn = useCallback(
    (signal: AbortSignal) => {
      const query = new URLSearchParams();
      applyRosterQuery(query, params);
      query.set("page", String(params.page));
      query.set("pageSize", String(params.pageSize));
      return client.get<WorkforceAccessSubjectPageDto>(
        `${coreWorkforcePaths.accessSubjects()}?${query.toString()}`,
        { signal }
      );
    },
    [client, params]
  );

  return useApiQuery(coreWorkforceQueryKeys.accessSubjects(params), queryFn, {
    enabled,
  });
}

/**
 * Selection preview: every selectable person that matches the current filters, across all
 * pages, so the full-view count is exact and never silently expands. The server
 * re-resolves the same filters; the client never guesses beyond what it can see.
 */
export function useAccessSelectionPreview(
  filters: AccessRosterFilters,
  enabled = true
) {
  const client = useMemo(() => createPlatformApiClient(), []);
  const queryFn = useCallback(
    (signal: AbortSignal) => {
      const query = new URLSearchParams();
      applyRosterQuery(query, filters);
      return client.get<WorkforceAccessSubjectSummaryDto[]>(
        `${coreWorkforcePaths.accessSubjectsPreview()}?${query.toString()}`,
        { signal }
      );
    },
    [client, filters]
  );

  return useApiQuery(
    coreWorkforceQueryKeys.accessSubjectsPreview(filters),
    queryFn,
    { enabled }
  );
}

export function useAccessRosterSummary(enabled = true) {
  const client = useMemo(() => createPlatformApiClient(), []);
  const queryFn = useCallback(
    (signal: AbortSignal) =>
      client.get<WorkforceAccessRosterSummaryDto>(
        coreWorkforcePaths.accessSubjectsSummary(),
        { signal }
      ),
    [client]
  );

  return useApiQuery(coreWorkforceQueryKeys.accessSubjectsSummary(), queryFn, {
    enabled,
  });
}

export function useAccessCandidate(employeeId: string | null, enabled = true) {
  const client = useMemo(() => createPlatformApiClient(), []);
  const queryFn = useCallback(
    async (signal: AbortSignal) => {
      if (!employeeId) throw new Error("Employee is required.");
      return client.get<WorkforceAccessCandidateDto>(
        coreWorkforceAccessPaths.candidate(employeeId),
        { signal }
      );
    },
    [client, employeeId]
  );

  return useApiQuery(
    employeeId
      ? coreWorkforceAccessQueryKeys.candidate(employeeId)
      : ([
          ...coreWorkforceAccessQueryKeys.all(),
          "candidate",
          "pending",
        ] as const),
    queryFn,
    { enabled: enabled && !!employeeId }
  );
}

export function useAccessCandidates(
  employeeIds: readonly string[],
  enabled = true
) {
  const client = useMemo(() => createPlatformApiClient(), []);
  const stableEmployeeIds = useMemo(
    () => [...new Set(employeeIds)].sort(),
    [employeeIds]
  );
  const queryFn = useCallback(
    (signal: AbortSignal) =>
      client.post<WorkforceAccessCandidateDto[]>(
        coreWorkforceAccessPaths.candidates(),
        {
          employeeIds: stableEmployeeIds,
        } satisfies WorkforceAccessCandidatesRequest,
        { signal }
      ),
    [client, stableEmployeeIds]
  );

  return useApiQuery(
    coreWorkforceAccessQueryKeys.candidates(stableEmployeeIds),
    queryFn,
    { enabled: enabled && stableEmployeeIds.length > 0 }
  );
}

interface SinglePersonMutationArgs {
  employeeId: string;
  baseline: WorkforceBaselineChoice;
  expectedVersion: number;
}

function useSinglePersonMutation(pathFor: (employeeId: string) => string) {
  const client = useMemo(() => createPlatformApiClient(), []);
  return useApiMutation<
    WorkforceAccessCommandResultDto,
    SinglePersonMutationArgs
  >(
    ({ employeeId, baseline, expectedVersion }) =>
      client.post<WorkforceAccessCommandResultDto>(pathFor(employeeId), {
        employeeId,
        baseline,
        expectedVersion,
      }),
    { invalidateQueries: MUTATION_INVALIDATIONS }
  );
}

export function useBulkActivate() {
  const client = useMemo(() => createPlatformApiClient(), []);
  return useApiMutation<
    WorkforceAccessBulkResultDto,
    WorkforceAccessBulkRequest
  >(
    (request) =>
      client.post<WorkforceAccessBulkResultDto>(
        coreWorkforceAccessPaths.bulkActivate(),
        request
      ),
    { invalidateQueries: MUTATION_INVALIDATIONS }
  );
}

/**
 * Resolves a simple workforce blocker without leaving the activation plan. The
 * write still goes through the canonical CoreHR People command; this hook only
 * gives the workflow a focused entry point and refreshes both surfaces after it
 * succeeds.
 */
export function useUpdateWorkforceWorkEmail() {
  const client = useMemo(() => createPlatformApiClient(), []);
  const api = useMemo(() => createCorePeopleApi(client), [client]);
  const queryClient = useQueryClient();

  return useApiMutation<
    void,
    { employeeKey: string; workEmail: string; expectedVersion: number }
  >(
    ({ employeeKey, workEmail, expectedVersion }) =>
      api.updateWorkEmail(employeeKey, { workEmail }, expectedVersion),
    {
      onSuccess: (_result, variables) => {
        void queryClient.invalidateQueries({
          queryKey: corePeopleQueryKeys.all(),
        });
        void queryClient.invalidateQueries({
          queryKey: coreWorkforceQueryKeys.all(),
        });
        void queryClient.invalidateQueries({
          queryKey: coreWorkforceAccessQueryKeys.all(),
        });
        void queryClient.invalidateQueries({
          queryKey: corePeopleQueryKeys.profile(variables.employeeKey),
        });
      },
    }
  );
}

export const useActivateAccess = () =>
  useSinglePersonMutation(coreWorkforceAccessPaths.activate);

function useInviteLifecycleMutation(pathFor: (employeeId: string) => string) {
  const client = useMemo(() => createPlatformApiClient(), []);
  return useApiMutation<
    WorkforceAccessCommandResultDto,
    { employeeId: string }
  >(
    ({ employeeId }) =>
      client.post<WorkforceAccessCommandResultDto>(pathFor(employeeId), {}),
    { invalidateQueries: [...MUTATION_INVALIDATIONS, { queryKey: corePeopleQueryKeys.all() }] }
  );
}

export const useResendInvite = () =>
  useInviteLifecycleMutation(coreWorkforceAccessPaths.resend);
export const useWithdrawInvite = () =>
  useInviteLifecycleMutation(coreWorkforceAccessPaths.withdraw);
export const useSuspendAccess = () =>
  useInviteLifecycleMutation(coreWorkforceAccessPaths.suspend);
export const useRestoreAccess = () =>
  useInviteLifecycleMutation(coreWorkforceAccessPaths.restore);

/** The person's account story for Person › Access › History (B-231), newest first. */
export function useAccessHistory(employeeId: string | null, enabled = true) {
  const client = useMemo(() => createPlatformApiClient(), []);
  const queryFn = useCallback(
    async (signal: AbortSignal) => {
      if (!employeeId) throw new Error("Employee is required.");
      return client.get<WorkforceAccountHistoryEventDto[]>(
        coreWorkforceAccessPaths.history(employeeId),
        { signal }
      );
    },
    [client, employeeId]
  );
  return useApiQuery(
    employeeId
      ? coreWorkforceAccessQueryKeys.history(employeeId)
      : ([...coreWorkforceAccessQueryKeys.all(), "history", "pending"] as const),
    queryFn,
    { enabled: enabled && !!employeeId }
  );
}
/**
 * Single-person identity correction: rebinds one account from the source Employee (route)
 * onto the corrected target Employee. The command carries only references, the reviewed
 * baseline, the required reason, and the reviewed access revision — never an identity fact.
 */
export function useCorrectIdentity() {
  const client = useMemo(() => createPlatformApiClient(), []);
  return useApiMutation<
    WorkforceAccessCommandResultDto,
    WorkforceAccessCorrectionCommand
  >(
    (command) =>
      client.post<WorkforceAccessCommandResultDto>(
        coreWorkforceAccessPaths.correct(command.employeeId),
        command
      ),
    { invalidateQueries: MUTATION_INVALIDATIONS }
  );
}

export const useLinkAccess = () =>
  useSinglePersonMutation(coreWorkforceAccessPaths.link);
export const useReactivateAccess = () =>
  useSinglePersonMutation(coreWorkforceAccessPaths.reactivate);
export const useConnectAccess = () =>
  useSinglePersonMutation(coreWorkforceAccessPaths.connect);

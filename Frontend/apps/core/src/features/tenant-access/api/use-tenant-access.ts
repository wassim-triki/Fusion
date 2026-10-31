"use client";

import { useCallback, useMemo } from "react";
import {
  ApiError,
  coreAccessQueryKeys,
  createPlatformApiClient,
  tenantAccessPaths,
  tenantAccessQueryKeys,
  type AddAdministratorRequest,
  type AdministratorCandidateDto,
  type AdministratorHistoryItemDto,
  type TenantAccessProblemType,
  type TenantAccessSummaryDto,
  type TenantAdministratorDto,
} from "@repo/api";
import { useApiMutation, useApiQuery, useApiQueryClient } from "@repo/api/query";
import { useAuth } from "@repo/auth";

type ApiQueryClient = ReturnType<typeof useApiQueryClient>;

/** A change to who administers the company refreshes the page, the summary and the roles table together. */
async function refreshAdministrators(queryClient: ApiQueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: tenantAccessQueryKeys.all() }),
    queryClient.invalidateQueries({ queryKey: coreAccessQueryKeys.roles() }),
  ]);
}

/**
 * The stable problem type behind a failure, so each one can be resolved the way
 * it actually needs to be. Falls back to `unexpected` rather than guessing from
 * message text.
 */
export function problemTypeOf(error: unknown): TenantAccessProblemType {
  if (!(error instanceof ApiError)) {
    return "unexpected";
  }

  // The envelope carries the machine-readable type under `details.code`; the
  // client only lifts a root-level `code` into ApiError.code.
  const details = error.details as { code?: unknown } | null;
  const code = typeof details?.code === "string" ? details.code : error.code;

  return (code as TenantAccessProblemType | null) ?? "unexpected";
}

// ── Reads ──────────────────────────────────────────────

export function useTenantAccessSummary(enabled = true) {
  const { isAuthenticated } = useAuth();
  const client = useMemo(() => createPlatformApiClient(), []);

  const queryFn = useCallback(
    (signal: AbortSignal) =>
      client.get<TenantAccessSummaryDto>(tenantAccessPaths.summary(), { signal }),
    [client]
  );

  return useApiQuery(tenantAccessQueryKeys.summary(), queryFn, {
    enabled: isAuthenticated && enabled,
  });
}

export function useTenantAdministrators(enabled = true) {
  const { isAuthenticated } = useAuth();
  const client = useMemo(() => createPlatformApiClient(), []);

  const queryFn = useCallback(
    (signal: AbortSignal) =>
      client.get<TenantAdministratorDto[]>(tenantAccessPaths.administrators(), { signal }),
    [client]
  );

  return useApiQuery(tenantAccessQueryKeys.administrators(), queryFn, {
    enabled: isAuthenticated && enabled,
  });
}

export function useAdministratorHistory(enabled = true) {
  const { isAuthenticated } = useAuth();
  const client = useMemo(() => createPlatformApiClient(), []);

  const queryFn = useCallback(
    (signal: AbortSignal) =>
      client.get<AdministratorHistoryItemDto[]>(tenantAccessPaths.administratorHistory(), { signal }),
    [client]
  );

  return useApiQuery(tenantAccessQueryKeys.administratorHistory(), queryFn, {
    enabled: isAuthenticated && enabled,
  });
}

/** People who could be added, for the add sheet; only administrators may ask. */
export function useAdministratorCandidates(search: string, enabled = true) {
  const { isAuthenticated } = useAuth();
  const client = useMemo(() => createPlatformApiClient(), []);

  const queryFn = useCallback(
    (signal: AbortSignal) =>
      client.get<AdministratorCandidateDto[]>(tenantAccessPaths.administratorCandidates(), {
        signal,
        params: { search },
      }),
    [client, search]
  );

  return useApiQuery(tenantAccessQueryKeys.administratorCandidates(search), queryFn, {
    enabled: isAuthenticated && enabled,
  });
}

// ── Changes ────────────────────────────────────────────

export function useAddAdministrator() {
  const client = useMemo(() => createPlatformApiClient(), []);
  const queryClient = useApiQueryClient();

  return useApiMutation<unknown, AddAdministratorRequest>(
    (request) => client.post(tenantAccessPaths.administrators(), request),
    { onSuccess: () => refreshAdministrators(queryClient) }
  );
}

/** Covers stepping down: the actor names their own membership. */
export function useRemoveAdministrator() {
  const client = useMemo(() => createPlatformApiClient(), []);
  const queryClient = useApiQueryClient();

  return useApiMutation<unknown, { membershipId: string; version: number }>(
    ({ membershipId, version }) =>
      client.post(tenantAccessPaths.revokeAuthority(membershipId), {}, { headers: { "If-Match": `"${version}"` } }),
    { onSuccess: () => refreshAdministrators(queryClient) }
  );
}

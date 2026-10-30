"use client";

import { useCallback, useMemo } from "react";
import {
  coreAccessPaths,
  coreAccessQueryKeys,
  createPlatformApiClient,
  fusionNavigationQueryKeys,
  type AccessAuditEventDto,
  type AccessProfileSummaryDto,
  type CreateRoleRequest,
  type PersonRoleDto,
  type RoleCandidateDto,
  type RoleDetailDto,
  type RolesOverviewDto,
  type SaveRoleRequest,
} from "@repo/api";
import {
  useApiMutation,
  useApiQuery,
  useApiQueryClient,
} from "@repo/api/query";
import { useAuth } from "@repo/auth";

type ApiQueryClient = ReturnType<typeof useApiQueryClient>;

/** A role change can move who holds what, so the lists, the history and the settings' "last changed" refresh. */
async function invalidateRoleQueries(queryClient: ApiQueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: coreAccessQueryKeys.roles() }),
    queryClient.invalidateQueries({ queryKey: coreAccessQueryKeys.profiles() }),
    queryClient.invalidateQueries({ queryKey: coreAccessQueryKeys.audit() }),
    queryClient.invalidateQueries({ queryKey: [...coreAccessQueryKeys.all(), "person"] }),
    queryClient.invalidateQueries({ queryKey: fusionNavigationQueryKeys.all() }),
  ]);
}

function useClient() {
  return useMemo(() => createPlatformApiClient(), []);
}

export function useAccessProfiles(enabled = true) {
  const { isAuthenticated } = useAuth();
  const client = useClient();
  const queryFn = useCallback(
    (signal: AbortSignal) => client.get<AccessProfileSummaryDto[]>(coreAccessPaths.profiles(), { signal }),
    [client]
  );
  return useApiQuery(coreAccessQueryKeys.profiles(), queryFn, { enabled: isAuthenticated && enabled });
}

export function useAccessAudit(enabled = true) {
  const { isAuthenticated } = useAuth();
  const client = useClient();
  const queryFn = useCallback(
    (signal: AbortSignal) => client.get<AccessAuditEventDto[]>(coreAccessPaths.audit(), { signal }),
    [client]
  );
  return useApiQuery(coreAccessQueryKeys.audit(), queryFn, { enabled: isAuthenticated && enabled });
}

/** Every role with its areas and holders. */
export function useRoles(enabled = true) {
  const { isAuthenticated } = useAuth();
  const client = useClient();
  const queryFn = useCallback(
    (signal: AbortSignal) => client.get<RolesOverviewDto>(coreAccessPaths.roles(), { signal }),
    [client]
  );
  return useApiQuery(coreAccessQueryKeys.roles(), queryFn, { enabled: isAuthenticated && enabled });
}

/** One role, the areas it can be set in, and everyone who holds it. */
export function useRole(roleId: string) {
  const { isAuthenticated } = useAuth();
  const client = useClient();
  const queryFn = useCallback(
    (signal: AbortSignal) => client.get<RoleDetailDto>(coreAccessPaths.role(roleId), { signal }),
    [client, roleId]
  );
  return useApiQuery(coreAccessQueryKeys.role(roleId), queryFn, { enabled: isAuthenticated && Boolean(roleId) });
}

/** People who sign in and can be chosen for a role (or previewed), by name or email. */
export function useRoleCandidates(search: string, enabled = true) {
  const { isAuthenticated } = useAuth();
  const client = useClient();
  const queryFn = useCallback(
    (signal: AbortSignal) => client.get<RoleCandidateDto[]>(coreAccessPaths.roleCandidates(search), { signal }),
    [client, search]
  );
  return useApiQuery(coreAccessQueryKeys.roleCandidates(search), queryFn, {
    enabled: isAuthenticated && enabled,
    placeholderData: (previous) => previous,
  });
}

/** A person's roles and why they have each. */
export function usePersonRoles(employeeId: string | null, enabled = true) {
  const { isAuthenticated } = useAuth();
  const client = useClient();
  const queryFn = useCallback(
    (signal: AbortSignal) => client.get<PersonRoleDto[]>(coreAccessPaths.personRoles(employeeId ?? ""), { signal }),
    [client, employeeId]
  );
  return useApiQuery(coreAccessQueryKeys.personRoles(employeeId ?? ""), queryFn, {
    enabled: isAuthenticated && enabled && Boolean(employeeId),
  });
}

export function useCreateRole(opts?: { onSuccess?: (data: RoleDetailDto) => void }) {
  const client = useClient();
  const queryClient = useApiQueryClient();
  return useApiMutation<RoleDetailDto, CreateRoleRequest>(
    (input) => client.post<RoleDetailDto>(coreAccessPaths.roles(), input),
    {
      onSuccess: async (data) => {
        await invalidateRoleQueries(queryClient);
        await opts?.onSuccess?.(data);
      },
    }
  );
}

export function useSaveRole(roleId: string) {
  const client = useClient();
  const queryClient = useApiQueryClient();
  return useApiMutation<RoleDetailDto, { version: number; input: SaveRoleRequest }>(
    ({ version, input }) =>
      client.put<RoleDetailDto>(coreAccessPaths.role(roleId), input, { headers: { "If-Match": `"${version}"` } }),
    {
      onSuccess: async (data) => {
        queryClient.setQueryData(coreAccessQueryKeys.role(roleId), data);
        await invalidateRoleQueries(queryClient);
      },
    }
  );
}

export function useDeleteRole(roleId: string, opts?: { onSuccess?: () => void }) {
  const client = useClient();
  const queryClient = useApiQueryClient();
  return useApiMutation<void, void>(() => client.delete<void>(coreAccessPaths.role(roleId)), {
    onSuccess: async () => {
      await invalidateRoleQueries(queryClient);
      await opts?.onSuccess?.();
    },
  });
}

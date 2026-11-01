"use client";

import { useCallback, useMemo } from "react";
import {
  coreOrganizationQueryKeys,
  createCoreOrganizationApi,
  createPlatformApiClient,
  type ChangeOrganizationUnitRequest,
  type CorrectOrganizationCodeRequest,
  type CorrectOrganizationUnitRequest,
  type CreateOrganizationRootRequest,
  type CreateOrganizationUnitRequest,
  type CreateOrganizationalUnitTypeRequest,
  type InactivateOrganizationUnitRequest,
  type MoveOrganizationUnitRequest,
  type RenameOrganizationalUnitTypeRequest,
} from "@repo/api";
import { useApiMutation, useApiQuery, useApiQueryClient } from "@repo/api/query";
import { canViewCoreOrganization, useAuth } from "@repo/auth";

export function useOrganizationApi() {
  const client = useMemo(() => createPlatformApiClient(), []);
  return useMemo(() => createCoreOrganizationApi(client), [client]);
}

function useOrganizationReadEnabled(enabled: boolean) {
  const { user, isAuthenticated, isLoading } = useAuth();
  return !isLoading && isAuthenticated && canViewCoreOrganization(user) && enabled;
}

export function useOrganizationReadiness(enabled = true) {
  const api = useOrganizationApi();
  const canRead = useOrganizationReadEnabled(enabled);
  return useApiQuery(
    coreOrganizationQueryKeys.readiness(),
    useCallback((signal) => api.readiness(signal), [api]),
    { enabled: canRead }
  );
}

/** Whether CoreHR's foundation (published organization + sound active workforce) is established. */
export function useCoreHRReadiness(enabled = true) {
  const api = useOrganizationApi();
  const canRead = useOrganizationReadEnabled(enabled);
  return useApiQuery(
    coreOrganizationQueryKeys.coreHRReadiness(),
    useCallback((signal) => api.coreHRReadiness(signal), [api]),
    { enabled: canRead }
  );
}

export function useOrganizationHierarchy(asOf: string, enabled = true) {
  const api = useOrganizationApi();
  const canRead = useOrganizationReadEnabled(enabled);
  return useApiQuery(
    coreOrganizationQueryKeys.hierarchy(asOf),
    useCallback((signal) => api.hierarchy(asOf, signal), [api, asOf]),
    { enabled: canRead, placeholderData: (previous) => previous }
  );
}

export function useOrganizationUnit(id: string | null, asOf: string, enabled = true) {
  const api = useOrganizationApi();
  const canRead = useOrganizationReadEnabled(enabled && Boolean(id));
  return useApiQuery(
    coreOrganizationQueryKeys.unit(id ?? "none", asOf),
    useCallback((signal) => api.unit(id!, asOf, signal), [api, id, asOf]),
    { enabled: canRead }
  );
}

export function useOrganizationSearch(query: string, asOf: string, enabled = true) {
  const api = useOrganizationApi();
  const trimmed = query.trim();
  const canRead = useOrganizationReadEnabled(enabled && trimmed.length >= 2);
  return useApiQuery(
    coreOrganizationQueryKeys.search(trimmed, asOf),
    useCallback((signal) => api.search(trimmed, asOf, signal), [api, trimmed, asOf]),
    { enabled: canRead, placeholderData: (previous) => previous }
  );
}

export function useOrganizationHistory(id: string | null, enabled = true) {
  const api = useOrganizationApi();
  const canRead = useOrganizationReadEnabled(enabled && Boolean(id));
  return useApiQuery(
    coreOrganizationQueryKeys.history(id ?? "none"),
    useCallback((signal) => api.history(id!, signal), [api, id]),
    { enabled: canRead }
  );
}

export function useOrganizationUpcomingChanges(enabled = true) {
  const api = useOrganizationApi();
  const canRead = useOrganizationReadEnabled(enabled);
  return useApiQuery(
    coreOrganizationQueryKeys.upcomingChanges(),
    useCallback((signal) => api.upcomingChanges(signal), [api]),
    { enabled: canRead }
  );
}

export function useOrganizationTypes(enabled = true) {
  const api = useOrganizationApi();
  const canRead = useOrganizationReadEnabled(enabled);
  return useApiQuery(
    coreOrganizationQueryKeys.types(),
    useCallback((signal) => api.types(signal), [api]),
    { enabled: canRead }
  );
}

type Versioned<T> = { id: string; version: number; request: T };

export function useOrganizationMutations() {
  const api = useOrganizationApi();
  const queryClient = useApiQueryClient();
  const refresh = useCallback(
    async () => queryClient.invalidateQueries({ queryKey: coreOrganizationQueryKeys.all() }),
    [queryClient]
  );
  const options = { onSuccess: refresh };

  return {
    createRoot: useApiMutation((request: CreateOrganizationRootRequest) => api.createRoot(request), options),
    createUnit: useApiMutation((request: CreateOrganizationUnitRequest) => api.createUnit(request), options),
    changeUnit: useApiMutation(
      ({ id, version, request }: Versioned<ChangeOrganizationUnitRequest>) =>
        api.changeUnit(id, version, request),
      options
    ),
    moveUnit: useApiMutation(
      ({ id, version, request }: Versioned<MoveOrganizationUnitRequest>) => api.moveUnit(id, version, request),
      options
    ),
    inactivateUnit: useApiMutation(
      ({ id, version, request }: Versioned<InactivateOrganizationUnitRequest>) =>
        api.inactivateUnit(id, version, request),
      options
    ),
    correctUnit: useApiMutation(
      ({ id, version, request }: Versioned<CorrectOrganizationUnitRequest>) =>
        api.correctUnit(id, version, request),
      options
    ),
    correctCode: useApiMutation(
      ({ id, version, request }: Versioned<CorrectOrganizationCodeRequest>) =>
        api.correctCode(id, version, request),
      options
    ),
    cancelChange: useApiMutation(
      ({ id, version }: { id: string; version: number }) => api.cancelChange(id, version),
      options
    ),
    createType: useApiMutation((request: CreateOrganizationalUnitTypeRequest) => api.createType(request), options),
    renameType: useApiMutation(
      ({ id, request }: { id: string; request: RenameOrganizationalUnitTypeRequest }) =>
        api.renameType(id, request),
      options
    ),
    deleteType: useApiMutation((id: string) => api.deleteType(id), options),
  };
}

export type OrganizationMutations = ReturnType<typeof useOrganizationMutations>;

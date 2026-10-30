"use client";

import { useCallback, useMemo } from "react";
import {
  coreCatalogQueryKeys,
  coreOrgChartQueryKeys,
  corePeopleQueryKeys,
  createCoreCatalogApi,
  createPlatformApiClient,
  type CompanyListId,
  type JobRequest,
  type PlaceRequest,
} from "@repo/api";
import { useApiMutation, useApiQuery } from "@repo/api/query";
import { useAuth } from "@repo/auth";

export function useCatalogApi() {
  return useMemo(() => createCoreCatalogApi(createPlatformApiClient()), []);
}

function useSignedIn(enabled: boolean) {
  const { isAuthenticated, isLoading } = useAuth();
  return !isLoading && isAuthenticated && enabled;
}

/** The company's jobs, retired ones included (pickers hide them). */
export function useJobs(enabled = true) {
  const api = useCatalogApi();
  return useApiQuery(coreCatalogQueryKeys.jobs(), useCallback((signal) => api.jobs(signal), [api]), {
    enabled: useSignedIn(enabled),
    staleTime: 30_000,
  });
}

export function usePlaces(enabled = true) {
  const api = useCatalogApi();
  return useApiQuery(coreCatalogQueryKeys.places(), useCallback((signal) => api.places(signal), [api]), {
    enabled: useSignedIn(enabled),
    staleTime: 30_000,
  });
}

/** The company's lists; the first read gives a new company its defaults. */
export function useCompanyLists(enabled = true) {
  const api = useCatalogApi();
  return useApiQuery(coreCatalogQueryKeys.lists(), useCallback((signal) => api.lists(signal), [api]), {
    enabled: useSignedIn(enabled),
    staleTime: 30_000,
  });
}

/** A rename or merge changes the names people and open roles show, so those reads refresh too. */
const AFTER_CATALOG_CHANGE = [
  { queryKey: coreCatalogQueryKeys.all() },
  { queryKey: corePeopleQueryKeys.all() },
  { queryKey: coreOrgChartQueryKeys.all() },
] as const;

export function useJobMutations() {
  const api = useCatalogApi();
  const options = { invalidateQueries: AFTER_CATALOG_CHANGE };
  return {
    create: useApiMutation((request: JobRequest) => api.createJob(request), options),
    update: useApiMutation(({ id, request }: { id: string; request: JobRequest }) => api.updateJob(id, request), options),
    retire: useApiMutation(({ id, retired }: { id: string; retired: boolean }) => (retired ? api.retireJob(id) : api.restoreJob(id)), options),
    merge: useApiMutation(({ id, intoId }: { id: string; intoId: string }) => api.mergeJob(id, intoId), options),
    remove: useApiMutation((id: string) => api.deleteJob(id), options),
  };
}

export function usePlaceMutations() {
  const api = useCatalogApi();
  const options = { invalidateQueries: AFTER_CATALOG_CHANGE };
  return {
    create: useApiMutation((request: PlaceRequest) => api.createPlace(request), options),
    update: useApiMutation(({ id, request }: { id: string; request: PlaceRequest }) => api.updatePlace(id, request), options),
    retire: useApiMutation(({ id, retired }: { id: string; retired: boolean }) => (retired ? api.retirePlace(id) : api.restorePlace(id)), options),
    merge: useApiMutation(({ id, intoId }: { id: string; intoId: string }) => api.mergePlace(id, intoId), options),
    remove: useApiMutation((id: string) => api.deletePlace(id), options),
  };
}

export function useListMutations() {
  const api = useCatalogApi();
  const options = { invalidateQueries: AFTER_CATALOG_CHANGE };
  return {
    add: useApiMutation(({ list, label }: { list: CompanyListId; label: string }) => api.addValue(list, label), options),
    rename: useApiMutation(({ list, id, label }: { list: CompanyListId; id: string; label: string }) => api.renameValue(list, id, label), options),
    retire: useApiMutation(
      ({ list, id, retired }: { list: CompanyListId; id: string; retired: boolean }) => (retired ? api.retireValue(list, id) : api.restoreValue(list, id)),
      options,
    ),
    remove: useApiMutation(({ list, id }: { list: CompanyListId; id: string }) => api.deleteValue(list, id), options),
    reorder: useApiMutation(({ list, ids }: { list: CompanyListId; ids: string[] }) => api.reorder(list, ids), options),
  };
}

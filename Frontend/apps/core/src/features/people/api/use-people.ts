"use client";

import { useCallback, useMemo } from "react";
import {
  coreOrgChartQueryKeys,
  corePeopleQueryKeys,
  tenantSettingsQueryKeys,
  createCorePeopleApi,
  fusionNavigationQueryKeys,
  type UpdatePersonalRequest,
  createPlatformApiClient,
  type AddExistingEmployeeRequest,
  type HireEmployeeRequest,
  type EstablishmentReviewRequest,
  type PeopleQueryParams,
} from "@repo/api";
import { keepPreviousData, useApiMutation, useApiQuery } from "@repo/api/query";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@repo/auth";
import {
  canAccessEmployeeProfile,
  canAccessEmployeeRoster,
} from "@/lib/employee-roster-access";
import { employeeRosterQueryKeys } from "./employee-query-keys";

function usePeopleApi() {
  const client = useMemo(() => createPlatformApiClient(), []);
  return useMemo(() => createCorePeopleApi(client), [client]);
}

export function usePeople(params: PeopleQueryParams) {
  const api = usePeopleApi();
  const { user, isAuthenticated, isLoading } = useAuth();
  const enabled =
    !isLoading && isAuthenticated && canAccessEmployeeRoster(user);
  return useApiQuery(
    corePeopleQueryKeys.list(params),
    useCallback((signal) => api.people(params, signal), [api, params]),
    { enabled, placeholderData: keepPreviousData }
  );
}

export function usePeopleProfile(employeeKey: string, asOf?: string | null) {
  const api = usePeopleApi();
  const { user, isAuthenticated, isLoading } = useAuth();
  const enabled =
    !isLoading &&
    isAuthenticated &&
    canAccessEmployeeProfile(user) &&
    Boolean(employeeKey);
  return useApiQuery(
    corePeopleQueryKeys.profile(employeeKey, asOf ?? null),
    useCallback(
      (signal) => api.profile(employeeKey, asOf ?? null, signal),
      [api, employeeKey, asOf]
    ),
    { enabled }
  );
}

export function usePeopleTimeline(employeeKey: string, enabled = true) {
  const api = usePeopleApi();
  const { user, isAuthenticated, isLoading } = useAuth();
  const canRead =
    !isLoading &&
    isAuthenticated &&
    canAccessEmployeeProfile(user) &&
    Boolean(employeeKey) &&
    enabled;
  return useApiQuery(
    corePeopleQueryKeys.timeline(employeeKey),
    useCallback(
      (signal) => api.timeline(employeeKey, signal),
      [api, employeeKey]
    ),
    { enabled: canRead }
  );
}

export function useUpdatePeopleWorkEmail(employeeKey: string) {
  const api = usePeopleApi();
  const queryClient = useQueryClient();
  return useApiMutation(
    ({
      workEmail,
      expectedVersion,
    }: {
      workEmail: string;
      expectedVersion: number;
    }) => api.updateWorkEmail(employeeKey, { workEmail }, expectedVersion),
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: corePeopleQueryKeys.profiles(),
        });
        void queryClient.invalidateQueries({
          queryKey: corePeopleQueryKeys.lists(),
        });
        void queryClient.invalidateQueries({
          queryKey: corePeopleQueryKeys.accessStatus(employeeKey),
        });
      },
    }
  );
}

export function usePeopleAccessStatus(employeeKey: string, enabled = true) {
  const api = usePeopleApi();
  const { user, isAuthenticated, isLoading } = useAuth();
  const canRead =
    !isLoading &&
    isAuthenticated &&
    canAccessEmployeeProfile(user) &&
    Boolean(employeeKey) &&
    enabled;
  return useApiQuery(
    corePeopleQueryKeys.accessStatus(employeeKey),
    useCallback(
      (signal) => api.accessStatus(employeeKey, signal),
      [api, employeeKey]
    ),
    { enabled: canRead }
  );
}

export function usePeopleEstablishmentMutations() {
  const api = usePeopleApi();
  const queryClient = useQueryClient();
  const refreshCommittedPeople = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: corePeopleQueryKeys.lists(),
    });
    void queryClient.invalidateQueries({
      queryKey: corePeopleQueryKeys.profiles(),
    });
  }, [queryClient]);
  return {
    review: useApiMutation((request: EstablishmentReviewRequest) =>
      api.establishmentReview(request)
    ),
    hire: useApiMutation((request: HireEmployeeRequest) => api.hire(request), {
      onSuccess: refreshCommittedPeople,
    }),
    addExisting: useApiMutation(
      (request: AddExistingEmployeeRequest) => api.addExisting(request),
      { onSuccess: refreshCommittedPeople }
    ),
  };
}

/** What Add a person shows around the form: the manager's team and open roles on the first day, and the company's rules. */
export function useHiringContext(managerId: string | null, on: string) {
  const api = usePeopleApi();
  return useApiQuery(
    corePeopleQueryKeys.hiringContext(managerId, on),
    useCallback((signal) => api.hiringContext(managerId, on, signal), [api, managerId, on]),
    { placeholderData: keepPreviousData }
  );
}

/** The Personal tab, shaped by the server for this viewer. */
export function usePeoplePersonal(employeeKey: string, enabled = true) {
  const api = usePeopleApi();
  const { user, isAuthenticated, isLoading } = useAuth();
  return useApiQuery(
    corePeopleQueryKeys.personal(employeeKey),
    useCallback((signal) => api.personal(employeeKey, signal), [api, employeeKey]),
    { enabled: !isLoading && isAuthenticated && canAccessEmployeeProfile(user) && Boolean(employeeKey) && enabled }
  );
}

/** Saves the whole Personal tab; the preferred name and mobile also show on the profile and in lists. */
export function useUpdatePeoplePersonal(employeeKey: string) {
  const api = usePeopleApi();
  const queryClient = useQueryClient();
  return useApiMutation(
    ({ request, expectedVersion }: { request: UpdatePersonalRequest; expectedVersion: number }) =>
      api.updatePersonal(employeeKey, request, expectedVersion),
    {
      onSuccess: (saved) => {
        queryClient.setQueryData(corePeopleQueryKeys.personal(employeeKey), saved);
        void queryClient.invalidateQueries({ queryKey: corePeopleQueryKeys.profiles() });
        void queryClient.invalidateQueries({ queryKey: corePeopleQueryKeys.timeline(employeeKey) });
        void queryClient.invalidateQueries({ queryKey: corePeopleQueryKeys.lists() });
        void queryClient.invalidateQueries({ queryKey: employeeRosterQueryKeys.all() });
      },
    }
  );
}

/** Job information rows: HR and the branch manager only (the server answers 403 to anyone else). */
export function usePeopleJobHistory(employeeKey: string, enabled = true) {
  const api = usePeopleApi();
  const { user, isAuthenticated, isLoading } = useAuth();
  return useApiQuery(
    corePeopleQueryKeys.jobHistory(employeeKey),
    useCallback((signal) => api.jobHistory(employeeKey, signal), [api, employeeKey]),
    { enabled: !isLoading && isAuthenticated && canAccessEmployeeProfile(user) && Boolean(employeeKey) && enabled }
  );
}

/** Sets or removes a photo; every place that shows the person picks up the new address. */
export function usePhotoMutations(employeeKey: string) {
  const api = usePeopleApi();
  const queryClient = useQueryClient();
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: corePeopleQueryKeys.profiles() });
    void queryClient.invalidateQueries({ queryKey: corePeopleQueryKeys.lists() });
    void queryClient.invalidateQueries({ queryKey: coreOrgChartQueryKeys.all() });
    void queryClient.invalidateQueries({ queryKey: employeeRosterQueryKeys.all() });
    void queryClient.invalidateQueries({ queryKey: [...fusionNavigationQueryKeys.all(), "my-card"] });
  }, [queryClient]);
  return {
    upload: useApiMutation(
      (photo: Blob) => api.uploadPhoto(employeeKey, photo, photo.type === "image/webp" ? "photo.webp" : "photo.png"),
      { onSuccess: refresh }
    ),
    remove: useApiMutation(() => api.removePhoto(employeeKey), { onSuccess: refresh }),
  };
}

/** Saves what the person says about themselves; the page's profile read picks it up. */
export function useUpdatePeopleAbout(employeeKey: string) {
  const api = usePeopleApi();
  const queryClient = useQueryClient();
  return useApiMutation((about: string | null) => api.updateAbout(employeeKey, about), {
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: corePeopleQueryKeys.profiles() }),
  });
}

/** Company fields the server allows this viewer to see on the person. */
export function usePeopleFields(employeeKey: string, enabled = true) {
  const api = usePeopleApi();
  const { user, isAuthenticated, isLoading } = useAuth();
  return useApiQuery(
    corePeopleQueryKeys.fields(employeeKey),
    useCallback((signal) => api.fields(employeeKey, signal), [api, employeeKey]),
    { enabled: !isLoading && isAuthenticated && canAccessEmployeeProfile(user) && Boolean(employeeKey) && enabled }
  );
}

export function useUpdatePeopleField(employeeKey: string) {
  const api = usePeopleApi();
  const queryClient = useQueryClient();
  return useApiMutation(
    ({ fieldKey, value }: { fieldKey: string; value: unknown }) => api.updateField(employeeKey, fieldKey, value),
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: corePeopleQueryKeys.fields(employeeKey) });
        void queryClient.invalidateQueries({ queryKey: tenantSettingsQueryKeys.fields() });
      },
    }
  );
}

/** The person's documents: the person and HR only (the server answers 403 to anyone else). */
export function usePeopleDocuments(employeeKey: string, enabled = true) {
  const api = usePeopleApi();
  const { user, isAuthenticated, isLoading } = useAuth();
  return useApiQuery(
    corePeopleQueryKeys.documents(employeeKey),
    useCallback((signal) => api.documents(employeeKey, signal), [api, employeeKey]),
    { enabled: !isLoading && isAuthenticated && canAccessEmployeeProfile(user) && Boolean(employeeKey) && enabled }
  );
}

/** Adds, removes and opens a person's documents. */
export function useDocumentMutations(employeeKey: string) {
  const api = usePeopleApi();
  const queryClient = useQueryClient();
  const refresh = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: corePeopleQueryKeys.documents(employeeKey) }),
    [queryClient, employeeKey]
  );
  return {
    add: useApiMutation((file: File) => api.addDocument(employeeKey, file), { onSuccess: refresh }),
    remove: useApiMutation((documentId: string) => api.removeDocument(employeeKey, documentId), { onSuccess: refresh }),
    open: useCallback((documentId: string) => api.documentFile(employeeKey, documentId), [api, employeeKey]),
  };
}

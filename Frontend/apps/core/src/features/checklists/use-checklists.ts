"use client";

import { useCallback, useMemo } from "react";
import {
  coreChecklistQueryKeys,
  createCoreChecklistsApi,
  createPlatformApiClient,
  fusionAttentionQueryKeys,
  type ChecklistKind,
  type ChecklistTemplateTaskInput,
} from "@repo/api";
import { useApiMutation, useApiQuery } from "@repo/api/query";
import { useAuth } from "@repo/auth";

function useChecklistsApi() {
  return useMemo(() => createCoreChecklistsApi(createPlatformApiClient()), []);
}

function useSignedIn(enabled: boolean) {
  const { isAuthenticated, isLoading } = useAuth();
  return !isLoading && isAuthenticated && enabled;
}

export function useChecklistTemplates() {
  const api = useChecklistsApi();
  return useApiQuery(coreChecklistQueryKeys.templates(), useCallback((signal) => api.templates(signal), [api]), {
    enabled: useSignedIn(true),
  });
}

export function useSaveChecklistTemplate() {
  const api = useChecklistsApi();
  return useApiMutation(
    ({ kind, tasks }: { kind: ChecklistKind; tasks: ChecklistTemplateTaskInput[] }) => api.saveTemplate(kind, tasks),
    { invalidateQueries: [{ queryKey: coreChecklistQueryKeys.templates() }] },
  );
}

/** The person's checklists as the viewer may see them. */
export function usePersonChecklists(employeeKey: string | undefined) {
  const api = useChecklistsApi();
  return useApiQuery(
    coreChecklistQueryKeys.person(employeeKey ?? ""),
    useCallback((signal) => api.person(employeeKey!, signal), [api, employeeKey]),
    { enabled: useSignedIn(Boolean(employeeKey)) },
  );
}

/** Ticking a task also refreshes Needs you. */
export function useSetChecklistTask() {
  const api = useChecklistsApi();
  return useApiMutation(({ id, done }: { id: string; done: boolean }) => api.setDone(id, done), {
    invalidateQueries: [{ queryKey: coreChecklistQueryKeys.all() }, { queryKey: fusionAttentionQueryKeys.all() }],
  });
}

export function useBirthdaySharing(enabled: boolean) {
  const api = useChecklistsApi();
  return useApiQuery(coreChecklistQueryKeys.birthday(), useCallback((signal) => api.birthday(signal), [api]), {
    enabled: useSignedIn(enabled),
  });
}

export function useSetBirthdaySharing() {
  const api = useChecklistsApi();
  return useApiMutation((share: boolean) => api.setBirthday(share), {
    invalidateQueries: [{ queryKey: coreChecklistQueryKeys.birthday() }, { queryKey: fusionAttentionQueryKeys.all() }],
  });
}

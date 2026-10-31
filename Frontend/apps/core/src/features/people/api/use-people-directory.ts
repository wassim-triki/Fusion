"use client";

import { useCallback, useMemo } from "react";
import {
  corePeopleQueryKeys,
  createCorePeopleApi,
  createPlatformApiClient,
  type PeopleExportFormat,
  type PeopleQueryParams,
  type SendInvitationsRequest,
} from "@repo/api";
import { useApiMutation, useApiQuery } from "@repo/api/query";
import { useQueryClient } from "@tanstack/react-query";
import { canViewWorkforceAccess, useAuth } from "@repo/auth";
import { canAccessEmployeeProfile } from "@/lib/employee-roster-access";

function usePeopleApi() {
  const client = useMemo(() => createPlatformApiClient(), []);
  return useMemo(() => createCorePeopleApi(client), [client]);
}

/** Everyone in the company as any colleague sees them (D-28). */
export function usePeopleDirectory(enabled = true) {
  const api = usePeopleApi();
  const { user, isAuthenticated, isLoading } = useAuth();
  return useApiQuery(
    corePeopleQueryKeys.directory(),
    useCallback((signal) => api.directory(signal), [api]),
    { enabled: enabled && !isLoading && isAuthenticated && canAccessEmployeeProfile(user) }
  );
}

/** What the invite sheet offers: how many each choice reaches, and what is planned. */
export function useInvitationPlan(enabled = true) {
  const api = usePeopleApi();
  const { user, isAuthenticated, isLoading } = useAuth();
  return useApiQuery(
    corePeopleQueryKeys.invitations(),
    useCallback((signal) => api.invitationPlan(signal), [api]),
    { enabled: enabled && !isLoading && isAuthenticated && canViewWorkforceAccess(user) }
  );
}

export function useInvitationMutations() {
  const api = usePeopleApi();
  const queryClient = useQueryClient();
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: corePeopleQueryKeys.invitations() });
    void queryClient.invalidateQueries({ queryKey: corePeopleQueryKeys.lists() });
    void queryClient.invalidateQueries({ queryKey: corePeopleQueryKeys.profiles() });
  }, [queryClient]);
  return {
    send: useApiMutation((request: SendInvitationsRequest) => api.sendInvitations(request), { onSuccess: refresh }),
    cancel: useApiMutation((scheduleId: string) => api.cancelInvitations(scheduleId), { onSuccess: refresh }),
  };
}

/** People as filtered, as a file the server builds with only what the viewer may see. */
export function usePeopleExport(params: PeopleQueryParams) {
  const api = usePeopleApi();
  return useCallback(
    async (format: "csv" | "xlsx") => {
      const serverFormat: PeopleExportFormat = format === "xlsx" ? "Xlsx" : "Csv";
      const blob = await api.exportPeople(serverFormat, params);
      const day = new Date().toISOString().slice(0, 10);
      return { blob, fileName: `People ${day}.${format}` };
    },
    [api, params]
  );
}

"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, coreImportQueryKeys, createCoreImportApi, createPlatformApiClient, type CompanyImportDto, type CoreImportApi } from "@repo/api";
import { useApiQuery } from "@repo/api/query";
import { useAuth } from "@repo/auth";

export function useImportApi() {
  return useMemo(() => createCoreImportApi(createPlatformApiClient()), []);
}

function useSignedIn(enabled: boolean) {
  const { isAuthenticated, isLoading } = useAuth();
  return !isLoading && isAuthenticated && enabled;
}

/** The import still open, if any: the drop page resumes it. */
export function useActiveImport(enabled = true) {
  const api = useImportApi();
  return useApiQuery(coreImportQueryKeys.active(), useCallback((signal) => api.active(signal), [api]), {
    enabled: useSignedIn(enabled),
  });
}

export function useEarlierImports(enabled = true) {
  const api = useImportApi();
  return useApiQuery(coreImportQueryKeys.earlier(), useCallback((signal) => api.earlier(signal), [api]), {
    enabled: useSignedIn(enabled),
  });
}

/** One import; polled while it's being brought in so the frame fills as people are created. */
export function useCompanyImport(id: string) {
  const api = useImportApi();
  return useApiQuery(coreImportQueryKeys.session(id), useCallback((signal) => api.session(id, signal), [api, id]), {
    enabled: useSignedIn(true),
    refetchInterval: (query) => (query.state.data?.status === "BringingIn" ? 600 : false),
  });
}

/**
 * Runs a change to the import with its current version and puts the answer in the cache. A stale version reloads
 * the import and says so; any other refusal comes back as the server's words.
 */
export function useImportChange(id: string) {
  const api = useImportApi();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (label: string, change: (api: CoreImportApi, version: number) => Promise<CompanyImportDto>) => {
      const current = queryClient.getQueryData<CompanyImportDto>(coreImportQueryKeys.session(id));
      if (!current) return null;
      setPending(label);
      setError(null);
      try {
        const next = await change(api, current.version);
        queryClient.setQueryData(coreImportQueryKeys.session(id), next);
        return next;
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 409) await queryClient.invalidateQueries({ queryKey: coreImportQueryKeys.session(id) });
        setError(caught instanceof ApiError ? (caught.errors[0] ?? caught.message) : String(caught));
        return null;
      } finally {
        setPending(null);
      }
    },
    [api, id, queryClient],
  );

  return { run, pending, error, clearError: () => setError(null) };
}

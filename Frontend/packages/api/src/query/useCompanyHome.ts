"use client";

import { useMemo } from "react";
import { companyHomeKeys, createCompanyHomeApi } from "../company-home";
import { createPlatformApiClient } from "../platform";
import { useFusionViewer } from "../react/fusion-viewer";
import { useApiQuery } from "./useApiQuery";

export function useCompanyWorkWeek() {
  const { viewer } = useFusionViewer();
  const api = useMemo(() => createCompanyHomeApi(createPlatformApiClient()), []);
  return useApiQuery(companyHomeKeys.workWeek(viewer?.tenantId ?? "none"), (signal) => api.workWeek(signal), {
    enabled: Boolean(viewer?.tenantId),
  });
}

export function useMyManager() {
  const { viewer } = useFusionViewer();
  const api = useMemo(() => createCompanyHomeApi(createPlatformApiClient()), []);
  return useApiQuery(companyHomeKeys.manager(viewer?.tenantId ?? "none", viewer?.userId ?? "none"), (signal) => api.manager(signal), {
    enabled: Boolean(viewer?.tenantId && viewer.employeeId), retry: false,
  });
}

/** Who a refused person can ask, from their own company only. A failed read falls back to "your administrator". */
export function useCompanyAdministrators(enabled: boolean) {
  const { viewer } = useFusionViewer();
  const api = useMemo(() => createCompanyHomeApi(createPlatformApiClient()), []);
  return useApiQuery(companyHomeKeys.administrators(viewer?.tenantId ?? "none"), (signal) => api.administrators(signal), {
    enabled: enabled && Boolean(viewer?.tenantId), retry: false,
  });
}

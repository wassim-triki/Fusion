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

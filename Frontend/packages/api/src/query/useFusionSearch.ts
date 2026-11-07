"use client";

import { useMemo } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { createFusionSearchApi, fusionSearchKeys } from "../fusion-search";
import { createPlatformApiClient } from "../platform";
import { useFusionViewer } from "../react/fusion-viewer";
import { useApiQuery } from "./useApiQuery";

/**
 * The top bar search's two reads, asked in parallel for the settled text (B-211). Each module answers on its own:
 * one that is down or refuses just has no data, and its groups go missing. Empty text asks Core HR for the
 * viewer's own people.
 */
export function useFusionSearch(q: string, options: { open: boolean; core: boolean; performance: boolean }) {
  const { viewer } = useFusionViewer();
  const api = useMemo(() => createFusionSearchApi(createPlatformApiClient()), []);
  const tenantId = viewer?.tenantId ?? "none";
  const userId = viewer?.userId ?? "none";
  const text = q.trim();
  const core = useApiQuery(fusionSearchKeys.core(tenantId, userId, text), (signal) => api.core(text, signal), {
    enabled: options.open && options.core && Boolean(viewer?.tenantId),
    retry: false,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  const performance = useApiQuery(fusionSearchKeys.performance(tenantId, userId, text), (signal) => api.performance(text, signal), {
    enabled: options.open && options.performance && Boolean(viewer?.tenantId) && text.length > 0,
    retry: false,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  return { core, performance };
}

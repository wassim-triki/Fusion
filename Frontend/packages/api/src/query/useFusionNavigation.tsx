"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { FusionAttentionApi } from "../fusion-attention";
import {
  countByModule,
  countBySection,
  countHome,
  createFusionNavigationApi,
  fusionNavigationQueryKeys,
  visibleFusionModules,
  type CoreMeCardDto,
  type FusionModuleEntry,
  type FusionModuleKey,
  type FusionNavigationApi,
  type FusionRecentRecord,
  type FusionTenantSummaryDto,
} from "../fusion-navigation";
import { LAST_COMPANY_KEY } from "../company-brand";
import { createPlatformApiClient } from "../platform";
import { useFusionViewer, useRecentRecords } from "../react/fusion-viewer";
import { useFusionWork } from "./useFusionAttention";
import { usePhoto } from "./usePhoto";

const IDENTITY_STALE_MS = 10 * 60_000;

/**
 * Each module is its own document, so a query cache never outlives a module
 * switch. The card and tenant name are also kept for the browser session, so
 * the sidebar shows them at once on the next module instead of flashing.
 */
function readSession<T>(key: string): T | undefined {
  try {
    const raw = typeof window === "undefined" ? null : window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeSession(key: string, value: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A convenience only.
  }
}

function useNavigationApi(api?: FusionNavigationApi): FusionNavigationApi {
  return useMemo(() => api ?? createFusionNavigationApi(createPlatformApiClient()), [api]);
}

export interface UseFusionNavigationOptions {
  /** Injected for tests. */
  api?: FusionNavigationApi;
  attentionApi?: FusionAttentionApi;
}

/** The signed-in person's own Core HR card; absent without an employee record or when Core HR says 404. */
export function useMyCard(options: Pick<UseFusionNavigationOptions, "api"> = {}) {
  const { viewer } = useFusionViewer();
  const api = useNavigationApi(options.api);
  const queryKey = fusionNavigationQueryKeys.myCard(viewer?.userId ?? "none", viewer?.tenantId ?? null);
  const sessionKey = queryKey.join(":");
  return useQuery<CoreMeCardDto>({
    queryKey,
    queryFn: async ({ signal }) => {
      const card = await api.getMyCard(signal);
      writeSession(sessionKey, card);
      return card;
    },
    initialData: () => readSession<CoreMeCardDto>(sessionKey),
    initialDataUpdatedAt: 0,
    enabled: Boolean(viewer?.tenantId && viewer.employeeId),
    staleTime: IDENTITY_STALE_MS,
    retry: false,
  });
}

/** The company this browser last used, for its sign-in page. */
function rememberCompany(slug: string | undefined) {
  if (!slug) return;
  try {
    window.localStorage.setItem(LAST_COMPANY_KEY, slug);
  } catch {
    // Storage may be blocked; sign-in then shows Fusion's own side.
  }
}

/**
 * The caller's company: its name, logo and colour for the sidebar and the brand everywhere. Kept for the session so
 * the frame opens in the company's brand; the brand studio refreshes it after a save.
 */
export function useTenantSummary(options: Pick<UseFusionNavigationOptions, "api"> = {}) {
  const { viewer } = useFusionViewer();
  const api = useNavigationApi(options.api);
  const queryKey = fusionNavigationQueryKeys.tenant(viewer?.tenantId ?? "none");
  const sessionKey = `${queryKey.join(":")}:brand`;
  return useQuery<FusionTenantSummaryDto>({
    queryKey,
    queryFn: async ({ signal }) => {
      const summary = await api.getTenant(signal);
      writeSession(sessionKey, summary);
      rememberCompany(summary.slug);
      return summary;
    },
    initialData: () => readSession<FusionTenantSummaryDto>(sessionKey),
    initialDataUpdatedAt: 0,
    enabled: Boolean(viewer?.tenantId),
    staleTime: IDENTITY_STALE_MS,
    retry: false,
  });
}

export interface FusionNavigationModule extends FusionModuleEntry {
  /** Waiting work; absent when the module serves none, failed or hasn't answered. */
  count?: number;
}

export interface FusionNavigationState {
  /** The session is still restoring: render the frame with placeholders. */
  pending: boolean;
  tenantName: string | null;
  /** The company's logo address; null without one or while it loads. */
  tenantLogoUrl: string | null;
  /** The company's colour (`#rrggbb`), null for Fusion's own; undefined until the company is known. */
  brandColor: string | null | undefined;
  /** Absent until at least one module answered. */
  homeCount?: number;
  modules: FusionNavigationModule[];
  /** Waiting work per navigation path passed in `sectionPaths`. */
  sectionCounts: Record<string, number>;
  recent: FusionRecentRecord[];
  person: {
    name: string | null;
    /** Their photo, ready to display; null without one or while it loads. */
    photo: string | null;
    /** Job title from Core HR, else the account type in plain words. */
    detail: string | null;
    /** The title is still resolving; show a placeholder rather than the fallback. */
    detailPending: boolean;
  };
}

/**
 * Everything the Fusion sidebar shows besides a module's own sections: the
 * tenant, the modules the viewer can enter with their counts, section counts,
 * Recent and the person. One work query per module, shared with the bell and
 * the home through the query cache.
 */
export function useFusionNavigation(
  current: FusionModuleKey | null,
  sectionPaths: readonly string[],
  options: UseFusionNavigationOptions = {},
): FusionNavigationState {
  const { viewer, isLoading } = useFusionViewer();
  const modules = useMemo(() => visibleFusionModules(viewer), [viewer]);
  const attention = useMemo(
    () => modules.flatMap((module) => (module.attention ? [module.attention] : [])),
    [modules],
  );
  const work = useFusionWork(attention, { enabled: Boolean(viewer?.tenantId), api: options.attentionApi });
  const card = useMyCard({ api: options.api });
  const photo = usePhoto(card.data?.photoUrl);
  const tenant = useTenantSummary({ api: options.api });
  const recent = useRecentRecords(current);

  const answered = work.modules.filter((module) => module.status === "ready").map((module) => module.key);
  const byModule = countByModule(work.items, answered);
  const answeredItems = work.items.filter((item) => answered.includes(item.module));

  const cardTitle = card.data?.jobTitle?.trim() || null;
  const cardExpected = Boolean(viewer?.tenantId && viewer.employeeId);
  return {
    pending: isLoading,
    tenantName: tenant.data?.name ?? null,
    tenantLogoUrl: tenant.data?.logoUrl ?? null,
    brandColor: tenant.data ? (tenant.data.brandColor ?? null) : undefined,
    homeCount: answered.length > 0 ? countHome(answeredItems) : undefined,
    modules: modules.map((module) => ({
      ...module,
      count: module.attention ? byModule[module.attention] : undefined,
    })),
    sectionCounts: countBySection(answeredItems, sectionPaths),
    recent,
    person: {
      name: viewer?.fullName ?? null,
      photo,
      detail: cardTitle ?? viewer?.accountLabel ?? null,
      detailPending: isLoading || (cardExpected && card.isPending),
    },
  };
}

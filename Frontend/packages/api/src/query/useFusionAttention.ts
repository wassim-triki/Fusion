"use client";

import {
  useQueries,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createFusionAttentionApi,
  FUSION_ATTENTION_MODULES,
  fusionAttentionPaths,
  fusionAttentionQueryKeys,
  type FusionAttentionApi,
  type FusionAttentionModule,
  type FusionAttentionModuleKey,
  type FusionNotification,
  type FusionNotificationPage,
  type FusionUpcoming,
  type FusionWorkItem,
} from "../fusion-attention";
import { connectFusionFeed } from "../fusion-feed";
import { createPlatformApiClient, openPlatformEventStream } from "../platform";

export type FusionModuleLoadStatus = "loading" | "ready" | "error";

export interface FusionModuleState {
  key: FusionAttentionModuleKey;
  label: string;
  status: FusionModuleLoadStatus;
}

export interface UseFusionAttentionOptions {
  enabled?: boolean;
  /** Injected for tests; defaults to the platform client through the shell's `/api`. */
  api?: FusionAttentionApi;
  /**
   * Opens a module's live nudge stream. Defaults to the shell's `/api` with the session token when `api` isn't
   * injected; tests pass one, or nothing to leave the stream off.
   */
  openStream?: (path: string, signal: AbortSignal) => Promise<Response>;
}

/** How often the bell refetches without a live stream. */
export const FUSION_NOTIFICATION_POLL_MS = 60_000;
/** The slow fallback while a module's live stream is open: it catches anything a dropped nudge missed. */
export const FUSION_NOTIFICATION_FALLBACK_POLL_MS = 5 * 60_000;
const NOTIFICATION_PAGE_SIZE = 20;

function useAttentionApi(api?: FusionAttentionApi): FusionAttentionApi {
  return useMemo(
    () => api ?? createFusionAttentionApi(createPlatformApiClient()),
    [api]
  );
}

function modulesServing(
  keys: readonly FusionAttentionModuleKey[],
  contract: "work" | "notifications" | "upcoming"
): FusionAttentionModule[] {
  return FUSION_ATTENTION_MODULES.filter(
    (module) => keys.includes(module.key) && module.serves[contract]
  );
}

function statusOf(query: {
  isPending: boolean;
  isError: boolean;
  data: unknown;
}): FusionModuleLoadStatus {
  if (query.isError && query.data === undefined) return "error";
  if (query.isPending) return "loading";
  return "ready";
}

/** Earliest due first; undated work keeps each module's own order after the dated items. */
export function orderWorkItems(
  items: readonly FusionWorkItem[]
): FusionWorkItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const left = a.item.dueOn ?? null;
      const right = b.item.dueOn ?? null;
      if (left && right && left !== right) return left < right ? -1 : 1;
      if (left && !right) return -1;
      if (!left && right) return 1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

/**
 * The signed-in person's work across the given modules, one query per module
 * so a failing module never hides the others. `modules` is what the viewer may
 * enter (see `resolveFusionAttentionModules` in `@repo/auth`); modules that
 * don't serve work are skipped. Fetched on mount and on window focus.
 */
export function useFusionWork(
  modules: readonly FusionAttentionModuleKey[],
  options: UseFusionAttentionOptions = {}
) {
  const api = useAttentionApi(options.api);
  const serving = modulesServing(modules, "work");
  const results = useQueries({
    queries: serving.map((module) => ({
      queryKey: fusionAttentionQueryKeys.work(module.key),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.getWork(module.key, signal),
      enabled: options.enabled ?? true,
      refetchOnWindowFocus: true,
      retry: false,
    })),
  });

  const states: FusionModuleState[] = serving.map((module, index) => ({
    key: module.key,
    label: module.label,
    status: statusOf(results[index]!),
  }));
  const items = orderWorkItems(results.flatMap((result) => result.data ?? []));

  return {
    items,
    modules: states,
    isLoading: states.some((state) => state.status === "loading"),
    failedModules: states.filter((state) => state.status === "error"),
    refetch: async () => {
      await Promise.all(results.map((result) => result.refetch()));
    },
  };
}

/** The home's agenda window and the contract's ceiling. */
export const FUSION_UPCOMING_DAYS = 14;

/**
 * The signed-in person's upcoming moments across the given modules for the next `days`, earliest first, one
 * query per module so a failing module never hides the others. Modules that don't serve moments are skipped.
 */
export function useFusionUpcoming(
  modules: readonly FusionAttentionModuleKey[],
  options: UseFusionAttentionOptions & { days?: number } = {}
) {
  const api = useAttentionApi(options.api);
  const days = options.days ?? FUSION_UPCOMING_DAYS;
  const serving = modulesServing(modules, "upcoming");
  const results = useQueries({
    queries: serving.map((module) => ({
      queryKey: fusionAttentionQueryKeys.upcoming(module.key, days),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.getUpcoming(module.key, days, signal),
      enabled: options.enabled ?? true,
      refetchOnWindowFocus: true,
      retry: false,
    })),
  });

  const states: FusionModuleState[] = serving.map((module, index) => ({
    key: module.key,
    label: module.label,
    status: statusOf(results[index]!),
  }));
  const items = results
    .flatMap((result) => result.data ?? [])
    .sort((a: FusionUpcoming, b: FusionUpcoming) => {
      const left = a.at ?? `${a.date}T23:59:59Z`;
      const right = b.at ?? `${b.date}T23:59:59Z`;
      return a.date !== b.date
        ? a.date < b.date
          ? -1
          : 1
        : left < right
          ? -1
          : left > right
            ? 1
            : 0;
    });

  return {
    items,
    modules: states,
    isLoading: states.some((state) => state.status === "loading"),
    failedModules: states.filter((state) => state.status === "error"),
  };
}

interface FeedEntry {
  refs: number;
  connected: boolean;
  stop: () => void;
}

// One stream per module per tab, however many bells and pages ask for it.
const feeds = new Map<FusionAttentionModuleKey, FeedEntry>();

function isFeedConnected(key: FusionAttentionModuleKey): boolean {
  return feeds.get(key)?.connected ?? false;
}

function retainFeed(
  key: FusionAttentionModuleKey,
  queryClient: QueryClient,
  openStream: (path: string, signal: AbortSignal) => Promise<Response>
): () => void {
  let entry = feeds.get(key);
  if (!entry) {
    const created: FeedEntry = { refs: 0, connected: false, stop: () => {} };
    created.stop = connectFusionFeed(
      (signal) => openStream(fusionAttentionPaths.stream(key), signal),
      {
        onConnected: (connected) => {
          created.connected = connected;
        },
        onChange: () => {
          void queryClient.invalidateQueries({
            queryKey: fusionAttentionQueryKeys.notifications(key),
          });
          void queryClient.invalidateQueries({
            queryKey: fusionAttentionQueryKeys.work(key),
          });
          void queryClient.invalidateQueries({
            queryKey: fusionAttentionQueryKeys.upcomingOf(key),
          });
        },
      }
    );
    feeds.set(key, created);
    entry = created;
  }
  entry.refs += 1;
  const retained = entry;
  return () => {
    retained.refs -= 1;
    if (retained.refs === 0) {
      retained.stop();
      feeds.delete(key);
    }
  };
}

/** Keeps each module's live nudge open while a bell is mounted; a nudge refetches its bell, work and upcoming. */
function useFusionFeed(
  keys: readonly FusionAttentionModuleKey[],
  enabled: boolean,
  openStream:
    | ((path: string, signal: AbortSignal) => Promise<Response>)
    | undefined
) {
  const queryClient = useQueryClient();
  const joined = keys.join(",");
  useEffect(() => {
    if (!enabled || !openStream || joined === "") return;
    const releases = joined
      .split(",")
      .map((key) =>
        retainFeed(key as FusionAttentionModuleKey, queryClient, openStream)
      );
    return () => releases.forEach((release) => release());
  }, [enabled, joined, openStream, queryClient]);
}

function withRead(
  page: FusionNotificationPage,
  ids: readonly string[] | "all",
  readAt: string
): FusionNotificationPage {
  let changed = 0;
  const items = page.items.map((item) => {
    if (item.readAt || (ids !== "all" && !ids.includes(item.id))) return item;
    changed += 1;
    return { ...item, readAt };
  });
  return {
    ...page,
    items,
    unreadCount: ids === "all" ? 0 : Math.max(0, page.unreadCount - changed),
  };
}

/** What arrived after the bell first loaded: a new object per arrival, its notifications newest first. */
export interface FusionNotificationArrival {
  seq: number;
  items: FusionNotification[];
}

/**
 * Notifications that weren't in the feed before, unread. A module's first page only records what is there, so
 * opening a page or switching modules never replays old notifications as new.
 */
function useArrivals(
  keys: readonly FusionAttentionModuleKey[],
  pages: readonly (FusionNotificationPage | undefined)[]
): FusionNotificationArrival | null {
  // Runs after every render: a page object only changes when its feed was refetched, and the loop is a page or two.
  const seen = useRef(new Map<FusionAttentionModuleKey, Set<string>>());
  const [arrival, setArrival] = useState<FusionNotificationArrival | null>(null);
  useEffect(() => {
    const fresh: FusionNotification[] = [];
    keys.forEach((key, index) => {
      const page = pages[index];
      if (!page) return;
      const known = seen.current.get(key);
      if (!known) {
        seen.current.set(key, new Set(page.items.map((item) => item.id)));
        return;
      }
      for (const item of page.items) {
        if (known.has(item.id)) continue;
        known.add(item.id);
        if (!item.readAt) fresh.push(item);
      }
    });
    if (fresh.length === 0) return;
    fresh.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));
    setArrival((previous) => ({ seq: (previous?.seq ?? 0) + 1, items: fresh }));
  });
  return arrival;
}

/**
 * Asks every module's work, upcoming and notifications again, for after the person changes language: the servers word
 * them in the language a request reads in.
 */
export function useRefreshFusionAttention(): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: fusionAttentionQueryKeys.all() }),
    [queryClient]
  );
}

/**
 * The signed-in person's notifications across the given modules, newest first.
 * Each module's live nudge refetches the moment something arrives or is read in
 * another tab; polling stays as a fallback (every 60 seconds without a stream,
 * every 5 minutes with one) along with refetch on focus. Marking read is
 * optimistic and reconciled with the server afterwards.
 */
export function useFusionNotifications(
  modules: readonly FusionAttentionModuleKey[],
  options: UseFusionAttentionOptions = {}
) {
  const api = useAttentionApi(options.api);
  const queryClient = useQueryClient();
  const serving = modulesServing(modules, "notifications");
  const openStream =
    options.openStream ?? (options.api ? undefined : openPlatformEventStream);
  useFusionFeed(
    serving.map((module) => module.key),
    options.enabled ?? true,
    openStream
  );
  const results = useQueries({
    queries: serving.map((module) => ({
      queryKey: fusionAttentionQueryKeys.notifications(module.key),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.getNotifications(
          module.key,
          { limit: NOTIFICATION_PAGE_SIZE },
          signal
        ),
      enabled: options.enabled ?? true,
      refetchInterval: () =>
        isFeedConnected(module.key)
          ? FUSION_NOTIFICATION_FALLBACK_POLL_MS
          : FUSION_NOTIFICATION_POLL_MS,
      refetchOnWindowFocus: true,
      retry: false,
    })),
  });

  const states: FusionModuleState[] = serving.map((module, index) => ({
    key: module.key,
    label: module.label,
    status: statusOf(results[index]!),
  }));
  // At most a page per module, so merging on each render is cheap.
  const pages = results
    .map((result) => result.data)
    .filter((page): page is FusionNotificationPage => Boolean(page));
  const items = pages
    .flatMap((page) => page.items)
    .sort((a, b) =>
      a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0
    );
  const unreadCount = pages.reduce(
    (total, page) => total + page.unreadCount,
    0
  );
  const arrival = useArrivals(
    serving.map((module) => module.key),
    results.map((result) => result.data)
  );

  const markRead = useCallback(
    async (target: Pick<FusionNotification, "id" | "module"> | "all") => {
      const readAt = new Date().toISOString();
      const affected =
        target === "all"
          ? serving.map((module) => module.key)
          : [target.module];
      for (const key of affected) {
        await queryClient.cancelQueries({
          queryKey: fusionAttentionQueryKeys.notifications(key),
        });
        queryClient.setQueryData<FusionNotificationPage>(
          fusionAttentionQueryKeys.notifications(key),
          (page) =>
            page
              ? withRead(page, target === "all" ? "all" : [target.id], readAt)
              : page
        );
      }
      await Promise.all(
        affected.map(async (key) => {
          try {
            const result = await api.markNotificationsRead(
              key,
              target === "all" ? { all: true } : { ids: [target.id] }
            );
            queryClient.setQueryData<FusionNotificationPage>(
              fusionAttentionQueryKeys.notifications(key),
              (page) =>
                page ? { ...page, unreadCount: result.unreadCount } : page
            );
          } catch {
            await queryClient.invalidateQueries({
              queryKey: fusionAttentionQueryKeys.notifications(key),
            });
          }
        })
      );
    },
    // serving is derived from `modules`; its keys are the stable dependency.
    [api, queryClient, serving.map((module) => module.key).join(",")]
  );

  return {
    items,
    unreadCount,
    /** The latest arrival, for the bell's ring, pop-up and chime; null until something arrives. */
    arrival,
    modules: states,
    isLoading: states.some((state) => state.status === "loading"),
    failedModules: states.filter((state) => state.status === "error"),
    markRead: (item: Pick<FusionNotification, "id" | "module">) =>
      markRead(item),
    markAllRead: () => markRead("all"),
  };
}

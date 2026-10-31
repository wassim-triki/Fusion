import type { ApiClient } from "./types";

// ── Cross-module attention contracts (D-29 work items, D-30 notifications) ──
//
// Each module serves its own work items and notifications under its gateway
// prefix. Display text is composed by the module, so the bell and the Fusion
// home render any module without knowing its kinds.

/** Modules that serve the attention contract. */
export type FusionAttentionModuleKey = "core" | "performance";

/** Something the person must do. It stays until the underlying work is done. */
export interface FusionWorkItem {
  /** Stable across requests, e.g. `performance:plan-approval:{planId}`. */
  id: string;
  module: FusionAttentionModuleKey;
  kind: string;
  title: string;
  context?: string | null;
  /** ISO date (`yyyy-mm-dd`) when the work has a deadline. */
  dueOn?: string | null;
  /** Absolute in-app path where the work is done, e.g. `/performance/reviews/{id}`. */
  href: string;
  /** The person the work concerns, when it isn't the viewer. */
  subject?: { displayName: string } | null;
  /** Module navigation path the item is counted under in the sidebar, e.g. `/performance/team`. */
  section?: string | null;
  /** The path the work belongs to, so the home can show where it stands. */
  steps?: FusionWorkStep[] | null;
  /** What the work's button does ("Review plan"); the home says "Open" when a module doesn't say. */
  actionLabel?: string | null;
  /** ISO UTC instant since which another person has been blocked until the viewer acts; null when nobody waits. */
  waitingSince?: string | null;
  /** A yes or no the home gives in place: paths below the module's `apiBase`; declining posts `{ reason }`. */
  decision?: FusionWorkDecision | null;
}

export interface FusionWorkDecision {
  approvePath: string;
  declinePath: string;
}

export interface FusionWorkStep {
  label: string;
  detail?: string | null;
  state: "done" | "current" | "upcoming";
}

/** Something dated that isn't work: a 1:1, a deadline, a cycle's end. */
export interface FusionUpcoming {
  id: string;
  module: FusionAttentionModuleKey;
  kind: string;
  title: string;
  context?: string | null;
  /** ISO date (`yyyy-mm-dd`). */
  date: string;
  /** ISO UTC instant when the moment has a time. */
  at?: string | null;
  href: string;
  /** Work-item kinds this moment summarizes on its date; the home doesn't list those items again. */
  covers?: string[] | null;
}

/**
 * The family a notification belongs to, so the bell can mark it (a small badge on the face) without knowing a
 * module's kinds.
 */
export type FusionNotificationBadge = "praise" | "feedback" | "meeting" | "action" | "plan" | "review" | "reminder" | "team";

/** Something that happened for the person. Text and path are frozen when it's created. */
export interface FusionNotification {
  id: string;
  module: FusionAttentionModuleKey;
  kind: string;
  title: string;
  context?: string | null;
  actorName?: string | null;
  /** The employee record of the person who acted, for their photo; null for Fusion's own reminders. */
  actorEmployeeId?: string | null;
  badge?: FusionNotificationBadge | null;
  /** ISO timestamp. */
  occurredAt: string;
  href: string;
  readAt?: string | null;
}

export interface FusionNotificationPage {
  /** Newest first. */
  items: FusionNotification[];
  unreadCount: number;
  nextCursor?: string | null;
}

export interface FusionNotificationPageRequest {
  cursor?: string | null;
  /** At most 20. */
  limit?: number;
}

/** Marks the given ids, or every notification of the caller, as read. */
export interface MarkFusionNotificationsReadRequest {
  ids?: string[];
  all?: boolean;
}

export interface MarkFusionNotificationsReadResult {
  unreadCount: number;
}

export interface FusionAttentionModule {
  key: FusionAttentionModuleKey;
  label: string;
  /** Gateway prefix below `/api`. */
  apiBase: string;
  /** Tenant module entitlement the module requires. */
  entitlement: string;
  serves: { work: boolean; notifications: boolean; upcoming: boolean };
}

/**
 * The modules that serve the attention contract. Adding a module to the bell
 * and the Fusion home means implementing its endpoints and adding one entry.
 */
export const FUSION_ATTENTION_MODULES: readonly FusionAttentionModule[] = [
  {
    key: "core",
    label: "Core HR",
    apiBase: "/corehr",
    entitlement: "CoreHR",
    serves: { work: true, notifications: true, upcoming: true },
  },
  {
    key: "performance",
    label: "Performance",
    apiBase: "/performance",
    entitlement: "Performance",
    serves: { work: true, notifications: true, upcoming: true },
  },
];

export function getFusionAttentionModule(
  key: FusionAttentionModuleKey
): FusionAttentionModule {
  const module = FUSION_ATTENTION_MODULES.find(
    (candidate) => candidate.key === key
  );
  if (!module) throw new Error(`Unknown attention module: ${key}`);
  return module;
}

export const fusionAttentionPaths = {
  work: (key: FusionAttentionModuleKey) =>
    `${getFusionAttentionModule(key).apiBase}/work`,
  upcoming: (key: FusionAttentionModuleKey) =>
    `${getFusionAttentionModule(key).apiBase}/upcoming`,
  notifications: (key: FusionAttentionModuleKey) =>
    `${getFusionAttentionModule(key).apiBase}/notifications`,
  markRead: (key: FusionAttentionModuleKey) =>
    `${getFusionAttentionModule(key).apiBase}/notifications/read`,
  /** The module's live nudge: server-sent events saying only that the caller's feed changed. */
  stream: (key: FusionAttentionModuleKey) =>
    `${getFusionAttentionModule(key).apiBase}/notifications/stream`,
};

export const fusionAttentionQueryKeys = {
  all: () => ["fusion-attention"] as const,
  work: (key: FusionAttentionModuleKey) =>
    [...fusionAttentionQueryKeys.all(), "work", key] as const,
  upcoming: (key: FusionAttentionModuleKey, days: number) =>
    [...fusionAttentionQueryKeys.all(), "upcoming", key, days] as const,
  notifications: (key: FusionAttentionModuleKey) =>
    [...fusionAttentionQueryKeys.all(), "notifications", key] as const,
  /** Every upcoming window of one module, for invalidation. */
  upcomingOf: (key: FusionAttentionModuleKey) =>
    [...fusionAttentionQueryKeys.all(), "upcoming", key] as const,
};

export function createFusionAttentionApi(client: ApiClient) {
  return {
    getWork: (key: FusionAttentionModuleKey, signal?: AbortSignal) =>
      client.get<FusionWorkItem[]>(fusionAttentionPaths.work(key), { signal }),
    getUpcoming: (
      key: FusionAttentionModuleKey,
      days: number,
      signal?: AbortSignal
    ) =>
      client.get<FusionUpcoming[]>(fusionAttentionPaths.upcoming(key), {
        signal,
        params: { days },
      }),
    getNotifications: (
      key: FusionAttentionModuleKey,
      request: FusionNotificationPageRequest = {},
      signal?: AbortSignal
    ) =>
      client.get<FusionNotificationPage>(
        fusionAttentionPaths.notifications(key),
        {
          signal,
          params: { cursor: request.cursor, limit: request.limit },
        }
      ),
    markNotificationsRead: (
      key: FusionAttentionModuleKey,
      request: MarkFusionNotificationsReadRequest
    ) =>
      client.post<MarkFusionNotificationsReadResult>(
        fusionAttentionPaths.markRead(key),
        request
      ),
  };
}

export type FusionAttentionApi = ReturnType<typeof createFusionAttentionApi>;

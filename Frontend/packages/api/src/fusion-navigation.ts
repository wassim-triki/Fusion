import type { FusionAttentionModuleKey, FusionWorkItem } from "./fusion-attention";
import type { ApiClient } from "./types";

// ── The Fusion sidebar's navigation model (fusion-navigation) ──
//
// Renderer-neutral: `@repo/ds/shell` draws it for the shell, Core HR and
// Performance, `@repo/ui`'s AppSidebar for the other contributors' apps. Icons
// stay with each renderer; content, order, visibility and counts live here once.

export type FusionModuleKey =
  | "core"
  | "performance"
  | "learning"
  | "recruitment"
  | "onboarding"
  | "interview";

export interface FusionModuleEntry {
  key: FusionModuleKey;
  label: string;
  /** One line shown in the switcher. */
  description: string;
  /** Absolute entry path, e.g. `/performance`. Always a full document navigation. */
  href: string;
  /** Tenant entitlement that governs the module; modules without one are always offered. */
  entitlement?: string;
  /** Set when the module serves the work-item contract, so it carries counts. */
  attention?: FusionAttentionModuleKey;
}

/** Every tenant module, in sidebar order. */
export const FUSION_MODULE_REGISTRY: readonly FusionModuleEntry[] = [
  { key: "core", label: "Core HR", description: "People and organization", href: "/core", entitlement: "CoreHR", attention: "core" },
  {
    key: "performance",
    label: "Performance",
    description: "Goals, conversations and reviews",
    href: "/performance",
    entitlement: "Performance",
    attention: "performance",
  },
  { key: "learning", label: "Learning", description: "Training and sessions", href: "/learning" },
  { key: "recruitment", label: "Recruitment", description: "Hiring pipeline", href: "/recruitment" },
  { key: "onboarding", label: "Onboarding", description: "New-hire journeys", href: "/onboarding" },
  { key: "interview", label: "Interview", description: "Candidate assessments", href: "/interview" },
];

export function getFusionModuleEntry(key: FusionModuleKey): FusionModuleEntry {
  const entry = FUSION_MODULE_REGISTRY.find((candidate) => candidate.key === key);
  if (!entry) throw new Error(`Unknown Fusion module: ${key}`);
  return entry;
}

/** The module a label names, as the other contributors' sidebars pass it ("Learning", or the old "Core"). */
export function findFusionModuleByLabel(label: string): FusionModuleEntry | undefined {
  const wanted = label.trim().toLowerCase();
  return FUSION_MODULE_REGISTRY.find((entry) => entry.label.toLowerCase() === wanted || entry.key === wanted);
}

/**
 * Who is looking at the sidebar, as the sidebar needs it. Provided by
 * `AuthProvider` (see `FusionViewerProvider` in `@repo/api/react`), so
 * renderers that can't import `@repo/auth` still read it.
 */
export interface FusionNavigationViewer {
  userId: string;
  tenantId: string | null;
  fullName: string;
  /** Set when the account is linked to a Core HR employee; the job title is read only then. */
  employeeId: string | null;
  /** The account type in plain words, shown when Core HR has no job title. */
  accountLabel: string;
  moduleEntitlements: readonly string[];
  /** Governed modules the person can enter (entitled and with at least one workspace). */
  enterableModules: readonly FusionAttentionModuleKey[];
  /** Whether the person has an employee record they may open as My profile. */
  canOpenOwnProfile: boolean;
}

/**
 * The modules offered to the viewer: Core HR and Performance only when the
 * tenant is entitled and the person can enter them; the others as before.
 * Visibility only: the module's own entry gate and the backend still decide.
 */
export function visibleFusionModules(
  viewer: Pick<FusionNavigationViewer, "moduleEntitlements" | "enterableModules"> | null,
): FusionModuleEntry[] {
  return FUSION_MODULE_REGISTRY.filter((entry) => {
    if (!entry.entitlement) return true;
    if (!viewer || !viewer.moduleEntitlements.includes(entry.entitlement)) return false;
    return entry.attention === undefined || viewer.enterableModules.includes(entry.attention);
  });
}

// ── Counts: waiting work, never unread ──

/** All of the person's work items across the modules that answered. */
export function countHome(items: readonly FusionWorkItem[]): number {
  return items.length;
}

/** Items per module, for the modules that answered; a module that failed or is loading has no count. */
export function countByModule(
  items: readonly FusionWorkItem[],
  answered: readonly FusionAttentionModuleKey[],
): Partial<Record<FusionAttentionModuleKey, number>> {
  const counts: Partial<Record<FusionAttentionModuleKey, number>> = {};
  for (const key of answered) counts[key] = 0;
  for (const item of items) {
    if (counts[item.module] !== undefined) counts[item.module]! += 1;
  }
  return counts;
}

function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * Items per navigation path, for the paths the sidebar shows. An item counts
 * under a path only when its `section` names it exactly; items without a
 * section, or naming a path the person doesn't see, count nowhere here.
 */
export function countBySection(items: readonly FusionWorkItem[], paths: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const path of paths) counts[normalizePath(path)] = 0;
  for (const item of items) {
    if (!item.section) continue;
    const section = normalizePath(item.section);
    if (counts[section] !== undefined) counts[section] += 1;
  }
  return counts;
}

// ── Recent: the last records opened in a module, kept in this browser ──

export interface FusionRecentRecord {
  label: string;
  /** What the record is, in plain words ("Review round", "Person"). */
  kind: string;
  /** Absolute in-app path that reopens it. */
  href: string;
}

export const FUSION_RECENT_LIMIT = 3;

/** Per tenant and person, so another account on the same browser never sees these. */
export function fusionRecentStorageKey(
  viewer: Pick<FusionNavigationViewer, "tenantId" | "userId">,
  module: FusionModuleKey,
): string {
  return `fusion:recent:${viewer.tenantId ?? "none"}:${viewer.userId}:${module}`;
}

/** An absolute in-app path: rooted, and never protocol-relative (`//host`, `/\host`), so it can't leave Fusion. */
function isInAppPath(href: unknown): href is string {
  return typeof href === "string" && href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\");
}

function isRecentRecord(value: unknown): value is FusionRecentRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.label === "string" && typeof record.kind === "string" && isInAppPath(record.href);
}

/** Newest first. Empty when nothing is stored, the value is malformed or storage refuses. */
export function readRecentRecords(storage: Pick<Storage, "getItem"> | null | undefined, key: string): FusionRecentRecord[] {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecentRecord).slice(0, FUSION_RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

/** Puts the record first, drops an older entry with the same path and keeps three. Never throws. */
export function rememberRecentRecord(
  storage: Pick<Storage, "getItem" | "setItem"> | null | undefined,
  key: string,
  record: FusionRecentRecord,
): FusionRecentRecord[] {
  if (!isInAppPath(record.href)) return readRecentRecords(storage, key);
  const next = [record, ...readRecentRecords(storage, key).filter((entry) => entry.href !== record.href)].slice(
    0,
    FUSION_RECENT_LIMIT,
  );
  try {
    storage?.setItem(key, JSON.stringify(next));
  } catch {
    // Storage full or blocked: Recent is a convenience, so it simply doesn't update.
  }
  return next;
}

// ── Identity shown by the sidebar ──

/** The signed-in person's own card from Core HR (`GET /api/corehr/me/card`), as of today. */
export interface CoreMeCardDto {
  displayName: string;
  jobTitle: string | null;
  orgUnitName: string | null;
  /** API-relative photo address with a cache version; null without a photo. */
  photoUrl: string | null;
}

/** The caller's own tenant, from Identity: the sidebar's brand line, the brand studio and Settings › Details. */
export interface FusionTenantSummaryDto {
  tenantId: string;
  name: string;
  slug?: string;
  industry?: string | null;
  locale?: string;
  timeZone?: string;
  /** The company's colour (`#rrggbb`); null keeps Fusion's own. */
  brandColor?: string | null;
  /** API-relative logo address with its version; null without a logo. */
  logoUrl?: string | null;
  /** The company's default language: en, fr or ar. */
  language?: string;
}

export const fusionNavigationPaths = {
  myCard: () => "/corehr/me/card",
  tenant: () => "/identity/tenant-context/tenant-summary",
} as const;

export const fusionNavigationQueryKeys = {
  all: () => ["fusion-navigation"] as const,
  myCard: (userId: string, tenantId: string | null) =>
    [...fusionNavigationQueryKeys.all(), "my-card", tenantId ?? "none", userId] as const,
  tenant: (tenantId: string) => [...fusionNavigationQueryKeys.all(), "tenant", tenantId] as const,
};

export function createFusionNavigationApi(client: ApiClient) {
  return {
    getMyCard: (signal?: AbortSignal) => client.get<CoreMeCardDto>(fusionNavigationPaths.myCard(), { signal }),
    getTenant: (signal?: AbortSignal) => client.get<FusionTenantSummaryDto>(fusionNavigationPaths.tenant(), { signal }),
  };
}

export type FusionNavigationApi = ReturnType<typeof createFusionNavigationApi>;

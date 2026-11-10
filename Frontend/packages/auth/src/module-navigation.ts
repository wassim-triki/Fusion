"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { createPerformanceApi, createPlatformApiClient, performanceQueryKeys, type WorkspaceDestinationsDto } from "@repo/api";
import { useApiQuery, useFieldVisibility } from "@repo/api/query";
import { useFusionViewer } from "@repo/api/react";
import {
  ChartNoAxesColumn,
  CalendarRange,
  FeedbackIcon,
  FileCheck2,
  LayoutDashboard,
  Network,
  OneOnOnes,
  Stamp,
  User,
  Target,
  Users,
} from "@repo/ds/icons";
import type { ShellNavItem } from "@repo/ds/shell";
import { useAuth } from "./auth-context";
import {
  canAccessCoreOrgChart,
  canAccessCorePeople,
  canAccessCoreTeam,
  canAccessOwnCoreProfile,
  canApproveCoreChanges,
  canManageCoreEmployees,
  canProposeCoreChanges,
  canSeeCoreOrgChart,
  canSeeCoreSettingsNavigation,
  canSeeWholeCoreOrgChart,
  canViewCoreOrganization,
  canViewCoreReports,
} from "./roles";

/**
 * Whether the org chart is open to the viewer under the tenant's audience (Core HR settings › Employee fields). Managers
 * and people who read the whole workforce always see it; everyone else waits for the field policy, which every member
 * may read. `wholeCompany` says whether they see all of it rather than their own branch (unit heads and unit pages).
 * Core HR enforces the same rules, so this only hides what would lead to a refusal.
 */
export function useOrgChartAccess(): { canSee: boolean; wholeCompany: boolean; isLoading: boolean; narrowed: boolean } {
  const { user, isLoading: authLoading } = useAuth();
  const needsPolicy = canAccessCoreOrgChart(user) && !canAccessCoreTeam(user);
  const readsPolicy = canAccessCoreOrgChart(user) && !canAccessCorePeople(user);
  const policy = useFieldVisibility({ enabled: !authLoading && readsPolicy });
  const audience = policy.data?.orgChart?.audience;
  const canSee = canSeeCoreOrgChart(user, needsPolicy ? audience : "Everyone");
  return {
    canSee,
    wholeCompany: canSee && canSeeWholeCoreOrgChart(user, audience),
    isLoading: authLoading || (readsPolicy && policy.isLoading),
    // The role includes the chart but the company keeps it to managers and HR.
    narrowed: needsPolicy && !canSee && policy.data !== undefined,
  };
}

/** A module's pages in the sidebar: hrefs relative to the module (`/people` under `/core`). */
export interface ModulePages {
  items: ShellNavItem[];
  /** Who may see what isn't known yet: placeholders in their place. */
  pending: boolean;
  /** The person may change the module's company settings, so Fusion's Settings is offered. */
  settings: boolean;
}

type NavLabel =
  | "overview"
  | "year"
  | "myProfile"
  | "myTeam"
  | "people"
  | "organization"
  | "changes"
  | "reports"
  | "goals"
  | "oneOnOnes"
  | "feedback"
  | "reviews";

/** Core HR's pages, in the order the drawing lists them, each shown only to who may open it. */
export function useCorePages(): ModulePages {
  const { user, isLoading } = useAuth();
  const t = useTranslations("auth.nav");
  const orgChart = useOrgChartAccess();
  return useMemo(() => {
    const page = (label: NavLabel, href: string, icon: ShellNavItem["icon"], shown: boolean): ShellNavItem[] =>
      shown ? [{ label: t(label), href, icon, exact: href === "/" }] : [];
    const items = [
      ...page("overview", "/", LayoutDashboard, true),
      ...page("myProfile", "/profile", User, canAccessOwnCoreProfile(user)),
      ...page("myTeam", "/team", Users, canAccessCoreTeam(user)),
      // Everyone has People: HR's table, the directory for everyone else (D-28).
      ...page("people", "/people", Users, canAccessCorePeople(user) || canAccessOwnCoreProfile(user) || canAccessCoreTeam(user)),
      // One place for the organization: its people chart, structure and list (D-17).
      ...page("organization", "/organization", Network, canViewCoreOrganization(user) || orgChart.canSee),
      ...page(
        "changes",
        "/changes",
        Stamp,
        canApproveCoreChanges(user) || canProposeCoreChanges(user) || canManageCoreEmployees(user),
      ),
      ...page("reports", "/reports", ChartNoAxesColumn, canViewCoreReports(user)),
    ];
    return { items, pending: isLoading, settings: canSeeCoreSettingsNavigation(user) };
  }, [t, user, isLoading, orgChart.canSee]);
}

/** Which Performance pages the caller has, from the server's workspace context (navigation, never access). */
const DESTINATION_OF: Record<string, keyof WorkspaceDestinationsDto> = {
  "/one-on-ones": "oneOnOnes",
  "/feedback": "feedback",
  "/reviews": "reviews",
};

/**
 * Performance's pages for the year in view (`cycleId`, else the current one): destinations come from the server's
 * workspace context, participation and recorded responsibility rather than claims, so nothing flashes and disappears.
 */
export function usePerformancePages(cycleId: string | null = null): ModulePages {
  const t = useTranslations("auth.nav");
  const { viewer, isLoading: viewerLoading } = useFusionViewer();
  const enterable = viewer?.enterableModules.includes("performance") ?? false;
  const api = useMemo(() => createPerformanceApi(createPlatformApiClient()), []);
  const context = useApiQuery(
    performanceQueryKeys.workspaceContext(cycleId),
    (signal) => api.getWorkspaceContext(cycleId, signal),
    { enabled: enterable },
  );
  const destinations = context.data?.destinations;
  return useMemo(() => {
    const CYCLE_FREE = new Set(["/one-on-ones", "/feedback"]);
    const all: [NavLabel, string, ShellNavItem["icon"]][] = [
      ["year", "/", CalendarRange],
      ["goals", "/goals", Target],
      ["oneOnOnes", "/one-on-ones", OneOnOnes],
      ["feedback", "/feedback", FeedbackIcon],
      ["reviews", "/reviews", FileCheck2],
    ];
    const items = all
      .filter(([, href]) => {
        const key = DESTINATION_OF[href];
        return key ? (destinations?.[key] ?? false) : true;
      })
      .map(([label, href, icon]) => ({
        label: t(label),
        href,
        icon,
        exact: href === "/",
        // The year's pages keep the year being looked at; 1:1s and Feedback belong to people, not years.
        navigateHref: cycleId && !CYCLE_FREE.has(href) ? `${href}?cycle=${encodeURIComponent(cycleId)}` : undefined,
      }));
    return {
      items,
      pending: viewerLoading || (enterable && context.isLoading),
      settings: destinations?.settings ?? false,
    };
  }, [t, destinations, viewerLoading, enterable, context.isLoading, cycleId]);
}

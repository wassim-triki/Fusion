"use client";

import { useMemo } from "react";
import { useFusionNavigation, useFusionSettings, useSettingsReturn } from "@repo/api/query";
import { useFusionViewer } from "@repo/api/react";
import { visibleFusionModules, type FusionModuleKey } from "@repo/api";
import { FusionSidebar as FusionSidebarFrame, pagePaths, type FusionSidebarModule } from "@repo/ds/shell";
import { useCorePages, usePerformancePages } from "../module-navigation";
import { useAuth } from "../auth-context";
import { canSeeInsights } from "../roles";

/**
 * The one Fusion sidebar (D-45), the same from the shell, Core HR and Performance: every module the person can enter
 * as a group with its pages, counts of waiting work, Recent for the module in view, Settings at the end. Inside
 * Settings it switches to settings mode (fusion-settings).
 */
export function FusionSidebar({
  current = null,
  activePath,
  cycleId = null,
}: {
  /** The module in view, whose pages are client navigations; null on Home and the shell's own pages. */
  current?: FusionModuleKey | null;
  /** The path inside the module (or the shell), for the active page. */
  activePath: string;
  /** Performance: the year in view, so its pages follow the one being looked at. */
  cycleId?: string | null;
}) {
  const { user } = useAuth();
  const core = useCorePages();
  const performance = usePerformancePages(cycleId);
  const pages: Partial<Record<FusionModuleKey, typeof core>> = useMemo(() => ({ core, performance }), [core, performance]);
  const inSettings = activePath === "/settings" || activePath.startsWith("/settings/");
  const settings = useFusionSettings({ enabled: inSettings });
  const back = useSettingsReturn();

  const { viewer } = useFusionViewer();
  const paths = useMemo(
    () => pagePaths(visibleFusionModules(viewer).map((module) => ({ href: module.href, items: pages[module.key]?.items }))),
    [viewer, pages],
  );
  const navigation = useFusionNavigation(current, paths);
  const modules: FusionSidebarModule[] = navigation.modules.map((module) => {
    const own = pages[module.key];
    return own ? { ...module, items: own.items, pending: own.pending } : module;
  });
  const basePath = current ? `/${current}` : "";
  return (
    <FusionSidebarFrame
      mode={inSettings ? "settings" : "module"}
      settings={inSettings ? { back, groups: settings.groups } : undefined}
      tenantName={navigation.tenantName}
      tenantLogoUrl={navigation.tenantLogoUrl}
      brandColor={navigation.brandColor}
      homeCount={navigation.homeCount}
      insights={canSeeInsights(user)}
      modules={modules}
      currentModuleKey={current ?? undefined}
      basePath={basePath}
      activePath={activePath}
      sectionCounts={navigation.sectionCounts}
      recent={navigation.recent}
      showSettings={Object.values(pages).some((module) => module?.settings)}
    />
  );
}

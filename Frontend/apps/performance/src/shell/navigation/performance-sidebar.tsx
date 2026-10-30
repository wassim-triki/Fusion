"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { User } from "@/lib/icons";
import { useFusionNavigation, useFusionSettings, useSettingsReturn } from "@repo/api/query";
import { useFusionViewer } from "@repo/api/react";
import { useAuth } from "@repo/auth";
import { FusionSidebar, sectionPaths, type ShellNavSection } from "@repo/ds/shell";
import { ADMIN_NAV, CYCLE_FREE_ROUTES, PRIMARY_NAV, visibleAdminItems, visiblePrimaryItems } from "@/data/sidebar-nav";
import { resolvePerformanceWorkspaceAccessState } from "@/shell/performance-workspace-access";
import { useSelectedCycleId, useWorkspaceContext } from "@/features/performance/api/use-workspace";
import { withCycle } from "@/lib/performance-routes";

export function PerformanceSidebar() {
  const { user, isLoading: isAuthLoading } = useAuth();

  // Destinations come from the server's workspace context for the selected Cycle — participation and
  // recorded review responsibility, not persona rules derived from claims. Until it resolves the rail
  // shows its pending state rather than flashing entries that might disappear ("hide, don't deny").
  const entitled = resolvePerformanceWorkspaceAccessState({ user, isLoading: isAuthLoading }) === "allowed";
  const context = useWorkspaceContext(entitled);
  const destinations = context.data?.destinations;
  const selectedCycleId = useSelectedCycleId();
  const nav = useTranslations("common.nav");
  const carry = (section: ShellNavSection): ShellNavSection => ({
    ...section,
    title: section.title ? nav(section.title as "cycle") : section.title,
    items: section.items.map((item) => ({ ...item, label: nav(item.label as "cycle"), navigateHref: CYCLE_FREE_ROUTES.has(item.href) ? item.href : withCycle(item.href, selectedCycleId) })),
  });

  const primaryItems = visiblePrimaryItems(destinations);

  const sections: ShellNavSection[] = [carry({ ...PRIMARY_NAV, items: primaryItems })];
  const adminItems = visibleAdminItems(destinations);
  if (adminItems.length > 0) sections.push(carry({ ...ADMIN_NAV, items: adminItems }));

  return <SidebarFrame sections={sections} pending={isAuthLoading || (entitled && context.isLoading)} />;
}

function SidebarFrame({ sections, pending }: { sections: ShellNavSection[]; pending: boolean }) {
  const pathname = usePathname();
  const activePath = pathname.replace(/^\/performance/, "") || "/";
  const { logout, isLoading: isAuthLoading } = useAuth();
  const t = useTranslations("ds.sidebar");
  const { viewer } = useFusionViewer();
  const navigation = useFusionNavigation("performance", sectionPaths("/performance", sections));
  // Inside Settings the same sidebar switches to settings mode (fusion-settings).
  const inSettings = activePath === "/settings" || activePath.startsWith("/settings/");
  const settings = useFusionSettings({ enabled: inSettings });
  const back = useSettingsReturn();
  return (
    <FusionSidebar
      mode={inSettings ? "settings" : "module"}
      settings={inSettings ? { back, groups: settings.groups } : undefined}
      tenantName={navigation.tenantName}
      tenantLogoUrl={navigation.tenantLogoUrl}
      brandColor={navigation.brandColor}
      homeCount={navigation.homeCount}
      modules={navigation.modules}
      currentModuleKey="performance"
      basePath="/performance"
      activePath={activePath}
      sections={sections}
      sectionCounts={navigation.sectionCounts}
      pending={pending}
      recent={navigation.recent}
      person={{
        ...navigation.person,
        pending: isAuthLoading,
        links: viewer?.canOpenOwnProfile ? [{ label: t("myProfile"), href: "/core/profile", icon: User }] : [],
        onSignOut: async () => {
          await logout();
          window.location.href = "/auth/signin";
        },
      }}
    />
  );
}

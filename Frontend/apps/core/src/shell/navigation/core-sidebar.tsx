"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { User } from "lucide-react";
import { useFusionNavigation, useFusionSettings, useSettingsReturn } from "@repo/api/query";
import { FusionSidebar, sectionPaths } from "@repo/ds/shell";
import {
  useAuth,
  canViewWorkforceAccess,
  canViewCoreOrganization,
  canSeeCoreSettingsNavigation,
  canViewTenantAdministration,
  canApproveCoreChanges,
  canProposeCoreChanges,
  canManageCoreEmployees,
} from "@repo/auth";
import { useCoreNav } from "@/shell/navigation/use-core-nav";
import { useOrgChartAccess } from "@/features/org-chart/api/use-org-chart-access";
import {
  canSeeEmployeeRosterNavigation,
  canSeeSelfEmployeeProfileNavigation,
  canSeeTeamWorkspaceNavigation,
} from "@/lib/employee-roster-access";

// Navigation is no longer gated on setup completion. A destination that has a
// real prerequisite says so itself, in its own words, at the point the user tries
// to act — which is both more useful and more truthful than disabling most of the
// product behind one generic sentence.

export function CoreSidebar() {
  const pathname = usePathname();
  const activePath = pathname.replace(/^\/core/, "") || "/";
  const { user, logout, isLoading: isAuthLoading } = useAuth();
  const t = useTranslations("ds.sidebar");
  const nav = useCoreNav();
  const canSeeSetup = canViewTenantAdministration(user);
  const canSeeWorkforceAccess = canViewWorkforceAccess(user);
  const canSeeSettings = canSeeCoreSettingsNavigation(user);
  const canSeeEmployeeRoster = canSeeEmployeeRosterNavigation(user);
  const canSeeOrganization = canViewCoreOrganization(user);
  const canSeeOrgChart = useOrgChartAccess().canSee;
  const canSeeMyProfile = canSeeSelfEmployeeProfileNavigation(user);
  const canSeeMyTeam = canSeeTeamWorkspaceNavigation(user);

  const peopleItems = nav.people.items.filter((item) => {
    if (item.href === "/profile") return canSeeMyProfile;
    if (item.href === "/team") return canSeeMyTeam;
    if (item.href === "/people") return canSeeEmployeeRoster;
    if (item.href === "/org-chart") return canSeeOrgChart;
    if (item.href === "/organization") return canSeeOrganization;
    if (item.href === "/changes") return canApproveCoreChanges(user) || canProposeCoreChanges(user) || canManageCoreEmployees(user);
    return true;
  });
  const adminItems = nav.admin.items.filter((item) => {
    if (item.href === "/getting-started") return canSeeSetup;
    if (item.href === "/workforce-access") return canSeeWorkforceAccess;
    if (item.href === "/settings") return canSeeSettings;
    return canSeeSetup;
  });

  const visibleSections = adminItems.length
    ? [
        { ...nav.people, items: peopleItems },
        { ...nav.admin, items: adminItems },
      ]
    : [{ ...nav.people, items: peopleItems }];

  const navigation = useFusionNavigation("core", sectionPaths("/core", visibleSections));
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
      currentModuleKey="core"
      basePath="/core"
      activePath={activePath}
      sections={visibleSections}
      sectionCounts={navigation.sectionCounts}
      pending={isAuthLoading}
      recent={navigation.recent}
      person={{
        ...navigation.person,
        pending: isAuthLoading,
        // Raw anchor, so the basePath is explicit.
        links: canSeeMyProfile ? [{ label: t("myProfile"), href: "/core/profile", icon: User }] : [],
        onSignOut: async () => {
          await logout();
          window.location.href = "/auth/signin";
        },
      }}
    />
  );
}

"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { TopBarPreferences, TopBarSearch, ViewingAsBar } from "@repo/auth";
import { AppShell, SettingsBreadcrumb, TopBar } from "@repo/ds/shell";
import { useCoreSettingsLabel } from "@/features/settings/core-settings";
import { AppBreadcrumb } from "@/shell/app-breadcrumb";
import { CoreSidebar } from "@/shell/navigation/core-sidebar";
import { FusionNotificationBell } from "@/shell/fusion-notification-bell";

// The frame renders unconditionally — SSR and first client paint are identical.
// Loading only ever happens inside the content area (route loading boundary);
// the sidebar covers unknown auth state with
// its own pending treatment instead of hiding the whole shell.
export function CorePagesShell({ children }: { children: ReactNode }) {
  // usePathname omits the basePath; the optional prefix keeps this true either way.
  const coreSettingsLabel = useCoreSettingsLabel();
  const settingsSection = /^(?:\/core)?\/settings(?:\/([^/?#]+))?$/.exec(usePathname() ?? "");
  const breadcrumb = settingsSection ? (
    <SettingsBreadcrumb trail={["Core HR", ...(settingsSection[1] ? [coreSettingsLabel(settingsSection[1])] : [])]} />
  ) : (
    <AppBreadcrumb />
  );
  return (
    <AppShell
      sidebar={<CoreSidebar />}
      notice={<ViewingAsBar />}
      header={
        <TopBar left={breadcrumb}>
          <TopBarSearch />
          <FusionNotificationBell />
          <TopBarPreferences />
        </TopBar>
      }
    >
      {children}
    </AppShell>
  );
}

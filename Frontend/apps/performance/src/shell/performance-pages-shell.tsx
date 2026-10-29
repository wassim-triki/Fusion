"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { TopBarPreferences } from "@repo/auth";
import { AppShell, SettingsBreadcrumb, TopBar } from "@repo/ds/shell";
import { usePerformanceSettingsLabel } from "@/features/settings/performance-settings";
import { PerformanceSidebar } from "@/shell/navigation/performance-sidebar";
import { PerformanceCycleContext } from "@/shell/performance-cycle-context";
import { FusionNotificationBell } from "@/shell/fusion-notification-bell";
import { RecordCycleScopeProvider } from "@/features/performance/api/use-workspace";

export function PerformancePagesShell({ children }: { children: ReactNode }) {
  // The light-mode white working surface is applied via a `--background` token
  // override in globals.css (guarded to `:not(.dark)`), not a content class here.
  // The top bar carries the Cycle context; the breadcrumb (performance-breadcrumb.tsx)
  // is parked until the breadcrumb architecture is revisited. Inside Settings it names the section instead.
  // usePathname omits the basePath; the optional prefix keeps this true either way.
  const performanceSettingsLabel = usePerformanceSettingsLabel();
  const settingsSection = /^(?:\/performance)?\/settings(?:\/([^/?#]+))?$/.exec(usePathname() ?? "");
  const left = settingsSection ? (
    <SettingsBreadcrumb trail={["Performance", ...(settingsSection[1] ? [performanceSettingsLabel(settingsSection[1])] : [])]} />
  ) : (
    <PerformanceCycleContext />
  );
  return (
    <RecordCycleScopeProvider>
      <AppShell sidebar={<PerformanceSidebar />} header={
          <TopBar left={left}>
            <FusionNotificationBell />
          <TopBarPreferences />
          </TopBar>
        }>
        {children}
      </AppShell>
    </RecordCycleScopeProvider>
  );
}

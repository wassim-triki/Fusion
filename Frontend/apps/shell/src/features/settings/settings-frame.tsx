"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { FusionSidebar, YourMenu, TopBarSearch, useAuth, ViewingAsBar } from "@repo/auth";
import { AppShell, SettingsBreadcrumb, ThemeProvider, TopBar } from "@repo/ds/shell";
import { ShellNotificationBell } from "@/features/home/shell-notification-bell";

/** The frame of the shell's personal settings pages (Preferences, Notifications). */
export function SettingsFrame({ trail, children }: { trail: readonly string[]; children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  useEffect(() => {
    if (!isLoading && !user) window.location.replace("/auth/signin");
  }, [isLoading, user]);

  return (
    <ThemeProvider>
      <AppShell
        sidebar={<FusionSidebar activePath={pathname} />}
        notice={<ViewingAsBar />}
        header={
          <TopBar left={<SettingsBreadcrumb trail={trail} />}>
            <TopBarSearch />
            <ShellNotificationBell />
            <YourMenu />
          </TopBar>
        }
      >
        {children}
      </AppShell>
    </ThemeProvider>
  );
}

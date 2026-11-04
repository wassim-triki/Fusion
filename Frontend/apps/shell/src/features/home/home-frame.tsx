"use client";

import type { ReactNode } from "react";
import { TopBarPreferences, TopBarSearch, ViewingAsBar } from "@repo/auth";
import { AppShell, ThemeProvider, TopBar } from "@repo/ds/shell";
import { FusionSidebar } from "./fusion-sidebar";
import { ShellNotificationBell } from "./shell-notification-bell";

/** Session readiness only gates the content; the Fusion frame stays mounted. */
export function HomeFrame({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AppShell
        sidebar={<FusionSidebar />}
        notice={<ViewingAsBar />}
        header={
          <TopBar>
            <TopBarSearch />
            <ShellNotificationBell />
            <TopBarPreferences />
          </TopBar>
        }
      >
        {children}
      </AppShell>
    </ThemeProvider>
  );
}

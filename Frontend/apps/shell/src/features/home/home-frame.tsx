"use client";

import type { ReactNode } from "react";
import { FusionSidebar, YourMenu, TopBarSearch, ViewingAsBar } from "@repo/auth";
import { AppShell, ThemeProvider, TopBar } from "@repo/ds/shell";
import { ShellNotificationBell } from "./shell-notification-bell";

/** Session readiness only gates the content; the Fusion frame stays mounted. */
export function HomeFrame({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AppShell
        sidebar={<FusionSidebar activePath="/" />}
        notice={<ViewingAsBar />}
        header={
          <TopBar>
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

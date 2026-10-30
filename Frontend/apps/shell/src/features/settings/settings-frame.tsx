"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { User } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFusionNavigation, useFusionSettings, useSettingsReturn } from "@repo/api/query";
import { useFusionViewer } from "@repo/api/react";
import { TopBarPreferences, TopBarSearch, useAuth } from "@repo/auth";
import { AppShell, FusionSidebar, SettingsBreadcrumb, ThemeProvider, TopBar } from "@repo/ds/shell";
import { ShellNotificationBell } from "@/features/home/shell-notification-bell";

/** The shell's settings sidebar: You, then each module group the person can view, and the way back. */
function SettingsSidebar() {
  const t = useTranslations("ds.sidebar");
  const { logout } = useAuth();
  const { viewer, isLoading } = useFusionViewer();
  const navigation = useFusionNavigation(null, []);
  const settings = useFusionSettings();
  const back = useSettingsReturn();
  const pathname = usePathname();
  const platformAdministrator = viewer !== null && !viewer.tenantId;
  return (
    <FusionSidebar
      mode="settings"
      settings={{ back, groups: settings.groups }}
      tenantName={platformAdministrator ? "Platform" : navigation.tenantName}
      tenantLogoUrl={platformAdministrator ? null : navigation.tenantLogoUrl}
      brandColor={platformAdministrator ? undefined : navigation.brandColor}
      modules={navigation.modules}
      activePath={pathname}
      person={{
        ...navigation.person,
        pending: isLoading,
        links: viewer?.canOpenOwnProfile ? [{ label: t("myProfile"), href: "/core/profile", icon: User }] : [],
        onSignOut: async () => {
          await logout();
          window.location.href = "/auth/signin";
        },
      }}
    />
  );
}

/** The frame of the shell's personal settings pages (Preferences, Notifications). */
export function SettingsFrame({ trail, children }: { trail: readonly string[]; children: ReactNode }) {
  const { user, isLoading } = useAuth();
  useEffect(() => {
    if (!isLoading && !user) window.location.replace("/auth/signin");
  }, [isLoading, user]);

  return (
    <ThemeProvider>
      <AppShell
        sidebar={<SettingsSidebar />}
        header={
          <TopBar left={<SettingsBreadcrumb trail={trail} />}>
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

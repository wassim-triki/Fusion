"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Settings2, Shield } from "@repo/ds/icons";
import { canAccessPlatform, useAuth } from "@repo/auth";
import { ModuleSidebar, ShellUserPanel } from "@repo/ds/shell";
import { usePlatformNav } from "@/shell/navigation/use-platform-nav";
import { buildShellUrl } from "@/lib/shell-url";

export function PlatformSidebar() {
  const t = useTranslations("frame");
  const sidebar = useTranslations("ds.sidebar");
  const pathname = usePathname();
  const activePath = pathname.replace(/^\/platform/, "") || "/";
  const { user, logout, isLoading } = useAuth();
  const hasPlatformAccess = canAccessPlatform(user);
  const nav = usePlatformNav();

  return (
    <ModuleSidebar
      brandTitle="Fusion Platform"
      brandSubtitle={t("administration")}
      brandIcon={Shield}
      activePath={activePath}
      sections={hasPlatformAccess ? [nav] : []}
      contextLabel={hasPlatformAccess ? t("platformAccess") : undefined}
      pending={isLoading}
      userPanel={(collapsed) => (
        <ShellUserPanel
          collapsed={collapsed}
          pending={isLoading}
          name={user?.fullName}
          secondaryLabel={user?.roles?.[0]}
          // Fusion Settings (Preferences only for a platform administrator) is served by the shell.
          links={[{ label: sidebar("settings"), href: "/settings", icon: Settings2 }]}
          onSignOut={async () => {
            await logout();
            window.location.assign(buildShellUrl("/auth/signin"));
          }}
        />
      )}
    />
  );
}

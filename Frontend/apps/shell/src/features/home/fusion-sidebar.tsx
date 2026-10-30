"use client";

import { User } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFusionNavigation } from "@repo/api/query";
import { useFusionViewer } from "@repo/api/react";
import { useAuth } from "@repo/auth";
import { FusionSidebar as FusionSidebarFrame } from "@repo/ds/shell";

/** The Fusion home's sidebar: Home is current, so the person's modules are listed with their waiting work. */
export function FusionSidebar() {
  const t = useTranslations("ds.sidebar");
  const { logout } = useAuth();
  const { viewer, isLoading } = useFusionViewer();
  const navigation = useFusionNavigation(null, []);
  return (
    <FusionSidebarFrame
      tenantName={navigation.tenantName}
      tenantLogoUrl={navigation.tenantLogoUrl}
      brandColor={navigation.brandColor}
      homeCount={navigation.homeCount}
      modules={navigation.modules}
      activePath="/"
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

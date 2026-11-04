"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Spinner } from "@repo/ds/components/ui/spinner";
import { SettingsPage } from "@repo/ds/shell";
import { SettingsFrame } from "@/features/settings/settings-frame";
import { HomeFrame } from "./home-frame";
import { HomeSkeleton } from "./home-skeleton";

export function ShellRouteLoading() {
  const pathname = usePathname();
  const preferences = useTranslations("settings.preferences");
  const settings = useTranslations("ds.settings");
  const states = useTranslations("ds.states");
  if (pathname === "/")
    return (
      <HomeFrame>
        <HomeSkeleton />
      </HomeFrame>
    );
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    const title =
      pathname === "/settings/notifications"
        ? settings("notifications")
        : preferences("title");
    return (
      <SettingsFrame trail={[title]}>
        <SettingsPage title={title} loading>
          {null}
        </SettingsPage>
      </SettingsFrame>
    );
  }
  return (
    <div className="grid min-h-screen place-items-center">
      <Spinner aria-label={states("loading")} />
    </div>
  );
}

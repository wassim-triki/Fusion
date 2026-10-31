"use client";

import { useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import type { ProfileTab, ProfileTabLink } from "./worker-profile";

const ORDER: ProfileTab[] = ["overview", "job", "personal", "performance", "documents", "access"];

/**
 * The person page's tabs as `?tab=` links (Overview is the bare address), keeping the as-of date. A tab the viewer
 * doesn't have falls back to Overview.
 */
export function useProfileTabs(available: Partial<Record<ProfileTab, boolean>>): {
  tab: ProfileTab;
  tabs: ProfileTabLink[];
} {
  const t = useTranslations("profile.tabs");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const keys = ORDER.filter((key) => key === "overview" || available[key]);
  const href = (key: ProfileTab) => {
    const params = new URLSearchParams();
    const asOf = searchParams.get("asOf");
    if (asOf) params.set("asOf", asOf);
    if (key !== "overview") params.set("tab", key);
    const search = params.toString();
    return search ? `${pathname}?${search}` : pathname;
  };
  const requested = searchParams.get("tab") as ProfileTab | null;
  return {
    tab: requested && keys.includes(requested) ? requested : "overview",
    tabs: keys.map((key) => ({ key, label: t(key), href: href(key) })),
  };
}

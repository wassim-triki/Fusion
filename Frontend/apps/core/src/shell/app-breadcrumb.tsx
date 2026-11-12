"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppBreadcrumb as SharedAppBreadcrumb } from "@repo/ds/shell";
import { useBreadcrumbOverridesMap } from "@/shell/breadcrumb-overrides";
import { APP_NAME } from "@/config/constants";
import { useCorePages } from "@repo/auth";

// The route's own words ("import", "change-work"…), worded by `frame.breadcrumb`.
const ROUTE_SEGMENTS = [
  "import",
  "match",
  "review",
  "change-work",
  "change-manager",
  "end-employment",
  "activity",
] as const;

// Core HR's route folders with no word of their own.
const ROUTES = new Set([
  "add", "administrators", "changes", "jobs", "org-chart", "organization", "people", "places",
  "insights", "profile", "reports", "roles", "settings", "team", "units", ...ROUTE_SEGMENTS,
]);

export function AppBreadcrumb() {
  const pathname = usePathname();
  const pageOverrides = useBreadcrumbOverridesMap();
  const pages = useCorePages();
  const t = useTranslations("frame.breadcrumb");
  const insights = useTranslations("insights");

  const clean = pathname.replace(/^\/core/, "") || "/";
  // A page's own label (a person's or a unit's name) wins over the route's word.
  const overrides = new Map<string, string>(ROUTE_SEGMENTS.map((segment) => [segment, t(segment)]));
  // Insights' own words for its tabs (D-88): `people` there is a tab, not Core HR's People.
  if (clean === "/insights" || clean.startsWith("/insights/")) {
    overrides.set("insights", insights("title"));
    for (const tab of ["people", "performance", "reports"] as const) overrides.set(tab, insights(`tabs.${tab}`));
  }
  for (const [segment, label] of pageOverrides) overrides.set(segment, label);

  return (
    <SharedAppBreadcrumb
      appName={APP_NAME}
      pathname={clean}
      navItems={pages.items}
      overrides={overrides}
      routeSegments={ROUTES}
    />
  );
}

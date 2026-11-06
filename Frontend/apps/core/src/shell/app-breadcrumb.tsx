"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppBreadcrumb as SharedAppBreadcrumb } from "@repo/ds/shell";
import { useBreadcrumbOverridesMap } from "@/shell/breadcrumb-overrides";
import { APP_NAME } from "@/config/constants";
import { useCoreNav } from "@/shell/navigation/use-core-nav";

// The route's own words ("import", "change-work"…), worded by `frame.breadcrumb`.
const ROUTE_SEGMENTS = [
  "import",
  "match",
  "review",
  "hire",
  "add-existing",
  "change-work",
  "change-manager",
  "end-employment",
  "performance",
  "activity",
] as const;

// Core HR's route folders with no word of their own.
const ROUTES = new Set([
  "access", "add", "administrators", "changes", "employees", "jobs", "org-chart", "organization", "people", "places",
  "profile", "reports", "roles", "settings", "setup", "team", "units", "workforce-access", ...ROUTE_SEGMENTS,
]);

export function AppBreadcrumb() {
  const pathname = usePathname();
  const pageOverrides = useBreadcrumbOverridesMap();
  const nav = useCoreNav();
  const t = useTranslations("frame.breadcrumb");

  const clean = pathname.replace(/^\/core/, "") || "/";
  // A page's own label (a person's or a unit's name) wins over the route's word.
  const overrides = new Map<string, string>(ROUTE_SEGMENTS.map((segment) => [segment, t(segment)]));
  for (const [segment, label] of pageOverrides) overrides.set(segment, label);

  return (
    <SharedAppBreadcrumb
      appName={APP_NAME}
      pathname={clean}
      navItems={[...nav.people.items, ...nav.admin.items]}
      overrides={overrides}
      routeSegments={ROUTES}
    />
  );
}

"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../components/ui/breadcrumb";
import type { ShellNavItem } from "./types";

// Record ids: UUIDs and Core HR's stable employee keys (E-<32 hex>), never shown raw.
const UUID_SEGMENT_REGEX =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|E-[0-9a-f]{32})$/i;

function humanize(segment: string): string {
  return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ");
}

function resolveLabel(
  segment: string,
  navItems: ShellNavItem[],
  overrides: Map<string, string>,
  details: string,
): string {
  if (UUID_SEGMENT_REGEX.test(segment)) {
    return overrides.get(segment) ?? details;
  }
  const fromOverride = overrides.get(segment);
  if (fromOverride) return fromOverride;

  const fromNav = navItems.find((item) => {
    const navSegment = item.href.replace(/^\//, "");
    return navSegment === segment;
  });
  if (fromNav) return fromNav.label;

  return humanize(segment);
}

export interface AppBreadcrumbProps {
  /** The app name shown as the root breadcrumb (e.g. "Core", "Performance"). */
  appName: string;
  /** Current pathname from the router (e.g. "/employees/abc-123"). */
  pathname: string;
  /** Flat list of nav items used for label resolution. */
  navItems: ShellNavItem[];
  /** Dynamic label overrides keyed by path segment. */
  overrides?: Map<string, string>;
  /** Transform a relative href into a full link target (e.g. for tenant context). */
  buildHref?: (href: string) => string;
}

/**
 * Route-driven breadcrumb shared across Core and Performance.
 *
 * Derives breadcrumb segments from the URL path. Labels resolve in order:
 * 1. Dynamic overrides (e.g. employee name for a UUID segment)
 * 2. Static nav item labels
 * 3. Humanized path segment
 */
export function AppBreadcrumb({
  appName,
  pathname,
  navItems,
  overrides = new Map(),
  buildHref,
}: AppBreadcrumbProps) {
  const t = useTranslations("ds.breadcrumb");
  const segments = useMemo(() => {
    const clean = pathname.replace(/^\/+/, "") || "";
    return clean ? clean.split("/").filter(Boolean) : [];
  }, [pathname]);

  const link = (href: string) =>
    buildHref ? buildHref(href) : href;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {segments.length === 0 ? (
          <BreadcrumbItem>
            <BreadcrumbPage>{appName}</BreadcrumbPage>
          </BreadcrumbItem>
        ) : (
          <>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href={link("/")}>{appName}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            {segments.map((segment, index) => {
              const isLast = index === segments.length - 1;
              const href = "/" + segments.slice(0, index + 1).join("/");
              const label = resolveLabel(segment, navItems, overrides, t("details"));
              return (
                <React.Fragment key={href}>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    {isLast ? (
                      <BreadcrumbPage>{label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild>
                        <Link href={link(href)}>{label}</Link>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </React.Fragment>
              );
            })}
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useHydratedWorkspaceAccess, PageRefusal } from "@repo/auth";
import { PageState } from "@repo/ds/shell";
import { Button } from "@repo/ds/components/ui/button";
import { PerformanceRouteSkeleton } from "./route-page-skeleton";
import { buildShellUrl } from "@/lib/shell-url";
import {
  buildPerformanceCallbackUrl,
  resolvePerformanceWorkspaceAccessState,
} from "./performance-workspace-access";
import { useTranslations } from "next-intl";

export function PerformanceWorkspaceAccessBoundary({
  children,
}: {
  children: ReactNode;
}) {
  const t = useTranslations("common.PerformanceWorkspaceAccessBoundary");
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The shared hydration-safe mechanism holds the first client render equal to
  // the server's until hydration settles, then resolves access from session
  // claims. This is what keeps Performance from regenerating its subtree during
  // hydration — the guard now lives in @repo/auth so it cannot be forgotten.
  const { state } = useHydratedWorkspaceAccess(
    resolvePerformanceWorkspaceAccessState,
  );

  useEffect(() => {
    if (state !== "sign-in-required") {
      return;
    }

    const callbackUrl = buildPerformanceCallbackUrl(
      pathname,
      searchParams.toString()
    );
    const signInUrl = buildShellUrl("/auth/signin");
    signInUrl.searchParams.set("callbackUrl", callbackUrl);
    window.location.replace(signInUrl);
  }, [pathname, searchParams, state]);

  if (state === "loading" || state === "sign-in-required") {
    return <PerformanceRouteSkeleton label={t("checkingPerformanceAccess")} />;
  }

  if (state === "forbidden") {
    return (
      <PageState
        drawing="refused"
        title={t("performanceIsNotAvailableTo")}
        description={t("useThePlatformControlPlane")}
        actions={
          <Button asChild>
            <a href={buildShellUrl("/platform").toString()}>{t("openPlatform")}</a>
          </Button>
        }
      />
    );
  }

  // They hold no way into Performance at all, so its Overview wouldn't open either.
  if (state === "no-access") return <PageRefusal leaveTo="home" />;

  if (state === "module-unavailable") {
    return (
      <PageState
        drawing="refused"
        title={t("performanceIsNotAvailable")}
        description={t("performanceIsNotEnabledFor")}
        actions={
          <Button asChild>
            <a href={buildShellUrl("/").toString()}>{t("openFusion")}</a>
          </Button>
        }
      />
    );
  }

  return children;
}

"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useHydratedWorkspaceAccess } from "@repo/auth";
import {
  PageContainer,
  PageHeader,
  PagePermissionNotice,
  PageRefusal,
} from "@repo/ds/shell";
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
      <PageContainer className="space-y-6">
        <PageHeader
          title={t("performanceIsACustomerWorkspace")}
          description={t("platformAdministrationIsKeptSeparate")}
        />
        <PagePermissionNotice
          title={t("performanceIsNotAvailableTo")}
          description={t("useThePlatformControlPlane")}
          action={
            <Button asChild>
              <a href={buildShellUrl("/platform").toString()}>{t("openPlatform")}</a>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  if (state === "no-access") {
    return (
      <PageContainer>
        <PageRefusal
          action={
            <Button asChild variant="outline">
              <a href={buildShellUrl("/").toString()}>{t("openFusion")}</a>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  if (state === "module-unavailable") {
    return (
      <PageContainer>
        <PagePermissionNotice
          title={t("performanceIsNotAvailable")}
          headingLevel={1}
          description={t("performanceIsNotEnabledFor")}
          action={
            <Button asChild variant="outline">
              <a href={buildShellUrl("/").toString()}>{t("openFusion")}</a>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  return children;
}

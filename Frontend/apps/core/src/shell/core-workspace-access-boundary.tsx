"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { canAccessPlatform, useHydratedWorkspaceAccess } from "@repo/auth";
import {
  PageContainer,
  PageHeader,
  PagePermissionNotice,
} from "@repo/ds/shell";
import { Button } from "@/components/ui/button";
import { CoreRouteSkeleton } from "./route-page-skeleton";
import { buildShellUrl } from "@/lib/shell-url";
import {
  buildCoreCallbackUrl,
  resolveCoreWorkspaceAccessState,
} from "./core-workspace-access";

export function CoreWorkspaceAccessBoundary({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("frame");

  // The shared hydration-safe mechanism holds the first client render equal to
  // the server's until hydration settles, then resolves access from session
  // claims — so this boundary can never drift back into a hydration mismatch.
  const { state, user } = useHydratedWorkspaceAccess(({ user, isLoading }) =>
    resolveCoreWorkspaceAccessState({ user, isLoading, pathname }),
  );

  useEffect(() => {
    if (state !== "sign-in-required") {
      return;
    }

    const callbackUrl = buildCoreCallbackUrl(pathname, searchParams.toString());
    const signInUrl = buildShellUrl("/auth/signin");
    signInUrl.searchParams.set("callbackUrl", callbackUrl);
    window.location.replace(signInUrl);
  }, [pathname, searchParams, state]);

  if (state === "loading" || state === "sign-in-required") {
    return <CoreRouteSkeleton label={t("checkingAccess")} />;
  }

  if (state === "forbidden") {
    if (!canAccessPlatform(user)) {
      return (
        <PageContainer className="space-y-6">
          <PageHeader
            title={t("boundary.denied.title")}
            description={t("boundary.denied.description")}
          />
          <PagePermissionNotice
            title={t("boundary.denied.noticeTitle")}
            description={t("boundary.denied.noticeDescription")}
            action={
              <Button asChild variant="outline">
                <a href={buildShellUrl("/").toString()}>{t("boundary.denied.action")}</a>
              </Button>
            }
          />
        </PageContainer>
      );
    }
    return (
      <PageContainer className="space-y-6">
        <PageHeader
          title={t("boundary.platform.title")}
          description={t("boundary.platform.description")}
        />
        <PagePermissionNotice
          title={t("boundary.platform.noticeTitle")}
          description={t("boundary.platform.noticeDescription")}
          action={
            <Button asChild>
              <a href={buildShellUrl("/platform").toString()}>{t("boundary.platform.action")}</a>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  if (state === "module-unavailable") {
    return (
      <PageContainer className="space-y-6">
        <PageHeader
          title={t("boundary.unavailable.title")}
          description={t("boundary.unavailable.description")}
        />
        <PagePermissionNotice
          title={t("boundary.unavailable.noticeTitle")}
          description={t("boundary.unavailable.noticeDescription")}
          action={
            <Button asChild variant="outline">
              <a href={buildShellUrl("/").toString()}>{t("boundary.unavailable.action")}</a>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  if (state === "allowed") return children;

  return <CoreRouteSkeleton label={t("checkingAccess")} />;
}

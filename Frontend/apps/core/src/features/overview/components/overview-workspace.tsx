"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  canViewCoreReports,
  canAccessCoreAccess,
  canAccessCoreSettings,
  canAccessCorePeople,
  canAccessCoreTeam,
  canAccessOwnCoreProfile,
  useAuth,
} from "@repo/auth";
import {
  PageContainer,
  PageLoading,
  PagePermissionNotice,
} from "@repo/ds/shell";
import { OverviewPageSkeleton } from "@/shell/route-skeletons";
import { ADMINISTRATORS_PATH } from "@/features/settings/roles/paths";
import FrontPage from "./front-page";

/** Company history is the Reports read, at the viewer's existing reach. Other viewers enter their own workspace. */
export default function OverviewWorkspace() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const t = useTranslations("overview");
  const canSee = canViewCoreReports(user);
  const fallback = canAccessCoreTeam(user)
    ? "/team"
    : canAccessOwnCoreProfile(user)
      ? "/profile"
      : canAccessCorePeople(user)
        ? "/people"
        : canAccessCoreAccess(user)
          ? ADMINISTRATORS_PATH
          : canAccessCoreSettings(user)
            ? "/settings"
            : null;
  useEffect(() => {
    if (!isLoading && !canSee && fallback) router.replace(fallback);
  }, [isLoading, canSee, fallback, router]);
  if (isLoading) return <OverviewPageSkeleton />;
  if (canSee) return <FrontPage />;
  return (
    <PageContainer width="wide">
      {fallback ? (
        <PageLoading
          rows={4}
          label={t("operations.redirectingTo", { href: fallback })}
        />
      ) : (
        <PagePermissionNotice
          title={t("operations.none")}
          description={t("operations.noneDescription")}
        />
      )}
    </PageContainer>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { User } from "lucide-react";
import { useFieldVisibility } from "@repo/api/query";
import { PageFailure, useAuth } from "@repo/auth";
import { PageContainer, PageEmpty, PageHeader } from "@repo/ds/shell";
import PeopleProfileWorkspace from "@/features/people/components/people-profile-workspace";
import { WorkerProfileSkeleton } from "@/features/people/components/worker-profile/worker-profile-skeleton";
import { useEmployeeDetailsById } from "@/features/people/api/use-employees";

/** The signed-in person's own page: the one person page (B-180), opened on themselves. */
export function MyProfile() {
  const { user, isLoading: authLoading } = useAuth();
  const t = useTranslations("profile.self");
  const employeeId = user?.employeeId ?? null;
  // The field policy every member may read (fusion-settings): no settings permission needed.
  const { data: settings } = useFieldVisibility({ enabled: Boolean(employeeId) });
  const { data: details, error, isLoading, refetch } = useEmployeeDetailsById(employeeId);

  if (authLoading || (employeeId && isLoading && !details && !error)) return <WorkerProfileSkeleton />;

  // Workforce existence and Fusion-account linkage are separate concepts: a
  // signed-in account with no linked worker is not "profile unavailable".
  if (!employeeId) {
    return (
      <PageContainer className="space-y-6">
        <PageHeader title={t("title")} description={t("noLink")} />
        <PageEmpty icon={User} title={t("noLinkTitle")} description={t("noLinkDescription")} />
      </PageContainer>
    );
  }

  if (error) return <PageFailure error={error} onRetry={refetch} />;
  if (!details) {
    return (
      <PageContainer className="space-y-6">
        <PageHeader title={t("title")} />
        <PageEmpty icon={User} title={t("notFound")} description={t("notFoundDescription")} />
      </PageContainer>
    );
  }

  return (
    <PeopleProfileWorkspace
      employeeKey={details.stableEmployeeKey}
      self
      selfService={{
        canEditPreferredName: settings?.selfService.canEditPreferredName !== false,
        canEditPhone: settings?.selfService.canEditPhone !== false,
      }}
    />
  );
}

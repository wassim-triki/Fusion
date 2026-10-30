"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { canViewCoreOrganization, useAuth } from "@repo/auth";
import { PageHeader, PagePermissionNotice } from "@repo/ds/shell";
import { OrganizationLenses, type OrganizationLens } from "@/features/organization/components/organization-lenses";

/** The Organization area's frame around Jobs and Places: the area's title, its lenses, then the view. */
export function CatalogFrame({
  lens,
  actions,
  children,
}: {
  lens: Exclude<OrganizationLens, "structure">;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("organization");
  const { user, isLoading } = useAuth();
  const canView = isLoading || canViewCoreOrganization(user);
  return (
    <div className="mx-auto w-full max-w-6xl px-6 pt-5 pb-10">
      <PageHeader title={t("title")} className="mb-3" actions={canView ? actions : undefined} />
      <OrganizationLenses active={lens} />
      <div className="mt-6">
        {canView ? children : <PagePermissionNotice title={t("access.title")} description={t("access.description")} />}
      </div>
    </div>
  );
}

/** Who holds a job or place today: a figure, or a faint dash for nobody. */
export function CountCell({ value }: { value: number }) {
  return value > 0 ? (
    <span className="type-body tabular-nums text-foreground">{value}</span>
  ) : (
    <span className="type-body text-muted-foreground/60" aria-label="0">–</span>
  );
}

"use client";

import { usePathname } from "next/navigation";
import { PageContainer, PageSkeleton } from "@repo/ds/shell";
import { RecordSkeleton } from "@/features/tenants/record/record-skeleton";
import { TenantsPageSkeleton } from "@/features/tenants/overview/tenants-page-skeleton";

export function PlatformRouteSkeleton({ label }: { label?: string }) {
  const path = usePathname().replace(/^\/platform(?=\/|$)/, "") || "/";
  const skeleton =
    path === "/" || path === "/tenants" ? (
      <TenantsPageSkeleton />
    ) : /^\/tenants\/[^/]+(?:\/|$)/.test(path) && path !== "/tenants/new" ? (
      <PageContainer>
        <RecordSkeleton />
      </PageContainer>
    ) : (
      <PageSkeleton rows={3} />
    );
  return (
    <div aria-busy aria-label={label}>
      {skeleton}
    </div>
  );
}

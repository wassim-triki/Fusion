import { useTranslations } from "next-intl";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { PageContainer, PageHeader } from "@repo/ds/shell";

/** Static estate-directory geometry, shared before access and before data. */
export function TenantsPageSkeleton() {
  const t = useTranslations("tenants.overview");
  return (
    <PageContainer width="wide" aria-busy>
      <PageHeader title={t("title")} description={t("description")} />
      <div aria-hidden="true">
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-5 rounded-surface bg-card p-5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-14" />
              <Skeleton className="h-3 w-32 max-w-full" />
            </div>
          ))}
        </div>
        <div className="overflow-hidden rounded-surface bg-card">
          <div className="flex h-14 items-center gap-3 px-4">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-8 w-24" />
          </div>
          <div className="flex h-10 items-center gap-8 bg-inlay px-4">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
          {Array.from({ length: 10 }, (_, i) => (
            <div
              key={i}
              className="flex h-14 items-center gap-5 border-t border-border px-4"
            >
              <Skeleton className="size-8 rounded-control" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
          <div className="flex h-12 items-center justify-between border-t border-border px-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-32" />
          </div>
        </div>
        <div className="mt-6 space-y-3">
          <Skeleton className="h-5 w-40" />
          <div className="grid gap-2 md:grid-cols-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-surface" />
            ))}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

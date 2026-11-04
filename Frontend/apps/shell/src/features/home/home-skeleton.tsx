import { Skeleton } from "@repo/ds";
import { PageContainer } from "@repo/ds/shell";
import { useTranslations } from "next-intl";

/** No identity, capabilities or tenant data is needed to draw Home's pending frame. */
export function HomeSkeleton() {
  const t = useTranslations("ds.states");
  return (
    <PageContainer
      className="space-y-8"
      aria-busy
      aria-label={t("loadingPage")}
    >
      <div className="space-y-2" aria-hidden="true">
        <Skeleton className="h-12 w-80 max-w-full" />
        <Skeleton className="h-5 w-64 max-w-full" />
      </div>
      <div
        className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_300px]"
        aria-hidden="true"
      >
        <div className="space-y-5 rounded-surface bg-card p-7">
          <Skeleton className="h-6 w-56 max-w-full" />
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-control" />
          ))}
        </div>
        <div className="space-y-5">
          <Skeleton className="h-48 w-full rounded-surface" />
          <Skeleton className="h-36 w-full rounded-surface" />
        </div>
      </div>
    </PageContainer>
  );
}

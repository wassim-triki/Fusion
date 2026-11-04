import { useTranslations } from "next-intl";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { PageContainer } from "@repo/ds/shell";

export function OneOnOnesSkeleton() {
  const t = useTranslations("oneOnOnes.OneOnOnesSkeleton");
  return (
    <PageContainer width="wide">
      <div role="status" aria-label={t("loadingYour11s")}>
        <Skeleton className="h-9 w-24" />
        <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="space-y-10">
            <Skeleton className="h-56 w-full rounded-surface" />
            <Skeleton className="h-72 w-full rounded-surface" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-20 w-full rounded-surface" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

export function SeriesSkeleton() {
  const t = useTranslations("oneOnOnes.SeriesSkeleton");
  return (
    <PageContainer width="wide">
      <div role="status" aria-label={t("loadingThis11")}>
        <Skeleton className="h-4 w-16" />
        <div className="mt-4 flex items-center gap-4">
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="h-9 w-72 max-w-full" />
        </div>
        <Skeleton className="mt-8 h-12 w-full" />
        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="space-y-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-52 w-full rounded-surface" />
            <Skeleton className="h-40 w-full rounded-surface" />
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    </PageContainer>
  );
}

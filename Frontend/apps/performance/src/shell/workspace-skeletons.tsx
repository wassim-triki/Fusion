import { useTranslations } from "next-intl";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { PageContainer, PageHeader, TeamBandSkeleton } from "@repo/ds/shell";

export function TeamWorkspaceSkeleton() {
  return (
    <PageContainer width="wide" className="max-w-6xl pb-16" aria-busy>
      <TeamBandSkeleton />
      <div className="mt-8 space-y-6" aria-hidden="true">
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="h-5 w-96 max-w-full" />
        <Skeleton className="h-72 w-full rounded-surface" />
        <Skeleton className="h-48 w-full rounded-surface" />
      </div>
    </PageContainer>
  );
}

export function FeedSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <Skeleton className="h-32 w-full rounded-surface" />
      <Skeleton className="h-32 w-full rounded-surface" />
    </div>
  );
}

export function FeedbackPageSkeleton() {
  const t = useTranslations("conversations.FeedbackWorkspace");
  return (
    <PageContainer width="wide" aria-busy>
      <PageHeader className="mb-4" title={t("feedback")} />
      <div className="mt-4 flex gap-3" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-24" />
        ))}
      </div>
      <div className="mt-6">
        <FeedSkeleton />
      </div>
    </PageContainer>
  );
}

export function WorkspaceSkeleton() {
  const t = useTranslations("reviews.WorkspaceSkeleton");
  return (
    <PageContainer width="wide">
      <PageHeader className="mb-4" title={t("reviews")} size="display" />
      <div className="space-y-6" aria-label={t("loadingReviews")} role="status">
        <Skeleton className="h-56 rounded-surface" />
        <div className="grid gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-surface" />
          ))}
        </div>
        <Skeleton className="h-40 rounded-surface" />
      </div>
    </PageContainer>
  );
}

export function RequestSkeleton() {
  const t = useTranslations("conversations.RequestSkeleton");
  return (
    <PageContainer>
      <div
        role="status"
        aria-label={t("loadingThisRequest")}
        className="mx-auto max-w-3xl space-y-4"
      >
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="mt-8 h-48 w-full rounded-surface" />
      </div>
    </PageContainer>
  );
}

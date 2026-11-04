import { useTranslations } from "next-intl";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { cn } from "@repo/ds/lib/utils";
import { RECORD_DESTINATIONS } from "./record-routes";

/** Holds the record's real shape — header, destinations, then content. */
export function RecordSkeleton() {
  const t = useTranslations("record");
  return (
    <div aria-busy aria-label={t("loading")}>
      <div className="mb-6 flex items-center gap-5">
        <Skeleton className="size-16 shrink-0 rounded-surface" />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
          <Skeleton className="mt-2 h-4 w-32" />
        </div>
        <Skeleton className="size-9 shrink-0 self-start rounded-control" />
      </div>

      <div className="mb-6 flex gap-7 border-b border-border pb-3">
        {RECORD_DESTINATIONS.map((destination) => (
          <Skeleton
            key={destination.segment || "overview"}
            className="h-4 w-20"
          />
        ))}
      </div>

      {/* Mirrors the Overview body exactly — lifecycle banner, then the
          [1.45fr / 1fr] grid of Administrative handoff + Products on the left
          and Tenant profile + Recent activity on the right — so the real
          content lands in place without a reflow. */}
      <div className="space-y-5">
        {/* Lifecycle banner */}
        <div className="flex items-center gap-4 rounded-surface bg-card px-5 py-4">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3.5 w-80 max-w-full" />
          </div>
        </div>

        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <HandoffSkeleton />
            <ProductsSkeleton />
          </div>
          <div className="flex flex-col gap-3">
            <ProfileSkeleton />
            <ActivitySkeleton />
          </div>
        </div>
      </div>
    </div>
  );
}

/** A card header: leading icon, a title, and an optional trailing control. */
function SkeletonCardHeader({
  titleWidth,
  subtitleWidth,
  action,
}: {
  titleWidth: string;
  subtitleWidth?: string;
  action?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <Skeleton className="size-8 shrink-0 rounded-control" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className={cn("h-4", titleWidth)} />
        {subtitleWidth ? (
          <Skeleton className={cn("h-3.5", subtitleWidth)} />
        ) : null}
      </div>
      {action ? (
        <Skeleton className="h-8 w-24 shrink-0 rounded-control" />
      ) : null}
    </div>
  );
}

/** Administrative handoff: header, then the person / status / action strip. */
function HandoffSkeleton() {
  return (
    <div className="rounded-surface bg-card p-5">
      <SkeletonCardHeader titleWidth="w-40" subtitleWidth="w-64" />
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-4 rounded-surface border border-border bg-inlay px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="ms-auto h-8 w-32 rounded-control" />
      </div>
    </div>
  );
}

/** Products: header with a trailing button, then six catalogue rows. */
function ProductsSkeleton() {
  return (
    <div className="rounded-surface bg-card p-5">
      <SkeletonCardHeader titleWidth="w-24" subtitleWidth="w-48" action />
      <ul className="mt-4 divide-y divide-border overflow-hidden rounded-surface border border-border bg-inlay">
        {Array.from({ length: 6 }).map((_, index) => (
          <li key={index} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="size-5 shrink-0 rounded-detail" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="ms-auto h-5 w-20 rounded-full" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Tenant profile: header with an Edit button, then four label / value rows. */
function ProfileSkeleton() {
  return (
    <div className="rounded-surface bg-card p-5">
      <SkeletonCardHeader titleWidth="w-28" action />
      <div className="mt-4 divide-y divide-border">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] items-baseline gap-10 py-3"
          >
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Recent activity: header with a link, then four timeline entries. */
function ActivitySkeleton() {
  return (
    <div className="rounded-surface bg-card p-5">
      <SkeletonCardHeader titleWidth="w-28" action />
      <ol className="mt-4 space-y-5">
        {Array.from({ length: 4 }).map((_, index) => (
          <li key={index} className="flex gap-3">
            <Skeleton className="mt-1 size-2.5 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-20 shrink-0" />
              </div>
              <Skeleton className="h-3.5 w-56 max-w-full" />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

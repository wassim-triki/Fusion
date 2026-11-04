import { useTranslations } from "next-intl";
import { Skeleton } from "@repo/ds";
import { PageHeader } from "@repo/ds/shell";

/** Safe for SSR before the viewer's table/card permissions are known. */
export function PeoplePendingContent() {
  const t = useTranslations("frame.skeletons");
  return (
    <div aria-busy aria-label={t("loadingPeople")}>
      <PageHeader title={t("people")} />
      <div aria-hidden="true">
        <div className="mb-4 flex gap-5">
          {[96, 112, 88].map((width) => (
            <Skeleton key={width} className="h-8" style={{ width }} />
          ))}
        </div>
        <div className="overflow-hidden rounded-surface bg-card">
          <div className="flex h-14 items-center gap-3 px-4">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-8 w-24" />
          </div>
          <div className="flex h-10 items-center gap-8 bg-inlay px-4">
            {[160, 112, 96, 80].map((width) => (
              <Skeleton key={width} className="h-3" style={{ width }} />
            ))}
          </div>
          {Array.from({ length: 10 }, (_, i) => (
            <div
              key={i}
              className="flex h-14 items-center gap-8 border-t border-border px-4"
            >
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
          <div className="flex h-12 items-center justify-between border-t border-border px-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-32" />
          </div>
        </div>
      </div>
    </div>
  );
}

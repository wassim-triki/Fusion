import { Skeleton } from "@repo/ds";
import { PageContainer } from "@repo/ds/shell";

/**
 * Loading skeleton for the worker profile. Mirrors `WorkerProfile`'s geometry (band with the photo, name
 * and tabs, then the rail and the tab body) so the page resolves in place.
 */
export function WorkerProfileSkeleton({ showBackLink = false }: { showBackLink?: boolean } = {}) {
  return (
    <PageContainer width="wide" className="max-w-6xl pb-16" aria-busy>
      {showBackLink ? <Skeleton className="mb-4 h-5 w-20" /> : null}

      <section className="relative rounded-surface bg-section px-6 pt-6 sm:grid sm:grid-cols-[10.5rem_minmax(0,1fr)] sm:gap-x-8 sm:px-8 sm:pt-8">
        <Skeleton className="mb-4 size-24 rounded-full sm:row-span-3 sm:mb-0 sm:size-[10.5rem] sm:self-start" />
        <div className="space-y-2.5 sm:col-start-2">
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3.5 w-32" />
        </div>
        <div className="mt-5 flex gap-4 pb-5 sm:col-start-2">
          <Skeleton className="h-5 w-12" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-20" />
        </div>
      </section>

      <div className="mt-8 flex flex-col gap-10 lg:flex-row lg:items-start">
        <div className="w-full shrink-0 space-y-5 lg:w-64">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-4 w-40" />
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1 space-y-8 lg:pt-2">
          <div className="space-y-3">
            <Skeleton className="h-5 w-32" />
            <div className="flex gap-10">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-24" />
              ))}
            </div>
          </div>
          <Skeleton className="h-48 w-full rounded-surface" />
        </div>
      </div>
    </PageContainer>
  );
}

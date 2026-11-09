"use client";

import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { PageContainer } from "@repo/ds/shell";
import { PlanDocument, PlanSection, SidebarSection } from "./plan-layout";
import { useTranslations } from "next-intl";

/**
 * The Plan's loading state in its real frame: the objective cards beside the unframed sidebar, so the surface fills in place rather than swapping layouts.
 */
export function PlanSurfaceSkeleton() {
  const t = useTranslations("plan.PlanSurfaceSkeleton");
  return (
    <div role="status" aria-label={t("loadingYourPlan")}>
      <PlanDocument
        main={
          <PlanSection label={<Skeleton className="h-5 w-28" />} summary={<Skeleton className="h-2 w-40 rounded-full" />}>
            {/* Objective cards mirror PlanObjectiveRow: identity, then facts + weight. */}
            <div className="space-y-3">
              {Array.from({ length: 2 }, (_, i) => (
                <div key={i} className="rounded-surface bg-card p-5">
                  <div className="flex items-start gap-4">
                    <Skeleton className="size-10 shrink-0 rounded-control" />
                    <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                      <Skeleton className="h-4 w-3/5" />
                      <Skeleton className="h-3 w-2/5" />
                    </div>
                  </div>
                  <div className="mt-4 flex items-end gap-3 ps-14">
                    <div className="flex min-w-0 flex-1 gap-8">
                      {["w-28", "w-24", "w-40"].map((width, j) => (
                        <div key={j} className={j === 2 ? "hidden space-y-2 sm:block" : "space-y-2"}>
                          <Skeleton className="h-3 w-20" />
                          <Skeleton className={`h-4 ${width}`} />
                        </div>
                      ))}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <Skeleton className="h-3 w-12" />
                      <Skeleton className="h-5 w-10" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </PlanSection>
        }
        sidebar={
          // Sidebar: unframed property groups, as the real sidebar.
          <>
            {Array.from({ length: 3 }, (_, i) => (
              <SidebarSection key={i} label={<Skeleton className="h-3 w-24" />}>
                <div className="mt-4 space-y-5">
                  {Array.from({ length: 2 }, (_, j) => (
                    <div key={j} className="flex gap-3.5">
                      <Skeleton className="size-8 shrink-0 rounded-full" />
                      <div className="flex-1 space-y-1.5 pt-1">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-full" />
                      </div>
                    </div>
                  ))}
                </div>
              </SidebarSection>
            ))}
          </>
        }
      />
    </div>
  );
}

/**
 * My Plan's loading state, shaped like its not-started surface: the centred start card (illustration,
 * heading, three pillars, the start action) beside the next-steps and direction sidebar.
 */
export function PlanEmptySkeleton() {
  const t = useTranslations("plan.PlanEmptySkeleton");
  return (
    <div role="status" aria-label={t("loadingYourPlan")}>
      <PlanDocument
        main={
          <PlanSection label={<Skeleton className="h-5 w-28" />}>
            <div className="flex flex-col items-center rounded-surface bg-card px-6 py-12">
              <Skeleton className="h-36 w-36 rounded-full" />
              <Skeleton className="mt-6 h-7 w-72" />
              <Skeleton className="mt-3 h-4 w-64" />
              <div className="mt-8 grid w-full max-w-3xl gap-5 sm:grid-cols-3">
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="flex items-center justify-center gap-3">
                    <Skeleton className="size-9 shrink-0 rounded-full" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ))}
              </div>
              <Skeleton className="mt-8 h-10 w-40 rounded-control" />
            </div>
          </PlanSection>
        }
        sidebar={
          <>
            <SidebarSection label={<Skeleton className="h-3 w-20" />}>
              <div className="mt-5 space-y-6">
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="flex gap-3.5">
                    <Skeleton className="size-8 shrink-0 rounded-full" />
                    <div className="flex-1 space-y-1.5 pt-1">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  </div>
                ))}
              </div>
            </SidebarSection>
            <SidebarSection label={<Skeleton className="h-3 w-20" />}>
              <div className="mt-4 space-y-5">
                {Array.from({ length: 2 }, (_, i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="size-8 shrink-0 rounded-control" />
                    <div className="flex-1 space-y-1.5 pt-0.5">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                ))}
              </div>
            </SidebarSection>
          </>
        }
      />
    </div>
  );
}

/** Page-level loading: the heading and subtitle, then the surface skeleton (`empty` for My Plan). */
export function PlanPageSkeleton({ empty = false }: { empty?: boolean }) {
  return (
    <PageContainer width="wide">
      <div className="mb-6 space-y-2.5">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-40" />
      </div>
      {empty ? <PlanEmptySkeleton /> : <PlanSurfaceSkeleton />}
    </PageContainer>
  );
}

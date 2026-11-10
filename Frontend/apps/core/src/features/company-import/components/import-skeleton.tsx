"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageContainer } from "@repo/ds/shell";
import { Skeleton } from "@/components/ui/skeleton";
import { useBreadcrumbLabel } from "@/shell/breadcrumb-overrides";

// Presentation only: the route loading boundary renders this before the import is fetched,
// so the page's step travels in the URL (`?step=`) and the loading shape and crumb follow it.

export type ImportStep = "understood" | "chart" | "again" | "bring";

const STEP_PARAM: Record<ImportStep, string | null> = { understood: null, chart: "chart", again: "changes", bring: "done" };

export function importStepFromParam(step: string | null): ImportStep {
  return step === "chart" ? "chart" : step === "changes" ? "again" : step === "done" ? "bring" : "understood";
}

export function importHref(id: string, step: ImportStep = "understood"): string {
  const param = STEP_PARAM[step];
  return param ? `/import/${id}?step=${param}` : `/import/${id}`;
}

/** The step's crumb: its name, as the loaded page shows it. */
export function useImportCrumb(id: string, step: ImportStep | null) {
  const t = useTranslations("companyImport");
  const label = step === "chart" ? t("chart.crumb") : step === "again" ? t("again.crumb")
    : step === "bring" ? t("bring.crumb") : step ? t("understood.title") : undefined;
  useBreadcrumbLabel(id, label);
}

/** The route loading boundary's skeleton for `/import/{id}`. */
export function ImportRouteSkeleton() {
  return (
    <Suspense fallback={<ImportSkeleton step="understood" />}>
      <ImportRouteSkeletonForStep />
    </Suspense>
  );
}

function ImportRouteSkeletonForStep() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const step = importStepFromParam(useSearchParams().get("step"));
  useImportCrumb(sessionId, step);
  return <ImportSkeleton step={step} />;
}

/** The shape of one import step before its data arrives. */
export function ImportSkeleton({ step }: { step: ImportStep }) {
  const t = useTranslations("companyImport");
  if (step === "bring") {
    return (
      <PageContainer width="wide" className="pb-12">
        <div role="status" aria-label={t("loading")} className="mx-auto grid max-w-[60rem] gap-6">
          <div className="grid justify-items-center gap-3 pt-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-10 w-96 max-w-full" />
          </div>
          <div className="grid gap-6 rounded-surface bg-card px-8 pb-7 pt-8">
            <div className="flex flex-wrap justify-center gap-x-8 gap-y-6">
              {[0, 1, 2].map((i) => (
                <div key={i} className="grid w-48 gap-2">
                  <Skeleton className="h-4 w-32" />
                  <div className="flex flex-wrap gap-1.5">{Array.from({ length: 8 }, (_, j) => <Skeleton key={j} className="size-6 rounded-full" />)}</div>
                </div>
              ))}
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
            <div className="flex justify-center gap-7">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-4 w-20" />)}</div>
          </div>
        </div>
      </PageContainer>
    );
  }

  const twoColumns = step === "chart" || step === "again";
  return (
    <PageContainer width="wide" className="pb-12">
      <div role="status" aria-label={t("loading")}>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-5">
          <div className="grid gap-2">
            {twoColumns ? <Skeleton className="h-4 w-20" /> : null}
            <Skeleton className="h-8 w-72 max-w-full" />
            <Skeleton className="h-4 w-56 max-w-full" />
          </div>
          <div className="flex gap-2">
            {!twoColumns ? <Skeleton className="h-9 w-28 rounded-control" /> : null}
            <Skeleton className="h-9 w-36 rounded-control" />
          </div>
        </div>
        {twoColumns ? (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21.25rem]">
            {step === "chart" ? (
              <div className="grid min-w-0 gap-3.5">
                <Skeleton className="h-8 w-72 rounded-control" />
                <Skeleton className="h-[33.75rem] w-full rounded-surface" />
              </div>
            ) : (
              <div className="overflow-hidden rounded-surface bg-card py-1">
                {[0, 1].map((group) => (
                  <div key={group} className={group > 0 ? "border-t border-border" : undefined}>
                    <Skeleton className="mx-5 mb-3 mt-4 h-4 w-24" />
                    {[0, 1, 2].map((row) => (
                      <div key={row} className="flex items-center gap-3.5 border-t border-border px-5 py-3">
                        <Skeleton className="size-10 shrink-0 rounded-full" />
                        <div className="grid flex-1 gap-1.5"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-64 max-w-full" /></div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            <div className="grid gap-3.5">
              <Skeleton className="h-5 w-32" />
              {[0, 1].map((i) => <Skeleton key={i} className="h-32 w-full rounded-surface" />)}
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {[0, 1].map((i) => (
              <div key={i} className="overflow-hidden rounded-surface bg-card">
                <div className="flex items-center gap-3.5 px-5 py-4">
                  <Skeleton className="size-[2.625rem] shrink-0 rounded-control" />
                  <div className="grid flex-1 gap-1.5"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-32" /></div>
                </div>
                <Skeleton className="mx-5 mb-5 h-40 rounded-control" />
              </div>
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  );
}

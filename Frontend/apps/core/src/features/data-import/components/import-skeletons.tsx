"use client";

import { useTranslations } from "next-intl";
import { Skeleton } from "@repo/ds";
import { PageContainer } from "@repo/ds/shell";
import { ImportHeader } from "@/features/data-import/components/import-header";
import type { ImportStep } from "@/features/data-import/components/import-stepper";

// One skeleton per import stage, shaped like the stage it stands in for. The route loading
// boundaries, the access gate and the attempt frame all render these, so loading a stage
// reads as that stage filling in rather than a generic loader swapping out.

export type ImportSkeletonStage = "upload" | "match" | "review";

export type ImportDomain = "organization" | "workforce";

type ImportWords = ReturnType<typeof useTranslations<"dataImport">>;

function useCopy(domain: ImportDomain) {
  const t = useTranslations("dataImport");
  return {
    t,
    title: t(`domain.${domain}.title`),
    context: t(`domain.${domain}.context`),
    name: t(`domain.${domain}.name`),
  };
}

function skeletonSteps(stage: ImportSkeletonStage | null, t: ImportWords): ImportStep[] {
  const at =
    stage === "match"
      ? 1
      : stage === "review"
        ? 2
        : stage === "upload"
          ? 0
          : -1;
  return (["upload", "match", "review"] as const).map((key, index) => ({
    key,
    label: t(`steps.${key}`),
    state: index < at ? "done" : index === at ? "current" : "upcoming",
  }));
}

function LoadingRegion({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-live="polite" aria-label={label}>
      {children}
    </div>
  );
}

/** Upload: the header, the file-and-date card, and the template action. */
export function ImportUploadSkeleton({ domain = "organization" }: { domain?: ImportDomain }) {
  const copy = useCopy(domain);
  return (
    <LoadingRegion label={copy.t("loading.domain", { name: copy.name })}>
      <PageContainer className="space-y-8 pb-16">
        <ImportHeader title={copy.title} context={copy.context} steps={skeletonSteps("upload", copy.t)} />
        <section className="rounded-surface bg-card p-5 shadow-raised sm:p-8">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="mt-2 h-4 w-96 max-w-full" />
          <Skeleton className="mt-6 h-24 w-full rounded-control" />
          <Skeleton className="mt-7 h-4 w-28" />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Skeleton className="h-11 min-w-56 flex-1 basis-64 rounded-control sm:max-w-md" />
            <div className="ms-auto flex items-center gap-3">
              <Skeleton className="h-11 w-36" />
              <Skeleton className="h-11 w-20" />
            </div>
          </div>
        </section>
        <div className="flex items-center gap-4 rounded-surface bg-card p-5">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
          <Skeleton className="h-9 w-28" />
        </div>
      </PageContainer>
    </LoadingRegion>
  );
}

/** An attempt still resolving its stage: the frame's header, then a quiet body. */
export function ImportAttemptSkeleton({
  stage,
  domain = "organization",
}: {
  stage: ImportSkeletonStage | null;
  domain?: ImportDomain;
}) {
  const copy = useCopy(domain);
  return (
    <LoadingRegion label={copy.t("loading.import")}>
      <PageContainer>
        <ImportHeader title={copy.title} context={<Skeleton className="h-4 w-72 max-w-full" />} steps={skeletonSteps(stage, copy.t)} />
      </PageContainer>
      {stage === "match" ? (
        <MatchBody />
      ) : stage === "review" ? (
        domain === "workforce" ? <PeopleReviewBody /> : <ReviewBody />
      ) : (
        <PageContainer className="pt-2">
          <Skeleton className="h-24 rounded-surface" />
        </PageContainer>
      )}
    </LoadingRegion>
  );
}

/** Match body, inside the attempt frame. */
export function ImportMatchSkeleton() {
  const t = useTranslations("dataImport");
  return (
    <LoadingRegion label={t("loading.match")}>
      <MatchBody />
    </LoadingRegion>
  );
}

/** Review body, inside the attempt frame. */
export function ImportReviewSkeleton({ domain = "organization" }: { domain?: ImportDomain }) {
  const t = useTranslations("dataImport");
  return (
    <LoadingRegion label={t("loading.review")}>
      {domain === "workforce" ? <PeopleReviewBody /> : <ReviewBody />}
    </LoadingRegion>
  );
}

function MatchBody() {
  return (
    <>
      <PageContainer className="space-y-6 pt-2">
        <BannerSkeleton metrics={3} />
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]">
          <div className="min-w-0 space-y-6">
            <Panel>
              <Skeleton className="h-5 w-40" />
              <div className="mt-4 space-y-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4"
                  >
                    <Skeleton className="h-9 rounded-control" />
                    <Skeleton className="h-9 rounded-control" />
                  </div>
                ))}
              </div>
            </Panel>
            <Panel>
              <Skeleton className="h-5 w-48" />
              <div className="mt-4 space-y-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-11 rounded-control" />
                ))}
              </div>
            </Panel>
          </div>
          <aside className="min-w-0 space-y-6">
            <Panel>
              <Skeleton className="h-5 w-32" />
              <Skeleton className="mt-4 h-52 rounded-control" />
            </Panel>
            <Panel>
              <Skeleton className="h-5 w-28" />
              <div className="mt-4 space-y-2.5">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton
                    key={index}
                    className="h-4"
                    style={{ width: `${80 - index * 15}%` }}
                  />
                ))}
              </div>
            </Panel>
          </aside>
        </div>
      </PageContainer>
      <FooterSkeleton />
    </>
  );
}

/** Indent depth of each placeholder row, so the tree reads as a hierarchy while loading. */
const TREE_DEPTHS = [0, 1, 2, 2, 1, 2, 3, 3, 1];

function ReviewBody() {
  return (
    <>
      <PageContainer className="space-y-6 pt-2">
        <BannerSkeleton metrics={4} />
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
          <Panel>
            <Skeleton className="h-5 w-48" />
            <Skeleton className="mt-4 h-9 w-full rounded-control sm:max-w-md" />
            <div className="mt-4 space-y-3">
              {TREE_DEPTHS.map((depth, index) => (
                <Skeleton
                  key={index}
                  className="h-7 rounded-control-sm"
                  style={{
                    marginInlineStart: `${depth * 1.5}rem`,
                    width: `${55 - depth * 6}%`,
                  }}
                />
              ))}
            </div>
          </Panel>
          <aside className="min-w-0 space-y-6">
            <Panel>
              <Skeleton className="h-5 w-32" />
              <div className="mt-4 space-y-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-12 rounded-control" />
                ))}
              </div>
            </Panel>
            <Panel>
              <Skeleton className="h-5 w-24" />
              <div className="mt-4 space-y-2.5">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <Skeleton className="size-5 shrink-0 rounded-full" />
                    <Skeleton className="h-4 w-40" />
                  </div>
                ))}
              </div>
            </Panel>
          </aside>
        </div>
      </PageContainer>
      <FooterSkeleton />
    </>
  );
}

/** Workforce Review: the summary, the classification filters, and the paged people list. */
function PeopleReviewBody() {
  return (
    <>
      <PageContainer className="space-y-4 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-surface bg-card p-4 sm:pe-5">
          <div className="flex min-w-0 items-center gap-4">
            <Skeleton className="size-12 shrink-0 rounded-full" />
            <div className="min-w-0 space-y-2">
              <Skeleton className="h-7 w-52" />
              <Skeleton className="h-4 w-[26rem] max-w-full" />
            </div>
          </div>
          <Skeleton className="h-10 w-56 rounded-control" />
        </div>
        <section className="min-w-0 overflow-hidden rounded-surface bg-card">
          <div className="space-y-4 px-4 pb-4 pt-5 sm:px-5">
            <Skeleton className="h-6 w-48" />
            <div className="flex flex-wrap items-center gap-3">
              <Skeleton className="h-10 w-full rounded-control sm:w-96" />
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-24 rounded-full" />
              ))}
            </div>
          </div>
          <div className="border-y border-border bg-inlay px-5 py-3">
            <Skeleton className="h-3.5 w-2/3" />
          </div>
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4 border-b border-border/60 px-5 py-3 last:border-b-0">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4" style={{ width: `${34 - (index % 3) * 5}%` }} />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="hidden h-4 w-28 md:block" />
              <Skeleton className="hidden h-4 w-32 lg:block" />
              <Skeleton className="hidden h-4 w-24 lg:block" />
              <Skeleton className="h-7 w-24 rounded-full" />
            </div>
          ))}
        </section>
      </PageContainer>
      <FooterSkeleton />
    </>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-surface bg-card p-5">
      {children}
    </section>
  );
}

function BannerSkeleton({ metrics }: { metrics: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-5 rounded-surface bg-card p-4 sm:pe-6">
      <div className="flex min-w-0 flex-[2] basis-80 items-center gap-4">
        <Skeleton className="size-12 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-6">
        {Array.from({ length: metrics }).map((_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton className="size-5 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-3 w-14" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FooterSkeleton() {
  return (
    <div className="sticky bottom-0 z-20 mt-8 border-t border-border bg-background">
      <PageContainer className="flex items-center justify-between gap-4 py-3">
        <Skeleton className="h-9 w-28" />
        <div className="flex items-center gap-4">
          <Skeleton className="hidden h-4 w-40 sm:block" />
          <Skeleton className="h-9 w-40" />
        </div>
      </PageContainer>
    </div>
  );
}

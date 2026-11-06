import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  PageContainer,
  PageHeader,
  PageLoading,
  PageSkeleton,
  SettingsSkeleton,
  TeamBandSkeleton,
} from "@repo/ds/shell";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkerProfileSkeleton } from "@/features/people/components/worker-profile/worker-profile-skeleton";
import { PeoplePendingContent } from "@/features/people/components/people-page-skeleton";
import { ImportRouteSkeleton } from "@/features/company-import/components/import-skeleton";

// ── Route skeleton registry ─────────────────────────────────────────────────
// One dedicated loading skeleton per route, shared by every loading surface:
// the (pages) route loading boundary, the workspace access hold,
// and the pages' own loading branches. All three render the SAME component for
// a given route, so the user sees exactly one skeleton from first paint to
// content — never a generic phase swapping into a dedicated one.
//
// Import static presentation only, never feature queries or page modules.

export function getCorePathname(pathname: string): string {
  const nextPath = pathname.replace(/^\/core(?=\/|$)/, "");
  return nextPath || "/";
}

interface TitledPageLoadingProps {
  title: string;
  description?: string;
  rows?: number;
  label?: string;
  className?: string;
}

/** Standard "real title + content rows" loading page. */
export function TitledPageLoading({
  title,
  description,
  rows = 6,
  label,
  className = "space-y-6",
}: TitledPageLoadingProps) {
  const t = useTranslations("frame.skeletons");
  return (
    <PageContainer width="wide" className={className}>
      <PageHeader title={title} description={description} />
      <PageLoading
        rows={rows}
        label={label ?? t("loadingTitle", { title: title.toLowerCase() })}
      />
    </PageContainer>
  );
}

export function OverviewPageSkeleton() {
  const t = useTranslations("frame.skeletons");
  return (
    <PageContainer width="wide" className="space-y-6">
      <div className="flex items-center gap-4" role="status" aria-label={t("loadingTitle", { title: t("dashboard") })}>
        <Skeleton className="size-14 shrink-0 rounded-control" />
        <div className="grid gap-2"><Skeleton className="h-8 w-80 max-w-full" /><Skeleton className="h-4 w-64 max-w-full" /></div>
      </div>
      <OverviewContentSkeleton />
    </PageContainer>
  );
}

export function OverviewContentSkeleton() {
  return <>
    <Skeleton className="h-[420px] w-full rounded-surface" />
    <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map(i => <Skeleton key={i} className="h-60 rounded-surface" />)}
    </div>
  </>;
}

export function EmployeesPageSkeleton({ label }: { label?: string }) {
  return (
    <PageContainer width="wide" className="pb-12" aria-label={label}>
      <PeoplePendingContent />
    </PageContainer>
  );
}

export function EmployeeProfilePageSkeleton() {
  return <WorkerProfileSkeleton />;
}

export function MyProfilePageSkeleton() {
  return <WorkerProfileSkeleton />;
}

export function TeamPageSkeleton() {
  return (
    <PageContainer width="wide" className="max-w-6xl pb-16">
      <TeamBandSkeleton />
    </PageContainer>
  );
}

/** Loading skeleton for the Administrators workspace — same shape the page fills. */
export function AccessPageSkeleton() {
  return (
    <PageContainer width="wide" className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9 w-36 shrink-0" />
      </div>

      <div className="flex flex-col gap-6 rounded-surface bg-section p-5 lg:flex-row lg:items-center lg:gap-8">
        <div className="flex flex-1 items-start gap-4">
          <Skeleton className="size-11 shrink-0 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-3 w-80 max-w-full" />
          </div>
        </div>
        <div className="flex items-center gap-8">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-7 w-8" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
          <Skeleton className="h-9 w-36" />
        </div>
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Skeleton className="h-9 w-full sm:max-w-xs" />
          <div className="space-y-3">
            <Skeleton className="h-4 w-44" />
            <AccessTableSkeleton rows={2} />
          </div>
        </div>

        <aside className="hidden xl:block">
          <div className="space-y-5 rounded-surface bg-card p-5">
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <div className="space-y-3 border-t pt-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex justify-between">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-28" />
                </div>
              ))}
            </div>
            <div className="space-y-2 border-t pt-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-surface" />
              ))}
            </div>
          </div>
        </aside>
      </div>
    </PageContainer>
  );
}

function AccessTableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="overflow-hidden rounded-surface border">
      <div className="border-b bg-inlay px-4 py-3">
        <Skeleton className="h-3 w-24" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b px-4 py-3.5 last:border-b-0"
        >
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
          <Skeleton className="hidden h-5 w-16 sm:block" />
        </div>
      ))}
    </div>
  );
}

/** Loading skeleton for the activity log — a feed, not a master-detail. */
export function ActivityLogPageSkeleton() {
  return (
    <PageContainer width="wide" className="max-w-3xl space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="space-y-4 border-s ps-6">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-baseline justify-between gap-4">
            <Skeleton className="h-4 w-72 max-w-full" />
            <Skeleton className="h-3 w-20 shrink-0" />
          </div>
        ))}
      </div>
    </PageContainer>
  );
}

/** Organization: its header and views, the time slider, and the chart. */
export function OrganizationPageSkeleton() {
  const t = useTranslations("frame.skeletons");
  return (
    <div className="grid gap-4 px-6 pt-5">
      <PageHeader
        title={t("organization")}
        className="mb-0"
        actions={<Skeleton className="h-9 w-64 shrink-0 rounded-control" />}
      />
      <Skeleton className="h-20 w-full rounded-surface" />
      <div className="grid h-[clamp(520px,calc(100dvh-21rem),880px)] place-items-center rounded-surface bg-section">
        <div className="grid justify-items-center gap-10">
          <Skeleton className="h-24 w-60 rounded-surface" />
          <div className="flex gap-8">
            <Skeleton className="h-24 w-60 rounded-surface" />
            <Skeleton className="h-24 w-60 rounded-surface" />
            <Skeleton className="h-24 w-60 rounded-surface" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** A settings section: the centred column of Fusion Settings, its title and rows still loading. */
export function SettingsPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[760px] px-6 pt-10 pb-16">
      <Skeleton className="mb-3 h-9 w-56" />
      <Skeleton className="mb-8 h-4 w-60" />
      <SettingsSkeleton />
    </div>
  );
}

/** The dedicated loading skeleton for a core route (module-relative path). */
export function getRoutePageSkeleton(corePath: string): ReactNode {
  if (corePath === "/reports" || corePath.startsWith("/reports/"))
    return <ReportsPageSkeleton />;
  if (corePath === "/") return <OverviewPageSkeleton />;
  if (corePath === "/people") return <EmployeesPageSkeleton />;
  if (corePath.startsWith("/import/")) return <ImportRouteSkeleton />;
  if (corePath === "/import") return <PageSkeleton width="wide" />;
  if (["/people/add", "/people/hire", "/people/add-existing"].includes(corePath)) return <PersonTaskPageSkeleton />;
  if (corePath.startsWith("/people/")) return <EmployeeProfilePageSkeleton />;
  if (corePath === "/profile") return <MyProfilePageSkeleton />;
  if (corePath === "/team" || corePath.startsWith("/team/"))
    return <TeamPageSkeleton />;
  if (corePath === "/organization") return <OrganizationPageSkeleton />;
  if (corePath.startsWith("/organization/units/"))
    return <UnitPageSkeleton />;
  if (corePath === "/org-chart") return <OrganizationPageSkeleton />;
  if (corePath === "/settings" || corePath.startsWith("/settings/"))
    return <SettingsPageSkeleton />;
  if (corePath === "/access/activity") return <ActivityLogPageSkeleton />;
  if (corePath.startsWith("/access")) return <AccessPageSkeleton />;
  return <PageFallbackSkeleton />;
}

export function UnitPageSkeleton() {
  return (
    <PageContainer width="wide" className="max-w-6xl">
      <Skeleton className="mb-4 h-5 w-32 rounded-detail" />
      <Skeleton className="h-44 w-full rounded-surface" />
      <Skeleton className="mt-8 h-64 w-full rounded-surface" />
    </PageContainer>
  );
}

export function ReportResultsSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mb-6 flex flex-wrap gap-4">
        {[88, 112, 96, 76].map((width, i) => <Skeleton key={i} className="h-3" style={{ width }} />)}
      </div>
      <div className="flex h-56 items-end justify-around gap-3 border-b border-border px-8 pb-1">
        {[45, 68, 54, 78, 61, 85, 72, 92].map((height, i) => (
          <Skeleton key={i} className="w-10 max-w-[9%] rounded-t-control rounded-b-none" style={{ height: `${height}%` }} />
        ))}
      </div>
      <div className="mt-3 flex justify-around px-8">
        {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-3 w-9" />)}
      </div>
      <div className="mt-7 overflow-hidden rounded-control bg-inlay">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          {[112, 48, 48, 48, 48].map((width, i) => <Skeleton key={i} className="h-3" style={{ width }} />)}
        </div>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 border-t border-border bg-card px-4 py-4">
            {[132, 32, 32, 32, 32].map((width, j) => <Skeleton key={j} className="h-3" style={{ width }} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PeopleResultsSkeleton() {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-control">
      <div className="flex gap-8 bg-inlay px-4 py-3">{[120, 100, 90, 90].map((width, i) => <Skeleton key={i} className="h-3" style={{ width }} />)}</div>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex items-center gap-8 border-t border-border px-4 py-4">
          <Skeleton className="size-6 shrink-0 rounded-full" />
          {[96, 100, 90, 90].map((width, j) => <Skeleton key={j} className="h-3" style={{ width }} />)}
        </div>
      ))}
    </div>
  );
}

export function ReportsPageSkeleton() {
  const t = useTranslations("reports");
  return (
    <PageContainer width="wide" className="px-10 pt-9 pb-14">
      <div role="status" aria-label={t("loadingReport")} className="grid items-start gap-9 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div aria-hidden="true" className="rounded-surface bg-section p-4">
          <div className="space-y-2 px-2 pb-6 pt-1"><Skeleton className="h-6 w-24" /><Skeleton className="h-3 w-40 max-w-full" /></div>
          <Skeleton className="mx-2 mb-3 h-3 w-16" />
          <div className="space-y-1">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-2.5 py-1.5"><Skeleton className="size-8 shrink-0 rounded-control-sm" /><Skeleton className="h-4 w-28" /></div>
            ))}
          </div>
          <div className="mx-2 mt-5 border-t border-border pt-4"><Skeleton className="h-4 w-24" /><Skeleton className="mt-4 h-3 w-36 max-w-full" /></div>
        </div>
        <div aria-hidden="true" className="grid min-w-0 gap-[18px]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-2"><Skeleton className="h-9 w-48" /><Skeleton className="h-4 w-64 max-w-full" /></div>
            <div className="flex gap-2"><Skeleton className="h-8 w-20" /><Skeleton className="h-8 w-24" /><Skeleton className="h-8 w-20" /></div>
          </div>
          <div className="flex flex-wrap gap-2">{[180, 180, 130, 90].map((width, i) => <Skeleton key={i} className="h-8" style={{ width }} />)}</div>
          <div className="min-w-0 rounded-surface bg-card p-6"><ReportResultsSkeleton /></div>
          <div className="min-w-0 rounded-surface bg-card p-4"><Skeleton className="h-6 w-20" /><div className="mt-4"><PeopleResultsSkeleton /></div></div>
        </div>
      </div>
    </PageContainer>
  );
}

function PersonTaskPageSkeleton() {
  const t = useTranslations("frame.skeletons");
  return (
    <TitledPageLoading
      title={t("people")}
      rows={5}
      label={t("openingPerson")}
    />
  );
}

function PageFallbackSkeleton() {
  const t = useTranslations("frame");
  return <PageSkeleton label={t("loadingPage")} />;
}

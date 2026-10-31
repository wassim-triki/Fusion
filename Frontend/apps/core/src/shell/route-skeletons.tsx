import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  PageContainer,
  PageHeader,
  PageLoading,
  PageSkeleton,
  SettingsSkeleton,
} from "@repo/ds/shell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkerProfileSkeleton } from "@/features/people/components/worker-profile/worker-profile-skeleton";
import {
  ImportAttemptSkeleton,
  ImportUploadSkeleton,
} from "@/features/data-import/components/import-skeletons";

// ── Route skeleton registry ─────────────────────────────────────────────────
// One dedicated loading skeleton per route, shared by every loading surface:
// the (pages) route loading boundary, CoreSetupRouteGuard's fail-closed hold,
// and the pages' own loading branches. All three render the SAME component for
// a given route, so the user sees exactly one skeleton from first paint to
// content — never a generic phase swapping into a dedicated one.
//
// Keep this module light: ds/ui primitives only, no feature imports (it loads
// with the route loading boundary).

export function getCorePathname(pathname: string): string {
  const nextPath = pathname.replace(/^\/core/, "");
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
      <PageLoading rows={rows} label={label ?? t("loadingTitle", { title: title.toLowerCase() })} />
    </PageContainer>
  );
}

export function OverviewPageSkeleton() {
  const t = useTranslations("frame.skeletons");
  return (
    <PageContainer width="wide" className="space-y-6">
      <PageHeader
        title={t("dashboard")}
        description={<Skeleton className="h-4 w-80 max-w-full" />}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-surface" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64 rounded-surface lg:col-span-2" />
        <Skeleton className="h-64 rounded-surface" />
      </div>
    </PageContainer>
  );
}

export function EmployeesPageSkeleton({ label }: { label?: string }) {
  const t = useTranslations("frame.skeletons");
  return (
    <PageContainer width="wide" className="space-y-5">
      <PageHeader title={t("people")} />
      <PageLoading rows={8} label={label ?? t("loadingPeople")} />
    </PageContainer>
  );
}

export function EmployeeProfilePageSkeleton() {
  return <WorkerProfileSkeleton showBackLink />;
}

export function MyProfilePageSkeleton() {
  return <WorkerProfileSkeleton />;
}

export function TeamPageSkeleton() {
  const t = useTranslations("frame.skeletons");
  return (
    <PageContainer className="space-y-6">
      <PageHeader title={t("myTeam")} description={t("loadingTeam")} />
      <PageLoading rows={6} label={t("loadingYourTeam")} />
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
        <div key={i} className="flex items-center gap-3 border-b px-4 py-3.5 last:border-b-0">
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

/** Organization: the units chart's header, its Structure tab and the canvas. */
export function OrganizationPageSkeleton() {
  const t = useTranslations("frame.skeletons");
  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-[680px] flex-col overflow-hidden">
      <header className="shrink-0 px-6 pt-5">
        <PageHeader
          title={t("organization")}
          description={t("organizationDescription")}
          className="mb-3"
          actions={<Skeleton className="h-9 w-40 shrink-0 rounded-control" />}
        />
        <div className="flex border-b">
          <Skeleton className="mb-2.5 h-5 w-20" />
        </div>
      </header>
      <div className="grid flex-1 place-items-center">
        <div className="grid justify-items-center gap-10">
          <Skeleton className="h-16 w-56 rounded-surface" />
          <div className="flex gap-8">
            <Skeleton className="h-16 w-52 rounded-surface" />
            <Skeleton className="h-16 w-52 rounded-surface" />
            <Skeleton className="h-16 w-52 rounded-surface" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The people org chart: its header, the search and lens bar, and the stage with a leader and their team. */
export function OrgChartPageSkeleton() {
  const t = useTranslations("frame.skeletons");
  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-[680px] flex-col overflow-hidden">
      <header className="shrink-0 px-6 pt-5">
        <PageHeader title={t("orgChart")} className="mb-4" actions={<Skeleton className="h-9 w-56 shrink-0 rounded-control" />} />
      </header>
      <div className="flex shrink-0 items-center gap-3 border-y px-6 py-3">
        <Skeleton className="h-9 w-72 rounded-control" />
        <Skeleton className="h-9 w-40 rounded-control" />
      </div>
      <div className="grid flex-1 place-items-center bg-section">
        <div className="grid justify-items-center gap-10">
          <Skeleton className="h-52 w-64 rounded-surface" />
          <div className="flex gap-12">
            <Skeleton className="h-20 w-64 rounded-surface" />
            <Skeleton className="h-20 w-64 rounded-surface" />
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

export function SetupPageSkeleton() {
  const t = useTranslations("frame.skeletons");
  return (
    <PageContainer width="wide" className="space-y-5">
      <PageHeader title={t("setup")} description={t("setupDescription")} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] xl:items-start">
        <div className="space-y-4">
          <Card>
            <CardContent className="flex flex-col gap-4 px-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Skeleton className="h-5 w-24 rounded-full" />
                </div>
                <div className="space-y-1.5">
                  <Skeleton className="h-7 w-64" />
                  <Skeleton className="h-4 w-full max-w-lg" />
                  <Skeleton className="h-4 w-80" />
                </div>
              </div>
              <div className="flex flex-nowrap gap-2">
                <Skeleton className="h-9 w-44" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-4 pb-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-72" />
                </div>
                <Skeleton className="h-5 w-28 rounded-full" />
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <Skeleton className="h-3.5 w-48" />
                  <Skeleton className="h-3.5 w-16" />
                </div>
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                {[
                  "border-primary/20 bg-primary/5",
                  "border-dashed",
                  "border-dashed",
                ].map((borderClass, index) => (
                  <div
                    key={index}
                    className={`flex flex-col items-center gap-4 rounded-surface border p-5 text-center ${borderClass}`}
                  >
                    <Skeleton className="size-12 rounded-full" />
                    <div className="space-y-1">
                      <Skeleton className="mx-auto h-3 w-16" />
                      <Skeleton className="mx-auto h-4 w-28" />
                    </div>
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="xl:self-stretch">
          <Card className="flex h-full flex-col">
            <CardHeader className="pb-3">
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent className="flex flex-1 flex-col items-center justify-center py-12">
              <div className="flex size-8 items-center justify-center rounded-full border bg-inlay text-muted-foreground/60">
                <Skeleton className="size-3.5 rounded-full" />
              </div>
              <Skeleton className="mt-2 h-4 w-28" />
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}

/** The dedicated loading skeleton for a core route (module-relative path). */
export function getRoutePageSkeleton(corePath: string): ReactNode {
  if (corePath === "/") return <OverviewPageSkeleton />;
  if (corePath === "/people") return <EmployeesPageSkeleton />;
  if (corePath === "/people/import") return <ImportUploadSkeleton domain="workforce" />;
  if (corePath.startsWith("/people/import/")) {
    const step = corePath.split("/")[4];
    return <ImportAttemptSkeleton domain="workforce" stage={step === "match" || step === "review" ? step : null} />;
  }
  if (corePath === "/people/hire" || corePath === "/people/add-existing") return <PersonTaskPageSkeleton />;
  if (corePath.startsWith("/people/")) return <EmployeeProfilePageSkeleton />;
  if (corePath === "/profile") return <MyProfilePageSkeleton />;
  if (corePath === "/team") return <TeamPageSkeleton />;
  if (corePath === "/organization/import") return <ImportUploadSkeleton />;
  if (corePath.startsWith("/organization/import/")) {
    const step = corePath.split("/")[4];
    return <ImportAttemptSkeleton stage={step === "match" || step === "review" ? step : null} />;
  }
  if (corePath === "/organization") return <OrganizationPageSkeleton />;
  if (corePath === "/org-chart") return <OrgChartPageSkeleton />;
  if (corePath === "/settings" || corePath.startsWith("/settings/")) return <SettingsPageSkeleton />;
  if (corePath === "/access/profiles") return <AccessProfilesPageSkeleton />;
  if (corePath === "/access/activity") return <ActivityLogPageSkeleton />;
  if (corePath.startsWith("/access")) return <AccessPageSkeleton />;
  if (corePath === "/getting-started" || corePath === "/setup")
    return <SetupPageSkeleton />;
  return <PageFallbackSkeleton />;
}

function PersonTaskPageSkeleton() {
  const t = useTranslations("frame.skeletons");
  return <TitledPageLoading title={t("people")} rows={5} label={t("openingPerson")} />;
}

function AccessProfilesPageSkeleton() {
  const t = useTranslations("frame.skeletons");
  return <TitledPageLoading title={t("accessProfiles")} rows={4} label={t("openingAccessProfiles")} />;
}

function PageFallbackSkeleton() {
  const t = useTranslations("frame");
  return <PageSkeleton label={t("loadingPage")} />;
}

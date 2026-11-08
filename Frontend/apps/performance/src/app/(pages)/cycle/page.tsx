"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { LinkTabs, PageContainer, PageHeader } from "@repo/ds/shell";
import { CycleSurfaceSkeleton } from "@/features/performance/components/cycle-setup/setup-skeletons";
import { ContentUnavailable } from "@/features/performance/components/content-unavailable";
import { useCurrentCycle, useCycleClosure } from "@/features/performance/api/use-performance";
import { useWorkspaceContext } from "@/features/performance/api/use-workspace";
import { ClosureSection, CloseCycleAction } from "@/features/performance/components/cycle/cycle-closure";
import { MilestoneRail } from "@/features/performance/components/milestone-rail";
import { CycleInsights } from "@/features/performance/components/cycle/cycle-insights";
import { useTranslations } from "next-intl";
import { PageRefusal } from "@repo/auth";

/**
 * The durable Cycle surface — the established (Active/Closed) Cycle, read-only. A Draft is still
 * being created, so it belongs to the guided setup flow (/cycle/setup), and no Cycle at all means
 * there is nothing to manage. Both redirect out.
 */

export default function CyclePage() {
  const t = useTranslations("cycle.CyclePage");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Status and Insights share the record's address; the view and the Insights unit live in the URL.
  const view = params.get("view") === "insights" ? "insights" : "status";
  const unitId = params.get("unit");
  const hrefFor = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const text = next.toString();
    return text ? `${pathname}?${text}` : pathname;
  };
  const go = (changes: Record<string, string | null>) => router.replace(hrefFor(changes), { scroll: false });
  const context = useWorkspaceContext();
  const canAdminister = context.data?.capabilities.administers ?? false;
  const detail = useCurrentCycle(canAdminister);

  const cycle = detail.data?.cycle;
  const cycleId = cycle?.id;
  const isDraft = cycle?.state === "Draft";
  const ready = !context.isLoading && !detail.isLoading;
  const noCycle = ready && canAdminister && !detail.data;
  const closure = useCycleClosure(cycle && !isDraft ? cycle.id : null, canAdminister);

  useEffect(() => {
    if (isDraft && cycleId) router.replace(`/cycle/setup?cycle=${encodeURIComponent(cycleId)}`);
  }, [isDraft, cycleId, router]);
  useEffect(() => {
    if (noCycle) router.replace("/");
  }, [noCycle, router]);

  if (context.isLoading) return <CycleSurfaceSkeleton />;
  if (context.error && !canAdminister) return <PageContainer><PageRefusal /></PageContainer>;
  if (context.error) return <ContentUnavailable error={context.error} onRetry={context.refetch} />;
  if (!canAdminister) {
    return <PageContainer><PageRefusal /></PageContainer>;
  }
  if (detail.isLoading) return <CycleSurfaceSkeleton />;
  if (detail.error) {
    return <ContentUnavailable error={detail.error} onRetry={detail.refetch} />;
  }
  if (!detail.data || isDraft) return <CycleSurfaceSkeleton />;

  const cycleDetail = detail.data;
  const isActive = cycleDetail.cycle.state === "Active";

  return (
    <PageContainer width="wide">
      <PageHeader className="mb-4"
        title={cycleDetail.cycle.name}
        description={isActive ? t(`phase.${cycleDetail.phase ?? "Planning"}`) : t("closed")}
        actions={isActive ? <CloseCycleAction detail={cycleDetail} closure={closure.data} /> : null}
      />
      <LinkTabs
        label={t("cycleViews")}
        current={view}
        className="mb-8"
        tabs={[
          { key: "status", label: t("status"), href: hrefFor({ view: null, unit: null }) },
          { key: "insights", label: t("insights"), href: hrefFor({ view: "insights" }) },
        ]}
      />
      {view === "insights" ? (
        <CycleInsights cycleId={cycleDetail.cycle.id} unitId={unitId} onUnit={(unit) => go({ unit })} />
      ) : (
        <div className="space-y-8">
          <MilestoneRail milestones={cycleDetail.milestones} />
          {closure.error ? (
            <ContentUnavailable error={closure.error} onRetry={closure.refetch} size="card" title={t("closureDidNotLoad")} />
          ) : (
            <ClosureSection closure={closure.data} loading={closure.isLoading} />
          )}
        </div>
      )}
    </PageContainer>
  );
}

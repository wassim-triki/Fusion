"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { PageContainer, PageHeader } from "@repo/ds/shell";
import { CycleSurfaceSkeleton } from "@/features/performance/components/cycle-setup/setup-skeletons";
import { ContentUnavailable } from "@/features/performance/components/content-unavailable";
import { useCurrentCycle, useCycleClosure } from "@/features/performance/api/use-performance";
import { useWorkspaceContext } from "@/features/performance/api/use-workspace";
import { ClosureSection, CloseCycleAction } from "@/features/performance/components/cycle/cycle-closure";
import { MilestoneRail } from "@/features/performance/components/milestone-rail";
import { CycleInsights } from "@/features/performance/components/cycle/cycle-insights";
import { cn } from "@repo/ds/lib/utils";
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
  const go = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
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
      <div role="tablist" aria-label={t("cycleViews")} className="mb-8 flex gap-6 border-b border-border">
        {(["status", "insights"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={view === tab}
            onClick={() => go({ view: tab === "insights" ? "insights" : null, unit: tab === "insights" ? unitId : null })}
            className={cn(
              "-mb-px border-b-2 px-0.5 pb-3 type-label transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              view === tab ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab === "status" ? t("status") : t("insights")}
          </button>
        ))}
      </div>
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

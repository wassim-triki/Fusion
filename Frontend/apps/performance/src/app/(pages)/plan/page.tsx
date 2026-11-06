"use client";

import { PageContainer, PagePermissionNotice } from "@repo/ds/shell";
import { ContentUnavailable } from "@/features/performance/components/content-unavailable";
import { PlanPageSkeleton } from "@/features/performance/components/plan/plan-skeleton";
import { MyPlanWorkspace } from "@/features/performance/components/plan/my-plan-workspace";
import { useCurrentCycle } from "@/features/performance/api/use-performance";
import { useWorkspaceContext } from "@/features/performance/api/use-workspace";
import { performanceFailure } from "@/features/performance/api/performance-failure";
import { useTranslations } from "next-intl";

export default function PlanPage() {
  const t = useTranslations("plan.PlanPage");
  const context = useWorkspaceContext();
  // My Plan belongs to participants of the selected Cycle, as Performance recorded them.
  const canParticipate = context.data?.destinations.myPlan ?? false;

  const detail = useCurrentCycle(canParticipate);
  const cycle = detail.data?.cycle ?? null;

  if (context.isLoading) return <PlanPageSkeleton empty />;
  if (context.error && !performanceFailure(context.error).unavailable) return <ContentUnavailable error={context.error} onRetry={context.refetch} />;
  // Not a participant of the selected cycle (B-069): one precise line; the cycle switcher above offers the others.
  if (context.error || !canParticipate) {
    const selected = context.data?.selected?.name ?? null;
    return (
      <PageContainer>
        <PagePermissionNotice title={selected ? t("youreNotPartOf", { selected }) : t("youreNotPartOfA")} />
      </PageContainer>
    );
  }
  if (detail.isLoading) return <PlanPageSkeleton empty />;
  if (detail.error) return <ContentUnavailable error={detail.error} onRetry={detail.refetch} />;
  // Planning opens at activation: a Cycle still in setup has no plan to author yet.
  if (!cycle || cycle.state === "Draft") {
    return (
      <PageContainer>
        <PagePermissionNotice title={t("noPerformanceCycleYet")} />
      </PageContainer>
    );
  }

  return <MyPlanWorkspace cycle={cycle} enabled={canParticipate} />;
}

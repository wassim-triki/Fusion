"use client";

import { PageContainer, PagePermissionNotice } from "@repo/ds/shell";
import { useCycle, usePlanDetail } from "../../api/use-performance";
import { useWorkspaceContext } from "../../api/use-workspace";
import { performanceFailure } from "../../api/performance-failure";
import { ContentUnavailable } from "../content-unavailable";
import { PlanReview } from "./plan-review";
import { PlanPageSkeleton } from "./plan-skeleton";
import { useRecentRecord } from "@repo/api/react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/**
 * One plan, addressed by its own Cycle. The owner is sent to Goals, You; the
 * responsible reviewer and administrators see the same plan presented for a decision. What each may do
 * comes from the server's capabilities on the plan, never from this page.
 */
export function PlanRecordPage({ cycleId, planId }: { cycleId: string; planId: string }) {
  const t = useTranslations("plan.PlanRecordPage");
  const context = useWorkspaceContext();
  const canRead = Boolean(context.data);
  const cycle = useCycle(canRead ? cycleId : null);
  const plan = usePlanDetail(canRead ? cycleId : null, planId);
  // Someone else's plan is a record people return to; your own lives at My Plan.
  useRecentRecord(
    "performance",
    plan.data && !plan.data.isOwner
      ? {
          label: plan.data.employee.name ? t("sPlan", { name: plan.data.employee.name }) : t("plan"),
          kind: `${plan.data.cycleName} plan`,
          href: `/performance/cycles/${cycleId}/plans/${planId}`,
        }
      : null,
  );

  if (context.isLoading || (canRead && (cycle.isLoading || plan.isLoading))) return <PlanPageSkeleton />;
  if (context.error || performanceFailure(cycle.error).unavailable || performanceFailure(plan.error).unavailable) {
    return (
      <PageContainer>
        <PagePermissionNotice title={t("planUnavailable")} />
      </PageContainer>
    );
  }
  if (cycle.error) return <ContentUnavailable error={cycle.error} onRetry={cycle.refetch} />;
  if (!cycle.data) return <PlanPageSkeleton />;

  // Your own plan lives in Goals, You.
  if (plan.data?.isOwner) return <ToGoals cycleId={cycleId} />;

  return (
    <PageContainer width="wide">
      <PlanReview cycle={cycle.data.cycle} planId={planId} />
    </PageContainer>
  );
}

function ToGoals({ cycleId }: { cycleId: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/goals?tab=you&cycle=${encodeURIComponent(cycleId)}`);
  }, [router, cycleId]);
  return <PlanPageSkeleton />;
}

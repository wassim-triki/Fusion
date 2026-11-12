"use client";

import { Skeleton } from "@repo/ds";
import { PageContainer } from "@repo/ds/shell";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { InsightsFrame, useInsightsTabs } from "./insights-frame";

/** Insights opens on its first tab this person has: People for report viewers, else Performance. */
export function InsightsLanding() {
  const router = useRouter();
  const { tabs, pending } = useInsightsTabs();
  const first = tabs[0];
  useEffect(() => {
    if (first) router.replace(`/insights/${first}`);
  }, [first, router]);
  if (!pending && !first) return <InsightsFrame tab="people">{null}</InsightsFrame>;
  return (
    <PageContainer width="wide">
      <Skeleton className="h-9 w-40" />
    </PageContainer>
  );
}

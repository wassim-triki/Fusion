import { Suspense } from "react";
import { PageSkeleton } from "@repo/ds/shell";
import { GoalsPlace } from "@/features/performance/components/goals/goals-place";

export default function GoalsPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={4} />}>
      <GoalsPlace />
    </Suspense>
  );
}

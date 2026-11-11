"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { CalibrationPage } from "@/features/performance/components/calibration/calibration-page";

export default function CalibrationRoute() {
  const params = useParams<{ roundId: string }>();
  return (
    <Suspense>
      <CalibrationPage roundId={params.roundId} />
    </Suspense>
  );
}

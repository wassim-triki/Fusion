"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { newReviewRoundHref } from "@/lib/performance-routes";
import { PageSkeleton } from "@repo/ds/shell";
import {
  OneOnOnesSkeleton,
  SeriesSkeleton,
} from "@/features/performance/components/one-on-ones/one-on-one-skeletons";
import { PlanPageSkeleton } from "@/features/performance/components/plan/plan-skeleton";
import {
  SetupShellSkeleton,
} from "@/features/performance/components/cycle-setup/setup-skeletons";
import {
  FeedbackPageSkeleton,
  RequestSkeleton,
  TeamWorkspaceSkeleton,
  WorkspaceSkeleton,
} from "./workspace-skeletons";

/** Static pending UI only; importing this cannot start a workspace query. */
export function PerformanceRouteSkeleton({ label }: { label?: string }) {
  const pathname = usePathname();
  const path = pathname.replace(/^\/performance(?=\/|$)/, "") || "/";
  const t = useTranslations("common.PagesLoading");
  let skeleton;
  if (path === "/one-on-ones") skeleton = <OneOnOnesSkeleton />;
  else if (path.startsWith("/one-on-ones/")) skeleton = <SeriesSkeleton />;
  else if (path === "/team") skeleton = <TeamWorkspaceSkeleton />;
  else if (path === "/feedback") skeleton = <FeedbackPageSkeleton />;
  else if (/^\/cycles\/[^/]+\/plans\//.test(path))
    skeleton = <PlanPageSkeleton />;
  else if (path === "/cycle/setup" || path.startsWith("/cycle/setup/")) {
    const step = path.endsWith("/population")
      ? "population"
      : path.endsWith("/review")
        ? "review"
        : "details";
    skeleton = <SetupShellSkeleton step={step} />;
  } else if (path === "/reviews") skeleton = <WorkspaceSkeleton />;
  else if (path.startsWith("/feedback/requests/"))
    skeleton = <RequestSkeleton />;
  else if (path.startsWith("/reviews/peer-requests/"))
    skeleton = <PageSkeleton rows={5} />;
  else if (path === newReviewRoundHref())
    skeleton = <PageSkeleton rows={5} width="wide" />;
  else if (path.startsWith("/reviews/"))
    skeleton = <PageSkeleton rows={7} width="wide" />;
  else skeleton = <PageSkeleton rows={4} label={t("loading")} />;
  return (
    <div aria-busy aria-label={label}>
      {skeleton}
    </div>
  );
}

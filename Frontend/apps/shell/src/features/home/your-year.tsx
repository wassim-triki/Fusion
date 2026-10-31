"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  createPerformanceApi,
  createPlatformApiClient,
  performanceQueryKeys,
  type PersonPerformanceSummaryDto,
} from "@repo/api";
import { Button, Skeleton } from "@repo/ds";
import { Section } from "@repo/ds/shell";
import { formatPercent } from "@repo/ds/lib/numbers";

const PLAN = "/performance/plan";


/** The viewer's own Performance summary (D-32): the same read Performance's person page uses. */
export function useMyYear(employeeId: string | null | undefined, enabled: boolean) {
  const api = useMemo(() => createPerformanceApi(createPlatformApiClient()), []);
  return useQuery({
    queryKey: performanceQueryKeys.personSummary(employeeId ?? "none"),
    queryFn: ({ signal }) => api.getPersonSummary(employeeId!, null, signal),
    enabled: enabled && Boolean(employeeId),
    staleTime: 60_000,
    retry: false,
  });
}

type YearT = ReturnType<typeof useTranslations<"home.year">>;

function daysAgo(iso: string, now: Date, t: YearT): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? t("today") : days === 1 ? t("yesterday") : t("daysAgo", { count: days });
}

/** A plan's percentage, whole, in the person's language ("42%", "42 %"). */
function percent(value: number, locale: string): string {
  return formatPercent(Math.round(value) / 100, undefined, locale);
}

function StatusLine({ summary }: { summary: NonNullable<PersonPerformanceSummaryDto["currentCycle"]> }) {
  const t = useTranslations("home.year");
  const counts = { OnTrack: 0, AtRisk: 0, OffTrack: 0 };
  for (const objective of summary.objectives) if (objective.status) counts[objective.status] += 1;
  const parts = [
    counts.OnTrack ? { key: "on", label: t("onTrack", { count: counts.OnTrack }), tone: "bg-success" } : null,
    counts.AtRisk ? { key: "risk", label: t("atRisk", { count: counts.AtRisk }), tone: "bg-warning" } : null,
    counts.OffTrack ? { key: "off", label: t("offTrack", { count: counts.OffTrack }), tone: "bg-destructive" } : null,
  ].filter((part) => part !== null);
  if (parts.length === 0) return <p className="type-meta text-muted-foreground">{t("noStatus")}</p>;
  return (
    <p className="flex flex-wrap gap-x-3 type-meta">
      {parts.map((part) => (
        <span key={part.key} className="inline-flex items-center gap-1.5 text-foreground">
          <span aria-hidden className={`size-2 rounded-full ${part.tone}`} />
          {part.label}
        </span>
      ))}
    </p>
  );
}

/** The plan's progress as a bar, in the brand's color; empty before there's any. */
function Bar({ value }: { value: number }) {
  return (
    <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-inlay">
      <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }} />
    </span>
  );
}

/**
 * Your year on the home (fusion-home), as drawn: once the plan is approved, its progress as a big figure with the
 * objectives, a bar and their status; before that, where the plan stands, with the way to write it. It opens My Plan.
 * People outside the current cycle get no card.
 */
export function YourYear({ employeeId, enabled }: { employeeId: string | null | undefined; enabled: boolean }) {
  const t = useTranslations("home.year");
  const locale = useLocale();
  const summary = useMyYear(employeeId, enabled);
  if (!enabled || !employeeId) return null;
  const myPlan = (
    <a href={PLAN} className="inline-flex items-center gap-0.5 type-label font-semibold text-foreground hover:text-primary">
      {t("myPlan")} <ChevronRight className="size-4 text-muted-foreground rtl:rotate-180" aria-hidden />
    </a>
  );
  if (summary.isPending) {
    return (
      <Section size="card" title={t("title")} aria-label={t("loading")}>
        <div className="space-y-3"><Skeleton className="h-10 w-28" /><Skeleton className="h-1.5 w-full" /></div>
      </Section>
    );
  }
  if (summary.isError) {
    return (
      <Section size="card" id="your-year" title={t("title")}>
        <p className="type-body-secondary text-muted-foreground">{t("failed")}</p>
      </Section>
    );
  }
  const cycle = summary.data.currentCycle;
  if (!cycle?.isParticipant) return null;
  const review = summary.data.reviews?.current;
  const status = cycle.planStatus ?? "NotStarted";
  const now = new Date();

  if (status === "Approved") {
    return (
      <Section size="card" id="your-year" title={t("title")} action={myPlan}>
        <div lang={locale} className="space-y-3">
          <p className="flex items-baseline gap-2.5">
            <span className="type-figure text-foreground">
              {cycle.overallProgress !== null ? percent(cycle.overallProgress, locale) : "–"}
            </span>
            <span className="type-meta text-muted-foreground">{t("objectives", { count: cycle.objectives.length })}</span>
          </p>
          <Bar value={cycle.overallProgress ?? 0} />
          <StatusLine summary={cycle} />
          <p className="type-meta text-muted-foreground">
            {review && review.state !== "SelfAssessment" && review.reviewerName
              ? t("reviewWith", { name: review.reviewerName })
              : cycle.lastUpdateAt
                ? t("lastUpdate", { when: daysAgo(cycle.lastUpdateAt, now, t) })
                : t("noUpdate")}
          </p>
        </div>
      </Section>
    );
  }

  // Before approval: where the plan stands, the cycle it's for, and the way to write it.
  const writes = status === "NotStarted" || status === "Draft" || status === "ReturnedForChanges";
  return (
    <Section size="card" id="your-year" title={t("title")} action={myPlan}>
      <div lang={locale} className="space-y-3">
        <div className="space-y-0.5">
          <p className="type-section-title text-foreground">{t(`plan.${status}`)}</p>
          <p className="type-meta text-muted-foreground">
            {[cycle.cycleName, cycle.phase].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Bar value={0} />
        <p className="type-meta text-muted-foreground">
          {status === "NotStarted"
            ? cycle.reviewerName ? t("approves", { name: cycle.reviewerName }) : null
            : <>
                {t("objectives", { count: cycle.objectives.length })}
                {cycle.weightTotal !== null && cycle.weightTotal !== undefined ? t("weights", { percent: percent(cycle.weightTotal, locale) }) : ""}
                {cycle.reviewerName ? ` · ${t("approves", { name: cycle.reviewerName })}` : ""}
              </>}
        </p>
        {writes ? (
          <Button asChild variant="outline" size="sm" className="w-full">
            <a href={PLAN}>{status === "NotStarted" ? t("start") : t("continue")}</a>
          </Button>
        ) : null}
      </div>
    </Section>
  );
}

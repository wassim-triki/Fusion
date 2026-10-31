"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CircleCheck,
  Info,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  UserX,
} from "@/lib/icons";
import type { PopulationDto } from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { Progress } from "@repo/ds/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@repo/ds/components/ui/tooltip";
import { cn } from "@repo/ds/lib/utils";
import { useTranslations } from "next-intl";
import type { Say } from "@/i18n/say";

function relativeSince(ts: number, say: Say): string {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 45) return say("justNow");
  const mins = Math.round(secs / 60);
  if (mins < 60) return say("minutesAgo", { count: mins });
  const hrs = Math.round(mins / 60);
  return say("hoursAgo", { count: hrs });
}

/**
 * The operational read-out of the resolution in one panel: how many people Fusion evaluated, how
 * they split across ready / attention / excluded, reviewer coverage, and a single health line that
 * tells the admin whether they can confirm. Numbers first — not a decorative dashboard.
 */
export function ResolvedPopulation({
  population,
  onRefresh,
  refreshing,
}: {
  population: PopulationDto;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const tr = useTranslations("cycleSetup.ResolvedPopulation");
  const total = population.candidates.length;
  const coverage =
    population.reviewerRequiredCount === 0
      ? 100
      : Math.round(
          (population.reviewerReadyCount / population.reviewerRequiredCount) *
            100
        );

  // Anchor "last resolved" to real fetch completions: when a resolution fetch finishes
  // (refreshing goes true → false), stamp now. Re-render periodically so the label stays current.
  const [updatedAt, setUpdatedAt] = useState(() => Date.now());
  const wasRefreshing = useRef(refreshing);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (wasRefreshing.current && !refreshing) setUpdatedAt(Date.now());
    wasRefreshing.current = refreshing;
  }, [refreshing]);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="overflow-hidden rounded-surface bg-card">
      <div className="flex items-start justify-between gap-4 px-5 pt-5">
        <div className="flex items-center gap-3">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary-tint text-primary-ink type-meta-strong tabular-nums">
            2
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="type-section-title text-foreground">
                {tr("resolvedPopulation")}
              </h2>
              {refreshing ? (
                <span
                  className="inline-flex items-center gap-1.5 type-meta text-muted-foreground"
                  role="status"
                >
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                  {tr("resolvingWorkforce")}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5 type-meta text-muted-foreground">
              <span>
                {tr("evaluatedFromTheSelectedScope")}
              </span>
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="rounded-control text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={tr("howFusionResolvesThePopulation")}
                    >
                      <Info className="size-3.5" aria-hidden />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {tr("fusionResolvesThisSelectionAgainst")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden type-meta text-muted-foreground sm:inline">
            {tr("lastResolved", { updatedAt: relativeSince(updatedAt, (key, values) => tr(key as "justNow", values as never)) })}
          </span>
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onRefresh}
                    disabled={refreshing}
                  >
                    <RefreshCw
                      className={cn("size-4", refreshing && "animate-spin")}
                      data-icon="inline-start"
                    />
                    {tr("refresh")}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{tr("reResolvePopulationFromCorehr")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-y-6 px-5 py-6 md:grid-cols-4 md:gap-0 xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.5fr)] md:divide-x md:divide-border">
        <Metric
          icon={<UserRound className="size-5" />}
          tone="primary"
          value={total}
          label={tr("totalResolved")}
          caption={tr("employeesEvaluatedForThisCycle")}
        />
        <Metric
          icon={<CircleCheck className="size-5" />}
          tone="success"
          value={population.readyCount}
          label={tr("ready")}
          caption={tr("validAndCanParticipate")}
        />
        <Metric
          icon={<TriangleAlert className="size-5" />}
          tone={population.needsAttentionCount > 0 ? "warning" : "muted"}
          value={population.needsAttentionCount}
          label={tr("needAttention")}
          caption={tr("resolveOrExcludeBeforeConfirmation")}
        />
        <Metric
          icon={<UserX className="size-5" />}
          tone={population.excludedCount > 0 ? "danger" : "muted"}
          value={population.excludedCount}
          label={tr("excluded")}
          caption={tr("wontParticipateInThisCycle")}
        />
        <div className="col-span-2 md:col-span-4 md:mt-6 md:border-t md:border-border md:pt-6 xl:col-span-1 xl:mt-0 xl:border-0 xl:pt-0 xl:ps-5">
          <div className="flex gap-3">
            <Chip tone="muted">
              <ShieldCheck className="size-5" />
            </Chip>
            <div className="min-w-0 flex-1">
              <p className="type-meta text-muted-foreground">
                {tr("reviewerCoverage")}
              </p>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="type-metric text-foreground tabular-nums">
                  {population.reviewerReadyCount}
                </span>
                <span className="type-body-secondary text-muted-foreground">
                  / {population.reviewerRequiredCount}
                </span>
                <span className="ms-auto type-label tabular-nums text-foreground">
                  {coverage}%
                </span>
              </div>
              <Progress value={coverage} className="mt-2 h-1.5" />
              <p className="type-meta mt-1.5 text-muted-foreground">
                {tr("employeesWithAValidReviewer")}
              </p>
            </div>
          </div>
        </div>
      </div>

      <HealthStrip
        needsAttention={population.needsAttentionCount}
        ready={population.readyCount}
      />
    </section>
  );
}

function Metric({
  icon,
  tone,
  value,
  label,
  caption,
}: {
  icon: ReactNode;
  tone: Tone;
  value: number;
  label: string;
  caption: string;
}) {
  return (
    <div className="flex gap-3 md:px-5 md:first:ps-0">
      <Chip tone={tone}>{icon}</Chip>
      <div className="min-w-0">
        <p className="type-metric text-foreground tabular-nums leading-none">
          {value}
        </p>
        <p className="mt-1.5 type-label text-foreground">{label}</p>
        <p className="mt-0.5 type-meta text-muted-foreground">{caption}</p>
      </div>
    </div>
  );
}

type Tone = "primary" | "success" | "warning" | "danger" | "muted";

function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  const toneClass =
    tone === "success"
      ? "bg-emerald-500/12 text-emerald-500"
      : tone === "warning"
        ? "bg-amber-500/12 text-amber-500"
        : tone === "danger"
          ? "bg-destructive/12 text-destructive"
          : tone === "muted"
            ? "bg-muted text-muted-foreground"
            : "bg-primary-tint text-primary-ink";
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-control",
        toneClass
      )}
    >
      {children}
    </span>
  );
}

function HealthStrip({
  needsAttention,
  ready,
}: {
  needsAttention: number;
  ready: number;
}) {
  const t = useTranslations("cycleSetup.HealthStrip");
  if (needsAttention > 0) {
    return (
      <div className="flex items-center gap-3 border-t border-amber-500/20 bg-amber-500/[0.04] px-5 py-3">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
          <TriangleAlert className="size-3.5" aria-hidden />
        </span>
        <p className="type-body-secondary">
          <span className="font-medium text-foreground">
            {needsAttention}{" "}
            {needsAttention === 1 ? t("employeeNeeds") : t("employeesNeed")}{t("attention")}
          </span>{" "}
          <span className="text-muted-foreground">
            {t("resolveTheIssueInCore")}
          </span>
        </p>
      </div>
    );
  }

  if (ready > 0) return null;

  return (
    <div className="flex items-center gap-3 border-t border-border bg-inlay px-5 py-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <UserX className="size-3.5" aria-hidden />
      </span>
      <p className="type-body-secondary">
        <span className="font-medium text-foreground">
          {t("noOneIsCurrentlyEligible")}
        </span>{" "}
        <span className="text-muted-foreground">
          {t("broadenTheScopeOrReview")}
        </span>
      </p>
    </div>
  );
}

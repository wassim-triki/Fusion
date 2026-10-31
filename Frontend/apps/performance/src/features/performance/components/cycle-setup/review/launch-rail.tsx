"use client";

import type { ReactNode } from "react";
import {
  Check as CheckIcon,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  Lock,
  MessageSquare,
  Play,
  Target,
  Users2,
  X,
} from "@/lib/icons";
import type { CycleDetailDto, PopulationDto } from "@repo/api";
import { cn } from "@repo/ds/lib/utils";
import { useTranslations } from "next-intl";
import { useFormat, type Format } from "@repo/ds/lib/use-format";

/**
 * The launch rail: the authoritative go/no-go readout beside the summary. Blockers become a list of
 * satisfied (or failing) checks; the things that deliberately are not launch prerequisites are named
 * so their absence never reads as an oversight; and the irreversible consequences of launching are
 * stated once, plainly, where the decision is made.
 */

interface Check {
  ok: boolean;
  label: string;
  detail?: string[];
}

function deriveChecks(detail: CycleDetailDto, population: PopulationDto, t: (key: string, values?: Record<string, string | number>) => string, format: Format): Check[] {
  const c = detail.cycle;
  const datesValid =
    detail.launchReadiness.areas.find((a) => a.key === "details")?.complete ?? true;
  const required = population.reviewerRequiredCount;
  const reviewersResolved = required === 0 || population.reviewerReadyCount >= required;

  return [
    { ok: c.state === "Draft", label: t("check.draft") },
    { ok: !detail.otherActiveCycleExists, label: t("check.noOtherActive") },
    {
      ok: datesValid,
      label: t("check.dates"),
      detail: [
        format.range(c.startDate, c.endDate),
        t("check.plansDue", { day: format.date(c.planningDeadline) }),
      ],
    },
    {
      ok: detail.populationConfirmed && reviewersResolved,
      label: t("check.population"),
      detail: [t("check.participants", { count: detail.confirmedParticipantCount })],
    },
  ];
}

function RailCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-surface bg-card p-5 sm:p-6", className)}>
      {children}
    </section>
  );
}

function RailHeading({ children }: { children: ReactNode }) {
  return <h2 className="type-page-title text-foreground">{children}</h2>;
}

export function LaunchReadinessPanel({
  detail,
  population,
}: {
  detail: CycleDetailDto;
  population: PopulationDto;
}) {
  const t = useTranslations("cycleSetup.LaunchReadinessPanel");
  const format = useFormat();
  const checks = deriveChecks(detail, population, (key, values) => t(key as never, values as never), format);
  const ready = checks.every((check) => check.ok);
  const failing = checks.filter((check) => !check.ok).length;

  const notRequired = [
    {
      icon: Target,
      label: t("strategicDirection"),
      detail:
        detail.publishedStrategyCount > 0
          ? (detail.publishedStrategyCount === 1 ? t("objectivePublished", { publishedStrategyCount: detail.publishedStrategyCount }) : t("objectivesPublished", { publishedStrategyCount: detail.publishedStrategyCount }))
          : t("canBeCreatedLaterAfter"),
    },
    { icon: ClipboardList, label: t("employeePlans"), detail: t("createdAsParticipantsBeginPlanning") },
    { icon: MessageSquare, label: t("communications"), detail: t("noNotificationsAreSentAt") },
  ];

  return (
    <RailCard className="flex flex-1 flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <RailHeading>{t("launchReadiness")}</RailHeading>
          <p className="mt-1 type-meta text-muted-foreground">
            {ready
              ? t("allRequiredConditionsAreMet")
              : (failing === 1 ? t("requiredConditionIsNotMet", { failing }) : t("requiredConditionsAreNotMet", { failing }))}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-control border px-2.5 py-1 type-meta-strong",
            ready
              ? "border-success/35 bg-success/10 text-success"
              : "border-warning/40 bg-warning/10 text-warning"
          )}
        >
          {ready ? (
            <CircleCheck className="size-3.5" aria-hidden />
          ) : (
            <CircleAlert className="size-3.5" aria-hidden />
          )}
          {ready ? t("ready") : t("notReady")}
        </span>
      </div>

      <ul className="mt-5 space-y-4">
        {checks.map((check) => (
          <li key={check.label} className="flex items-start gap-3">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full",
                check.ok ? "bg-success text-background" : "bg-destructive text-background"
              )}
              aria-hidden
            >
              {check.ok ? (
                <CheckIcon className="size-3.5" strokeWidth={3} />
              ) : (
                <X className="size-3.5" strokeWidth={3} />
              )}
            </span>
            <span className="min-w-0 pt-0.5">
              <span className="block type-label text-foreground">{check.label}</span>
              {check.detail?.map((line) => (
                <span
                  key={line}
                  className={cn(
                    "mt-0.5 block type-meta",
                    check.ok ? "text-muted-foreground" : "text-destructive"
                  )}
                >
                  {line}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-5">
        <div className="border-t border-border/70 pt-5">
          <p className="type-meta text-muted-foreground">{t("notRequiredToLaunch")}</p>
          <ul className="mt-3.5 space-y-3.5">
            {notRequired.map((item) => (
              <li key={item.label} className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-muted text-muted-foreground">
                  <item.icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block type-body text-foreground">{item.label}</span>
                  <span className="mt-0.5 block type-meta text-muted-foreground">{item.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </RailCard>
  );
}

const CONSEQUENCES = [
  { icon: Play, key: "live" },
  { icon: Lock, key: "lock" },
  { icon: Users2, key: "roster" },
] as const;

export function LaunchConsequences() {
  const t = useTranslations("cycleSetup.LaunchConsequences");
  return (
    <RailCard>
      <RailHeading>{t("whatHappensWhenYouLaunch")}</RailHeading>
      <ul className="mt-5 space-y-4">
        {CONSEQUENCES.map((item) => (
          <li key={item.key} className="flex items-start gap-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-primary-tint text-primary-ink ring-1 ring-inset ring-primary-ring">
              <item.icon className="size-[1.125rem]" aria-hidden />
            </span>
            <span className="min-w-0 pt-0.5">
              <span className="block type-subsection-title text-foreground">{t(`${item.key}.label`)}</span>
              <span className="mt-0.5 block type-meta text-muted-foreground">{t(`${item.key}.detail`)}</span>
            </span>
          </li>
        ))}
      </ul>
    </RailCard>
  );
}

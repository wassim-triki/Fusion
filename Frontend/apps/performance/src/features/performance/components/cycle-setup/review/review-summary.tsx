"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ChartColumnBig,
  Check,
  CircleMinus,
  FileText,
  Layers,
  Network,
  Target,
  Unlink,
  Users,
} from "@/lib/icons";
import type { CycleDetailDto, CycleSettingsDto, PopulationDto } from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { cn } from "@repo/ds/lib/utils";
import { setupStepHref } from "../setup-readiness";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";
import { useSay } from "@repo/ds/lib/say";

/**
 * The three settled decisions of the Cycle — details, population, policy — gathered into one
 * summary the admin confirms before launch. Each block states its facts at a glance and offers a
 * single route back to the step that owns them; nothing is re-edited in place.
 */

type Icon = typeof Users;

export function CycleSetupSummary({ children }: { children: ReactNode }) {
  const t = useTranslations("cycleSetup.CycleSetupSummary");
  return (
    <section className="rounded-surface bg-card p-4 sm:p-6">
      <h2 className="type-page-title text-foreground">{t("cycleSetupSummary")}</h2>
      <p className="mt-1 type-body-secondary text-muted-foreground">
        {t("reviewTheKeyDetailsFor")}
      </p>
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

function SummaryBlock({
  icon: Icon,
  title,
  caption,
  editHref,
  children,
}: {
  icon: Icon;
  title: string;
  caption: string;
  editHref: string;
  children: ReactNode;
}) {
  const t = useTranslations("cycleSetup.SummaryBlock");
  return (
    <section className="@container rounded-surface bg-card p-4 sm:p-5">
      <header className="flex items-start gap-3 sm:gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-success/15 text-success sm:size-12">
          <Icon className="size-5" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="min-w-0 flex-1 self-center sm:self-auto sm:pt-0.5">
          <h3 className="type-section-title text-foreground">{title}</h3>
          <p className="hidden type-meta text-muted-foreground sm:block">{caption}</p>
        </div>
        <Button variant="outline" size="sm" asChild className="shrink-0">
          <Link href={editHref} aria-label={t("edit2", { toLowerCase: title.toLowerCase() })}>
            {t("edit")}
          </Link>
        </Button>
      </header>
      <div className="mt-4 border-t border-border/70 pt-4">{children}</div>
    </section>
  );
}

/** A row of labelled facts; vertical rules separate them once they sit side by side. */
function Facts({ className, children }: { className: string; children: ReactNode }) {
  return <dl className={cn("grid gap-4 divide-border", className)}>{children}</dl>;
}

function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: Icon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 [&:not(:first-child)]:ps-[var(--fact-gap,0px)]">
      <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0">
        <dt className="type-meta text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 type-subsection-title text-foreground">{children}</dd>
      </div>
    </div>
  );
}

/* Facts sit side by side, ruled apart, once their block (not the viewport) has room for them. */
const ROW_3 =
  "@sm:grid-cols-2 @xl:grid-cols-[minmax(0,1fr)_auto_auto] @xl:divide-x @xl:[--fact-gap:1.25rem]";
const ROW_2 = "@sm:grid-cols-2 @sm:divide-x @sm:[--fact-gap:1.25rem]";
const ROW_4 = "@sm:grid-cols-2 @2xl:grid-cols-4 @2xl:divide-x @2xl:[--fact-gap:1.25rem]";

export function CycleDetailsBlock({ detail }: { detail: CycleDetailDto }) {
  const format = useFormat();
  const t = useTranslations("cycleSetup.CycleDetailsBlock");
  const c = detail.cycle;
  return (
    <SummaryBlock
      icon={FileText}
      title={t("cycleDetails")}
      caption={t("basicInformationAndTimelineFor")}
      editHref={setupStepHref("details", c.id)}
    >
      <Facts className={ROW_3}>
        <Fact icon={FileText} label={t("cycleName")}>
          <span className="break-words">{c.name}</span>
        </Fact>
        <Fact icon={CalendarRange} label={t("performancePeriod")}>
          <span className="tabular-nums @xl:whitespace-nowrap">
            {format.date(c.startDate)} – {format.date(c.endDate)}
          </span>
        </Fact>
        <Fact icon={CalendarClock} label={t("planningDeadline")}>
          <span className="tabular-nums @xl:whitespace-nowrap">{format.date(c.planningDeadline)}</span>
        </Fact>
      </Facts>
      {c.description ? (
        <p className="mt-4 line-clamp-3 border-t border-border/50 pt-3 type-body-secondary text-muted-foreground">
          {c.description}
        </p>
      ) : null}
    </SummaryBlock>
  );
}

function Stat({
  icon,
  value,
  label,
}: {
  icon: ReactNode;
  value: ReactNode;
  label: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-3 sm:px-5">
      {icon}
      <div className="min-w-0">
        <div className="type-subsection-title tabular-nums text-foreground">{value}</div>
        <div className="type-meta text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}


export function PopulationBlock({
  detail,
  population,
  unitNames,
  includeDescendants,
}: {
  detail: CycleDetailDto;
  population: PopulationDto;
  unitNames: string[] | null;
  includeDescendants: boolean;
}) {
  const format = useFormat();
  const t = useTranslations("cycleSetup.PopulationBlock");
  const sel = population.selection;
  const byScope = sel.mode === "ByScope";
  const required = population.reviewerRequiredCount;
  const ready = population.reviewerReadyCount;
  const fullCoverage = required === 0 || ready >= required;
  const excluded = sel.exclusions.length;
  const included = sel.inclusions.length;
  const units = unitNames?.length ? unitNames.join(", ") : null;

  return (
    <SummaryBlock
      icon={Users}
      title={t("population")}
      caption={t("whoWillBeIncludedIn")}
      editHref={setupStepHref("population", detail.cycle.id)}
    >
      <Facts className={ROW_2}>
        <Fact icon={Network} label={t("scope")}>
          {byScope ? t("selectedOrganizationUnits") : t("allActiveEmployees")}
          {byScope ? (
            <span className="mt-0.5 block truncate type-meta text-muted-foreground" title={units ?? undefined}>
              {units ??
                `${sel.orgUnitSelections.length} ${t("unitWord", { count: sel.orgUnitSelections.length })}`}
              {includeDescendants ? " " + t("includingSubUnits") : null}
            </span>
          ) : null}
        </Fact>
        <Fact icon={CalendarDays} label={t("eligibilityDate")}>
          <span className="tabular-nums">{format.date(sel.eligibilityDate)}</span>
        </Fact>
      </Facts>

      <div className="mt-4 grid divide-y divide-border rounded-surface border border-border bg-inlay @xl:grid-cols-[auto_auto_minmax(0,1fr)] @xl:divide-x @xl:divide-y-0">
        <Stat
          icon={<Users className="size-5 shrink-0 text-success" strokeWidth={1.75} aria-hidden />}
          value={detail.confirmedParticipantCount}
          label={
            <>
              {t("confirmed", { confirmedParticipantCount: t("participantWord", { count: detail.confirmedParticipantCount }) })}
              {included > 0 ? " " + t("addedIndividually", { included }) : null}
            </>
          }
        />
        <Stat
          icon={<CircleMinus className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />}
          value={excluded}
          label={t("excluded", { excluded: t("personWord", { count: excluded }) })}
        />
        <div className="flex min-w-0 items-center gap-3 px-4 py-3 sm:px-5">
          {fullCoverage ? (
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-success text-background">
              <Check className="size-3.5" strokeWidth={3} aria-hidden />
            </span>
          ) : (
            <AlertTriangle className="size-5 shrink-0 text-warning" strokeWidth={1.75} aria-hidden />
          )}
          <div className="min-w-0">
            <div className="type-meta text-muted-foreground">{t("reviewerCoverage")}</div>
            <div className="type-subsection-title text-foreground">
              {fullCoverage ? (
                t("everyParticipantHasAReviewer")
              ) : (
                <span className="tabular-nums text-warning">
                  {t("ofAssigned", { ready, required })}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </SummaryBlock>
  );
}

export function PolicyBlock({ settings }: { settings: CycleSettingsDto }) {
  const t = useTranslations("cycleSetup.PolicyBlock");
  const words = useSay("common.words");
  const { suggestedObjectiveCountMin: min, suggestedObjectiveCountMax: max } = settings;
  const count = min === max ? `${min}` : `${min}–${max}`;
  return (
    <SummaryBlock
      icon={ChartColumnBig}
      title={t("performancePolicy")}
      caption={t("howPerformanceWillBeMeasured")}
      editHref="/settings"
    >
      <Facts className={ROW_4}>
        <Fact icon={Target} label={t("measurementMethod")}>
          {words(`method.${settings.defaultMeasurementMethod}`)}
        </Fact>
        <Fact icon={Layers} label={t("objectivesPerPlan")}>
          <span className="tabular-nums">{t("suggested", { count })}</span>
        </Fact>
        <Fact icon={Unlink} label={t("alignmentToStrategicDirection")}>
          {settings.planAlignmentPolicy === "EveryObjectiveConnected" ? t("everyObjective") : settings.planAlignmentPolicy === "Optional" ? t("optional") : t("atLeastOneObjective")}
        </Fact>
        <Fact icon={CalendarClock} label={t("planningWindow")}>
          <span className="tabular-nums">{t("days", { planningDeadlineOffsetDays: settings.planningDeadlineOffsetDays })}</span> {t("fromStart")}
        </Fact>
      </Facts>
    </SummaryBlock>
  );
}

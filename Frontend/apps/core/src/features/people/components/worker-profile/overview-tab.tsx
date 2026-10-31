"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";
import { Skeleton } from "@repo/ds";
import { Section } from "@repo/ds/shell";
import { ArrowRight, PartyPopper } from "lucide-react";
import { useWorkforceDate } from "../workforce-ui";
import { ProfileTimeline } from "./job-tab";
import type { WorkerProfileView } from "./worker-profile-view";

const HISTORY_ROWS = 4;
const ANNIVERSARY_WINDOW_DAYS = 60;

/** The next work anniversary within the window, as its date and the years it marks; none in the first year. */
export function nextAnniversary(start: string | null, today: Date = new Date()): { date: string; years: number } | null {
  if (!start) return null;
  const [y, m, d] = start.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let next = new Date(midnight.getFullYear(), m - 1, d);
  if (next < midnight) next = new Date(midnight.getFullYear() + 1, m - 1, d);
  const years = next.getFullYear() - y;
  const days = Math.round((next.getTime() - midnight.getTime()) / 86_400_000);
  if (years < 1 || days > ANNIVERSARY_WINDOW_DAYS) return null;
  const iso = `${next.getFullYear()}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { date: iso, years };
}

/**
 * Overview (D-01): what's coming up for the person from every module, their performance at a glance, then their job and
 * its story. Each section shows only when there is something the viewer may see.
 */
export function OverviewTab({
  view,
  comingUp,
  performance,
  timeline,
  jobHref,
  performanceHref,
}: {
  view: WorkerProfileView;
  /** Requests and scheduled changes about the person, already as cards. */
  comingUp: ReactNode[];
  /** The compact performance summary; undefined when the viewer can't enter Performance. */
  performance?: ReactNode;
  /** Undefined when the viewer may not read the history. */
  timeline?: { isLoading: boolean };
  jobHref?: string;
  performanceHref?: string;
}) {
  const t = useTranslations("profile.overview");
  const workforceDate = useWorkforceDate();
  const anniversary = nextAnniversary(view.employmentStart);
  const upcoming = [
    ...comingUp,
    anniversary ? (
      <div key="anniversary" className="flex items-center gap-4 rounded-surface bg-inlay px-4 py-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-control bg-card text-primary-ink">
          <PartyPopper className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="type-label text-foreground">{t("anniversary", { count: anniversary.years })}</p>
          <p className="type-meta text-muted-foreground">{workforceDate(anniversary.date, { month: "long" })}</p>
        </div>
      </div>
    ) : null,
  ].filter(Boolean);

  const recent = view.timeline.slice(0, HISTORY_ROWS);
  const facts = [
    { label: t("job"), value: view.jobTitle },
    { label: t("unit"), value: view.orgUnitName },
    { label: t("manager"), value: view.manager?.name ?? null },
    { label: t("place"), value: view.workLocation },
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact.value));

  return (
    <div className="space-y-5">
      {upcoming.length > 0 ? (
        <Section title={t("comingUp")}>
          <div className="grid gap-2.5">{upcoming}</div>
        </Section>
      ) : null}

      {performance ? (
        <Section title={t("performance")} className="has-[[data-slot=section-body]:empty]:hidden" action={performanceHref ? <SectionLink href={performanceHref}>{t("openPerformance")}</SectionLink> : undefined}>
          {performance}
        </Section>
      ) : null}

      <Section title={t("jobAndHistory")} action={jobHref ? <SectionLink href={jobHref}>{t("openJob")}</SectionLink> : undefined}>
        {facts.length > 0 ? (
          <dl className="grid gap-x-10 gap-y-4 sm:grid-cols-2">
            {facts.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <dt className="type-meta text-muted-foreground">{fact.label}</dt>
                <dd className="mt-0.5 truncate type-body text-foreground">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="type-body text-muted-foreground">{t("noJob")}</p>
        )}
        {timeline ? (
          timeline.isLoading && recent.length === 0 ? (
            <div className="mt-5 space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-2/3" />
            </div>
          ) : recent.length > 0 ? (
            <div className="mt-6 border-t border-border pt-5">
              <ProfileTimeline events={recent} />
            </div>
          ) : null
        ) : null}
      </Section>
    </div>
  );
}

function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} scroll={false} className="inline-flex items-center gap-1.5 type-label text-primary-ink underline-offset-4 hover:underline">
      {children}
      <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
    </Link>
  );
}

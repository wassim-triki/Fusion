"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { PersonPerformanceSummaryDto } from "@repo/api";
import { Button, Skeleton, Textarea, cn } from "@repo/ds";
import { Section, Said } from "@repo/ds/shell";
import { ArrowRight, BarChart3, Inbox, Users } from "lucide-react";
import { toast } from "sonner";
import { useRefusal } from "@/i18n/words";
import { useUpdatePeopleAbout } from "../../api/use-people";
import { ProfileTimeline } from "./job-tab";
import type { WorkerProfileView } from "./worker-profile-view";

const HISTORY_ROWS = 4;
const ANNIVERSARY_WINDOW_DAYS = 60;
const ABOUT_MAX = 1000;

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

type Source = "performance" | "core";

/** One row of Coming up, as drawn: when, what, and the module it comes from. */
export interface UpcomingItem {
  key: string;
  /** Sorts the list; null (open asks) goes first. */
  at: string | null;
  when: { top: string; main: ReactNode; today?: boolean };
  title: string;
  meta?: string;
  source: Source;
  href?: string;
}

/** Coming up from Performance's summary: the viewer's next 1:1 with the person, open asks, the review step due. */
export function performanceUpcoming(
  summary: PersonPerformanceSummaryDto | undefined,
  words: {
    oneOnOne: string;
    asked: (by: string, title: string) => string;
    askedOn: (date: string) => string;
    review: (round: string) => string;
    reviewDue: (date: string) => string;
    open: string;
    today: string;
    month: (iso: string) => string;
    day: (iso: string) => string;
    time: (iso: string) => string;
    date: (iso: string) => string;
  },
  now: Date = new Date()
): UpcomingItem[] {
  if (!summary) return [];
  const items: UpcomingItem[] = [];
  const isToday = (iso: string) => new Date(iso).toDateString() === now.toDateString();
  const meeting = summary.oneOnOne?.nextMeetingAt;
  if (meeting) {
    items.push({
      key: "one-on-one",
      at: meeting,
      when: isToday(meeting)
        ? { top: words.today, main: words.time(meeting), today: true }
        : { top: words.month(meeting), main: words.day(meeting) },
      title: words.oneOnOne,
      meta: words.date(meeting),
      source: "performance",
      href: summary.oneOnOne!.href,
    });
  }
  for (const objective of summary.currentCycle?.objectives ?? []) {
    if (!objective.openRequest) continue;
    items.push({
      key: `ask-${objective.objectiveId}`,
      at: null,
      when: { top: words.open, main: <Inbox className="mx-auto size-4" aria-hidden /> },
      title: words.asked(objective.openRequest.requestedByName, objective.title),
      meta: words.askedOn(objective.openRequest.requestedAt),
      source: "performance",
      href: objective.href,
    });
  }
  const review = summary.reviews?.current;
  if (review?.dueDate) {
    items.push({
      key: "review",
      at: review.dueDate,
      when: { top: words.month(review.dueDate), main: words.day(review.dueDate) },
      title: words.review(review.reviewRoundName),
      meta: words.reviewDue(review.dueDate),
      source: "performance",
      href: review.href,
    });
  }
  return items;
}

/**
 * Overview (D-01): what the person says about themselves, what's coming up for them from every module, their
 * performance at a glance, then their job and its story. Each section shows only when there is something to show.
 */
export function OverviewTab({
  view,
  canEditAbout,
  isSelf,
  changes,
  upcoming,
  performance,
  timeline,
  jobHref,
  performanceHref,
}: {
  view: WorkerProfileView;
  /** The person or whoever changes their personal details. */
  canEditAbout: boolean;
  isSelf: boolean;
  /** Requests and scheduled changes about the person, already as cards. */
  changes: ReactNode[];
  /** Coming up from other modules (Performance). */
  upcoming: UpcomingItem[];
  /** The compact performance summary; undefined when the viewer can't enter Performance. */
  performance?: ReactNode;
  /** Undefined when the viewer may not read the history. */
  timeline?: { isLoading: boolean };
  jobHref?: string;
  performanceHref?: string;
}) {
  const t = useTranslations("profile.overview");
  const { month, day } = useDayParts();
  const anniversary = nextAnniversary(view.employmentStart);
  const rows: UpcomingItem[] = [
    ...upcoming,
    ...(anniversary
      ? [{
          key: "anniversary",
          at: anniversary.date,
          when: { top: month(anniversary.date), main: day(anniversary.date) },
          title: t("anniversary", { count: anniversary.years }),
          meta: t("workAnniversary"),
          source: "core" as const,
        }]
      : []),
  ].sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));

  const recent = view.timeline.slice(0, HISTORY_ROWS);
  const facts = [
    { label: t("job"), value: view.jobTitle },
    { label: t("unit"), value: view.orgUnitName },
    { label: t("manager"), value: view.manager?.name ?? null },
    { label: t("place"), value: view.workLocation },
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact.value));

  return (
    <div className="space-y-5">
      {view.about || canEditAbout ? <AboutSection view={view} canEdit={canEditAbout} isSelf={isSelf} /> : null}

      {changes.length > 0 || rows.length > 0 ? (
        <Section title={t("comingUp")} flush={rows.length > 0 && changes.length === 0}>
          {changes.length > 0 ? <div className={cn("grid gap-2.5", rows.length > 0 && "mb-4")}>{changes}</div> : null}
          {rows.length > 0 ? (
            <ul className={cn("divide-y divide-border", changes.length > 0 && "-mx-5 -mb-5 border-t border-border")}>
              {rows.map((row) => (
                <UpcomingRow key={row.key} item={row} />
              ))}
            </ul>
          ) : null}
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

/** "Dec" and "15" for a when box, in the viewer's language. */
export function useDayParts() {
  const locale = useLocale();
  const at = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return {
    month: (iso: string) => new Intl.DateTimeFormat(locale, { month: "short" }).format(at(iso)),
    day: (iso: string) => new Intl.DateTimeFormat(locale, { day: "numeric" }).format(at(iso)),
  };
}

/** About (D-01): a few lines in the person's own words, in the editorial face; edited in place. */
function AboutSection({ view, canEdit, isSelf }: { view: WorkerProfileView; canEdit: boolean; isSelf: boolean }) {
  const t = useTranslations("profile.overview");
  const refusal = useRefusal();
  const update = useUpdatePeopleAbout(view.employeeKey);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(view.about ?? "");
  const save = async () => {
    try {
      await update.mutateAsync(draft.trim() || null);
      toast.success(t("aboutSaved"));
      setEditing(false);
    } catch (caught) {
      toast.error(refusal(caught, t("aboutFailed")));
    }
  };
  return (
    <Section
      id="profile-about"
      title={t("about")}
      action={
        canEdit && !editing ? (
          <Button variant="ghost" size="sm" onClick={() => { setDraft(view.about ?? ""); setEditing(true); }}>
            {view.about ? t("edit") : t("add")}
          </Button>
        ) : undefined
      }
    >
      {editing ? (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Textarea
            aria-label={t("about")}
            value={draft}
            maxLength={ABOUT_MAX}
            rows={4}
            autoFocus
            placeholder={isSelf ? t("aboutPromptSelf") : t("aboutPrompt", { name: view.displayName.split(" ")[0] ?? view.displayName })}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={update.isLoading}>{update.isLoading ? t("saving") : t("save")}</Button>
            <Button type="button" size="sm" variant="ghost" disabled={update.isLoading} onClick={() => setEditing(false)}>{t("cancel")}</Button>
            <span className="ms-auto type-meta tabular-nums text-muted-foreground">{draft.length}/{ABOUT_MAX}</span>
          </div>
        </form>
      ) : view.about ? (
        <Said>{view.about}</Said>
      ) : (
        <p className="type-body text-muted-foreground">{isSelf ? t("aboutEmptySelf") : t("aboutEmpty")}</p>
      )}
    </Section>
  );
}

const SOURCE_ICON: Record<Source, typeof Users> = { performance: BarChart3, core: Users };

function UpcomingRow({ item }: { item: UpcomingItem }) {
  const t = useTranslations("profile.overview");
  const Icon = SOURCE_ICON[item.source];
  const body = (
    <>
      <span className={cn("grid w-14 shrink-0 place-items-center rounded-control py-1.5 text-center", item.when.today ? "bg-primary-tint text-primary-ink" : "bg-inlay text-foreground")}>
        <small className="type-eyebrow text-muted-foreground">{item.when.top}</small>
        <b className="type-label">{item.when.main}</b>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate type-label text-foreground">{item.title}</span>
        {item.meta ? <span className="block truncate type-meta text-muted-foreground">{item.meta}</span> : null}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1.5 type-meta text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {item.source === "performance" ? t("fromPerformance") : t("fromCoreHr")}
      </span>
    </>
  );
  const className = "flex items-center gap-4 px-5 py-3";
  return (
    <li>
      {item.href ? (
        <a href={item.href} className={cn(className, "outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-ring")}>
          {body}
        </a>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
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

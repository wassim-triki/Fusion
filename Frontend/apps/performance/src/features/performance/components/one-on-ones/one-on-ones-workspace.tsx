"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useAuth } from "@repo/auth";
import type { AgendaSourceKind, OneOnOneOwedActionDto, OneOnOnePersonDto, OneOnOneRowDto, OneOnOnesDto } from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { PageContainer, PageHeader, StatusBadge } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { PersonInitials } from "@repo/performance-ui";
import { ArrowRight, ChevronRight, Flag, MessageSquare, Plus, RefreshCw, Star, Target } from "@/lib/icons";
import { useOneOnOne, useOneOnOnes } from "../../api/use-conversations";
import { ContentUnavailable } from "../content-unavailable";
import { PlanDocument, SidebarSection } from "../plan/plan-layout";
import { formatDay, shortDay, useOneOnOneWords } from "./one-on-one-lib";
import { RhythmScale, RhythmStrip, SourceWell, TimeBlock } from "./one-on-one-parts";
import { StartOneOnOnesDialog, StartWithManager } from "./start-one-on-ones";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";

const WEEK_MS = 7 * 86_400_000;

/**
 * The 1:1s workspace (D-12, S-02). It leads with the next conversation and what to bring to it, then the team's
 * rhythm: who you meet, how regularly, and when next. Your own 1:1 with your manager, the actions you owe and the
 * week ahead sit beside it. Someone with no 1:1s yet gets one job: starting them. Not cycle-bound.
 */
export function OneOnOnesWorkspace() {
  const t = useTranslations("oneOnOnes.OneOnOnesWorkspace");
  const query = useOneOnOnes();
  if (query.error) return <ContentUnavailable error={query.error} onRetry={query.refetch} subject={t("your11s")} />;
  if (!query.data) return <OneOnOnesSkeleton />;
  return <Workspace data={query.data} />;
}

function Workspace({ data }: { data: OneOnOnesDto }) {
  const t = useTranslations("oneOnOnes.Workspace");
  const { user } = useAuth();
  const [starting, setStarting] = useState<OneOnOnePersonDto | null>(null);
  const active = [...(data.withManager ? [data.withManager] : []), ...data.reports];
  const next = active.filter((r) => r.nextMeetingAt).sort((a, b) => a.nextMeetingAt!.localeCompare(b.nextMeetingAt!))[0] ?? null;
  const hasTeam = data.reports.length > 0 || data.startWithReports.length > 0;
  const thisWeek = active.filter((r) => r.nextMeetingAt && new Date(r.nextMeetingAt).getTime() - Date.now() < WEEK_MS);

  // Nobody to meet: say why in one line.
  if (!data.withManager && !data.startWithManager && !hasTeam && data.ended.length === 0) {
    return (
      <PageContainer>
        <PageHeader className="mb-4" title={t("n11s")} />
        <p className="mt-6 type-body-secondary text-muted-foreground">
          {data.lineAvailable ? t("youHaveNoManagerOr") : t("yourReportingLineCouldntBe")}
        </p>
      </PageContainer>
    );
  }

  // Each fact is said once: the hero is the next meeting, the side panel what isn't already in the main column.
  const heroIsManagerSeries = next !== null && next === data.withManager;

  const main = (
    <div className="space-y-10">
      {data.startWithManager && !hasTeam && !data.withManager ? (
        <StartWithManager me={user?.fullName ?? ""} manager={data.startWithManager.with} defaultCadence={data.defaultCadence} />
      ) : next ? (
        <NextUp row={next} isManager={next !== data.withManager} />
      ) : null}

      {hasTeam ? (
        <RhythmTable title={t("yourTeam")} count={data.reports.length + data.startWithReports.length}>
          {data.reports.map((row) => <RhythmRow key={row.seriesId} row={row} />)}
          {data.startWithReports.map((option) => (
            <StartRow key={option.with.employeeId} person={option.with} onStart={() => setStarting(option.with)} />
          ))}
        </RhythmTable>
      ) : data.withManager && !heroIsManagerSeries ? (
        <RhythmTable title={t("withYourManager")}>
          <RhythmRow row={data.withManager} />
        </RhythmTable>
      ) : null}

      {!data.lineAvailable ? (
        <p className="type-body-secondary text-muted-foreground">{t("yourReportingLineCouldntBe2")}</p>
      ) : null}
      {data.ended.length > 0 ? <EndedLine rows={data.ended} /> : null}
    </div>
  );

  const sidebar = (
    <>
      {hasTeam && !heroIsManagerSeries ? (
        <SidebarSection label={t("withYourManager")}>
          {data.withManager ? (
            <ManagerCard row={data.withManager} />
          ) : data.startWithManager ? (
            <button
              type="button"
              onClick={() => setStarting(data.startWithManager!.with)}
              className="mt-3 flex w-full items-center gap-3 rounded-surface border border-dashed border-border px-4 py-3 text-start hover:bg-card"
            >
              <PersonInitials name={data.startWithManager.with.displayName} size="lg" />
              <span className="min-w-0 flex-1">
                <span className="block truncate type-label text-foreground">{data.startWithManager.with.displayName}</span>
                <span className="block type-meta text-muted-foreground">{t("notMeetingYet")}</span>
              </span>
              <Plus className="size-4 text-muted-foreground" aria-hidden />
            </button>
          ) : (
            <p className="mt-3 type-body-secondary text-muted-foreground">{t("noManagerInCoreHr")}</p>
          )}
        </SidebarSection>
      ) : null}
      <SidebarSection label={t("actionsYouOwe", { value: data.myActions.length > 0 ? ` · ${data.myActions.length}` : "" })}>
        <OwedActions actions={data.myActions} />
      </SidebarSection>
      {hasTeam && thisWeek.length > 0 ? (
        <SidebarSection label={t("thisWeek")}>
          <ThisWeek rows={thisWeek} managerSeriesId={data.withManager?.seriesId ?? null} />
        </SidebarSection>
      ) : null}
    </>
  );

  return (
    <PageContainer width="wide">
      <PageHeader className="mb-4" title={t("n11s")} />
      <div className="mt-6">
        <PlanDocument main={main} sidebar={data.startWithManager && !hasTeam && !data.withManager ? undefined : sidebar} />
      </div>
      {starting ? <StartOneOnOnesDialog person={starting} defaultCadence={data.defaultCadence} onClose={() => setStarting(null)} /> : null}
    </PageContainer>
  );
}

// ── Next up ────────────────────────────────────────────────────────────────────

const SINCE_ICON: Record<AgendaSourceKind, typeof Target> = { Objective: Target, UpdateRequest: RefreshCw, Feedback: MessageSquare, Praise: Star };


/** The one conversation that matters now: when, with whom, what's on the agenda and what changed since last time. */
function NextUp({ row, isManager }: { row: OneOnOneRowDto; isManager: boolean }) {
  const w = useOneOnOneWords();
  const format = useFormat();
  const t = useTranslations("oneOnOnes.NextUp");
  const series = useOneOnOne(row.seriesId);
  const meeting = series.data?.upcoming ?? null;
  const agenda = meeting?.agenda ?? [];
  const counts = new Map<AgendaSourceKind, number>();
  for (const s of meeting?.suggestions ?? []) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  const href = `/one-on-ones/${row.seriesId}`;
  const names = series.data ? new Map([[series.data.manager.employeeId, series.data.manager.displayName], [series.data.report.employeeId, series.data.report.displayName]]) : new Map<string, string>();

  return (
    <section aria-labelledby="next-up" className="rounded-surface border border-primary-ring bg-card p-6">
      <div className="flex flex-wrap items-start gap-5">
        <TimeBlock iso={row.nextMeetingAt!} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="type-meta text-primary-ink">{t("nextUp", { howSoon: w.howSoon(row.nextMeetingAt!) })}</p>
          <div className="mt-2 flex items-center gap-3">
            <PersonInitials name={row.with.displayName} size="lg" />
            <div className="min-w-0">
              <h2 id="next-up" className="truncate type-section-title text-foreground">{row.with.displayName}</h2>
              <p className="truncate type-meta text-muted-foreground">
                {[row.with.jobTitle, isManager ? null : t("yourManager"), w.cadence[row.cadence].toLowerCase()].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
        </div>
        <Button asChild>
          <Link href={href}>
            {t("open11")} <ArrowRight className="size-4" data-icon="inline-end" />
          </Link>
        </Button>
      </div>

      <div className="mt-5 grid gap-6 border-t border-primary-ring pt-5 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="type-meta text-muted-foreground">{t("onTheAgenda")}{row.agendaCount > 0 ? ` · ${row.agendaCount}` : ""}</p>
          {series.isLoading ? (
            <div className="mt-3 space-y-2"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-5 w-1/2" /></div>
          ) : agenda.length === 0 ? (
            <p className="mt-3 type-body-secondary text-muted-foreground">{t("nothingYet")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {agenda.slice(0, 3).map((item) => (
                <li key={item.id} className="flex items-center gap-2.5">
                  {item.sourceKind ? <SourceWell kind={item.sourceKind} size="sm" /> : <PersonInitials name={names.get(item.authorEmployeeId)} size="xs" className="mx-0.5" />}
                  <span className={cn("min-w-0 truncate type-body", item.discussed ? "text-muted-foreground line-through" : "text-foreground")}>{item.text}</span>
                </li>
              ))}
              {agenda.length > 3 ? <li className="ps-9 type-meta text-muted-foreground">{t("more", { value: agenda.length - 3 })}</li> : null}
            </ul>
          )}
        </div>
        <div className="min-w-0">
          <p className="type-meta text-muted-foreground">{row.lastMetAt ? t("sinceYouMet", { lastMetAt: shortDay(row.lastMetAt, format.locale) }) : t("readyToDiscuss")}</p>
          {series.isLoading ? (
            <Skeleton className="mt-3 h-7 w-2/3" />
          ) : counts.size === 0 && row.overdueActions === 0 ? (
            <p className="mt-3 type-body-secondary text-muted-foreground">{t("nothingNew")}</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {row.overdueActions > 0 ? (
                <span className="inline-flex h-7 items-center gap-1.5 rounded-control-sm bg-destructive/12 px-2.5 type-meta-strong text-destructive">
                  <Flag className="size-3.5" aria-hidden />
                  {t("action", { overdueActions: row.overdueActions })}{row.overdueActions === 1 ? "" : t("s")} {t("overdue")}
                </span>
              ) : null}
              {[...counts.entries()].map(([kind, count]) => {
                const Icon = SINCE_ICON[kind];
                return (
                  <span key={kind} className="inline-flex h-7 items-center gap-1.5 rounded-control-sm bg-inlay px-2.5 type-meta-strong text-foreground">
                    <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                    {t(`since.${kind}`, { count })}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Rhythm table ───────────────────────────────────────────────────────────────

const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-4 md:grid-cols-[15rem_minmax(0,1fr)_7.5rem_1rem] md:gap-6";

function RhythmTable({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const t = useTranslations("oneOnOnes.RhythmTable");
  return (
    <section aria-labelledby={`rhythm-${title}`} className="overflow-hidden rounded-surface bg-card">
      <h2 id={`rhythm-${title}`} className="flex min-h-14 items-center justify-between gap-2 px-5 type-section-title text-foreground">
        {title}
        {count !== undefined ? <span className="type-meta tabular-nums text-muted-foreground">{count}</span> : null}
      </h2>
      <div>
        <div className={cn(ROW_GRID, "h-10 bg-inlay px-5")}>
          <span className="type-meta text-muted-foreground">{t("person")}</span>
          <RhythmScale className="hidden md:block" />
          <span className="type-meta text-muted-foreground">{t("next")}</span>
          <span />
        </div>
        <ul className="divide-y divide-border">{children}</ul>
      </div>
    </section>
  );
}

function RhythmRow({ row }: { row: OneOnOneRowDto }) {
  const w = useOneOnOneWords();
  const t = useTranslations("oneOnOnes.RhythmRow");
  return (
    <li>
      <Link href={`/one-on-ones/${row.seriesId}`} className={cn(ROW_GRID, "group min-h-16 px-5 py-3 hover:bg-inlay/50")}>
        <span className="flex min-w-0 items-center gap-3">
          <PersonInitials name={row.with.displayName} />
          <span className="min-w-0">
            <span className="block truncate type-label text-foreground">{row.with.displayName}</span>
            <span className="block truncate type-meta text-muted-foreground">
              {w.cadence[row.cadence]}
              {row.overdueActions > 0 ? (
                <span className="text-destructive"> {t("overdue", { overdueActions: row.overdueActions })}</span>
              ) : row.openActions > 0 ? (
                " " + t("open", { openActions: row.openActions })
              ) : null}
            </span>
          </span>
        </span>
        <span className="hidden md:block">
          <RhythmStrip beats={row.recent} label={t("n11sWith", { displayName: row.with.displayName })} />
        </span>
        <span>{row.nextMeetingAt ? <TimeBlock iso={row.nextMeetingAt} size="sm" /> : <span className="type-meta text-muted-foreground">{t("notSet")}</span>}</span>
        <ChevronRight className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden />
      </Link>
    </li>
  );
}

function StartRow({ person, onStart }: { person: OneOnOnePersonDto; onStart: () => void }) {
  const t = useTranslations("oneOnOnes.StartRow");
  return (
    <li className={cn(ROW_GRID, "min-h-16 px-5 py-3")}>
      <span className="flex min-w-0 items-center gap-3">
        <PersonInitials name={person.displayName} className="opacity-70" />
        <span className="min-w-0">
          <span className="block truncate type-label text-foreground">{person.displayName}</span>
          {person.jobTitle ? <span className="block truncate type-meta text-muted-foreground">{person.jobTitle}</span> : null}
        </span>
      </span>
      <span className="hidden type-meta text-muted-foreground md:block">{t("notMeetingYet")}</span>
      <Button size="sm" variant="ghost" onClick={onStart} className="justify-self-start">
        <Plus className="size-4" data-icon="inline-start" /> {t("start11s")}
      </Button>
      <span />
    </li>
  );
}

function EndedLine({ rows }: { rows: OneOnOneRowDto[] }) {
  const format = useFormat();
  const t = useTranslations("oneOnOnes.EndedLine");
  return (
    <ul className="space-y-1.5">
      {rows.map((row) => (
        <li key={row.seriesId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusBadge tone="muted">{t("ended")}</StatusBadge>
          <span className="type-body-secondary text-muted-foreground">
            {row.with.displayName}
            {row.endedAt ? " " + t("ended2", { endedAt: formatDay(row.endedAt, format.locale) }) : ""}
          </span>
          <Link href={`/one-on-ones/${row.seriesId}`} className="type-meta text-foreground hover:underline">
            {t("showHistory")}
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────────

function ManagerCard({ row }: { row: OneOnOneRowDto }) {
  const w = useOneOnOneWords();
  const t = useTranslations("oneOnOnes.ManagerCard");
  return (
    <>
      <Link href={`/one-on-ones/${row.seriesId}`} className="group mt-3 flex items-center gap-3 rounded-surface bg-card px-4 py-3 hover:bg-inlay/60">
        <PersonInitials name={row.with.displayName} size="lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate type-label text-foreground">{row.with.displayName}</span>
          <span className="block truncate type-meta text-muted-foreground">
            {row.nextMeetingAt ? `${w.timeBlock(row.nextMeetingAt).day} ${w.timeBlock(row.nextMeetingAt).time}` : t("notScheduled")} · {w.cadence[row.cadence].toLowerCase()}
          </span>
        </span>
        <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground" aria-hidden />
      </Link>
      {row.agendaCount > 0 ? (
        <p className="mt-2.5 type-meta text-muted-foreground">{t("onTheAgenda", { agendaCount: row.agendaCount })}</p>
      ) : null}
    </>
  );
}

function OwedActions({ actions }: { actions: OneOnOneOwedActionDto[] }) {
  const format = useFormat();
  const t = useTranslations("oneOnOnes.OwedActions");
  if (actions.length === 0) return <p className="mt-3 type-body-secondary text-muted-foreground">{t("nothingOpen")}</p>;
  return (
    <ul className="mt-3.5 space-y-3">
      {actions.slice(0, 5).map((action) => (
        <li key={action.actionId}>
          <Link href={`/one-on-ones/${action.seriesId}`} className="group flex items-start gap-2.5">
            <span className="mt-0.5 size-4 shrink-0 rounded-detail border border-input" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block type-body text-foreground group-hover:underline">{action.text}</span>
              <span className="block type-meta text-muted-foreground">{t("n11With", { displayName: action.with.displayName })}</span>
            </span>
            {action.dueDate ? (
              <StatusBadge tone={action.overdue ? "danger" : "neutral"}>{action.overdue ? t("overdue") : format.date(action.dueDate)}</StatusBadge>
            ) : null}
          </Link>
        </li>
      ))}
      {actions.length > 5 ? <li className="type-meta text-muted-foreground">{t("more", { value: actions.length - 5 })}</li> : null}
    </ul>
  );
}

function ThisWeek({ rows, managerSeriesId }: { rows: OneOnOneRowDto[]; managerSeriesId: string | null }) {
  const w = useOneOnOneWords();
  const t = useTranslations("oneOnOnes.ThisWeek");
  const sorted = [...rows].sort((a, b) => a.nextMeetingAt!.localeCompare(b.nextMeetingAt!));
  return (
    <ol className="mt-4">
      {sorted.map((row, index) => {
        const { day, time, today } = w.timeBlock(row.nextMeetingAt!);
        const last = index === sorted.length - 1;
        return (
          <li key={row.seriesId} className="grid grid-cols-[4.5rem_1rem_minmax(0,1fr)] gap-3">
            <span className="text-end">
              <span className="block type-label text-foreground">{day}</span>
              <span className="block type-meta tabular-nums text-muted-foreground">{time}</span>
            </span>
            <span className="flex flex-col items-center" aria-hidden>
              <span className={cn("mt-1.5 size-2.5 rounded-full", today ? "bg-primary ring-4 ring-primary-tint" : "border-2 border-muted-foreground/50")} />
              {last ? null : <span className="mt-1 w-px flex-1 bg-border" />}
            </span>
            <Link href={`/one-on-ones/${row.seriesId}`} className={cn("min-w-0 hover:underline", last ? "" : "pb-4")}>
              <span className="block truncate type-label text-foreground">{row.with.displayName}</span>
              <span className="block type-meta text-muted-foreground">
                {row.seriesId === managerSeriesId ? t("yourManager") : row.agendaCount > 0 ? t("onTheAgenda", { agendaCount: row.agendaCount }) : t("nothingOnTheAgendaYet")}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

function OneOnOnesSkeleton() {
  const t = useTranslations("oneOnOnes.OneOnOnesSkeleton");
  return (
    <PageContainer width="wide">
      <div role="status" aria-label={t("loadingYour11s")}>
        <Skeleton className="h-9 w-24" />
        <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="space-y-10">
            <Skeleton className="h-56 w-full rounded-surface" />
            <Skeleton className="h-72 w-full rounded-surface" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-20 w-full rounded-surface" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

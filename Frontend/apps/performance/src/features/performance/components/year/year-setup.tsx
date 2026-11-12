"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { CyclePhase, YearPlanDto, YearSetupDto } from "@repo/api";
import { useCompanyWorkWeek, useTenantSummary } from "@repo/api/query";
import { PageRefusal } from "@repo/auth";
import { cn } from "@repo/ds";
import { Segmented } from "@repo/ds/choice";
import { Button } from "@repo/ds/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ds/components/ui/popover";
import { dateFormatter } from "@repo/ds/lib/dates";
import { Check, ChevronRight, Clock, Rocket, Settings, TriangleAlert } from "@repo/ds/icons";
import { AsyncButton, PageContainer, PageSkeleton } from "@repo/ds/shell";
import { AvatarStack, PersonInitials } from "@repo/performance-ui";
import { reportPerformanceFailure } from "../../api/performance-failure";
import { useLaunchYear, useSaveYear, useYearSetup } from "../../api/use-performance";
import { useWorkspaceContext } from "../../api/use-workspace";
import { ContentUnavailable } from "../content-unavailable";
import { day, dayMonth, daysBetween, firstName } from "./year-words";

const PHASES: CyclePhase[] = ["Planning", "Execution", "Review", "ResultsOut"];
const STEP_TONE = [
  "bg-[color-mix(in_oklab,var(--primary)_34%,var(--inlay))]",
  "bg-[color-mix(in_oklab,var(--identity-2)_24%,var(--inlay))]",
  "bg-[color-mix(in_oklab,var(--identity-4)_28%,var(--inlay))]",
  "bg-[color-mix(in_oklab,var(--success)_28%,var(--inlay))]",
];
/** A step never shrinks below a week when dragged. */
const MIN_DAYS = 7;
/** How far apart the hanging dates' rows sit. */
const LANE_PX = 38;

/** The year's dated moments: three end a step (goals agreed, reviews open, results out), three fall within one. */
type Edge = "planningEndsOn" | "reviewOpensOn" | "resultsOutOn";
type Within = "midYearCheckInOn" | "selfReviewsDueOn" | "calibrationOn";
type MomentKey = Edge | Within;
const EDGES: Edge[] = ["planningEndsOn", "reviewOpensOn", "resultsOutOn"];
const WITHIN: Within[] = ["midYearCheckInOn", "selfReviewsDueOn", "calibrationOn"];
const WORD = {
  planningEndsOn: "goalsAgreed",
  reviewOpensOn: "reviewsOpen",
  resultsOutOn: "resultsOut",
  midYearCheckInOn: "midYearCheckInOn",
  selfReviewsDueOn: "selfReviewsDueOn",
  calibrationOn: "calibrationOn",
} as const satisfies Record<MomentKey, string>;

/**
 * Setting up a year (D-91, its year redrawn in D-102): one page whose object is the year. Its name is edited in the
 * title; the year is the editor: its steps' edges dragged on the bar, every dated moment hanging under it with its
 * date, dragged along the year or clicked for a small step, the moments within a step also marked on the bar. Public
 * holidays sit on it (D-92) and a moment on a day off is caught in one line with its move. Then who's in from Core HR,
 * what comes along and what people see the day it launches. Kept as a draft (nobody is told) or launched (D-84).
 */
export function YearSetupPage() {
  const t = useTranslations("year.YearSetup");
  const context = useWorkspaceContext();
  const administers = context.data?.capabilities.administers ?? false;
  const setup = useYearSetup();

  if (context.isLoading || (administers && setup.isLoading)) return <PageSkeleton rows={5} width="wide" label={t("loading")} />;
  if (!administers) return <PageContainer><PageRefusal /></PageContainer>;
  if (setup.error) return <ContentUnavailable error={setup.error} onRetry={setup.refetch} />;
  if (!setup.data) return <PageSkeleton rows={5} width="wide" label={t("loading")} />;
  return <SetUp key={setup.data.draftId ?? "new"} setup={setup.data} />;
}

/** The top bar's path on this page: Performance › Year › Set up FY2028. */
export function YearSetupCrumbs() {
  const t = useTranslations("year.YearSetup");
  const setup = useYearSetup();
  const name = setup.data?.year.name;
  return (
    <nav aria-label={t("crumbs")}>
      <ol className="flex min-w-0 items-center gap-2 text-sm">
        <li><Link href="/" className="text-muted-foreground transition-colors hover:text-foreground">{t("crumbPerformance")}</Link></li>
        <li className="flex items-center gap-2">
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70 rtl:rotate-180" />
          <Link href="/" className="text-muted-foreground transition-colors hover:text-foreground">{t("crumbYear")}</Link>
        </li>
        {name ? (
          <li className="flex min-w-0 items-center gap-2">
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70 rtl:rotate-180" />
            <span aria-current="page" className="truncate font-semibold text-foreground">{t("title", { name })}</span>
          </li>
        ) : null}
      </ol>
    </nav>
  );
}

function SetUp({ setup }: { setup: YearSetupDto }) {
  const t = useTranslations("year.YearSetup");
  const locale = useLocale();
  const router = useRouter();
  const save = useSaveYear();
  const launch = useLaunchYear();
  const [year, setYear] = useState<YearPlanDto>(() => withMoments(setup.year));
  const [busy, setBusy] = useState<"draft" | "launch" | null>(null);
  const days = useDaysOff(year.startDate, year.endDate);
  const long = dateFormatter({ day: "numeric", month: "long", year: "numeric" }, locale);
  const longDay = (iso: string) => long.format(new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));

  const set = (patch: Partial<YearPlanDto>) => setYear((current) => ({ ...current, ...patch }));
  /** Moves a moment, kept inside its room: a step's end leaves each step at least a week; the rest stay in the year. */
  const move = (key: MomentKey, iso: string) =>
    setYear((current) => {
      const edge = EDGES.indexOf(key as Edge);
      const steps = stepsOf(current);
      const [min, max] = edge >= 0
        ? [addDays(steps[edge]!.start, MIN_DAYS), addDays(steps[edge + 1]!.end, -MIN_DAYS)]
        : [current.startDate, current.endDate];
      return { ...current, [key]: iso < min ? min : iso > max ? max : iso };
    });

  const moments = momentsOf(year, (key) => t(`moment.${WORD[key]}`));
  const firstOff = moments.find((moment) => days.isOff(moment.on));

  const persist = () =>
    save.mutateAsync({
      draftId: setup.draftId,
      version: setup.draftVersion,
      request: {
        name: year.name.trim(),
        startDate: year.startDate,
        endDate: year.endDate,
        planningDeadline: year.planningEndsOn,
        plan: {
          reviewOpensOn: year.reviewOpensOn,
          resultsOutOn: year.resultsOutOn,
          midYearCheckInOn: year.midYearCheckInOn,
          selfReviewsDueOn: year.selfReviewsDueOn,
          calibrationOn: year.calibrationOn,
          joinersJoin: year.joinersJoin,
          droppedCompanyGoalIds: year.droppedCompanyGoalIds,
        },
      },
    });

  const keepDraft = async () => {
    setBusy("draft");
    try {
      await persist();
      toast.success(t("keptToast"));
    } catch (error) {
      reportPerformanceFailure(error, t("saveFailed"));
    } finally {
      setBusy(null);
    }
  };

  const launchYear = async () => {
    setBusy("launch");
    try {
      const saved = await persist();
      const launched = await launch.mutateAsync({ cycleId: saved.id, version: saved.version });
      toast.success(t("launchedToast", { name: year.name.trim(), count: launched.people }));
      router.push("/");
    } catch (error) {
      reportPerformanceFailure(error, t("launchFailed"));
      setBusy(null);
    }
  };

  const blocked = setup.launchBlocker === "lastYearRunning";

  return (
    <PageContainer>
      <div className="grid max-w-[1160px] gap-[18px]">
        <div className="flex flex-wrap items-end gap-4 pt-2">
          <div className="grid gap-1">
            <h1 className="type-display text-foreground">
              {t.rich("titleEditable", { name: () => <YearName name={year.name} fallback={setup.year.name} onName={(name) => set({ name })} /> })}
            </h1>
            <span className="text-muted-foreground">{t("dates", { start: longDay(year.startDate), end: longDay(year.endDate) })}</span>
          </div>
          <div className="ms-auto flex items-center gap-2">
            <AsyncButton variant="ghost" pending={busy === "draft"} disabled={busy !== null} onClick={() => void keepDraft()}>
              {t("keepDraft")}
            </AsyncButton>
            <AsyncButton writes pending={busy === "launch"} disabled={busy !== null || blocked} onClick={() => void launchYear()}>
              <Rocket aria-hidden className="size-4" />
              {t("launch", { name: year.name })}
            </AsyncButton>
          </div>
        </div>
        {blocked ? (
          <p className="-mt-2 text-end text-[13px] text-muted-foreground">{t("lastYearRunning", { name: setup.lastYearName ?? "" })}</p>
        ) : null}

        <section className="grid gap-4 rounded-surface bg-card px-6 pb-5 pt-[22px]">
          <div className="flex justify-end gap-4 text-xs text-muted-foreground">
            {days.holidays.length > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <i aria-hidden className="size-[5px] rounded-full bg-muted-foreground/80" />
                {t("publicHolidays")}
              </span>
            ) : null}
            {setup.lastYear ? (
              <span className="inline-flex items-center gap-1.5">
                <i aria-hidden className="h-1 w-3.5 rounded-[1px] bg-border" />
                {t("aYearOn", { name: setup.lastYearName ?? "" })}
              </span>
            ) : null}
          </div>

          <YearEditor year={year} moments={moments} holidays={days.holidays} isOff={days.isOff} nextWorkingDay={days.nextWorkingDay}
            lastYear={setup.lastYear} onMove={move} />

          {firstOff ? (() => {
            const to = days.nextWorkingDay(firstOff.on);
            const holiday = days.holidayBetween(firstOff.on, to);
            return (
              <div className="flex flex-wrap items-center gap-3 rounded-inset bg-inlay py-[9px] pe-3 ps-3.5 text-[13.5px] animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
                <TriangleAlert aria-hidden className="size-[17px] text-warning" />
                <span>
                  <b className="font-semibold">{t("fallsOn", { moment: firstOff.label, day: day(firstOff.on, locale) })}</b>
                  {holiday ? <span className="text-muted-foreground">{t("andHoliday", { day: dayMonth(holiday.date, locale), holiday: holiday.name })}</span> : null}
                </span>
                <Button size="sm" variant="outline" className="ms-auto" onClick={() => move(firstOff.key, to)}>{t("moveTo", { day: day(to, locale) })}</Button>
              </div>
            );
          })() : null}
        </section>

        <div className="grid items-start gap-[18px] lg:grid-cols-3">
          <WhosIn setup={setup} year={year} joinersJoin={year.joinersJoin} onJoiners={(joinersJoin) => set({ joinersJoin })} />
          <WhatComesAlong setup={setup} dropped={year.droppedCompanyGoalIds}
            onToggle={(id) => set({ droppedCompanyGoalIds: year.droppedCompanyGoalIds.includes(id)
              ? year.droppedCompanyGoalIds.filter((d) => d !== id) : [...year.droppedCompanyGoalIds, id] })} />
          <WhatPeopleSee setup={setup} year={year} />
        </div>
      </div>
    </PageContainer>
  );
}

/** The year's name, edited where it reads: in the title. Enter or leaving it keeps it; emptied, it goes back. */
function YearName({ name, fallback, onName }: { name: string; fallback: string; onName: (name: string) => void }) {
  const t = useTranslations("year.YearSetup");
  const ref = useRef<HTMLSpanElement>(null);
  // The text is written here, not rendered, so React never fights the caret over it.
  useLayoutEffect(() => {
    if (ref.current && ref.current.textContent !== name) ref.current.textContent = name;
  }, [name]);
  const commit = () => {
    const typed = (ref.current?.textContent ?? "").trim().slice(0, 200);
    const next = typed || name || fallback;
    if (ref.current) ref.current.textContent = next;
    if (next !== name) onName(next);
  };
  return (
    <span ref={ref} role="textbox" aria-label={t("yearName")} tabIndex={0} contentEditable="plaintext-only" spellCheck={false}
      suppressContentEditableWarning onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
      className="-mx-1 cursor-text rounded-detail px-1 outline-none hover:shadow-[inset_0_-2px_0_color-mix(in_oklab,var(--muted-foreground)_45%,transparent)] focus:shadow-[inset_0_0_0_1.5px_var(--primary)]" />
  );
}

// ── The year, the editor ──────────────────────────────────────────────────────────────────────────

interface Step { phase: CyclePhase; start: string; end: string }
interface DatedMoment { key: MomentKey; label: string; on: string; edge: boolean }

function stepsOf(year: YearPlanDto): Step[] {
  const ends = [year.planningEndsOn, year.reviewOpensOn, year.resultsOutOn, year.endDate];
  return PHASES.map((phase, i) => ({ phase, start: i === 0 ? year.startDate : ends[i - 1]!, end: ends[i]! }));
}

function momentsOf(year: YearPlanDto, label: (key: MomentKey) => string): DatedMoment[] {
  return [...EDGES, ...WITHIN]
    .filter((key) => year[key])
    .map((key) => ({ key, label: label(key), on: year[key]!, edge: EDGES.includes(key as Edge) }))
    .sort((a, b) => a.on.localeCompare(b.on));
}

/** With no date fields, every moment needs a date: one missing is proposed inside its step. */
function withMoments(year: YearPlanDto): YearPlanDto {
  const within = (from: string, to: string, share: number) => addDays(from, Math.round(daysBetween(from, to) * share));
  return {
    ...year,
    midYearCheckInOn: year.midYearCheckInOn ?? within(year.planningEndsOn, year.reviewOpensOn, 0.5),
    selfReviewsDueOn: year.selfReviewsDueOn ?? within(year.reviewOpensOn, year.resultsOutOn, 0.35),
    calibrationOn: year.calibrationOn ?? within(year.reviewOpensOn, year.resultsOutOn, 0.7),
  };
}

function YearEditor({ year, moments, holidays, isOff, nextWorkingDay, lastYear, onMove }: {
  year: YearPlanDto;
  moments: DatedMoment[];
  holidays: Holiday[];
  isOff: (iso: string) => boolean;
  nextWorkingDay: (iso: string) => string;
  lastYear: YearPlanDto | null;
  onMove: (key: MomentKey, iso: string) => void;
}) {
  const t = useTranslations("year.YearSetup");
  const phaseWord = useTranslations("year.phase");
  const locale = useLocale();
  const track = useRef<HTMLDivElement>(null);
  const width = useWidth(track);
  const drag = useRef<{ key: MomentKey; x: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const [dragging, setDragging] = useState<MomentKey | null>(null);
  const [open, setOpen] = useState<MomentKey | null>(null);
  const steps = stepsOf(year);
  const span = Math.max(1, daysBetween(year.startDate, year.endDate));
  const pos = (iso: string) => Math.max(0, Math.min(100, (daysBetween(year.startDate, iso) / span) * 100));
  const monthName = dateFormatter({ month: "short" }, locale);
  const weekday = dateFormatter({ weekday: "long" }, locale);

  // The dates hang in rows under the year so their words never overlap; past 70% they hang leftwards.
  const lanes: [number, number][][] = [[], [], [], [], []];
  const placed = moments.map((moment) => {
    const at = pos(moment.on);
    const x = (at / 100) * width;
    const w = Math.max(moment.label.length * 6.8, 78) + 20;
    const end = at > 70;
    const left = end ? x - w : x;
    let lane = 0;
    while (lane < 4 && lanes[lane]!.some(([a, b]) => left < b + 8 && left + w > a - 8)) lane++;
    lanes[lane]!.push([left, left + w]);
    return { ...moment, at, end, lane };
  });
  const deepest = Math.max(0, ...placed.map((moment) => moment.lane));

  const dateAt = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect();
    const share = (document.dir === "rtl" ? rect.right - clientX : clientX - rect.left) / rect.width;
    return addDays(year.startDate, Math.round(Math.max(0, Math.min(1, share)) * span));
  };
  /** Pressing anything that carries a date starts a drag; a press that never moves stays a click. */
  const grab = (key: MomentKey) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      drag.current = { key, x: event.clientX, moved: false };
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (!current || (!current.moved && Math.abs(event.clientX - current.x) < 3)) return;
      if (!current.moved) { current.moved = true; setDragging(key); setOpen(null); }
      onMove(key, dateAt(event.clientX));
    },
    onPointerUp: () => {
      dragged.current = drag.current?.moved ?? false;
      drag.current = null;
      setDragging(null);
    },
    onPointerCancel: () => { drag.current = null; setDragging(null); },
  });
  const onEdgeKey = (key: Edge, step: Step, keyName: string) => {
    const delta = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[keyName] ?? 0;
    if (delta) onMove(key, addDays(step.end, delta * (document.dir === "rtl" ? -1 : 1)));
  };

  return (
    <div className="grid">
      <div className="grid gap-1">
        <div className="relative h-[18px]" aria-hidden>
          {monthStarts(year.startDate, year.endDate).map((month) => (
            <span key={month} className="absolute bottom-0 whitespace-nowrap ps-[5px] text-[11.5px] text-muted-foreground" style={{ insetInlineStart: `${pos(month)}%` }}>
              <i className="absolute bottom-0 start-0 h-[9px] w-px bg-border" />
              {monthName.format(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1))}
              {month.slice(5, 7) === "01" ? <b className="ms-[3px] font-semibold text-foreground">{month.slice(0, 4)}</b> : null}
            </span>
          ))}
        </div>

        <div ref={track} className="relative flex h-[52px] gap-[2px]">
          {steps.map((step, index) => {
            const share = pos(step.end) - pos(step.start);
            return (
              <div key={step.phase} title={t("stepSpan", { step: phaseWord(step.phase), start: dayMonth(step.start, locale), end: dayMonth(step.end, locale) })}
                className={cn("flex h-full flex-col justify-center overflow-hidden whitespace-nowrap px-3 leading-tight", STEP_TONE[index],
                  index === 0 && "rounded-s-detail", index === steps.length - 1 && "rounded-e-detail",
                  dragging === null && "transition-[width] duration-150")}
                style={{ width: `calc(${share}% - 2px)` }}>
                {share >= 7 ? (
                  <>
                    <span className="text-[13px] font-semibold text-foreground">{phaseWord(step.phase)}</span>
                    <small className="text-[11.5px] font-medium text-muted-foreground">{t("days", { count: daysBetween(step.start, step.end) })}</small>
                  </>
                ) : null}
              </div>
            );
          })}
          {EDGES.map((key, index) => (
            <span key={key} role="slider" tabIndex={0} aria-label={t("stepEnds", { step: phaseWord(steps[index]!.phase) })}
              aria-valuetext={day(steps[index]!.end, locale)} aria-valuemin={0} aria-valuemax={span} aria-valuenow={daysBetween(year.startDate, steps[index]!.end)}
              {...grab(key)} onKeyDown={(event) => onEdgeKey(key, steps[index]!, event.key)}
              className={cn("absolute -inset-y-[5px] z-[2] -ms-[7px] grid w-3.5 cursor-ew-resize touch-none place-items-center outline-none",
                "before:h-full before:w-[3px] before:rounded-[2px] before:shadow-[0_0_0_2px_var(--card)] hover:before:bg-primary focus-visible:before:bg-primary",
                dragging === key ? "before:bg-primary" : "before:bg-foreground")}
              style={{ insetInlineStart: `${pos(steps[index]!.end)}%` }} />
          ))}
          {placed.filter((moment) => !moment.edge).map((moment) => {
            const off = isOff(moment.on);
            return (
              <span key={moment.key} aria-hidden className="absolute -inset-y-1 z-[1] w-0" style={{ insetInlineStart: `${moment.at}%` }}>
                <i className={cn("absolute inset-y-0 -start-[0.75px] w-[1.5px]", off ? "bg-warning" : "bg-foreground/65")} />
                <i {...grab(moment.key)} title={`${moment.label}, ${day(moment.on, locale)}`}
                  className={cn("absolute -start-1 -top-[7px] size-2 rotate-45 cursor-ew-resize touch-none rounded-[1.5px]", off ? "bg-warning" : "bg-foreground")} />
              </span>
            );
          })}
        </div>

        <div className="relative h-2.5" aria-hidden>
          {holidays.map((holiday) => (
            <i key={holiday.date} title={`${holiday.name}, ${day(holiday.date, locale)}`}
              className="absolute top-[3px] -ms-[2.5px] size-[5px] rounded-full bg-muted-foreground/80" style={{ insetInlineStart: `${pos(holiday.date)}%` }} />
          ))}
        </div>
        {lastYear ? (
          <div className="relative mt-0.5 h-1" aria-hidden>
            {stepsOf(lastYear).map((step) => {
              const start = pos(addYears(step.start)), end = pos(addYears(step.end));
              return <i key={step.phase} className="absolute inset-y-0 rounded-[1px] bg-border" style={{ insetInlineStart: `${start}%`, width: `calc(${end - start}% - 2px)` }} />;
            })}
          </div>
        ) : null}
      </div>

      <div className="relative mt-4" style={{ height: 56 + deepest * LANE_PX }}>
        {placed.map((moment) => {
          const off = isOff(moment.on);
          const to = nextWorkingDay(moment.on);
          const holiday = holidays.find((h) => h.date === moment.on);
          const weekend = off && !holiday;
          return (
            <div key={moment.key} className={cn("absolute top-0 flex flex-col", moment.end && "-translate-x-full items-end rtl:translate-x-full")}
              style={{ insetInlineStart: `${moment.at}%`, paddingTop: moment.lane * LANE_PX }}>
              <i aria-hidden className={cn("absolute -top-1.5 w-[1.5px] bg-foreground/45", moment.end ? "end-0" : "start-0")}
                style={{ height: moment.lane * LANE_PX + 8 }} />
              <Popover open={open === moment.key} onOpenChange={(next) => setOpen(next ? moment.key : null)}>
                <PopoverTrigger asChild>
                  <button type="button" {...grab(moment.key)}
                    onClick={(event) => {
                      event.preventDefault();
                      if (dragged.current) { dragged.current = false; return; }
                      setOpen(open === moment.key ? null : moment.key);
                    }}
                    className={cn("relative z-[1] grid cursor-pointer touch-none gap-px whitespace-nowrap rounded-[8px] bg-card px-[7px] pb-1 pt-[3px] text-start outline-none",
                      "hover:bg-inlay focus-visible:shadow-[inset_0_0_0_1.5px_var(--primary)]", open === moment.key && "bg-inlay", moment.end && "text-end")}>
                    <span className="text-xs text-muted-foreground">{moment.label}</span>
                    <span className={cn("inline-flex items-center gap-[5px] text-[13.5px] font-semibold tabular-nums", moment.end && "justify-end", off ? "text-warning" : "text-foreground")}>
                      {off ? <TriangleAlert aria-hidden className="size-[13px]" /> : null}
                      {day(moment.on, locale)}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="grid w-[268px] gap-2.5 p-3" align={moment.end ? "end" : "start"}>
                  <span className="text-[12.5px] text-muted-foreground">{moment.label}</span>
                  <span className="text-lg font-semibold tabular-nums">{day(moment.on, locale)} {moment.on.slice(0, 4)}</span>
                  <div className="flex gap-1.5">
                    {([[-7, "minusWeek"], [-1, "minusDay"], [1, "plusDay"], [7, "plusWeek"]] as const).map(([by, word]) => (
                      <Button key={word} size="sm" variant="secondary" className="flex-1 px-0" onClick={() => onMove(moment.key, addDays(moment.on, by))}>{t(word)}</Button>
                    ))}
                  </div>
                  {off ? (
                    <>
                      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-warning">
                        <TriangleAlert aria-hidden className="size-3.5" />
                        {[weekend || !holiday ? weekday.format(new Date(`${moment.on}T00:00:00`)) : null, holiday?.name].filter(Boolean).join("; ")}
                      </span>
                      <Button size="sm" variant="secondary" onClick={() => onMove(moment.key, to)}>{t("moveTo", { day: day(to, locale) })}</Button>
                    </>
                  ) : null}
                </PopoverContent>
              </Popover>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The element's width, kept current; the hanging dates are laid out in pixels. */
function useWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(1040);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => { if (entry && entry.contentRect.width > 0) setWidth(entry.contentRect.width); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

// ── Beside it ─────────────────────────────────────────────────────────────────────────────────────

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-4 rounded-surface bg-card px-6 py-[22px]">
      <div className="flex items-center gap-3">
        <h2 className="font-editorial text-xl font-medium text-foreground">{title}</h2>
        {aside ? <span className="ms-auto text-xs text-muted-foreground">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

function WhosIn({ setup, year, joinersJoin, onJoiners }: { setup: YearSetupDto; year: YearPlanDto; joinersJoin: boolean; onJoiners: (value: boolean) => void }) {
  const t = useTranslations("year.YearSetup");
  const locale = useLocale();
  const company = useTenantSummary().data?.name;
  const more = setup.peopleCount - setup.people.length;
  const on = dayMonth(year.startDate, locale);
  return (
    <Card title={t("whosIn")} aside={t("fromCoreHr")}>
      <div className="flex flex-wrap items-center gap-1.5">
        {setup.people.map((person) => <PersonInitials key={person.employeeId} name={person.name} size="md" />)}
        {more > 0 ? <span className="ms-1 text-[12.5px] text-muted-foreground">{t("andMore", { count: more })}</span> : null}
      </div>
      <div className="grid">
        <div className="grid gap-1.5 py-[11px]">
          <span className="text-sm">{company ? t("everyoneAt", { company, day: on }) : t("everyoneOn", { day: on })}</span>
          <b className="text-sm font-semibold tabular-nums">{t("people", { count: setup.peopleCount })}</b>
        </div>
        <div className="grid gap-1.5 border-t border-border py-[11px]">
          <span className="text-sm">{t("joiners")}</span>
          <Segmented size="sm" tone="quiet" className="justify-self-start" label={t("joiners")} value={joinersJoin ? "in" : "next"}
            onChange={(value) => onJoiners(value === "in")}
            options={[{ value: "in", label: t("joinersIn") }, { value: "next", label: t("joinersNextYear") }]} />
        </div>
        <div className="grid gap-1.5 border-t border-border py-[11px]">
          <span className="text-sm">{t("leavers")}</span>
          <span className="text-[13px] text-muted-foreground">{t("leaversOut")}</span>
        </div>
        {setup.leftOut.length > 0 ? (
          <div className="grid gap-1.5 border-t border-border py-[11px]">
            <span className="text-sm">{t("leftOut", { count: setup.leftOut.length })}</span>
            <span className="text-[13px] text-muted-foreground">{setup.leftOut.slice(0, 3).map((p) => p.name).join(", ")}</span>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function WhatComesAlong({ setup, dropped, onToggle }: { setup: YearSetupDto; dropped: string[]; onToggle: (id: string) => void }) {
  const t = useTranslations("year.YearSetup");
  if (!setup.lastYearName) {
    return (
      <Card title={t("whatComesAlong")}>
        <span className="text-sm text-muted-foreground">{t("firstYear")}</span>
        <SettingsLine />
      </Card>
    );
  }
  return (
    <Card title={t("whatComesAlong")}>
      {setup.companyGoals.length > 0 ? (
        <div className="grid gap-1">
          {setup.companyGoals.map((goal) => {
            const kept = !dropped.includes(goal.id);
            return (
              <button key={goal.id} type="button" role="checkbox" aria-checked={kept} onClick={() => onToggle(goal.id)}
                className="-mx-2 flex items-center gap-2.5 rounded-inset px-2 py-[7px] text-start transition-colors hover:bg-inlay">
                <span className={cn("grid size-5 shrink-0 place-items-center rounded-detail", kept ? "bg-primary text-primary-foreground" : "shadow-[inset_0_0_0_1.5px_var(--muted-foreground)]")}>
                  {kept ? <Check aria-hidden className="size-3.5" /> : null}
                </span>
                <span className="grid">
                  <span className={cn("font-editorial text-[14.5px] font-medium", kept ? "text-foreground" : "text-muted-foreground line-through")}>{goal.title}</span>
                  <span className="text-xs text-muted-foreground">{t("companyGoalOf", { name: firstName(goal.ownerName) })}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">{t("noCompanyGoals", { name: setup.lastYearName })}</span>
      )}
      {setup.unfinishedGoals > 0 ? (
        <div className="flex items-center gap-3 rounded-inset bg-inlay px-3.5 py-3">
          <AvatarStack names={setup.unfinishedOwners.map((p) => p.name)} size="xs" max={4} />
          <span className="text-sm">
            <b className="font-semibold">{t("unfinished", { count: setup.unfinishedGoals })}</b>
            <span className="text-muted-foreground">{t("intoDrafts")}</span>
          </span>
        </div>
      ) : null}
      <SettingsLine />
    </Card>
  );
}

function SettingsLine() {
  const t = useTranslations("year.YearSetup");
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground">
      <Settings aria-hidden className="size-[15px] shrink-0" />
      <span>
        {t("settingsAsTheyAre")}{" "}
        <Link href="/settings" className="font-semibold text-primary-ink underline-offset-4 hover:underline">{t("settings")}</Link>
      </span>
    </span>
  );
}

function WhatPeopleSee({ setup, year }: { setup: YearSetupDto; year: YearPlanDto }) {
  const t = useTranslations("year.YearSetup");
  const locale = useLocale();
  const carried = setup.unfinishedOwners[0];
  const someone = carried ?? setup.people[0];
  return (
    <Card title={t("whatPeopleSee")}>
      <div className="grid gap-3">
        <div className="grid gap-2 rounded-inset bg-inlay px-[18px] py-4">
          <span className="text-[12.5px] text-muted-foreground">{t("yourNextStep")}</span>
          <span className="text-[19px] font-semibold leading-tight tracking-[-0.01em] text-foreground">{t("writeGoals", { name: year.name })}</span>
          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Clock aria-hidden className="size-[15px]" />
            {t("by", { day: day(year.planningEndsOn, locale) })}
          </span>
        </div>
        {someone ? (
          <div className="flex items-center gap-2.5">
            <PersonInitials name={someone.name} size="sm" />
            <span className="text-xs text-muted-foreground">
              {carried ? t("homeAndEmailCarried", { name: firstName(someone.name) }) : t("homeAndEmail", { name: firstName(someone.name) })}
            </span>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

// ── Days off: the company's work week (Core HR) and public holidays (D-92) ───────────────────────

interface Holiday { date: string; name: string }

function useDaysOff(start: string, end: string) {
  const locale = useLocale();
  const week = useCompanyWorkWeek();
  const [all, setAll] = useState<Holiday[]>([]);
  const fromYear = Number(start.slice(0, 4));
  const toYear = Number(end.slice(0, 4));
  useEffect(() => {
    let live = true;
    // Public holidays follow Tunisia until a company records its country (B-441).
    void import("date-holidays").then(({ default: Holidays }) => {
      const calendar = new Holidays("TN", { languages: [locale.slice(0, 2), "en"] });
      const found: Holiday[] = [];
      for (let y = fromYear; y <= toYear; y++)
        for (const h of calendar.getHolidays(y)) if (h.type === "public") found.push({ date: h.date.slice(0, 10), name: h.name });
      if (live) setAll(found);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [fromYear, toYear, locale]);

  return useMemo(() => {
    const holidays = all.filter((h) => h.date >= start && h.date <= end);
    const byDate = new Map(holidays.map((h) => [h.date, h]));
    const working = new Set(week.data?.workingDays?.length ? week.data.workingDays : [1, 2, 3, 4, 5]);
    const isoWeekday = (iso: string) => ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const isOff = (iso: string) => !working.has(isoWeekday(iso)) || byDate.has(iso);
    const nextWorkingDay = (iso: string) => {
      let next = iso;
      for (let i = 0; i < 14 && isOff(next); i++) next = addDays(next, 1);
      return next;
    };
    const holidayBetween = (from: string, to: string) => holidays.find((h) => h.date >= from && h.date <= to) ?? null;
    return { holidays, isOff, nextWorkingDay, holidayBetween };
  }, [all, start, end, week.data]);
}

// ── Dates ─────────────────────────────────────────────────────────────────────────────────────────

function addDays(iso: string, count: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

/** Last year's date as it falls in this one. */
function addYears(iso: string): string {
  return `${Number(iso.slice(0, 4)) + 1}${iso.slice(4)}`;
}

function monthStarts(start: string, end: string): string[] {
  const out: string[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  for (let i = 0; i < 13; i++) {
    if (m === 12) { m = 0; y += 1; }
    m += 1;
    const iso = `${y}-${String(m).padStart(2, "0")}-01`;
    if (iso >= end) break;
    if (iso > start) out.push(iso);
  }
  return out;
}

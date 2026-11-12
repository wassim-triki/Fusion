"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { CyclePhase, YearPlanDto, YearSetupDto } from "@repo/api";
import { useCompanyWorkWeek } from "@repo/api/query";
import { PageRefusal } from "@repo/auth";
import { cn } from "@repo/ds";
import { Segmented } from "@repo/ds/choice";
import { Button } from "@repo/ds/components/ui/button";
import { DatePicker } from "@repo/ds/components/ui/date-picker";
import { Input } from "@repo/ds/components/ui/input";
import { dateFormatter } from "@repo/ds/lib/dates";
import { Bell, CalendarIcon, Check, Clock, Rocket, Settings, TriangleAlert } from "@repo/ds/icons";
import { AsyncButton, PageContainer, PageSkeleton } from "@repo/ds/shell";
import { AvatarStack, PersonInitials } from "@repo/performance-ui";
import { reportPerformanceFailure } from "../../api/performance-failure";
import { useLaunchYear, useSaveYear, useYearSetup } from "../../api/use-performance";
import { useWorkspaceContext } from "../../api/use-workspace";
import { ContentUnavailable } from "../content-unavailable";
import { day, dayMonth, daysBetween, firstName, fullDay } from "./year-words";

const PHASES: CyclePhase[] = ["Planning", "Execution", "Review", "ResultsOut"];
const STEP_TONE = [
  "bg-[color-mix(in_oklab,var(--primary)_34%,var(--inlay))]",
  "bg-[color-mix(in_oklab,var(--identity-2)_24%,var(--inlay))]",
  "bg-[color-mix(in_oklab,var(--identity-4)_28%,var(--inlay))]",
  "bg-[color-mix(in_oklab,var(--success)_28%,var(--inlay))]",
];
/** A step never shrinks below a week when dragged. */
const MIN_DAYS = 7;

type Moment = "midYearCheckInOn" | "selfReviewsDueOn" | "calibrationOn";
const MOMENTS: Moment[] = ["midYearCheckInOn", "selfReviewsDueOn", "calibrationOn"];

/**
 * Setting up a year (D-91): one page whose object is the year. Its name, prefilled a year on; the year drawn with its
 * steps, dragged on it or picked in the fields below (D-81), last year's steps ghosted under it, public holidays on it
 * (D-92) and a one-click move when a moment lands on a day off; then who's in from Core HR, what comes along and what
 * people see the day it launches. Kept as a draft (nobody is told) or launched onto the Year (D-84).
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

function SetUp({ setup }: { setup: YearSetupDto }) {
  const t = useTranslations("year.YearSetup");
  const phaseWord = useTranslations("year.phase");
  const locale = useLocale();
  const router = useRouter();
  const save = useSaveYear();
  const launch = useLaunchYear();
  const [year, setYear] = useState<YearPlanDto>(setup.year);
  const [busy, setBusy] = useState<"draft" | "launch" | null>(null);
  const days = useDaysOff(year.startDate, year.endDate);
  const long = dateFormatter({ day: "numeric", month: "long", year: "numeric" }, locale);
  const longDay = (iso: string) => long.format(new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));

  const steps = stepsOf(year);
  const set = (patch: Partial<YearPlanDto>) => setYear((current) => ({ ...current, ...patch }));
  const moveEnd = (index: number, iso: string) => set(index === 0 ? { planningEndsOn: iso } : index === 1 ? { reviewOpensOn: iso } : { resultsOutOn: iso });

  // Every dated moment, where it falls; a moment on a day off is caught with a one-click move.
  const pins = [
    { key: "goalsAgreed", label: t("moment.goalsAgreed"), on: year.planningEndsOn, apply: (iso: string) => set({ planningEndsOn: iso }) },
    ...MOMENTS.filter((m) => year[m]).map((m) => ({ key: m, label: t(`moment.${m}`), on: year[m]!, apply: (iso: string) => set({ [m]: iso }) })),
    { key: "resultsOut", label: t("moment.resultsOut"), on: year.resultsOutOn, apply: (iso: string) => set({ resultsOutOn: iso }) },
  ].sort((a, b) => a.on.localeCompare(b.on));
  const offDays = pins.filter((pin) => days.isOff(pin.on));

  const persist = async () => {
    const saved = await save.mutateAsync({
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
    return saved;
  };

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
  const named = year.name.trim().length > 0;

  return (
    <PageContainer>
      <div className="grid max-w-[1160px] gap-[18px]">
        <div className="flex flex-wrap items-end gap-3 pt-2">
          <div className="grid gap-1">
            <h1 className="type-display text-foreground">{t("title", { name: year.name.trim() || setup.year.name })}</h1>
            <span className="text-sm text-muted-foreground">{t("dates", { start: longDay(year.startDate), end: longDay(year.endDate) })}</span>
          </div>
          <div className="ms-auto flex items-center gap-2">
            <AsyncButton variant="ghost" pending={busy === "draft"} disabled={busy !== null || !named} onClick={() => void keepDraft()}>
              {t("keepDraft")}
            </AsyncButton>
            <AsyncButton writes pending={busy === "launch"} disabled={busy !== null || blocked || !named} onClick={() => void launchYear()}>
              <Rocket aria-hidden className="size-4" />
              {t("launch", { name: year.name.trim() || setup.year.name })}
            </AsyncButton>
          </div>
        </div>
        {blocked ? (
          <p className="-mt-2 text-end text-[13px] text-muted-foreground">{t("lastYearRunning", { name: setup.lastYearName ?? "" })}</p>
        ) : null}

        <section className="grid gap-[18px] rounded-surface bg-card px-6 pb-5 pt-[22px]">
          <div className="flex flex-wrap items-center gap-4">
            <Input aria-label={t("yearName")} value={year.name} maxLength={200} onChange={(event) => set({ name: event.target.value })}
              className="h-9 w-[180px]" />
            <span className="ms-auto flex items-center gap-4">
              {days.holidays.length > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span aria-hidden className="size-[7px] rounded-full bg-muted-foreground" />
                  {t("publicHolidays")}
                </span>
              ) : null}
              {setup.lastYear ? <span className="text-xs text-muted-foreground">{t("aYearOn", { name: setup.lastYearName ?? "" })}</span> : null}
            </span>
          </div>

          <YearCalendar year={year} steps={steps} pins={pins} holidays={days.holidays} isOff={days.isOff}
            lastYear={setup.lastYear} lastYearName={setup.lastYearName} onMoveEnd={moveEnd} />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <div key={step.phase} className="grid min-w-0 gap-1.5">
                <span className="flex items-center text-[13px] font-medium text-foreground">
                  <i aria-hidden className={cn("me-[7px] inline-block size-[9px] rounded-[3px]", STEP_TONE[index])} />
                  {phaseWord(step.phase)}
                  <span className="ms-auto text-xs font-normal tabular-nums text-muted-foreground">{t("from", { day: dayMonth(step.start, locale) })}</span>
                </span>
                <div className="flex min-w-0 items-center">
                  {index < steps.length - 1 ? (
                    <DatePicker aria-label={t("stepEnds", { step: phaseWord(step.phase) })} value={step.end} className="min-w-0"
                      min={addDays(step.start, MIN_DAYS)} max={addDays(steps[index + 1]!.end, -MIN_DAYS)} onChange={(iso) => moveEnd(index, iso)} />
                  ) : (
                    <span className="flex h-9 flex-1 items-center gap-2 rounded-control bg-field px-3 text-sm tabular-nums text-foreground">
                      <CalendarIcon aria-hidden className="size-4 text-muted-foreground" />
                      {fullDay(step.end, locale)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {offDays.map((pin) => {
            const to = days.nextWorkingDay(pin.on);
            const holiday = days.holidayBetween(pin.on, to);
            return (
              <div key={pin.key} className="flex flex-wrap items-center gap-3 rounded-inset bg-inlay px-3.5 py-2.5 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
                <TriangleAlert aria-hidden className="size-[17px] text-warning" />
                <span className="text-sm">
                  <b className="font-semibold">{t("fallsOn", { moment: pin.label, day: day(pin.on, locale) })}</b>
                  {holiday ? <span className="text-muted-foreground">{t("andHoliday", { day: dayMonth(holiday.date, locale), holiday: holiday.name })}</span> : null}
                </span>
                <Button size="sm" variant="outline" className="ms-auto" onClick={() => pin.apply(to)}>{t("moveTo", { day: day(to, locale) })}</Button>
              </div>
            );
          })}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {MOMENTS.map((moment) => (
              <div key={moment} className="grid gap-1.5">
                <span className="text-[13px] font-medium text-foreground">{t(`moment.${moment}`)}</span>
                <DatePicker aria-label={t(`moment.${moment}`)} value={year[moment] ?? ""} min={year.startDate} max={year.endDate}
                  onChange={(iso) => set({ [moment]: iso })} />
              </div>
            ))}
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium text-foreground">{t("everyoneTold")}</span>
              <span className="flex h-9 items-center gap-2 rounded-control bg-field px-3 text-sm text-muted-foreground">
                <Bell aria-hidden className="size-4" />
                {t("whenYouLaunch")}
              </span>
            </div>
          </div>
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

// ── The year, drawn ───────────────────────────────────────────────────────────────────────────────

interface Step { phase: CyclePhase; start: string; end: string }
interface Pin { key: string; label: string; on: string }

function stepsOf(year: YearPlanDto): Step[] {
  const ends = [year.planningEndsOn, year.reviewOpensOn, year.resultsOutOn, year.endDate];
  return PHASES.map((phase, i) => ({ phase, start: i === 0 ? year.startDate : ends[i - 1]!, end: ends[i]! }));
}

function YearCalendar({ year, steps, pins, holidays, isOff, lastYear, lastYearName, onMoveEnd }: {
  year: YearPlanDto;
  steps: Step[];
  pins: Pin[];
  holidays: Holiday[];
  isOff: (iso: string) => boolean;
  lastYear: YearPlanDto | null;
  lastYearName: string | null;
  onMoveEnd: (index: number, iso: string) => void;
}) {
  const t = useTranslations("year.YearSetup");
  const phaseWord = useTranslations("year.phase");
  const locale = useLocale();
  const track = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const span = Math.max(1, daysBetween(year.startDate, year.endDate));
  const pos = (iso: string) => Math.max(0, Math.min(100, (daysBetween(year.startDate, iso) / span) * 100));
  const monthName = dateFormatter({ month: "short" }, locale);
  const months = monthStarts(year.startDate, year.endDate);

  // Pins stack in up to three rows so their words never overlap.
  const lanes: [number, number][][] = [[], [], []];
  const placed = pins.map((pin) => {
    const at = pos(pin.on);
    const width = (pin.label.length * 0.62 + 2) * (100 / 110);
    const anchor = at < 12 ? "start" : at > 85 ? "end" : "center";
    const left = anchor === "start" ? at : anchor === "end" ? at - width : at - width / 2;
    let lane = 0;
    while (lane < 2 && lanes[lane]!.some(([a, b]) => left < b + 1 && left + width > a - 1)) lane++;
    lanes[lane]!.push([left, left + width]);
    return { ...pin, at, anchor, lane };
  });

  const dateAt = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect();
    const share = (document.dir === "rtl" ? rect.right - clientX : clientX - rect.left) / rect.width;
    return addDays(year.startDate, Math.round(Math.max(0, Math.min(1, share)) * span));
  };
  const clampEnd = (index: number, iso: string) => {
    const min = addDays(steps[index]!.start, MIN_DAYS);
    const max = addDays(steps[index + 1]!.end, -MIN_DAYS);
    return iso < min ? min : iso > max ? max : iso;
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    if (dragging === null) return;
    onMoveEnd(dragging, clampEnd(dragging, dateAt(event.clientX)));
  };
  const onKey = (index: number, key: string) => {
    const delta = key === "ArrowRight" || key === "ArrowUp" ? 1 : key === "ArrowLeft" || key === "ArrowDown" ? -1 : 0;
    if (delta) onMoveEnd(index, clampEnd(index, addDays(steps[index]!.end, delta * (document.dir === "rtl" ? -1 : 1))));
  };

  return (
    <div className="grid gap-2" onPointerMove={onPointerMove} onPointerUp={() => setDragging(null)} onPointerCancel={() => setDragging(null)}>
      <div className="relative h-[62px]" aria-hidden>
        {placed.map((pin) => {
          const off = isOff(pin.on);
          return (
            <span key={pin.key} title={`${pin.label}, ${day(pin.on, locale)}`}
              className={cn("absolute bottom-0 flex flex-col gap-[3px]",
                pin.anchor === "center" ? "-translate-x-1/2 items-center" : pin.anchor === "start" ? "items-start" : "-translate-x-full items-end")}
              style={{ insetInlineStart: `${pin.at}%` }}>
              <em className={cn("inline-flex items-center gap-[5px] whitespace-nowrap text-xs font-semibold not-italic", off ? "text-warning" : "text-foreground")}>
                {off ? <TriangleAlert className="size-[13px]" /> : null}
                {pin.label}
              </em>
              <i className={cn("w-0.5 rounded-sm", off ? "bg-warning" : "bg-foreground/60")} style={{ height: `${8 + pin.lane * 19}px` }} />
            </span>
          );
        })}
      </div>
      <div className="relative">
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {months.map((month) => (
            <span key={month} className="absolute inset-y-0 flex items-end whitespace-nowrap ps-1.5 text-[11.5px] text-muted-foreground" style={{ insetInlineStart: `${pos(month)}%` }}>
              <i className="absolute inset-y-0 start-0 w-px bg-border" />
              {monthName.format(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1))}
              {month.slice(5, 7) === "01" ? <b className="ms-1 font-semibold text-foreground">{month.slice(0, 4)}</b> : null}
            </span>
          ))}
        </div>
        <div ref={track} className="relative z-[1] flex h-14 gap-[3px]">
          {steps.map((step, index) => {
            const width = pos(step.end) - pos(step.start);
            return (
              <div key={step.phase} title={t("stepSpan", { step: phaseWord(step.phase), start: dayMonth(step.start, locale), end: dayMonth(step.end, locale) })}
                className={cn("flex h-full flex-col justify-center overflow-hidden whitespace-nowrap rounded-xl px-3 leading-tight", STEP_TONE[index],
                  dragging === null && "transition-[width] duration-150")}
                style={{ width: `calc(${width}% - 3px)` }}>
                {width >= 7 ? (
                  <>
                    <span className="text-[13px] font-semibold text-foreground">{phaseWord(step.phase)}</span>
                    <small className="text-[11.5px] font-medium text-muted-foreground">{t("days", { count: daysBetween(step.start, step.end) })}</small>
                  </>
                ) : null}
              </div>
            );
          })}
          {steps.slice(0, -1).map((step, index) => (
            <span key={step.phase} role="slider" tabIndex={0} aria-label={t("stepEnds", { step: phaseWord(step.phase) })}
              aria-valuetext={dayMonth(step.end, locale)} aria-valuemin={0} aria-valuemax={span} aria-valuenow={daysBetween(year.startDate, step.end)}
              onPointerDown={(event) => { event.preventDefault(); (event.target as HTMLElement).setPointerCapture?.(event.pointerId); setDragging(index); }}
              onKeyDown={(event) => onKey(index, event.key)}
              className="absolute -inset-y-1.5 z-[2] -ms-2 grid w-4 cursor-ew-resize touch-none place-items-center outline-none before:h-full before:w-1.5 before:rounded before:bg-foreground before:shadow-[0_0_0_2px_var(--card)] focus-visible:before:ring-2 focus-visible:before:ring-primary"
              style={{ insetInlineStart: `${pos(step.end)}%` }} />
          ))}
        </div>
        <div className="relative h-3" aria-hidden>
          {holidays.map((holiday) => (
            <span key={holiday.date} title={`${holiday.name}, ${day(holiday.date, locale)}`}
              className="absolute top-1 z-[1] -ms-[3.5px] size-[7px] rounded-full bg-muted-foreground" style={{ insetInlineStart: `${pos(holiday.date)}%` }} />
          ))}
        </div>
        <div className="h-4" />
      </div>
      {lastYear ? (
        <div className="mt-0.5 grid gap-1" aria-hidden>
          <span className="text-[11.5px] text-muted-foreground">{lastYearName}</span>
          <div className="relative h-[9px]">
            {stepsOf(lastYear).map((step) => {
              const start = pos(addYears(step.start)), end = pos(addYears(step.end));
              return <span key={step.phase} className="absolute inset-y-0 rounded shadow-[inset_0_0_0_1.5px_var(--border)]" style={{ insetInlineStart: `${start}%`, width: `calc(${end - start}% - 3px)` }} />;
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Beside it ─────────────────────────────────────────────────────────────────────────────────────

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-4 rounded-surface bg-card px-6 py-[22px]">
      <div className="flex items-center gap-3">
        <h2 className="type-title text-foreground">{title}</h2>
        {aside ? <span className="ms-auto text-xs text-muted-foreground">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

function WhosIn({ setup, year, joinersJoin, onJoiners }: { setup: YearSetupDto; year: YearPlanDto; joinersJoin: boolean; onJoiners: (value: boolean) => void }) {
  const t = useTranslations("year.YearSetup");
  const locale = useLocale();
  const more = setup.peopleCount - setup.people.length;
  return (
    <Card title={t("whosIn")} aside={t("fromCoreHr")}>
      <div className="flex flex-wrap items-center gap-1.5">
        {setup.people.map((person) => <PersonInitials key={person.employeeId} name={person.name} size="md" />)}
        {more > 0 ? <span className="ms-1 text-[12.5px] text-muted-foreground">{t("andMore", { count: more })}</span> : null}
      </div>
      <div className="grid">
        <div className="grid gap-1.5 py-[11px]">
          <span className="text-sm">{t("everyoneOn", { day: dayMonth(year.startDate, locale) })}</span>
          <b className="text-sm font-semibold tabular-nums">{t("people", { count: setup.peopleCount })}</b>
        </div>
        <div className="grid gap-1.5 border-t border-border py-[11px]">
          <span className="text-sm">{t("joiners")}</span>
          <Segmented size="sm" className="justify-self-start" label={t("joiners")} value={joinersJoin ? "in" : "next"}
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
                className="-mx-2 flex items-center gap-2.5 rounded-xl px-2 py-[7px] text-start transition-colors hover:bg-inlay">
                <span className={cn("grid size-5 shrink-0 place-items-center rounded-md", kept ? "bg-primary text-primary-foreground" : "shadow-[inset_0_0_0_1.5px_var(--border)]")}>
                  {kept ? <Check aria-hidden className="size-3.5" /> : null}
                </span>
                <span className="grid">
                  <span className={cn("text-[14.5px] font-medium", kept ? "text-foreground" : "text-muted-foreground line-through")}>{goal.title}</span>
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
    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Settings aria-hidden className="size-[15px]" />
      {t("settingsAsTheyAre")}
      <Link href="/settings" className="font-medium text-foreground underline-offset-4 hover:underline">{t("settings")}</Link>
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
          <span className="text-[19px] font-semibold leading-tight tracking-[-0.01em] text-foreground">{t("writeGoals", { name: year.name.trim() || setup.year.name })}</span>
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

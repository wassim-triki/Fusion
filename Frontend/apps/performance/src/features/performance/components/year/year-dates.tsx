"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { CyclePhase, YearPlanDto } from "@repo/api";
import { cn } from "@repo/ds";
import { dateFormatter, formatDate } from "@repo/ds/lib/dates";
import { CalendarDays, TriangleAlert } from "@repo/ds/icons";
import { day, daysBetween } from "./year-words";

/** The year's dated moments in order: its first day, Planning's end, the moments within, results out, its last day. */
export type MomentKey =
  | "startDate" | "planningEndsOn" | "midYearCheckInOn" | "reviewOpensOn" | "selfReviewsDueOn" | "calibrationOn" | "resultsOutOn" | "endDate";
export const ORDER: MomentKey[] = [
  "startDate", "planningEndsOn", "midYearCheckInOn", "reviewOpensOn", "selfReviewsDueOn", "calibrationOn", "resultsOutOn", "endDate",
];
/** The year's own dates are set where it starts and ends, not here. */
const FIXED = new Set<MomentKey>(["startDate", "endDate"]);
const STEPS: { phase: CyclePhase; from: MomentKey; to: MomentKey; rows: MomentKey[] }[] = [
  { phase: "Planning", from: "startDate", to: "planningEndsOn", rows: ["startDate", "planningEndsOn"] },
  { phase: "Execution", from: "planningEndsOn", to: "reviewOpensOn", rows: ["midYearCheckInOn"] },
  { phase: "Review", from: "reviewOpensOn", to: "resultsOutOn", rows: ["reviewOpensOn", "selfReviewsDueOn", "calibrationOn"] },
  { phase: "ResultsOut", from: "resultsOutOn", to: "endDate", rows: ["resultsOutOn", "endDate"] },
];
const WORD = {
  startDate: "yearStarts",
  planningEndsOn: "goalsAgreed",
  midYearCheckInOn: "midYearCheckInOn",
  reviewOpensOn: "reviewsOpen",
  selfReviewsDueOn: "selfReviewsDueOn",
  calibrationOn: "calibrationOn",
  resultsOutOn: "resultsOut",
  endDate: "yearEnds",
} as const satisfies Record<MomentKey, string>;

export interface Holiday { date: string; name: string }
export interface DaysOff {
  holidays: Holiday[];
  /** Not one of the company's working weekdays. */
  isRestDay: (iso: string) => boolean;
  isOff: (iso: string) => boolean;
  nextWorkingDay: (iso: string) => string;
}

export const on = (year: YearPlanDto, key: MomentKey): string => year[key] ?? year.startDate;

/** A moment kept strictly between the ones either side of it. */
export function clampMoment(year: YearPlanDto, key: MomentKey, iso: string): string {
  const i = ORDER.indexOf(key);
  const lo = addDays(on(year, ORDER[i - 1]!), 1);
  const hi = addDays(on(year, ORDER[i + 1]!), -1);
  return iso < lo ? lo : iso > hi ? hi : iso;
}

/** The first moment (not the year's own dates) on a weekend or a public holiday. */
export function firstOffMoment(year: YearPlanDto, days: DaysOff): MomentKey | null {
  return ORDER.find((key) => !FIXED.has(key) && days.isOff(on(year, key))) ?? null;
}

/**
 * The year's dates (D-103): a row per dated moment grouped by step, each with its name, a date button that opens its
 * month and the ones either side in place, a lane on the year's months where the moment is dragged, and last year's
 * date beside it. A moment on a day off is caught in one line under the rows, its button naming the move.
 */
export function YearDates({ year, lastYear, lastYearName, days, onMove, onPick }: {
  year: YearPlanDto;
  lastYear: YearPlanDto | null;
  lastYearName: string | null;
  days: DaysOff;
  /** Dragged along a lane: no word, the dot says it. */
  onMove: (key: MomentKey, iso: string) => void;
  /** Picked on a month or moved off a day off: said with an undo. */
  onPick: (key: MomentKey, iso: string) => void;
}) {
  const t = useTranslations("year.YearSetup");
  const phaseWord = useTranslations("year.phase");
  const locale = useLocale();
  const [open, setOpen] = useState<MomentKey | null>(null);
  const drag = useRef<{ key: MomentKey; rect: DOMRect } | null>(null);
  const start = year.startDate, end = year.endDate;
  const span = Math.max(1, daysBetween(start, end));
  const pos = (iso: string) => Math.max(0, Math.min(100, (daysBetween(start, iso) / span) * 100));
  const monthName = dateFormatter({ month: "short" }, locale);
  const name = (key: MomentKey) => t(`moment.${WORD[key]}`);
  const lastOf = (key: MomentKey) => (lastYear && !FIXED.has(key) ? lastYear[key] : null);
  const holidaysIn = days.holidays.filter((h) => h.date > start && h.date < end);

  const dateAt = (clientX: number, rect: DOMRect) => {
    const share = (document.dir === "rtl" ? rect.right - clientX : clientX - rect.left) / rect.width;
    return addDays(start, Math.round(Math.max(0, Math.min(1, share)) * span));
  };
  const grab = (key: MomentKey) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      drag.current = { key, rect: event.currentTarget.parentElement!.getBoundingClientRect() };
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (current) onMove(key, clampMoment(year, key, dateAt(event.clientX, current.rect)));
    },
    onPointerUp: () => { drag.current = null; },
    onPointerCancel: () => { drag.current = null; },
  });

  const offKey = firstOffMoment(year, days);
  const warning = (() => {
    if (!offKey) return null;
    const at = on(year, offKey);
    const to = clampMoment(year, offKey, days.nextWorkingDay(at));
    const holiday = days.holidays.find((h) => h.date === at);
    const between = days.holidays.find((h) => h.date > at && h.date < to);
    const why = days.isRestDay(at) ? t("aWeekday", { weekday: dateFormatter({ weekday: "long" }, locale).format(new Date(`${at}T00:00:00`)) }) : holiday?.name ?? "";
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-inset bg-inlay py-2.5 pe-3 ps-4 text-[13.5px] animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
        <TriangleAlert aria-hidden className="size-[18px] text-warning" />
        <span>
          <b className="font-semibold">{t("landsOn", { moment: name(offKey), day: day(at, locale) })}</b>
          <span className="text-muted-foreground">
            , {why}{between ? t("andHoliday", { day: day(between.date, locale), holiday: between.name }) : null}
          </span>
        </span>
        {to !== at && !days.isOff(to) ? (
          <button type="button" onClick={() => onPick(offKey, to)}
            className="ms-auto inline-flex h-8 items-center rounded-control bg-primary px-3 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
            {t("moveMoment", { moment: name(offKey), day: day(to, locale) })}
          </button>
        ) : null}
      </div>
    );
  })();

  const row = "grid min-h-11 grid-cols-[190px_170px_minmax(0,1fr)_150px] items-center gap-4";
  return (
    <div className="grid gap-5">
      <div className="grid">
        <div className={cn(row, "min-h-[22px]")} aria-hidden>
          <span /><span />
          <div className="relative h-4">
            {monthStarts(start, end).map((month) => (
              <span key={month} className="absolute -translate-x-1/2 text-[11.5px] text-muted-foreground rtl:translate-x-1/2" style={{ insetInlineStart: `${pos(month)}%` }}>
                {monthName.format(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1))}
              </span>
            ))}
          </div>
          <span className="text-[12.5px] text-muted-foreground">{lastYearName}</span>
        </div>

        {STEPS.map((step) => (
          <div key={step.phase} className="grid">
            <div className={cn(row, "min-h-[30px] pt-2.5")}>
              <span>
                <b className="text-sm font-semibold">{phaseWord(step.phase)}</b>
                <small className="ms-1.5 text-[12.5px] text-muted-foreground">{t("days", { count: daysBetween(on(year, step.from), on(year, step.to)) })}</small>
              </span>
            </div>
            {step.rows.map((key) => {
              const at = on(year, key);
              const fixed = FIXED.has(key);
              const bad = !fixed && days.isOff(at);
              const isOpen = open === key;
              const last = lastOf(key);
              return (
                <div key={key} className="grid">
                  <div className={row}>
                    <span className="text-[13.5px]">{name(key)}</span>
                    {fixed ? (
                      <span className="text-[13.5px] font-medium tabular-nums text-muted-foreground">{dayYear(at, locale)}</span>
                    ) : (
                      <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)}
                        className={cn("inline-flex h-[34px] items-center gap-2 justify-self-start rounded-control bg-inlay px-3 text-[13.5px] font-semibold tabular-nums outline-none",
                          "shadow-[inset_0_0_0_1px_var(--border)] hover:shadow-[inset_0_0_0_1.5px_var(--primary)] focus-visible:shadow-[inset_0_0_0_1.5px_var(--primary)]",
                          isOpen && "shadow-[inset_0_0_0_1.5px_var(--primary)]", bad && "text-warning")}>
                        {bad ? <TriangleAlert aria-hidden className="size-[15px]" /> : <CalendarDays aria-hidden className="size-[15px]" />}
                        {dayYear(at, locale)}
                      </button>
                    )}
                    <div className="relative h-[26px]">
                      <span aria-hidden className="absolute top-[9px] h-2 rounded-[3px] bg-inlay"
                        style={{ insetInlineStart: `${pos(on(year, step.from))}%`, width: `${pos(on(year, step.to)) - pos(on(year, step.from))}%` }} />
                      {holidaysIn.map((h) => (
                        <i key={h.date} title={`${h.name}, ${day(h.date, locale)}`}
                          className="absolute top-5 -ms-0.5 size-1 rounded-full bg-[color-mix(in_oklab,var(--warning)_70%,transparent)]" style={{ insetInlineStart: `${pos(h.date)}%` }} />
                      ))}
                      {fixed ? null : (
                        <span role="slider" tabIndex={0} aria-label={t("dragAlong", { moment: name(key) })} aria-valuetext={day(at, locale)}
                          aria-valuemin={0} aria-valuemax={span} aria-valuenow={daysBetween(start, at)} title={t("dragAlongTitle")}
                          {...grab(key)}
                          onKeyDown={(event) => {
                            const by = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
                            if (!by) return;
                            event.preventDefault();
                            onMove(key, clampMoment(year, key, addDays(at, by * (document.dir === "rtl" ? -1 : 1))));
                          }}
                          className={cn("absolute top-1.5 -ms-[7px] size-3.5 cursor-ew-resize touch-none rounded-full shadow-[0_0_0_3px_var(--card)] outline-none focus-visible:ring-2 focus-visible:ring-primary",
                            bad ? "bg-warning" : "bg-primary")}
                          style={{ insetInlineStart: `${pos(at)}%` }} />
                      )}
                    </div>
                    <span className="text-[12.5px] tabular-nums text-muted-foreground">{last ? day(last, locale) : null}</span>
                  </div>
                  {isOpen ? (
                    <div className="ms-[206px] grid grid-cols-3 gap-4 pb-3.5 pt-1.5 animate-in fade-in-0 slide-in-from-top-1 duration-200">
                      {[-1, 0, 1].map((offset) => (
                        <Month key={offset} month={shiftMonth(at, offset)} year={year} lastYear={lastYear} selected={key} days={days} name={name}
                          onPick={(iso) => onPick(key, iso)} onSelect={(other) => setOpen(other)} />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {warning}
    </div>
  );
}

/** One month as a grid of days: the year's moments on it, last year's a year on as outlines, days off marked. */
function Month({ month, year, lastYear, selected, days, name, onPick, onSelect }: {
  month: string;
  year: YearPlanDto;
  lastYear: YearPlanDto | null;
  selected: MomentKey;
  days: DaysOff;
  name: (key: MomentKey) => string;
  onPick: (iso: string) => void;
  onSelect: (key: MomentKey) => void;
}) {
  const t = useTranslations("year.YearSetup");
  const locale = useLocale();
  const first = `${month}-01`;
  const count = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const at = new Map(ORDER.map((key) => [on(year, key), key] as const));
  const lastAt = new Map(lastYear ? ORDER.filter((key) => !FIXED.has(key) && lastYear[key]).map((key) => [aYearOn(lastYear[key]!), key] as const) : []);
  const weekdays = Array.from({ length: 7 }, (_, i) => dateFormatter({ weekday: "narrow" }, locale).format(new Date(Date.UTC(2024, 0, 1 + i))));
  const heading = dateFormatter({ month: "long" }, locale).format(new Date(`${first}T00:00:00`));
  return (
    <div className="grid content-start gap-1">
      <span className="ps-0.5 text-[12.5px] font-semibold">
        {heading}<b className="ms-1 font-medium text-muted-foreground">{month.slice(0, 4)}</b>
      </span>
      <div className="grid grid-cols-7 gap-0.5">
        {weekdays.map((w, i) => <span key={i} aria-hidden className="h-3.5 text-center text-[9.5px] text-muted-foreground">{w}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`l${i}`} />)}
        {Array.from({ length: count }, (_, i) => {
          const iso = `${month}-${String(i + 1).padStart(2, "0")}`;
          const moment = at.get(iso);
          const last = lastAt.get(iso);
          const holiday = days.holidays.find((h) => h.date === iso);
          const outside = iso < year.startDate || iso > year.endDate;
          const rest = days.isRestDay(iso);
          const bad = moment && !FIXED.has(moment) && days.isOff(iso);
          const pickable = !moment && !outside && !days.isOff(iso) && clampMoment(year, selected, iso) === iso;
          const tip = [moment ? `${name(moment)}, ${day(iso, locale)}` : null, holiday?.name,
            last ? t("lastYearsOn", { moment: name(last), day: day(lastYear![last]!, locale) }) : null].filter(Boolean).join(" · ");
          const act = moment && !FIXED.has(moment) ? () => onSelect(moment) : pickable ? () => onPick(iso) : undefined;
          return (
            <button key={iso} type="button" tabIndex={act ? 0 : -1} onClick={act} title={tip || undefined} disabled={!act}
              aria-label={`${day(iso, locale)}${tip ? `, ${tip}` : ""}`}
              className={cn("relative grid h-[22px] place-items-center rounded-[7px] text-[11px] tabular-nums text-foreground outline-none disabled:cursor-default",
                outside && "text-[color-mix(in_oklab,var(--muted-foreground)_40%,transparent)]",
                rest && !moment && "bg-[repeating-linear-gradient(135deg,transparent_0_3px,color-mix(in_oklab,var(--muted-foreground)_9%,transparent)_3px_4px)] text-[color-mix(in_oklab,var(--muted-foreground)_75%,transparent)]",
                holiday && "text-muted-foreground after:absolute after:bottom-0.5 after:size-1 after:rounded-full after:bg-warning",
                pickable && "cursor-pointer hover:bg-[color-mix(in_oklab,var(--primary)_18%,var(--inlay))] focus-visible:bg-[color-mix(in_oklab,var(--primary)_18%,var(--inlay))]",
                last && "shadow-[inset_0_0_0_1.25px_color-mix(in_oklab,var(--muted-foreground)_70%,transparent)]",
                last === selected && "shadow-[inset_0_0_0_1.5px_var(--foreground)]",
                moment && "cursor-pointer bg-[color-mix(in_oklab,var(--primary)_30%,var(--inlay))] font-bold",
                moment && bad && "bg-[color-mix(in_oklab,var(--warning)_35%,var(--inlay))]",
                moment === selected && (bad ? "bg-warning text-card" : "bg-primary text-primary-foreground"))}>
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** "Wed 26 May 2027": a date button always says its year. */
function dayYear(iso: string, locale: string): string {
  return formatDate(iso, { weekday: true, year: "always", locale });
}

export function addDays(iso: string, count: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

/** Last year's date as it falls in this one. */
function aYearOn(iso: string): string {
  return `${Number(iso.slice(0, 4)) + 1}${iso.slice(4)}`;
}

/** "2028-04" moved by whole months. */
function shiftMonth(iso: string, by: number): string {
  return new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1 + by, 1)).toISOString().slice(0, 7);
}

function monthStarts(start: string, end: string): string[] {
  const out: string[] = [];
  for (let i = 1; i <= 13; i++) {
    const iso = `${shiftMonth(start, i)}-01`;
    if (iso >= end) break;
    out.push(iso);
  }
  return out;
}

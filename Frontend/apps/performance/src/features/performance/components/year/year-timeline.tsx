"use client";

import type { CyclePhase, YearStepDto } from "@repo/api";
import { cn } from "@repo/ds";
import { dateFormatter } from "@repo/ds/lib/dates";
import { useLocale, useTranslations } from "next-intl";
import { dayMonth, daysBetween } from "./year-words";

/** Where an ISO date sits along the year, 0 to 1. */
export function yearPosition(start: string, end: string, iso: string): number {
  const span = Math.max(1, daysBetween(start, end));
  return Math.max(0, Math.min(1, daysBetween(start, iso) / span));
}

/**
 * The year as a timeline (D-44): its four steps sized by their dates, filled up to today, the current one lit, today
 * marked, the months below. During a preview (D-58) the steps come redrawn with the new dates.
 */
export function YearTimeline({
  start,
  end,
  today,
  steps,
  current,
}: {
  start: string;
  end: string;
  today: string;
  steps: YearStepDto[];
  current: CyclePhase | null;
}) {
  const t = useTranslations("year.YearTimeline");
  const phaseWord = useTranslations("year.phase");
  const locale = useLocale();
  const pos = (iso: string) => yearPosition(start, end, iso);
  const span = Math.max(1, daysBetween(start, end));
  const at = pos(today);
  const months = monthStarts(start, end);
  const monthName = dateFormatter({ month: "short" }, locale);
  const monthLabel = (iso: string) => {
    const date = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, 1);
    return iso.slice(5, 7) === "01" ? `${monthName.format(date)} ${iso.slice(0, 4)}` : monthName.format(date);
  };

  return (
    <div className="relative pt-1" aria-label={t("label")}>
      <div className="relative h-[26px]">
        {steps.map((step, index) => {
          const last = index === steps.length - 1;
          const on = step.phase === current;
          const next = steps[index + 1];
          if (!last && !on && next && pos(next.start) - pos(step.start) < 0.07) return null;
          return (
            <span
              key={step.phase}
              className={cn("absolute top-0 whitespace-nowrap text-[13px]", on ? "font-semibold text-foreground" : "text-muted-foreground", last && "-translate-x-full")}
              style={{ insetInlineStart: `${(last ? 1 : pos(step.start)) * 100}%` }}
            >
              {phaseWord(step.phase)}
            </span>
          );
        })}
      </div>
      <div className="relative flex h-3 gap-[3px]">
        {steps.map((step) => {
          const width = (Math.max(1, daysBetween(step.start, step.end)) / span) * 100;
          const fill = step.state === "Done" ? 100 : step.state === "Ahead" ? 0
            : Math.max(0, Math.min(100, (daysBetween(step.start, today) / Math.max(1, daysBetween(step.start, step.end))) * 100));
          const on = step.phase === current;
          return (
            <div key={step.phase} className="relative h-full overflow-hidden rounded-full bg-inlay" style={{ width: `calc(${width}% - 2px)` }}>
              <i
                className={cn("absolute inset-y-0 start-0 block transition-[width] duration-700", on ? "bg-primary" : "bg-primary/45")}
                style={{ width: `${fill}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="absolute top-[30px] h-6 w-0 transition-[inset-inline-start] duration-700" style={{ insetInlineStart: `${at * 100}%` }}>
        <span aria-hidden className="absolute inset-y-0 -start-px w-0.5 rounded-full bg-foreground" />
        <span
          className="absolute top-[30px] start-0 whitespace-nowrap rounded-full bg-foreground px-[9px] py-0.5 text-xs font-semibold text-background"
          style={{ transform: `translateX(${at < 0.05 ? "-14px" : at > 0.95 ? "calc(-100% + 14px)" : "-50%"})` }}
        >
          {t("today", { day: dayMonth(today, locale) })}
        </span>
      </div>
      <div className="relative mt-10 h-4" aria-hidden>
        {months.map((month) => (
          <span key={month} className="absolute -translate-x-1/2 text-[11.5px] text-muted-foreground" style={{ insetInlineStart: `${pos(month) * 100}%` }}>
            {monthLabel(month)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The first day of each month inside the year, after its start. */
function monthStarts(start: string, end: string): string[] {
  const out: string[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7)); // the month after the start's, as a 1-based index
  for (let i = 0; i < 13; i++) {
    if (month === 12) { month = 0; year += 1; }
    month += 1;
    const iso = `${year}-${String(month).padStart(2, "0")}-01`;
    if (iso > end) break;
    out.push(iso);
  }
  return out;
}

/** The steps as a preview of moving the year on today redraws them: the current step ends today, the next starts today. */
export function movedSteps(steps: YearStepDto[], current: CyclePhase, today: string): YearStepDto[] {
  const index = steps.findIndex((step) => step.phase === current);
  return steps.map((step, i) =>
    i === index ? { ...step, end: today } : i === index + 1 ? { ...step, start: today, state: "Current" as const } : step,
  );
}

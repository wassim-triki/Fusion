import { addDays, dayAt, dayIndex } from "@/features/org-chart/model/org-chart-model";

/** The slider's reach: the company's first day, today, and the last planned day with a margin. */
export interface TimeSpan {
  lo: string;
  today: string;
  hi: string;
}

/** The past takes three quarters of the track, the planned months the last quarter. */
export const PAST_SHARE = 0.75;
const FUTURE_MIN_DAYS = 90;
const FUTURE_MARGIN_DAYS = 30;
const FUTURE_MAX_DAYS = 730;

export function timeSpan(first: string | null, today: string, planned: string[]): TimeSpan {
  const lo = first && first < today ? first : addDays(today, -365);
  const last = planned.reduce<string | null>((max, day) => (day > today && (!max || day > max) ? day : max), null);
  const wanted = last ? addDays(last, FUTURE_MARGIN_DAYS) : today;
  const min = addDays(today, FUTURE_MIN_DAYS);
  const cap = addDays(today, FUTURE_MAX_DAYS);
  const hi = wanted > min ? (wanted < cap ? wanted : cap) : min;
  return { lo, today, hi };
}

/** Where a day sits on the track, 0 to 1. */
export function toFraction(span: TimeSpan, day: string): number {
  const at = dayIndex(day);
  const lo = dayIndex(span.lo);
  const now = dayIndex(span.today);
  const hi = dayIndex(span.hi);
  if (at <= lo) return 0;
  if (at >= hi) return 1;
  if (at <= now) return now === lo ? PAST_SHARE : (PAST_SHARE * (at - lo)) / (now - lo);
  return PAST_SHARE + ((1 - PAST_SHARE) * (at - now)) / (hi - now);
}

/** The day at a point of the track, 0 to 1. */
export function fromFraction(span: TimeSpan, fraction: number): string {
  const f = Math.min(1, Math.max(0, fraction));
  const lo = dayIndex(span.lo);
  const now = dayIndex(span.today);
  const hi = dayIndex(span.hi);
  if (f <= PAST_SHARE) return dayAt(Math.round(lo + ((now - lo) * f) / PAST_SHARE));
  return dayAt(Math.round(now + ((hi - now) * (f - PAST_SHARE)) / (1 - PAST_SHARE)));
}

/**
 * Ticks along the track: every year's first day over a long past, every quarter's over a short one. Ticks too close
 * to today's mark are left out so its label stays readable.
 */
export function timeTicks(span: TimeSpan): string[] {
  const years = (dayIndex(span.today) - dayIndex(span.lo)) / 365;
  const [loYear] = span.lo.split("-").map(Number) as [number];
  const ticks: string[] = [];
  for (let year = loYear; ; year++) {
    for (const month of years >= 2 ? [1] : [1, 4, 7, 10]) {
      const day = `${year}-${String(month).padStart(2, "0")}-01`;
      if (day > span.hi) return ticks;
      if (day > span.lo && Math.abs(toFraction(span, day) - toFraction(span, span.today)) > 0.04) ticks.push(day);
    }
  }
}

/** Replay: from the company's first day to today, a quarter at a time (at most 40 steps). */
export function replayDays(span: TimeSpan): string[] {
  const steps: string[] = [span.lo];
  const [y, m] = span.lo.split("-").map(Number) as [number, number];
  for (let q = Math.floor((m - 1) / 3) * 3 + 3; ; q += 3) {
    const day = new Date(Date.UTC(y, q, 1)).toISOString().slice(0, 10);
    if (day >= span.today) break;
    steps.push(day);
  }
  steps.push(span.today);
  if (steps.length <= 40) return steps;
  const every = Math.ceil(steps.length / 40);
  return steps.filter((_, index) => index % every === 0 || index === steps.length - 1);
}

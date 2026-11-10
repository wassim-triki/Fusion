import { daysFromToday, formatDate, formatDateRange } from "@repo/ds/lib/dates";
import { english, type Say } from "@/i18n/say";

const BASE = "/performance";

/** A server path ("/performance/reviews/1") as a route inside this app ("/reviews/1"). */
export function appHref(href: string): string {
  return href === BASE ? "/" : href.startsWith(`${BASE}/`) || href.startsWith(`${BASE}?`) ? href.slice(BASE.length) : href;
}

const en = english("year.words");

/** "Sat 31 Oct" (the year outside this year). */
export function day(iso: string, locale?: string): string {
  return formatDate(iso.slice(0, 10), { weekday: true, locale });
}

/** "31 Oct" (the year outside this year). */
export function dayMonth(iso: string, locale?: string): string {
  return formatDate(iso.slice(0, 10), { locale });
}

/** "25 Apr 2026" — the year always. */
export function fullDay(iso: string, locale?: string): string {
  return formatDate(iso.slice(0, 10), { year: "always", locale });
}

/** "1 Oct – 31 Oct". */
export function dayRange(start: string, end: string, locale?: string): string {
  return formatDateRange(start, end, { omitYear: true, locale });
}

/** Whole days from today to an ISO date or instant (negative once past). */
export function daysFrom(iso: string, now: Date = new Date()): number {
  return daysFromToday(iso.slice(0, 10), now) ?? 0;
}

/** "today", "yesterday", "6 days ago". */
export function ago(iso: string, now: Date = new Date(), say: Say = en): string {
  const days = -daysFrom(iso, now);
  return days <= 0 ? say("today") : days === 1 ? say("yesterday") : say("daysAgo", { count: days });
}

export const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] ?? "";

/** Whole days between two ISO dates. */
export function daysBetween(a: string, b: string): number {
  const at = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round((at(b) - at(a)) / 864e5);
}

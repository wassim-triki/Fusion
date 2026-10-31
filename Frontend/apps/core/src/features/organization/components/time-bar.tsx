"use client";

import { useTranslations } from "next-intl";
import { Button, cn } from "@repo/ds";
import { useFormat } from "@repo/ds/lib/use-format";
import { Play, Square } from "lucide-react";
import { fromFraction, timeTicks, toFraction, type TimeSpan } from "../model/time";

const STEPS = 1000;
const pct = (fraction: number) => `${fraction * 100}%`;

/**
 * The Organization's one time slider: the past from the company's first day (three quarters of the track), the planned
 * months after today (dashed), each planned change marked on it. Replay walks from the first day to today.
 */
export function TimeBar({
  span, date, planned, people, replaying, onDate, onReplay,
}: {
  span: TimeSpan;
  date: string;
  /** Days with a planned change, and what happens on each. */
  planned: { day: string; title: string }[];
  /** Headcount on the date, when the viewer may read it. */
  people: number | null;
  replaying: boolean;
  onDate: (date: string) => void;
  onReplay: () => void;
}) {
  const t = useTranslations("organization.time");
  const format = useFormat();
  const at = toFraction(span, date);
  const now = toFraction(span, span.today);
  const shown = format.date(date, { year: "always" });
  const when = date === span.today ? t("today") : date < span.today ? t("past") : t("planned");
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_200px] items-center gap-5 rounded-surface bg-card px-5 pt-4 pb-3 max-lg:grid-cols-1">
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onReplay}
          // eslint-disable-next-line no-restricted-syntax -- the replay button toggles one thing on and off
          aria-pressed={replaying}
        >
          {replaying ? <Square /> : <Play />}
          {replaying ? t("stop") : t("replay")}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={date === span.today && !replaying} onClick={() => onDate(span.today)}>
          {t("todayButton")}
        </Button>
      </div>
      <div className="relative h-[46px]">
        <span aria-hidden className="absolute inset-x-0 top-3 h-1.5 rounded-full bg-inlay" />
        <span aria-hidden className="absolute inset-s-0 top-3 h-1.5 rounded-full bg-primary transition-[width] duration-300" style={{ width: pct(Math.min(at, now)) }} />
        <span
          aria-hidden
          className="absolute inset-e-0 top-3 h-1.5 rounded-full bg-[repeating-linear-gradient(90deg,var(--input)_0_5px,transparent_5px_9px)]"
          style={{ insetInlineStart: pct(now) }}
        />
        {planned.map((item) => (
          <i
            key={`${item.day}-${item.title}`}
            title={`${format.date(item.day)} · ${item.title}`}
            className="absolute top-2.5 size-2.5 -translate-x-1/2 rounded-full border-2 border-info bg-card rtl:translate-x-1/2"
            style={{ insetInlineStart: pct(toFraction(span, item.day)) }}
          />
        ))}
        <span aria-hidden className="absolute top-1 h-[22px] w-0.5 -translate-x-1/2 rounded-full bg-foreground rtl:translate-x-1/2" style={{ insetInlineStart: pct(now) }} />
        <span aria-hidden className="absolute inset-x-0 top-7 text-[11px] text-muted-foreground">
          {timeTicks(span).map((day) => (
            <span key={day} className="absolute -translate-x-1/2 tabular-nums rtl:translate-x-1/2" style={{ insetInlineStart: pct(toFraction(span, day)) }}>
              {day.endsWith("-01-01") ? day.slice(0, 4) : format.parts(day, { month: "short" })}
            </span>
          ))}
        </span>
        <input
          type="range"
          min={0}
          max={STEPS}
          value={Math.round(at * STEPS)}
          aria-label={t("asOf")}
          aria-valuetext={shown}
          onChange={(event) => onDate(fromFraction(span, Number(event.target.value) / STEPS))}
          className="peer absolute inset-x-0 top-0 h-[30px] w-full cursor-pointer opacity-0"
        />
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-[5px] size-5 -translate-x-1/2 rounded-full bg-primary shadow-[0_0_0_4px_var(--primary-tint)] rtl:translate-x-1/2",
            "peer-focus-visible:shadow-[0_0_0_4px_var(--primary-ring)]",
            !replaying && "transition-[inset-inline-start] duration-150"
          )}
          style={{ insetInlineStart: pct(at) }}
        />
      </div>
      <div className="text-end max-lg:text-start" aria-live="polite">
        <p className="type-meta text-muted-foreground">{when}</p>
        <p className="type-label font-semibold">{shown}</p>
        {people !== null ? <p className="type-meta text-muted-foreground">{t("people", { count: people })}</p> : null}
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarIcon } from "../../icons";
import { ar, fr } from "react-day-picker/locale";
import type { DateRange, Matcher } from "react-day-picker";

import { cn } from "../../lib/utils";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { formatDateParts } from "../../lib/dates";

/** A selected range in `YYYY-MM-DD` string space — the shape the API and native date inputs use. */
export interface DateRangeValue {
  from?: string;
  to?: string;
}

/**
 * A date-range picker composed from the DS Popover + Calendar primitives — the range sibling of
 * {@link DatePicker}. Works in `YYYY-MM-DD` string space so it drops in wherever the API already
 * speaks dates, without touching serialization, and parses/formats in local time so the day the
 * user picks is the day that is stored.
 *
 * The two ends move independently (B-399): once both are set, a day before the start moves the start, a day after
 * the end moves the end, and a day inside moves the nearer end. Nothing is cleared, and the popup stays open so both
 * ends can be adjusted.
 */
function DateRangePicker({
  value,
  onChange,
  onOpenChange,
  min,
  max,
  id,
  placeholder,
  "aria-label": ariaLabel,
  disabled,
  className,
  numberOfMonths = 2,
}: {
  "aria-label"?: string;
  value?: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  onOpenChange?: (open: boolean) => void;
  /** Inclusive lower bound as `YYYY-MM-DD`. */
  min?: string;
  /** Inclusive upper bound as `YYYY-MM-DD`. */
  max?: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  numberOfMonths?: number;
}) {
  const locale = useLocale();
  const t = useTranslations("ds.datePicker");
  const [open, setOpen] = React.useState(false);

  const from = parseISODate(value?.from);
  const to = parseISODate(value?.to);
  const minDate = parseISODate(min);
  const maxDate = parseISODate(max);

  const selected: DateRange | undefined = from ? { from, to } : undefined;

  const disabledMatchers: Matcher[] = [];
  if (minDate) disabledMatchers.push({ before: minDate });
  if (maxDate) disabledMatchers.push({ after: maxDate });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          aria-label={ariaLabel}
          type="button"
          variant="outline"
          disabled={disabled}
          data-empty={!from}
          className={cn(
            "justify-start text-start font-normal data-[empty=true]:text-muted-foreground",
            className
          )}
        >
          <CalendarIcon
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          {from ? formatRange(from, to, locale) : (placeholder ?? t("pick"))}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          captionLayout="dropdown"
          locale={locale === "fr" ? fr : locale === "ar" ? ar : undefined}
          autoFocus
          numberOfMonths={numberOfMonths}
          selected={selected}
          defaultMonth={from ?? minDate ?? undefined}
          startMonth={minDate ?? new Date(1900, 0, 1)}
          endMonth={maxDate ?? new Date(2200, 11, 31)}
          disabled={disabledMatchers.length > 0 ? disabledMatchers : undefined}
          onSelect={(_range: DateRange | undefined, day: Date) => {
            const next = moveEnd(from, to, day);
            onChange({ from: formatISODate(next.from), to: next.to && formatISODate(next.to) });
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** The range after a click on `day`: the first click sets the start, then each click moves one end, never clearing. */
function moveEnd(from: Date | undefined, to: Date | undefined, day: Date): { from: Date; to?: Date } {
  if (!from) return { from: day };
  if (!to) return day < from ? { from: day, to: from } : { from, to: day };
  if (day < from) return { from: day, to };
  if (day > to) return { from, to: day };
  return day.getTime() - from.getTime() <= to.getTime() - day.getTime() ? { from: day, to } : { from, to: day };
}

/** Parse `YYYY-MM-DD` into a local-time Date (midnight), or undefined. */
function parseISODate(value?: string): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return undefined;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

/** Format a Date to `YYYY-MM-DD` in local time. */
function formatISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatOne(date: Date, withYear = true, locale?: string): string {
  return formatDateParts(
    date,
    {
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
    },
    "–",
    locale
  );
}

/** "Aug 1 – Sep 30, 2026" when the years match, "Aug 1, 2026 – Sep 30, 2027" otherwise. */
function formatRange(from: Date, to?: Date, locale?: string): string {
  if (!to) return formatOne(from, true, locale);
  const sameYear = from.getFullYear() === to.getFullYear();
  return `${formatOne(from, !sameYear, locale)} – ${formatOne(to, true, locale)}`;
}

export { DateRangePicker };

"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarIcon } from "lucide-react";
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
  // When the popup opens onto an already-complete range, the first day-click should start a fresh
  // range from that day rather than nudge an endpoint of the old one — the intuitive way to re-pick.
  const anchor = React.useRef<Date | null>(null);

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
        if (next) anchor.current = null;
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
            if (!anchor.current) {
              anchor.current = day;
              onChange({ from: formatISODate(day), to: undefined });
              return;
            }
            const first = anchor.current;
            const next = {
              from: formatISODate(first <= day ? first : day),
              to: formatISODate(first <= day ? day : first),
            };
            anchor.current = null;
            onChange(next);
            setOpen(false);
            onOpenChange?.(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
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

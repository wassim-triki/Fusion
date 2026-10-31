"use client"

import * as React from "react"
import { CalendarIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import type { Matcher } from "react-day-picker"

import { cn } from "../../lib/utils"
import { Button } from "./button"
import { Calendar } from "./calendar"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"
import { formatDateParts } from "../../lib/dates"

/**
 * A single-date picker composed from the DS Popover + Calendar primitives.
 *
 * Works in `YYYY-MM-DD` string space (the shape the API and native date inputs
 * already use) so it drops in wherever a `type="date"` Input was, without
 * touching serialization. Dates are parsed and formatted in local time, so the
 * day the user picks is the day that is stored — no timezone drift.
 */
function DatePicker({
  value,
  onChange,
  min,
  max,
  id,
  placeholder,
  disabled,
  className,
  captionLayout,
  ...aria
}: {
  /** Selected date as `YYYY-MM-DD`, or empty for none. */
  value?: string
  onChange: (value: string) => void
  /** Inclusive lower bound as `YYYY-MM-DD`. */
  min?: string
  /** Inclusive upper bound as `YYYY-MM-DD`. */
  max?: string
  id?: string
  placeholder?: string
  disabled?: boolean
  className?: string
  /** "dropdown" for dates far away, such as a birthday: month and year as menus. */
  captionLayout?: "label" | "dropdown"
  "aria-label"?: string
  "aria-invalid"?: boolean
}) {
  const locale = useLocale()
  const t = useTranslations("ds.datePicker")
  const [open, setOpen] = React.useState(false)

  const selected = parseISODate(value)
  const minDate = parseISODate(min)
  const maxDate = parseISODate(max)

  const disabledMatchers: Matcher[] = []
  if (minDate) disabledMatchers.push({ before: minDate })
  if (maxDate) disabledMatchers.push({ after: maxDate })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          data-empty={!selected}
          {...aria}
          className={cn(
            // A field, carved in like the others (B-227).
            "w-full justify-start border-input bg-field text-start font-normal hover:bg-field dark:bg-field dark:hover:bg-field aria-invalid:border-destructive data-[empty=true]:text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {selected ? formatDisplay(selected, locale) : (placeholder ?? t("pick"))}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          captionLayout={captionLayout}
          autoFocus
          selected={selected}
          defaultMonth={selected ?? minDate ?? undefined}
          startMonth={minDate ?? undefined}
          endMonth={maxDate ?? undefined}
          disabled={disabledMatchers.length > 0 ? disabledMatchers : undefined}
          onSelect={(date) => {
            if (date) {
              onChange(formatISODate(date))
              setOpen(false)
            }
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/** Parse `YYYY-MM-DD` into a local-time Date (midnight), or undefined. */
function parseISODate(value?: string): Date | undefined {
  if (!value) return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const [, y, m, d] = match
  return new Date(Number(y), Number(m) - 1, Number(d))
}

/** Format a Date to `YYYY-MM-DD` in local time. */
function formatISODate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function formatDisplay(date: Date, locale: string): string {
  return formatDateParts(date, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }, undefined, locale)
}

export { DatePicker }

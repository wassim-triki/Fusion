"use client";

import { useRef, useState } from "react";
import type { RowData } from "@tanstack/react-table";
import { Plus, Search, X } from "../icons";
import { useLocale, useTranslations } from "next-intl";
import type { DateRange } from "react-day-picker";
import { ar, fr } from "react-day-picker/locale";
import { Button } from "../components/ui/button";
import { Calendar } from "../components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover";
import {
  isFilterActive,
  type DataTableDateRange,
  type DataTableFilterField,
  type DataTableFilterOption,
  type DataTableFilterValue,
  type DataTableModel,
} from "./use-data-table";
import { dateFormatter } from "../lib/dates";

/*
 * The filter bar: the one way a Fusion table narrows its rows. Every filter is a chip that reads as a
 * sentence — "Module is any of Performance, Learning" — and edits in place through the DS dropdown
 * (option fields) or the DS calendar popover (date fields). Pinned fields are the table's primary
 * question: their chip is always shown and resets to "All". Every other field is spread in the bar as its own
 * "+ Field" chip (D-13), in the table's order, and becomes a sentence once chosen.
 * The fields, their state and their counts all come from the model (`useDataTable({ filters })`).
 */

type Field = DataTableFilterField<unknown>;

/** Lists longer than this get a search field. */
const SEARCH_THRESHOLD = 7;
const VISIBLE_OPTIONS = 8;

export function DataTableFilters<TData extends RowData>({
  model,
}: {
  model: DataTableModel<TData>;
}) {
  const { fields: typedFields, state, set, counts } = model.filters;
  const fields = typedFields as Field[];
  if (fields.length === 0) return null;

  const pinned = fields.filter((f) => f.pinned);
  const addable = fields.filter((f) => !f.pinned);
  const anyActive = fields.some((f) => isFilterActive(state[f.id]));
  const t = useTranslations("ds.table");

  return (
    <>
      {pinned.map((field) => (
        <FilterChip
          key={field.id}
          field={field}
          value={state[field.id]}
          counts={counts[field.id]}
          onChange={(next) => set({ [field.id]: next })}
        />
      ))}
      {addable.map((field) => (
        <FilterChip key={field.id} field={field} value={state[field.id]}
          counts={counts[field.id]} onChange={(next) => set({ [field.id]: next })} />
      ))}
      {anyActive &&
      fields.filter((f) => isFilterActive(state[f.id])).length > 1 ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() =>
            set(Object.fromEntries(fields.map((f) => [f.id, undefined])))
          }
        >
          {t("clear")}
        </Button>
      ) : null}
    </>
  );
}

/**
 * One field's chip outside a table (a chart's toolbar): "+ Field" until chosen, then its sentence. The same chip
 * the table bar spreads, so every Fusion filter reads alike.
 */
export function FilterFieldChip({
  field,
  value,
  counts,
  onChange,
  disabled,
}: {
  field: DataTableFilterField<unknown>;
  value: DataTableFilterValue | undefined;
  counts?: Record<string, number>;
  disabled?: boolean;
  onChange: (next: DataTableFilterValue | undefined) => void;
}) {
  return <FilterChip field={field} value={value} counts={counts} onChange={onChange} disabled={disabled} />;
}

const DATE_FORMAT = { month: "short", day: "numeric", year: "numeric" } as const;
const DATE_FORMAT_SHORT = { month: "short", day: "numeric" } as const;

type TableT = ReturnType<typeof useTranslations<"ds.table">>;

function parseDate(value?: string): Date | undefined {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : undefined;
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function describe(
  field: Field,
  value: DataTableFilterValue | undefined,
  t: TableT,
  locale: string
): { operator: string; text: string } {
  if (!isFilterActive(value)) return { operator: t("is"), text: t("all") };
  if (field.type === "options") {
    const selected = value as string[];
    const labels = selected.map(
      (v) => field.options.find((o) => o.value === v)?.label ?? v
    );
    return {
      operator: selected.length === 1 ? t("is") : t("isAnyOf"),
      text:
        labels.length <= 2
          ? labels.join(", ")
          : `${labels[0]} +${labels.length - 1}`,
    };
  }
  const { from, to } = value as DataTableDateRange;
  const f = parseDate(from);
  const e = parseDate(to);
  const full = dateFormatter(DATE_FORMAT, locale);
  if (f && e) {
    const sameYear = f.getFullYear() === e.getFullYear();
    return {
      operator: t("between"),
      text: `${(sameYear ? dateFormatter(DATE_FORMAT_SHORT, locale) : full).format(f)} – ${full.format(e)}`,
    };
  }
  if (f) return { operator: t("after"), text: full.format(f) };
  return { operator: t("before"), text: e ? full.format(e) : "" };
}

function FilterChip({
  field,
  value,
  counts,
  onChange,
  disabled,
}: {
  field: Field;
  value: DataTableFilterValue | undefined;
  counts?: Record<string, number>;
  disabled?: boolean;
  onChange: (next: DataTableFilterValue | undefined) => void;
}) {
  const t = useTranslations("ds.table");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const { operator, text } = describe(field, value, t, locale);
  const FieldIcon = field.icon;
  const active = field.pinned || isFilterActive(value);
  const valueButton = (
    <button
      type="button"
      disabled={disabled}
      aria-label={active ? t("editFilter", { field: field.label, operator, value: text }) : t("addFilterFor", { field: field.label })}
      className="disabled:cursor-not-allowed disabled:opacity-50 min-w-0 truncate px-1.5 last:pe-2.5 font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:bg-muted data-[state=open]:bg-muted"
    >
      {active ? text : <span className="inline-flex items-center gap-1.5"><Plus className="size-3.5" aria-hidden />{field.label}</span>}
    </button>
  );

  return (
    <div className={active ? "inline-flex h-8 max-w-full items-stretch overflow-hidden rounded-control border border-border bg-inlay text-sm" : "inline-flex h-8 max-w-full items-stretch rounded-control border border-dashed border-input text-sm text-muted-foreground"}>
      {active && <span className="flex items-center gap-1.5 ps-2.5 pe-1.5 text-muted-foreground">
        {FieldIcon ? <FieldIcon className="size-3.5 text-primary-ink" /> : null}
        {field.label}
        <span className="hidden text-muted-foreground/70 sm:inline">
          {operator}
        </span>
      </span>}
      {/* The chip sits still while its value changes, so editing applies live. */}
      {field.type === "dateRange" ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{valueButton}</PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-1">
            <DateRangeEditor
              value={(value as DataTableDateRange | undefined) ?? {}}
              onChange={onChange}
              onDone={() => setOpen(false)}
            />
          </PopoverContent>
        </Popover>
      ) : (
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>{valueButton}</DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <ValueMenu
              field={field}
              value={value}
              counts={counts}
              onChange={onChange}
              onDone={() => setOpen(false)}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {!active || field.pinned ? null : (
        <button
          type="button"
          aria-label={t("removeFilter", { field: field.label })}
          onClick={() => onChange(undefined)}
          className="flex w-7 items-center justify-center border-s border-border text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

// ── A field's values, as DS menu items ──────────────────────────────────────────

function ValueMenu({
  field,
  value,
  counts,
  onChange,
  onDone,
}: {
  field: Field;
  value: DataTableFilterValue | undefined;
  counts?: Record<string, number>;
  onChange: (next: DataTableFilterValue | undefined) => void;
  /** A choice is complete (a single option, a full range); `final` is that value. */
  onDone: (final?: DataTableFilterValue) => void;
}) {
  const t = useTranslations("ds.table");
  const [query, setQuery] = useState("");
  if (field.type !== "options") return null;

  const selected = (value as string[] | undefined) ?? [];
  const term = query.trim().toLowerCase();
  const matches = term
    ? field.options.filter((o) => o.label.toLocaleLowerCase().includes(term))
    : field.options;
  // Keep the first choices in place as they are checked. Selected values outside that
  // window replace unselected ones, so clearing a search does not hide the choice.
  const options = matches.slice(0, VISIBLE_OPTIONS);
  for (const option of matches.slice(VISIBLE_OPTIONS)) {
    if (!selected.includes(option.value)) continue;
    const replace = options.map((item) => selected.includes(item.value)).lastIndexOf(false);
    if (replace < 0) break;
    options.splice(replace, 1, option);
  }
  // With counts, a row keeps no empty gutter: the count sits at the edge, and a checked row shows its
  // check mark there instead.
  const itemClass = counts
    ? "group/option pe-2.5 data-[state=checked]:pe-8"
    : undefined;
  const count = (option: DataTableFilterOption<unknown>) =>
    counts ? (
      <span className="ms-auto ps-3 text-xs tabular-nums text-muted-foreground group-data-[state=checked]/option:hidden">
        {counts[option.value] ?? 0}
      </span>
    ) : null;

  return (
    <>
      {field.searchable || field.options.length > SEARCH_THRESHOLD ? (
        <MenuSearch
          value={query}
          onChange={setQuery}
          placeholder={field.label}
        />
      ) : null}
      {field.single ? (
        <DropdownMenuRadioGroup
          value={selected[0] ?? ""}
          onValueChange={(next) => {
            const chosen = next ? [next] : [];
            onChange(chosen);
            onDone(chosen);
          }}
        >
          {field.pinned ? (
            <DropdownMenuRadioItem value="" className={itemClass}>
              {t("all")}
            </DropdownMenuRadioItem>
          ) : null}
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className={itemClass}
            >
              {option.icon ? (
                <option.icon className="text-muted-foreground" />
              ) : null}
              {option.label}
              {count(option)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      ) : (
        options.map((option) => {
          const checked = selected.includes(option.value);
          return (
            <DropdownMenuCheckboxItem
              key={option.value}
              className={itemClass}
              disabled={!checked && field.maxSelections !== undefined && selected.length >= field.maxSelections}
              checked={checked}
              // Several values are picked in one visit, so choosing one keeps the menu open.
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={() =>
                onChange(
                  checked
                    ? selected.filter((v) => v !== option.value)
                    : [...selected, option.value]
                )
              }
            >
              {option.icon ? (
                <option.icon className="text-muted-foreground" />
              ) : null}
              {option.label}
              {count(option)}
            </DropdownMenuCheckboxItem>
          );
        })
      )}
      {options.length === 0 ? (
        <p className="px-2.5 py-2 text-sm text-muted-foreground">{t("noOptions")}</p>
      ) : matches.length > options.length ? (
        <p className="px-2.5 py-2 text-sm text-muted-foreground">{t("refineOptions", { shown: options.length, total: matches.length })}</p>
      ) : null}
    </>
  );
}

/** A search field inside a menu. Keys stay in the field instead of driving the menu's type-to-find. */
function MenuSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <>
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const items = event.currentTarget.closest('[role="menu"]')?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([data-disabled])');
              const target = event.key === "ArrowDown" ? items?.[0] : items?.[items.length - 1];
              target?.focus();
            }
            if (event.key !== "Escape" && event.key !== "Tab") event.stopPropagation();
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <DropdownMenuSeparator />
    </>
  );
}

/**
 * Two clicks make a range: the first sets the start, the second the end, and the popover closes. Opened
 * onto an existing range, the first click starts a new one. (The picker itself reports a first click as
 * a one-day range, so the sequence is tracked here rather than read from the range.)
 */
function DateRangeEditor({
  value,
  onChange,
  onDone,
}: {
  value: DataTableDateRange;
  onChange: (next: DataTableDateRange) => void;
  onDone: (final?: DataTableFilterValue) => void;
}) {
  const locale = useLocale();
  const anchor = useRef<Date | null>(null);
  const from = parseDate(value.from);
  const to = parseDate(value.to);
  const selected: DateRange | undefined = from ? { from, to } : undefined;

  return (
    <Calendar
      mode="range"
      captionLayout="dropdown"
      startMonth={new Date(1900, 0, 1)}
      endMonth={new Date(2200, 11, 31)}
      locale={locale === "fr" ? fr : locale === "ar" ? ar : undefined}
      numberOfMonths={1}
      selected={selected}
      defaultMonth={from}
      onSelect={(_next: DateRange | undefined, day: Date) => {
        if (!anchor.current) {
          anchor.current = day;
          onChange({ from: isoDate(day), to: undefined });
          return;
        }
        const first = anchor.current;
        const range = {
          from: isoDate(first <= day ? first : day),
          to: isoDate(first <= day ? day : first),
        };
        onChange(range);
        onDone(range);
      }}
    />
  );
}

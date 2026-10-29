"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import {
  RadioGroup as RadioGroupPrimitive,
  ToggleGroup as ToggleGroupPrimitive,
} from "radix-ui";
import { cn } from "../lib/utils";
import { RadioGroupItem } from "../components/ui/radio-group";

/**
 * Fusion's choice controls (B-162). Every "pick one of a few" and "narrow this list" moment uses one of these, never a
 * hand-made group of pressed buttons. Selection is Fusion's amber, as a tint: the same signal as switches, the
 * sidebar's active item and option cards.
 *
 * - {@link Segmented}: one of 2–4 short options, always visible (a view switch, a setting like cadence or language).
 * - {@link ChoiceMatrix}: many rows picking from the same few options (each option is a column, said once).
 * - {@link FilterChips}: narrowing a list or feed, one at a time or several.
 * - {@link QuickPicks}: shortcuts that fill a field with a common value.
 * - {@link OptionCards}: one choice whose options each need a line to explain.
 */

export interface ChoiceOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  /** Said on hover; never needed to understand the option. */
  hint?: string;
  disabled?: boolean;
}

const SELECTED_TINT = "border-primary/45 bg-primary-tint text-primary-ink";

// ── Segmented ──

export interface SegmentedProps<T extends string> {
  /** Null shows no option chosen yet. */
  value: T | null;
  onChange: (value: T) => void;
  options: readonly ChoiceOption<T>[];
  /** Names the choice for assistive technology. */
  label: string;
  size?: "sm" | "md";
  /** Stretch across the container, options sharing the width. */
  fill?: boolean;
  disabled?: boolean;
  className?: string;
}

/** One of 2–4 short options, always visible. Arrow keys move between them. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
  fill = false,
  disabled,
  className,
}: SegmentedProps<T>) {
  return (
    <RadioGroupPrimitive.Root
      value={value ?? ""}
      onValueChange={(next) => {
        const match = options.find((option) => option.value === next);
        if (match) onChange(match.value);
      }}
      orientation="horizontal"
      loop
      aria-label={label}
      disabled={disabled}
      className={cn(
        "max-w-full items-center gap-0.5 rounded-control border border-border bg-inlay p-[3px]",
        fill ? "flex w-full" : "inline-flex",
        className
      )}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          title={option.hint}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-nested border border-transparent text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
            size === "sm"
              ? "h-6 px-2.5 type-meta [&_svg]:size-3.5"
              : "h-7 px-3 type-label [&_svg]:size-4",
            fill && "flex-1",
            "data-[state=checked]:border-primary/45 data-[state=checked]:bg-primary-tint data-[state=checked]:text-primary-ink"
          )}
        >
          {option.icon}
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}

// ── Choice matrix ──

export interface ChoiceMatrixRow {
  key: string;
  label: ReactNode;
  /** Plain text for the row's radio group name; defaults to `label` when that is a string. */
  name?: string;
  description?: ReactNode;
}

export interface ChoiceMatrixProps<T extends string> {
  rows: readonly ChoiceMatrixRow[];
  /** The options, one column each, said once in the header. */
  columns: readonly (ChoiceOption<T> & { description?: ReactNode })[];
  /** The header over the rows' names. */
  rowHeader: ReactNode;
  valueOf: (rowKey: string) => T;
  onChange: (rowKey: string, value: T) => void;
  /** View-only readers see the choices without being able to change them. */
  editable?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Many rows picking from the same few options: each option is a column with its name once in the header, and each row
 * is its own radio group (arrow keys move along the row). Scrolls sideways inside its frame when narrow.
 */
export function ChoiceMatrix<T extends string>({
  rows,
  columns,
  rowHeader,
  valueOf,
  onChange,
  editable = true,
  disabled,
  className,
}: ChoiceMatrixProps<T>) {
  const template = {
    gridTemplateColumns: `minmax(12rem, 1fr) repeat(${columns.length}, minmax(5.5rem, auto))`,
  };
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-surface border border-border bg-card",
        className
      )}
    >
      <div className="min-w-max">
        <div
          style={template}
          className="grid items-end gap-x-2 border-b border-border bg-inlay px-5 py-2.5"
          aria-hidden
        >
          <span className="type-meta-strong text-muted-foreground">
            {rowHeader}
          </span>
          {columns.map((column) => (
            <span
              key={column.value}
              title={column.hint}
              className="flex flex-col items-center text-center"
            >
              <span className="type-meta-strong text-muted-foreground">
                {column.label}
              </span>
              {column.description ? (
                <span className="type-meta text-muted-foreground">
                  {column.description}
                </span>
              ) : null}
            </span>
          ))}
        </div>
        <div className="divide-y divide-border">
          {rows.map((row) => {
            const name =
              row.name ?? (typeof row.label === "string" ? row.label : row.key);
            return (
              <RadioGroupPrimitive.Root
                key={row.key}
                value={valueOf(row.key)}
                onValueChange={(next) => {
                  const match = columns.find((column) => column.value === next);
                  if (match) onChange(row.key, match.value);
                }}
                orientation="horizontal"
                aria-label={name}
                disabled={disabled || !editable}
                style={template}
                className="grid items-center gap-x-2 px-5 py-3"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="type-label text-foreground">
                    {row.label}
                  </span>
                  {row.description ? (
                    <span className="type-meta text-muted-foreground">
                      {row.description}
                    </span>
                  ) : null}
                </span>
                {columns.map((column) => (
                  <span key={column.value} className="flex justify-center">
                    <RadioGroupItem
                      value={column.value}
                      aria-label={`${name}: ${typeof column.label === "string" ? column.label : column.value}`}
                      title={column.hint}
                      className="size-[18px] disabled:cursor-default disabled:opacity-100 [&:disabled:not([data-state=checked])]:opacity-40"
                    />
                  </span>
                ))}
              </RadioGroupPrimitive.Root>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Filter chips ──

interface FilterChipOption<T extends string> extends ChoiceOption<T> {
  /** How many items the chip leaves, shown inside it. */
  count?: number;
}

interface FilterChipsBase<T extends string> {
  options: readonly FilterChipOption<T>[];
  label: string;
  /** Chips over a canvas (a chart's legend) sit on the overlay tone so they stay readable. */
  overlay?: boolean;
  disabled?: boolean;
  className?: string;
}

export type FilterChipsProps<T extends string> = FilterChipsBase<T> &
  (
    | {
        type: "single";
        value: T;
        onChange: (value: T) => void;
        clearable?: false;
      }
    | {
        type: "single";
        value: T | null;
        onChange: (value: T | null) => void;
        clearable: true;
      }
    | { type: "multiple"; value: readonly T[]; onChange: (value: T[]) => void }
  );

const chipClass = cn(
  "inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-3 type-label text-muted-foreground transition-colors outline-none hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
  "data-[state=on]:border-primary/45 data-[state=on]:bg-primary-tint data-[state=on]:text-primary-ink"
);

/**
 * Narrows a list or feed: one chip on at a time (`single`; `clearable` lets the chip switch off again), or several that
 * add up (`multiple`).
 */
export function FilterChips<T extends string>(
  props: FilterChipsBase<T> & {
    type: "single";
    value: T;
    onChange: (value: T) => void;
    clearable?: false;
  }
): ReactNode;
export function FilterChips<T extends string>(
  props: FilterChipsBase<T> & {
    type: "single";
    value: T | null;
    onChange: (value: T | null) => void;
    clearable: true;
  }
): ReactNode;
export function FilterChips<T extends string>(
  props: FilterChipsBase<T> & {
    type: "multiple";
    value: readonly T[];
    onChange: (value: T[]) => void;
  }
): ReactNode;
export function FilterChips<T extends string>(
  props: FilterChipsProps<T>
): ReactNode {
  const { options, label, overlay, disabled, className } = props;
  const items = options.map((option) => (
    <ToggleGroupPrimitive.Item
      key={option.value}
      value={option.value}
      disabled={option.disabled}
      title={option.hint}
      className={cn(chipClass, "group/chip", overlay && "bg-popover")}
    >
      {props.type === "multiple" ? (
        <Check
          aria-hidden
          className="hidden group-data-[state=on]/chip:block"
        />
      ) : null}
      {option.icon}
      {option.label}
      {option.count !== undefined ? (
        <span className="type-meta tabular-nums opacity-80">
          {option.count}
        </span>
      ) : null}
    </ToggleGroupPrimitive.Item>
  ));
  const rootClass = cn("flex flex-wrap gap-1.5", className);
  if (props.type === "single") {
    return (
      <ToggleGroupPrimitive.Root
        type="single"
        value={props.value ?? ""}
        onValueChange={(next) => {
          const match = options.find((option) => option.value === next);
          if (match) props.onChange(match.value);
          else if (props.clearable) props.onChange(null);
        }}
        aria-label={label}
        disabled={disabled}
        className={rootClass}
      >
        {items}
      </ToggleGroupPrimitive.Root>
    );
  }
  return (
    <ToggleGroupPrimitive.Root
      type="multiple"
      value={[...props.value]}
      onValueChange={(next) =>
        props.onChange(
          options
            .filter((option) => next.includes(option.value))
            .map((option) => option.value)
        )
      }
      aria-label={label}
      disabled={disabled}
      className={rootClass}
    >
      {items}
    </ToggleGroupPrimitive.Root>
  );
}

// ── Quick picks ──

export interface QuickPicksProps<T extends string> {
  options: readonly ChoiceOption<T>[];
  /** The field's current value: the matching pick shows as chosen. */
  value: T | null | undefined;
  onPick: (value: T) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

/** Shortcuts beside a field that fill it with a common value; the field keeps the answer. */
export function QuickPicks<T extends string>({
  options,
  value,
  onPick,
  label,
  disabled,
  className,
}: QuickPicksProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex flex-wrap items-center gap-1.5", className)}
    >
      {options.map((option) => {
        const current = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            title={option.hint}
            disabled={disabled || option.disabled}
            // eslint-disable-next-line no-restricted-syntax -- a pick is a button that fills the field; pressed says the field holds it
            aria-pressed={current}
            onClick={() => onPick(option.value)}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-full border px-2.5 type-meta transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
              current
                ? SELECTED_TINT
                : "border-dashed border-foreground/20 text-muted-foreground hover:border-solid hover:text-foreground"
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Option cards ──

export interface OptionCard<T extends string> extends ChoiceOption<T> {
  description?: ReactNode;
  /** A picture of the option above its name, such as an appearance preview. */
  preview?: ReactNode;
}

export interface OptionCardsProps<T extends string> {
  value: T | null | undefined;
  onChange: (value: T) => void;
  options: readonly OptionCard<T>[];
  label: string;
  /** Columns at full width; cards wrap to fewer when narrow. */
  columns?: 1 | 2 | 3 | 4;
  disabled?: boolean;
  className?: string;
}

const CARD_COLUMNS = {
  1: "",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
} as const;

/** One choice whose options each need a line to explain. The whole card is the target. */
export function OptionCards<T extends string>({
  value,
  onChange,
  options,
  label,
  columns = 3,
  disabled,
  className,
}: OptionCardsProps<T>) {
  return (
    <RadioGroupPrimitive.Root
      value={value ?? ""}
      onValueChange={(next) => {
        const match = options.find((option) => option.value === next);
        if (match) onChange(match.value);
      }}
      aria-label={label}
      disabled={disabled}
      className={cn("grid gap-2.5", CARD_COLUMNS[columns], className)}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          title={option.hint}
          className="group/card flex flex-col gap-2.5 rounded-control border border-border bg-inlay p-3 text-start transition-colors outline-none hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:ring-1 data-[state=checked]:ring-primary"
        >
          {option.preview}
          <span className="flex items-start gap-2.5">
            <span
              aria-hidden
              className="mt-px grid size-4 shrink-0 place-items-center rounded-full border border-input group-data-[state=checked]/card:border-primary group-data-[state=checked]/card:bg-primary"
            >
              <span className="hidden size-1.5 rounded-full bg-primary-foreground group-data-[state=checked]/card:block" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-2 type-label text-foreground">
                <span className="flex-1">{option.label}</span>
                {option.icon ? (
                  <span className="text-muted-foreground [&_svg]:size-4">
                    {option.icon}
                  </span>
                ) : null}
              </span>
              {option.description ? (
                <span className="type-meta text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
            </span>
          </span>
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}

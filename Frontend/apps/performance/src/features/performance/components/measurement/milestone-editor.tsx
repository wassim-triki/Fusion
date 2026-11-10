"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import { CalendarDays, GripVertical, Plus, Trash2 } from "@repo/ds/icons";
import type { MeasurementDto, MeasurementInput } from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import {
  ButtonGroup,
  ButtonGroupText,
} from "@repo/ds/components/ui/button-group";
import { Calendar } from "@repo/ds/components/ui/calendar";

import { Input } from "@repo/ds/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ds/components/ui/popover";
import { cn } from "@repo/ds/lib/utils";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";

export interface MilestoneRow {
  /** Stable identity for drag-reordering and list keys — order carries meaning, so it can't be index. */
  id: string;
  title: string;
  weight: string;
  /** Optional due date as `YYYY-MM-DD`; empty when the milestone has none. */
  dueDate: string;
}

export function emptyMilestone(): MilestoneRow {
  return { id: crypto.randomUUID(), title: "", weight: "", dueDate: "" };
}

/** Editable rows from a stored measurement, or a single empty row to start from. */
export function milestonesFromMeasurement(measurement?: MeasurementDto | null): MilestoneRow[] {
  const rows = measurement?.method === "WeightedMilestones" ? measurement.milestones : null;
  return rows && rows.length > 0
    ? rows.map((m) => ({
        id: crypto.randomUUID(),
        title: m.title,
        weight: String(m.weight),
        dueDate: m.dueDate ?? "",
      }))
    : [emptyMilestone()];
}

export function milestoneWeightSum(rows: MilestoneRow[]): number {
  return rows.reduce((total, row) => total + (Number(row.weight) || 0), 0);
}

/** The named rows as the API's milestone input — the one serialization every composer sends. */
export function toMilestoneInputs(
  rows: MilestoneRow[]
): NonNullable<MeasurementInput["milestones"]> {
  return rows
    .filter((row) => row.title.trim() !== "")
    .map((row) => ({
      title: row.title.trim(),
      weight: Number(row.weight),
      dueDate: row.dueDate || null,
    }));
}

/** Whether every dated milestone falls inside the objective's window (the domain's own rule). */
export function milestoneDatesWithin(
  rows: MilestoneRow[],
  start: string,
  end: string
): boolean {
  return rows.every(
    (row) => !row.dueDate || (row.dueDate >= start && row.dueDate <= end)
  );
}

/**
 * The weighted-milestone editor: reorderable rows of title, optional due date and weight that must
 * total 100%, with a live allocation readout. Due dates are bounded by the objective's window; a date
 * left outside it after the window moves is flagged on its row rather than silently dropped. Order carries meaning (earliest milestone first), so rows are dragged by
 * a handle and keyed by stable id. Shared by the organizational-objective composer and the employee
 * objective composer — the one place this interaction is defined.
 */
export function MilestoneEditor({
  milestones,
  weightSum,
  onChange,
  readyLabel = "Balanced",
  minDate,
  maxDate,
}: {
  milestones: MilestoneRow[];
  weightSum: number;
  onChange: (next: MilestoneRow[] | ((rows: MilestoneRow[]) => MilestoneRow[])) => void;
  /** Text shown beside the total once weights reach exactly 100% (context-specific). */
  readyLabel?: string;
  /** The objective's window as `YYYY-MM-DD`; due dates must fall inside it. */
  minDate: string;
  maxDate: string;
}) {
  const t = useTranslations("progress.MilestoneEditor");
  const remaining = 100 - weightSum;
  const empty = weightSum === 0;
  const ready = weightSum === 100;
  const over = weightSum > 100;
  const sensors = useSensors(
    // A small drag threshold keeps a click inside the title/weight fields from starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over: target } = event;
    if (!target || active.id === target.id) return;
    onChange((rows) => {
      const from = rows.findIndex((row) => row.id === active.id);
      const to = rows.findIndex((row) => row.id === target.id);
      return from === -1 || to === -1 ? rows : arrayMove(rows, from, to);
    });
  }

  const setTitle = (id: string, title: string) =>
    onChange((rows) => rows.map((row) => (row.id === id ? { ...row, title } : row)));
  const setWeight = (id: string, weight: string) =>
    onChange((rows) => rows.map((row) => (row.id === id ? { ...row, weight } : row)));
  const setDueDate = (id: string, dueDate: string) =>
    onChange((rows) => rows.map((row) => (row.id === id ? { ...row, dueDate } : row)));
  const removeRow = (id: string) =>
    onChange((rows) => (rows.length > 1 ? rows.filter((row) => row.id !== id) : rows));

  return (
    <div className="space-y-3 rounded-surface border border-border/70 p-4">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={milestones.map((row) => row.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {milestones.map((row, index) => (
              <SortableMilestoneRow
                key={row.id}
                row={row}
                index={index}
                canRemove={milestones.length > 1}
                onTitle={(value) => setTitle(row.id, value)}
                onWeight={(value) => setWeight(row.id, value)}
                onDueDate={(value) => setDueDate(row.id, value)}
                previousDue={
                  milestones
                    .slice(0, index)
                    .map((earlier) => earlier.dueDate)
                    .filter(Boolean)
                    .at(-1) ?? ""
                }
                onRemove={() => removeRow(row.id)}
                minDate={minDate}
                maxDate={maxDate}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div className="flex items-center justify-between border-t border-border/60 pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange((rows) => [...rows, emptyMilestone()])}
        >
          <Plus className="size-3.5" data-icon="inline-start" /> {t("addMilestone")}
        </Button>
        <div className="flex items-center gap-2.5">
          <span className="type-meta text-muted-foreground">
            {ready ? readyLabel : over ? t("over", { value: weightSum - 100 }) : t("toAllocate", { remaining })}
          </span>
          <span
            className={cn(
              "min-w-[3.25rem] rounded-control px-2 py-0.5 text-center type-subsection-title tabular-nums transition-colors",
              ready
                ? "bg-success-subtle text-success"
                : over
                  ? "bg-destructive/10 text-destructive"
                  : empty
                    ? "bg-muted text-muted-foreground"
                    : "bg-warning-subtle text-warning"
            )}
          >
            {weightSum}%
          </span>
        </div>
      </div>
    </div>
  );
}

function SortableMilestoneRow({
  row,
  index,
  canRemove,
  onTitle,
  onWeight,
  onDueDate,
  previousDue,
  onRemove,
  minDate,
  maxDate,
}: {
  row: MilestoneRow;
  index: number;
  canRemove: boolean;
  onTitle: (value: string) => void;
  onWeight: (value: string) => void;
  onDueDate: (value: string) => void;
  /** The nearest earlier milestone's due date — where an undated row's picker opens. */
  previousDue: string;
  onRemove: () => void;
  minDate: string;
  maxDate: string;
}) {
  const t = useTranslations("progress.SortableMilestoneRow");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2.5 rounded-control",
        isDragging && "relative z-10 bg-card shadow-overlay"
      )}
    >
      <button
        type="button"
        className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-control-sm text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        aria-label={t("reorderMilestone", { value: index + 1 })}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <Input
        value={row.title}
        onChange={(event) => onTitle(event.target.value)}
        placeholder={t("milestone", { value: index + 1 })}
        className="min-w-0 flex-1"
      />
      <MilestoneDueDate
        label={row.title.trim() || `milestone ${index + 1}`}
        value={row.dueDate}
        previous={previousDue}
        min={minDate}
        max={maxDate}
        onChange={onDueDate}
      />
      <ButtonGroup className="w-28 shrink-0">
        <Input
          type="number"
          value={row.weight}
          onChange={(event) => onWeight(event.target.value)}
          placeholder="0"
          className="text-end tabular-nums"
        />
        <ButtonGroupText>%</ButtonGroupText>
      </ButtonGroup>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label={t("removeMilestone", { value: index + 1 })}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}

/** Parse `YYYY-MM-DD` as a local date (no timezone drift), or undefined. */
function parseLocalDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function toLocalISO(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/**
 * A milestone's optional due date, sized to sit inside the row: a quiet calendar affordance until a
 * date is chosen, then the date itself. Bounded by the objective's window; a date the window has
 * since moved past reads as invalid so the author re-picks it.
 */
function MilestoneDueDate({
  label,
  value,
  previous,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  previous: string;
  min: string;
  max: string;
  onChange: (value: string) => void;
}) {
  const format = useFormat();
  const t = useTranslations("progress.MilestoneDueDate");
  const [open, setOpen] = useState(false);
  const selected = parseLocalDate(value);
  const minDate = parseLocalDate(min);
  const maxDate = parseLocalDate(max);
  const outside = Boolean(value) && (value < min || value > max);
  // Open where the author is most likely heading: the chosen date; else just after the previous
  // milestone, so a sequence is dated forward; else today when the window spans it; else its first month.
  const today = new Date();
  const openingMonth =
    selected ??
    parseLocalDate(previous) ??
    ((!minDate || today >= minDate) && (!maxDate || today <= maxDate) ? today : minDate);
  const display = selected ? format.date(selected) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-invalid={outside || undefined}
          aria-label={
            selected
              ? t("dueChangeTheDueDate", { display: display ?? "", label })
              : t("setADueDateFor", { label })
          }
          title={outside ? t("outsideTheObjectivesDates") : undefined}
          className={cn(
            "w-32 shrink-0 justify-start gap-2 px-2.5 font-normal tabular-nums",
            !selected && "text-muted-foreground",
            outside && "border-destructive text-destructive"
          )}
        >
          <CalendarDays className="size-4 shrink-0 opacity-70" aria-hidden />
          <span className="truncate">{selected ? display : t("dueDate")}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          autoFocus
          selected={selected}
          defaultMonth={openingMonth}
          startMonth={minDate}
          endMonth={maxDate}
          disabled={[
            ...(minDate ? [{ before: minDate }] : []),
            ...(maxDate ? [{ after: maxDate }] : []),
          ]}
          onSelect={(date) => {
            if (!date) return;
            onChange(toLocalISO(date));
            setOpen(false);
          }}
        />
        {value ? (
          <div className="border-t border-border p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              {t("noDueDate")}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

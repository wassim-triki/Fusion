"use client";

import { useState } from "react";
import { Flag, Info, LineChart, Percent, TrendingDown, TrendingUp } from "@repo/ds/icons";
import type { MeasurementMethod } from "@repo/api";
import { Input } from "@repo/ds/components/ui/input";
import { OptionCards } from "@repo/ds/choice";
import { Label } from "@repo/ds/components/ui/label";
import {
  Autocomplete,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@repo/ds/components/ui/combobox";
import { MilestoneEditor, type MilestoneRow } from "./milestone-editor";
import { useTranslations } from "next-intl";

/** The three direct ways an objective's progress can be measured — canonical type from `@repo/api`. */
export type { MeasurementMethod };

/** Common measurement units offered as suggestions — any custom unit can still be typed. */
const UNIT_OPTIONS = [
  "Percent (%)",
  "Count",
  "Days",
  "Hours",
  "Score",
  "NPS",
  "Ratio",
  "Currency",
];

/**
 * The one place a measurement is authored — the method choice (manual percentage, numeric target,
 * weighted milestones) and the editor for the chosen method. Shared verbatim by the organizational
 * objective composer and the employee plan composer so authoring a measure looks and behaves the same
 * wherever it happens. Presentation only: each composer owns its own readiness/validation and passes
 * the derived numeric-error flags in.
 */
export function MeasurementEditor({
  method,
  onMethodChange,
  baseline,
  target,
  unit,
  numericInvalid,
  numericSameValue,
  onBaseline,
  onTarget,
  onUnit,
  milestones,
  milestoneWeightSum,
  onMilestonesChange,
  milestoneReadyLabel,
  minDate,
  maxDate,
}: {
  method: MeasurementMethod | null;
  onMethodChange: (method: MeasurementMethod) => void;
  baseline: string;
  target: string;
  unit: string;
  numericInvalid: boolean;
  numericSameValue: boolean;
  onBaseline: (v: string) => void;
  onTarget: (v: string) => void;
  onUnit: (v: string) => void;
  milestones: MilestoneRow[];
  milestoneWeightSum: number;
  onMilestonesChange: (
    next: MilestoneRow[] | ((rows: MilestoneRow[]) => MilestoneRow[])
  ) => void;
  /** Overrides the milestone editor's "ready" label — e.g. "Ready to publish" in the org composer. */
  milestoneReadyLabel?: string;
  /** The objective's window as `YYYY-MM-DD`, bounding milestone due dates. */
  minDate: string;
  maxDate: string;
}) {
  const t = useTranslations("progress.MeasurementEditor");
  return (
    <div className="space-y-4">
      <OptionCards
        label={t("measurement")}
        value={method}
        onChange={onMethodChange}
        options={[
          { value: "ManualPercentage", label: t("manualPercentage"), description: t("updateProgressAsAPercentage"), icon: <Percent aria-hidden /> },
          { value: "NumericTarget", label: t("numericTarget"), description: t("defineATargetWithA"), icon: <LineChart aria-hidden /> },
          { value: "WeightedMilestones", label: t("weightedMilestones"), description: t("breakTheObjectiveIntoMilestones"), icon: <Flag aria-hidden /> },
        ]}
      />

      {method === "ManualPercentage" ? (
        <div className="flex items-center gap-2.5 rounded-surface border border-info/25 bg-info-subtle px-4 py-3 type-body text-info">
          <Info className="size-4 shrink-0" aria-hidden />
          {t("youllUpdateProgressAsA")}
        </div>
      ) : null}

      {method === "NumericTarget" ? (
        <NumericTargetEditor
          baseline={baseline}
          target={target}
          unit={unit}
          numericInvalid={numericInvalid}
          sameValue={numericSameValue}
          onBaseline={onBaseline}
          onTarget={onTarget}
          onUnit={onUnit}
        />
      ) : null}

      {method === "WeightedMilestones" ? (
        <MilestoneEditor
          milestones={milestones}
          weightSum={milestoneWeightSum}
          onChange={onMilestonesChange}
          readyLabel={milestoneReadyLabel}
          minDate={minDate}
          maxDate={maxDate}
        />
      ) : null}
    </div>
  );
}

/** Which way the number should move, read from baseline and target; null until both are numbers and differ. */
function readDirection(baseline: string, target: string): "Increase" | "Decrease" | null {
  const from = Number(baseline.replace(",", "."));
  const to = Number(target.replace(",", "."));
  if (baseline.trim() === "" || target.trim() === "" || Number.isNaN(from) || Number.isNaN(to) || from === to) return null;
  return to < from ? "Decrease" : "Increase";
}

// ── Numeric target editor (baseline → target, unit) ────────────────────────

function NumericTargetEditor({
  baseline,
  target,
  unit,
  numericInvalid,
  sameValue,
  onBaseline,
  onTarget,
  onUnit,
}: {
  baseline: string;
  target: string;
  unit: string;
  numericInvalid: boolean;
  sameValue: boolean;
  onBaseline: (v: string) => void;
  onTarget: (v: string) => void;
  onUnit: (v: string) => void;
}) {
  const t = useTranslations("progress.NumericTargetEditor");
  const error = numericInvalid
    ? t("enterANumberPutA")
    : sameValue
      ? t("baselineAndTargetMustDiffer")
      : null;
  return (
    <div className="space-y-3 rounded-surface border border-border/70 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <NumericField
          id="me-baseline"
          label={t("baseline")}
          value={baseline}
          placeholder="42"
          invalid={numericInvalid || sameValue}
          onChange={onBaseline}
        />
        <NumericField
          id="me-target"
          label={t("target")}
          value={target}
          placeholder="70"
          invalid={numericInvalid || sameValue}
          onChange={onTarget}
        />
        <div className="space-y-1.5">
          <Label htmlFor="me-unit">
            {t("unit")} <span className="text-destructive">*</span>
          </Label>
          <UnitCombobox value={unit} onChange={onUnit} />
        </div>
      </div>
      {/* D-40: the direction is read from the numbers, never picked. */}
      {readDirection(baseline, target) ? (
        <p className="flex items-center gap-1.5 type-meta text-muted-foreground">
          {readDirection(baseline, target) === "Decrease" ? <TrendingDown aria-hidden className="size-4" /> : <TrendingUp aria-hidden className="size-4" />}
          {readDirection(baseline, target) === "Decrease" ? t("fewerIsBetter") : t("moreIsBetter")}
        </p>
      ) : null}
      {error ? <p className="type-body text-destructive">{error}</p> : null}
    </div>
  );
}

/** Unit picker: a live text field with common-unit suggestions that still accepts any custom unit. */
function UnitCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTranslations("progress.UnitCombobox");
  const [open, setOpen] = useState(false);
  return (
    <Autocomplete
      items={UNIT_OPTIONS}
      value={value}
      onValueChange={onChange}
      // Show every common unit on focus (empty query), then narrow as the user types — the default
      // filter hides the whole list until there's input, which leaves an empty popup on open.
      filter={(item, query) => {
        const q = query.trim().toLowerCase();
        return q === "" || String(item).toLowerCase().includes(q);
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <ComboboxInput id="me-unit" placeholder={t("percent")} className="w-full" />
      <ComboboxContent className="pointer-events-auto">
        <ComboboxEmpty>{t("usesAsACustomUnit", { trim: value.trim() })}</ComboboxEmpty>
        {/* Function child: Base UI filters `items` by the input and renders only the matches,
            which is also what registers each item for highlight and click/keyboard selection. */}
        <ComboboxList>
          {(u: string) => (
            <ComboboxItem key={u} value={u}>
              {u}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Autocomplete>
  );
}

function NumericField({
  id,
  label,
  value,
  placeholder,
  invalid,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  invalid: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label} <span className="text-destructive">*</span>
      </Label>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
        className="tabular-nums"
      />
    </div>
  );
}


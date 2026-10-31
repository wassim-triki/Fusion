"use client";

import { reportPerformanceFailure } from "@/features/performance/api/performance-failure";

import { MilestoneDue } from "../measurement/milestone-due";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, X } from "@/lib/icons";
import type { EvidenceInput, ObjectiveProgressDto, ObjectiveStatus, SubmitProgressRequest } from "@repo/api";
import { Label } from "@repo/ds/components/ui/label";
import { Textarea } from "@repo/ds/components/ui/textarea";
import { cn } from "@repo/ds/lib/utils";
import { EvidenceUploader } from "./evidence-uploader";
import { num, numericProgress, pct } from "./progress-lib";
import { ValueDial } from "./value-dial";
import { numericDomain, percentDomain } from "./value-dial-lib";
import { useTranslations } from "next-intl";

type UploadFn = (file: File) => Promise<{ uploadId: string; fileName: string; contentType: string; sizeBytes: number }>;

const NOTE_MAX = 500;

/**
 * The record-progress form — the measurement-aware body of the objective drawer's record mode, and one
 * check-in: manual percentage records a completion figure, numeric target the current actual against the
 * baseline→target rail, weighted milestones every milestone completed or reopened together. "How it's going"
 * carries the owner's status (D-05), preselected from the last report; at risk or off track turns the note
 * into "What's in the way", required. A check-in may change no value and report status alone. Corrections —
 * a value that moves backward or a reopened milestone — also require the note.
 */
export function ProgressUpdateComposer({
  progress,
  submitting,
  formId,
  onSubmit,
  upload,
  onValidityChange,
  onRecorded,
}: {
  progress: ObjectiveProgressDto;
  submitting: boolean;
  /** The <form> id the drawer's pinned footer submits — the button lives outside this component. */
  formId: string;
  /** Commits the check-in. */
  onSubmit: (request: Omit<SubmitProgressRequest, "expectedVersion">) => Promise<void>;
  upload: UploadFn;
  /** Reports whether the update is submittable, so the external footer can enable its action. */
  onValidityChange: (valid: boolean) => void;
  /** Called once an update commits — the drawer returns to the updated details view. */
  onRecorded: () => void;
}) {
  if (progress.method === "WeightedMilestones") {
    return (
      <MilestoneForm progress={progress} submitting={submitting} formId={formId} onSubmit={onSubmit} upload={upload} onValidityChange={onValidityChange} onRecorded={onRecorded} />
    );
  }
  return <ValueForm progress={progress} submitting={submitting} formId={formId} onSubmit={onSubmit} upload={upload} onValidityChange={onValidityChange} onRecorded={onRecorded} />;
}

// ── Manual percentage & numeric target ───────────────────────────────────────

function ValueForm({
  progress,
  submitting,
  formId,
  onSubmit,
  upload,
  onValidityChange,
  onRecorded,
}: {
  progress: ObjectiveProgressDto;
  submitting: boolean;
  formId: string;
  onSubmit: (request: Omit<SubmitProgressRequest, "expectedVersion">) => Promise<void>;
  upload: UploadFn;
  onValidityChange: (valid: boolean) => void;
  onRecorded: () => void;
}) {
  const t = useTranslations("progress.ValueForm");
  const isNumeric = progress.method === "NumericTarget";
  // Plain entry stays only as the fallback for a numeric target with no usable scale (missing or equal
  // baseline/target); everything else is set on the dial.
  const domain = useMemo(
    () =>
      isNumeric
        ? progress.baseline != null && progress.target != null
          ? numericDomain(progress.baseline, progress.target, progress.unit, progress.currentActual)
          : null
        : percentDomain(),
    [isNumeric, progress.baseline, progress.target, progress.unit, progress.currentActual]
  );
  const reported = isNumeric ? progress.currentActual : progress.currentPercentage;
  const [dialValue, setDialValue] = useState<number | null>(null);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<ObjectiveStatus | null>(progress.currentStatus);
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState<EvidenceInput[]>([]);

  const typed = value === "" ? null : Number(value);
  const entered = domain ? dialValue : typed;
  // Re-recording the figure already on record changes nothing; the check-in then reports status alone.
  const changed = entered != null && Number.isFinite(entered) && entered !== reported;

  // A value that moves backward from the last reported figure is a correction — note required.
  const decreased =
    !isNumeric && changed && progress.currentPercentage != null && (entered as number) < progress.currentPercentage;
  const risky = isRisky(status);
  const noteRequired = decreased || risky;
  const canSubmit = status !== null && (!noteRequired || note.trim() !== "");
  useEffect(() => onValidityChange(canSubmit), [canSubmit, onValidityChange]);

  async function save() {
    if (!status) return;
    try {
      await onSubmit({
        percentage: !isNumeric && changed ? entered : null,
        numericActual: isNumeric && changed ? entered : null,
        milestones: null,
        status,
        contextNote: note.trim() || null,
        isCorrection: decreased,
        evidence: evidence.length > 0 ? evidence : null,
      });
      onRecorded();
    } catch (error) {
      reportPerformanceFailure(error, t("couldNotRecordProgress"));
    }
  }

  const unit = isNumeric ? progress.unit ?? "" : "%";

  const unitSuffix = (v: number) => (isNumeric ? `${num(v)}${progress.unit ? (progress.unit === "%" ? "%" : ` ${progress.unit}`) : ""}` : `${v}%`);

  return (
    <form
      id={formId}
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit && !submitting) void save();
      }}
    >
      {domain ? (
        <ValueDial
          label={isNumeric ? t("newValue") : t("completion")}
          domain={domain}
          value={dialValue}
          reported={reported}
          onChange={setDialValue}
          format={unitSuffix}
          startLabel={isNumeric ? t("baseline") : ""}
          targetLabel={isNumeric ? t("target") : undefined}
          progressOf={(v) =>
            isNumeric && progress.baseline != null && progress.target != null
              ? numericProgress(progress.baseline, progress.target, v)
              : v
          }
        />
      ) : (
        <div className="space-y-2">
          <Label htmlFor="pv-value">{t("currentValue", { value: unit ? ` (${unit})` : "" })}</Label>
          <NumberField
            id="pv-value"
            value={value}
            onChange={setValue}
            suffix={unit}
            placeholder={progress.currentActual != null ? num(progress.currentActual) : ""}
            base={progress.currentActual ?? progress.baseline ?? 0}
          />
        </div>
      )}

      <StatusPicker value={status} onChange={setStatus} disabled={submitting} />
      <NoteField value={note} onChange={setNote} required={noteRequired} risky={risky} hint={decreased && !risky ? t("thisLowersTheLastReported") : undefined} />
      <EvidenceField items={evidence} onChange={setEvidence} upload={upload} />
    </form>
  );
}

// ── Weighted milestones ──────────────────────────────────────────────────────

function MilestoneForm({
  progress,
  submitting,
  formId,
  onSubmit,
  upload,
  onValidityChange,
  onRecorded,
}: {
  progress: ObjectiveProgressDto;
  submitting: boolean;
  formId: string;
  onSubmit: (request: Omit<SubmitProgressRequest, "expectedVersion">) => Promise<void>;
  upload: UploadFn;
  onValidityChange: (valid: boolean) => void;
  onRecorded: () => void;
}) {
  const t = useTranslations("progress.MilestoneForm");
  // Pending selection begins from the agreed truth; Record progress commits only what changed.
  const initial = useMemo(
    () => Object.fromEntries(progress.milestones.map((m) => [m.id, m.isCompleted])),
    [progress.milestones]
  );
  const [pending, setPending] = useState<Record<string, boolean>>(initial);
  const [status, setStatus] = useState<ObjectiveStatus | null>(progress.currentStatus);
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState<EvidenceInput[]>([]);

  const total = progress.milestones.length;
  const completedCount = progress.milestones.filter((m) => pending[m.id]).length;
  const wasCompleted = progress.milestones.filter((m) => m.isCompleted).length;

  const changes = progress.milestones.filter((m) => pending[m.id] !== m.isCompleted);
  const reopening = changes.some((m) => !pending[m.id]);
  const risky = isRisky(status);
  const noteRequired = reopening || risky;
  const canSubmit = status !== null && (!noteRequired || note.trim() !== "");
  useEffect(() => onValidityChange(canSubmit), [canSubmit, onValidityChange]);

  async function save() {
    if (!status) return;
    try {
      // One check-in: every milestone changed here is recorded together, with the status, note and evidence.
      await onSubmit({
        percentage: null,
        numericActual: null,
        milestones: changes.length > 0 ? changes.map((m) => ({ milestoneId: m.id, completed: pending[m.id]! })) : null,
        status,
        contextNote: note.trim() || null,
        isCorrection: reopening,
        evidence: evidence.length > 0 ? evidence : null,
      });
      onRecorded();
    } catch (error) {
      reportPerformanceFailure(error, t("couldNotUpdateTheMilestones"));
    }
  }

  return (
    <form
      id={formId}
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit && !submitting) void save();
      }}
    >
      <div className="rounded-surface bg-popover p-4 dark:bg-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="type-meta text-muted-foreground">{t("milestones")}</p>
            <p className="mt-1.5 type-body text-muted-foreground">
              <span className="type-metric text-foreground">{completedCount}</span> {t("ofComplete", { total })}
            </p>
          </div>
          {changes.length > 0 ? (
            <span className="type-meta tabular-nums text-muted-foreground">{t("wasOf", { wasCompleted, total })}</span>
          ) : null}
        </div>
        <ul className="mt-3 space-y-0.5">
          {progress.milestones.map((m) => {
            const on = pending[m.id] ?? false;
            const change = on === m.isCompleted ? null : on ? "New" : "Reopened";
            return (
              <li key={m.id} className={cn("flex items-center gap-3 rounded-control-sm px-2.5 py-2.5", change && "bg-inlay")}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  disabled={submitting}
                  onClick={() => setPending((prev) => ({ ...prev, [m.id]: !prev[m.id] }))}
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-detail border transition-colors",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-input hover:border-primary"
                  )}
                >
                  {on ? <Check className="size-3.5" aria-hidden /> : null}
                </button>
                <span className={cn("min-w-0 flex-1 type-body text-foreground", change && "font-medium")}>{m.title}</span>
                <MilestoneDue milestone={m} />
                {change ? (
                  <span className={cn("shrink-0 type-meta-strong", change === "New" ? "text-primary-ink" : "text-warning")}>{change === "New" ? t("new") : t("reopened")}</span>
                ) : (
                  <span className="w-9 shrink-0 text-end type-meta-strong tabular-nums text-muted-foreground">{pct(m.weight)}%</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <StatusPicker value={status} onChange={setStatus} disabled={submitting} />
      <NoteField value={note} onChange={setNote} required={noteRequired} risky={risky} hint={reopening && !risky ? t("reopeningACompletedMilestoneAdd") : undefined} />
      <EvidenceField items={evidence} onChange={setEvidence} upload={upload} />
    </form>
  );
}

// ── Shared field pieces ──────────────────────────────────────────────────────

const isRisky = (status: ObjectiveStatus | null) => status === "AtRisk" || status === "OffTrack";

const STATUS_OPTIONS: { value: ObjectiveStatus; mark: string; selected: string }[] = [
  { value: "OnTrack", mark: "bg-success-subtle text-success", selected: "border-success bg-success-subtle/40 ring-success/30" },
  { value: "AtRisk", mark: "bg-primary text-primary-foreground", selected: "border-primary bg-primary-tint ring-primary-ring" },
  { value: "OffTrack", mark: "bg-destructive/12 text-destructive", selected: "border-destructive bg-destructive/10 ring-destructive/30" },
];

/** "How it's going": the owner's status as three tiles (PlanDrawer board). Required with every check-in. */
function StatusPicker({ value, onChange, disabled }: { value: ObjectiveStatus | null; onChange: (value: ObjectiveStatus) => void; disabled?: boolean }) {
  const t = useTranslations("progress.StatusPicker");
  return (
    <fieldset>
      <legend className="type-subsection-title text-foreground">{t("howItsGoing")}</legend>
      {/* eslint-disable-next-line no-restricted-syntax -- on track, at risk and off track keep their status colours when chosen */}
      <div role="radiogroup" aria-label={t("howItsGoing")} className="mt-2.5 grid grid-cols-3 gap-2.5">
        {STATUS_OPTIONS.map((option) => {
          const on = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                "flex flex-col items-start gap-3 rounded-control border px-3 py-3 text-start type-subsection-title text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on ? cn("ring-2", option.selected) : "border-border hover:border-foreground/30"
              )}
            >
              <span className={cn("flex size-7 items-center justify-center rounded-control-sm", option.mark)} aria-hidden>
                {option.value === "OnTrack" ? <Check className="size-3.5" /> : option.value === "AtRisk" ? <span className="type-subsection-title leading-none">!</span> : <X className="size-3.5" />}
              </span>
              {t(option.value)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * A number input with a unit suffix and its own up/down stepper. `min`/`max` are hard guardrails: typing,
 * pasting, or stepping past a bound snaps back to it, so the control can never express an impossible value.
 */
function NumberField({
  id,
  value,
  onChange,
  suffix,
  placeholder,
  min,
  max,
  base,
  integer,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  /** Where stepping/scrolling starts while the field is still empty — the current committed value, so the
   *  first tick nudges the real value instead of snapping to 0. */
  base?: number;
  /** Constrain to whole numbers — a manual completion percent has no MVP need for decimals, so 65.4 snaps
   *  to 65 as it is typed. Raw numeric values keep their precision (integer stays off). */
  integer?: boolean;
}) {
  const t = useTranslations("progress.NumberField");
  const ref = useRef<HTMLInputElement>(null);

  // Snap a numeric string into [min, max] (and to a whole number when integer); empty and partial entries
  // ("-", ".") pass through untouched.
  const clamp = (raw: string): string => {
    if (raw === "") return "";
    const n = Number(raw);
    if (!Number.isFinite(n)) return raw;
    let c = integer ? Math.round(n) : n;
    if (min != null && c < min) c = min;
    if (max != null && c > max) c = max;
    return c === n ? raw : String(c);
  };
  const step = (delta: number) => {
    const start = value === "" ? base ?? min ?? 0 : Number(value);
    let next = (Number.isFinite(start) ? start : min ?? 0) + delta;
    if (min != null && next < min) next = min;
    if (max != null && next > max) next = max;
    onChange(String(next));
  };

  // Own the wheel so a scroll over the focused field nudges from the current value rather than the browser's
  // empty-is-zero default. Non-passive so the page does not scroll while adjusting.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (document.activeElement !== el || e.deltaY === 0) return;
      e.preventDefault();
      step(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  return (
    <div className="flex h-11 w-full items-stretch overflow-hidden rounded-control border border-input bg-transparent focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40">
      <input
        ref={ref}
        id={id}
        type="number"
        inputMode={integer ? "numeric" : "decimal"}
        step={integer ? 1 : "any"}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(clamp(e.target.value))}
        placeholder={placeholder}
        autoFocus
        // eslint-disable-next-line no-restricted-syntax -- a text input stays at 1rem (DESIGN.md §3); no role sets that size
        className="min-w-0 flex-1 bg-transparent px-3.5 text-base tabular-nums text-foreground outline-none placeholder:text-muted-foreground/60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {suffix ? (
        <span className="flex items-center pe-1 type-label text-muted-foreground">{suffix}</span>
      ) : null}
      <div className="flex w-9 shrink-0 flex-col border-s border-input">
        <button
          type="button"
          aria-label={t("increase")}
          onClick={() => step(1)}
          className="flex flex-1 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronUp className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t("decrease")}
          onClick={() => step(-1)}
          className="flex flex-1 items-center justify-center border-t border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronDown className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** The derived progress card — the headline figure over its own bar, shared by the recorder's live preview
 *  and the details drawer's committed current-progress read. Progress is a whole-percent readout (the raw
 *  value lives on the rail above where present); decimals would be false precision. Pass no `label` to let a
 *  surrounding section title carry the heading. */
export function DerivedCard({
  derived,
  from,
  subtitle,
  label,
}: {
  derived: number;
  from?: number | null;
  subtitle?: string;
  label?: string;
}) {
  const t = useTranslations("progress.DerivedCard");
  const complete = derived >= 100;
  const clamped = Math.max(0, Math.min(100, derived));
  return (
    <div className="rounded-surface bg-popover p-4 dark:bg-card">
      {label ? <p className="type-meta text-muted-foreground">{label}</p> : null}
      <div className={cn("flex items-center gap-3", label && "mt-2")}>
        <span className={cn("type-metric", complete ? "text-success" : "text-foreground")}>
          {Math.round(derived)}%
        </span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <span className={cn("block h-full rounded-full", complete ? "bg-success" : "bg-[var(--type-accent,var(--primary))]")} style={{ width: `${clamped}%` }} />
        </div>
        {from != null ? <span className="shrink-0 type-meta text-muted-foreground tabular-nums">{t("from", { from: Math.round(from) })}</span> : null}
      </div>
      {subtitle ? <p className="mt-2 type-meta text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}

/** The note, with a live character count. At risk or off track, it is the reason: "What's in the way". */
function NoteField({
  value,
  onChange,
  required,
  risky,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  risky?: boolean;
  hint?: string;
}) {
  const t = useTranslations("progress.NoteField");
  return (
    <div className="space-y-2">
      <Label htmlFor="pv-note">
        {risky ? t("whatsInTheWay") : t("addANote")}{" "}
        {risky ? null : required ? <span className="text-destructive">{t("required")}</span> : <span className="text-muted-foreground">{t("optional")}</span>}
      </Label>
      <div className="relative">
        <Textarea
          id="pv-note"
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, NOTE_MAX))}
          rows={3}
          maxLength={NOTE_MAX}
          placeholder={risky ? undefined : t("eGKeyActivitiesCompleted")}
          className="resize-none pb-6"
        />
        <span className="pointer-events-none absolute bottom-2 inset-e-3 type-meta tabular-nums text-muted-foreground/70">
          {value.length}/{NOTE_MAX}
        </span>
      </div>
      {hint ? <p className="type-meta text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Evidence — the optional attachments that support this one update. */
function EvidenceField({
  items,
  onChange,
  upload,
}: {
  items: EvidenceInput[];
  onChange: (items: EvidenceInput[]) => void;
  upload: UploadFn;
}) {
  const t = useTranslations("progress.EvidenceField");
  return (
    <div className="space-y-2">
      <Label>{t("addEvidence")} <span className="text-muted-foreground">{t("optional")}</span></Label>
      <EvidenceUploader items={items} onChange={onChange} upload={upload} />
    </div>
  );
}

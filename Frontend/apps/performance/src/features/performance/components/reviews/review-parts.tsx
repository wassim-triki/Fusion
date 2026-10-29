import type { ReactNode } from "react";
import type { RatingScaleLevelDto } from "@repo/api";
import { cn } from "@repo/ds/lib/utils";
import { formatDate } from "@repo/ds/lib/dates";
import { Check, Clock } from "@/lib/icons";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";
import { english, type Say } from "@/i18n/say";

// The slice 4 review language (approved canvas, B-070): stage tracks, count tiles, segment ratings, level cards and dials.

/** A date-only value as the boards say it: "Wed 15 Sept" (the year outside this year). */
/** Review words in English, for helpers outside a translated tree. */
const en = english("reviews.parts");

export function dayLabel(value: string | null | undefined, locale?: string): string {
  return formatDate(value?.slice(0, 10), { weekday: true, fallback: "", locale });
}

/** Whole days from today to a date-only value (negative when past). */
export function daysFromToday(value: string | null | undefined): number | null {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86_400_000);
}

/** "due in 6 days", "due today", "2 days late". */
export function dueIn(value: string | null | undefined, say: Say = en): string {
  const days = daysFromToday(value);
  if (days === null) return "";
  if (days === 0) return say("dueToday");
  if (days === 1) return say("dueTomorrow");
  if (days > 1) return say("dueInDays", { count: days });
  return days === -1 ? say("dayLate") : say("daysLate", { count: -days });
}


export type StepState = "done" | "current" | "late" | "todo";
export interface Step {
  label: string;
  detail?: ReactNode;
  state: StepState;
}

/** Where a review or round stands: a line of stages, the current one marked. */
export function StageTrack({ steps, className, label }: { steps: Step[]; className?: string; label: string }) {
  return (
    <ol aria-label={label} className={cn("grid gap-4", className)} style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((step, index) => (
        <li key={step.label} aria-current={step.state === "current" || step.state === "late" ? "step" : undefined} className="relative min-w-0">
          <div className="flex items-center">
            <StepDot state={step.state} />
            {index < steps.length - 1 ? (
              <span aria-hidden className={cn("ms-2 h-px flex-1", step.state === "done" ? "bg-success/60" : "bg-border")} />
            ) : null}
          </div>
          <p className={cn("mt-2.5 type-label",
            step.state === "current" ? "text-primary" : step.state === "late" ? "text-destructive" : "text-foreground")}>
            {step.label}
          </p>
          {step.detail ? <p className="mt-0.5 type-meta text-muted-foreground">{step.detail}</p> : null}
        </li>
      ))}
    </ol>
  );
}

function StepDot({ state }: { state: StepState }) {
  if (state === "done")
    return <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success text-background"><Check className="size-3" aria-hidden /></span>;
  if (state === "current" || state === "late")
    return (
      <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border-2",
        state === "late" ? "border-destructive" : "border-primary")}>
        <span className={cn("size-2 rounded-full", state === "late" ? "bg-destructive" : "bg-primary")} />
      </span>
    );
  return <span className="size-5 shrink-0 rounded-full border border-border bg-inlay" />;
}

/** A counted stage: the label, the number against its total, a fill and one fact beneath. */
export function CountTile({
  label,
  value,
  total,
  foot,
  aside,
  tone = "success",
  className,
}: {
  label: string;
  value: number | string;
  total?: number;
  foot?: ReactNode;
  aside?: ReactNode;
  tone?: "success" | "primary" | "muted";
  className?: string;
}) {
  const share = typeof value === "number" && total ? Math.min(100, Math.round((value / total) * 100)) : null;
  return (
    <div className={cn("rounded-surface bg-card p-5", className)}>
      <p className="type-meta text-muted-foreground">{label}</p>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="type-metric text-foreground">{value}</span>
        {total !== undefined ? <span className="type-meta tabular-nums text-muted-foreground">/ {total}</span> : null}
      </p>
      {share !== null ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-inlay" aria-hidden>
          <div className={cn("h-full rounded-full", tone === "primary" ? "bg-primary" : tone === "muted" ? "bg-muted-foreground" : "bg-success")} style={{ width: `${share}%` }} />
        </div>
      ) : null}
      {foot || aside ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="type-meta text-muted-foreground">{foot}</span>
          {aside}
        </div>
      ) : null}
    </div>
  );
}

/** A due date as a mark: warning while open, danger once late. */
export function DueChip({ date, late = false, label }: { date: string | null | undefined; late?: boolean; label?: string }) {
  const format = useFormat();
  if (!date) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control-sm px-2 py-0.5 type-meta-strong tabular-nums",
      late ? "bg-destructive/15 text-destructive" : "bg-warning-subtle text-warning")}>
      <Clock className="size-3.5" aria-hidden />
      {label ?? dayLabel(date, format.locale)}
    </span>
  );
}

/** A rating as a row of levels. Editable with `onChange`; `theirs` rings the other person's level beside yours. */
export function SegmentRating({
  levels,
  value,
  onChange,
  theirs,
  label,
  disabled = false,
}: {
  levels: RatingScaleLevelDto[];
  value: number | null;
  onChange?: (value: number) => void;
  theirs?: number | null;
  label: string;
  disabled?: boolean;
}) {
  const parts = useTranslations("reviews.parts");
  return (
    <div role={onChange ? "radiogroup" : "img"} aria-label={onChange ? label : parts("rated", { label, value: levels.find((l) => l.value === value)?.label ?? parts("notRated") })}
      className="inline-flex items-center gap-0.5 rounded-control bg-inlay p-0.5">
      {levels.map((level) => {
        const selected = value === level.value;
        const other = theirs === level.value;
        const common = cn("flex size-7 items-center justify-center rounded-nested type-meta-strong tabular-nums transition-colors",
          selected ? "bg-primary text-primary-foreground" : other ? "text-info ring-1 ring-info ring-inset" : "text-muted-foreground");
        return onChange ? (
          <button key={level.value} type="button" role="radio" aria-checked={selected} aria-label={`${level.value} ${level.label}`}
            disabled={disabled} onClick={() => onChange(level.value)}
            className={cn(common, !selected && "hover:bg-card hover:text-foreground", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60")}>
            {level.value}
          </button>
        ) : (
          <span key={level.value} className={common}>{level.value}</span>
        );
      })}
    </div>
  );
}

/** The overall view as a row of level cards (boards 08, 12). `theirs` underlines the other person's choice. */
export function LevelCards({
  levels,
  value,
  onChange,
  theirs,
  label,
  disabled = false,
}: {
  levels: RatingScaleLevelDto[];
  value: number | null;
  onChange?: (value: number) => void;
  theirs?: number | null;
  label: string;
  disabled?: boolean;
}) {
  const t = useTranslations("reviews.LevelCards");
  return (
    // eslint-disable-next-line no-restricted-syntax -- the rating scale shows each level's number and the reviewer's marker; a scale, not a few options
    <div role="radiogroup" aria-label={label} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${levels.length}, minmax(0, 1fr))` }}>
      {levels.map((level) => {
        const selected = value === level.value;
        return (
          <button key={level.value} type="button" role="radio" aria-checked={selected} disabled={disabled || !onChange}
            onClick={() => onChange?.(level.value)}
            className={cn("relative rounded-control border px-3 py-2.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected ? "border-primary bg-primary-tint text-primary-ink" : "border-transparent bg-inlay text-foreground hover:border-border",
              "disabled:cursor-default")}>
            <span className="block type-label tabular-nums">{level.value}</span>
            <span className="block type-meta text-muted-foreground">{level.label}</span>
            {theirs === level.value ? <span aria-label={t("theirView")} className="absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-info" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Objective progress as a small ring with its figure. */
export function ProgressRing({ value, size = 48, tone }: { value: number | null; size?: number; tone?: "success" | "warning" }) {
  const t = useTranslations("reviews.ProgressRing");
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const share = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-label={value === null ? t("noProgressYet") : t("progress", { share: Math.round(share) })} role="img">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        {value !== null && share > 0 ? (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${(share / 100) * c} ${c}`} className={tone === "warning" ? "stroke-warning" : "stroke-success"} />
        ) : null}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center type-meta-strong tabular-nums text-foreground">
        {value === null ? "–" : `${Math.round(share)}%`}
      </span>
    </div>
  );
}

/** A section heading with its count and an optional note or action on the right. */
export function SectionHeading({ title, count, aside, id }: { title: string; count?: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
      <h2 id={id} className="type-section-title text-foreground">
        {title}
        {count !== undefined ? <span className="ms-1.5 type-meta tabular-nums text-muted-foreground">{count}</span> : null}
      </h2>
      {aside ? <div className="type-meta text-muted-foreground">{aside}</div> : null}
    </div>
  );
}

/** A small label over a value, for fact rows inside a card. */
export function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="type-meta text-muted-foreground">{label}</p>
      <div className="mt-1 type-body text-foreground">{children}</div>
    </div>
  );
}

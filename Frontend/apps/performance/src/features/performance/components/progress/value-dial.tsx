"use client";

import { useId, type ReactNode } from "react";
import { Minus, Plus, RotateCcw } from "@/lib/icons";
import { cn } from "@repo/ds/lib/utils";
import type { DialDomain } from "./value-dial-lib";
import { useTranslations } from "next-intl";

/**
 * Direct-manipulation entry for a progress value: a large readout with nudge buttons over a rail you
 * drag, click or key along. A transparent native range input owns the interaction (pointer, touch,
 * arrows, Home/End, PageUp/Down, screen readers); the rail beneath is drawn to show the baseline, the
 * target, the overachievement run past it, and where the last report sits.
 */
export function ValueDial({
  label,
  domain,
  value,
  reported,
  onChange,
  format,
  startLabel,
  targetLabel,
  progressOf,
}: {
  label: string;
  domain: DialDomain;
  /** The pending value; null while untouched (the dial rests on the reported value). */
  value: number | null;
  /** The last reported value, if any — the rest position and the "last report" mark. */
  reported: number | null;
  onChange: (value: number | null) => void;
  format: (value: number) => string;
  /** Caption under the rail's start (e.g. "Baseline"). */
  startLabel: string;
  /** Caption under the target mark; omitted for a plain 0–100 scale. */
  targetLabel?: string;
  /** Objective progress (0..∞ %) a value produces — rides in the handle, and marks the last report. */
  progressOf: (value: number) => number;
}) {
  const t = useTranslations("progress.ValueDial");
  const id = useId();
  const restValue = reported ?? domain.valueAt(domain.baselinePos);
  const shown = value ?? restValue;
  const pos = domain.positionOf(shown);
  const touched = value != null;
  const reportedPos = reported != null ? domain.positionOf(reported) : null;

  const at = (p: number) => `${(p / domain.max) * 100}%`;
  const fillFrom = Math.min(domain.baselinePos, pos);
  const fillTo = Math.max(domain.baselinePos, pos);
  const past = domain.targetPos != null && pos > domain.targetPos;
  const progress = Math.round(progressOf(shown));
  const complete = progress >= 100;
  const handleLeft = `clamp(1.5rem, ${at(pos)}, calc(100% - 1.5rem))`;
  const wasEdge = reportedPos != null ? reportedPos / domain.max : 0;

  const set = (p: number) => {
    const next = domain.valueAt(Math.max(0, Math.min(domain.max, p)));
    // Landing back on the reported value is "no change", not a new report.
    onChange(reported != null && next === reported ? null : next);
  };

  return (
    <div className="rounded-surface bg-popover p-4 dark:bg-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <label htmlFor={id} className="type-meta text-muted-foreground">
            {label}
          </label>
          <p
            className={cn(
              "mt-1.5 type-metric transition-colors",
              touched ? "text-foreground" : "text-muted-foreground"
            )}
            aria-hidden
          >
            {format(shown)}
          </p>
          {reported == null ? <p className="mt-2 type-meta text-muted-foreground">{t("notReportedYet")}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {touched ? (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="me-1 inline-flex items-center gap-1 rounded-detail type-meta-strong text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              {t("reset")}
            </button>
          ) : null}
          <NudgeButton label={t("decrease")} disabled={pos <= 0} onClick={() => set(pos - 1)}>
            <Minus className="size-4" aria-hidden />
          </NudgeButton>
          <NudgeButton label={t("increase")} disabled={pos >= domain.max} onClick={() => set(pos + 1)}>
            <Plus className="size-4" aria-hidden />
          </NudgeButton>
        </div>
      </div>

      {/* The rail. The native range sits on top, invisible, so every input method works; the visuals follow. */}
      <div className={cn("relative h-7", reported != null ? "mt-10" : "mt-5")}>
        {/* The last report as one marker: a tag over a stem down to its dot on the rail. It sits above the
            rail, so it never fights the handle, and stays put as the reference while you drag. */}
        {reportedPos != null && reported != null ? (
          <>
            <span
              className="absolute -top-8 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-popover px-2 py-0.5 type-meta tabular-nums text-muted-foreground shadow-raised dark:bg-card"
              style={{
                left: at(reportedPos),
                transform: wasEdge < 0.2 ? "translateX(-0.75rem)" : wasEdge > 0.8 ? "translateX(calc(-100% + 0.75rem))" : "translateX(-50%)",
              }}
              aria-hidden
            >
              <span className="font-medium text-foreground/80">{t("last")}</span>
              {format(reported)}
              {/* At rest the handle already shows this %; it joins the tag once the value moves away. */}
              {touched ? (
                <>
                  <span className="text-border">·</span>
                  <span className="font-semibold text-foreground/80">{Math.round(progressOf(reported))}%</span>
                </>
              ) : null}
            </span>
            <span
              className="absolute -top-2 h-3.5 w-px -translate-x-1/2 bg-border"
              style={{ left: at(reportedPos) }}
              aria-hidden
            />
          </>
        ) : null}
        <div className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 overflow-hidden rounded-full bg-muted-foreground/15">
          {/* Overachievement run past the target reads as an extension, not more of the same track. */}
          {domain.targetPos != null && domain.targetPos < domain.max ? (
            <span
              className="absolute inset-y-0 inset-e-0 bg-[repeating-linear-gradient(135deg,transparent_0_4px,color-mix(in_oklab,var(--muted-foreground)_14%,transparent)_4px_8px)]"
              style={{ left: at(domain.targetPos) }}
            />
          ) : null}
          <span
            className={cn(
              "absolute inset-y-0 transition-[left,right] duration-75",
              past ? "bg-success" : "bg-[var(--type-accent,var(--primary))]"
            )}
            style={{ left: at(fillFrom), right: `calc(100% - ${at(fillTo)})` }}
          />
        </div>

        {domain.targetPos != null ? (
          <span
            className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/50"
            style={{ left: at(domain.targetPos) }}
            aria-hidden
          />
        ) : null}

        {reportedPos != null && reportedPos !== pos ? (
          <span
            className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/45 ring-2 ring-popover dark:ring-card"
            style={{ left: at(reportedPos) }}
            aria-hidden
          />
        ) : null}

        <input
          id={id}
          type="range"
          min={0}
          max={domain.max}
          step={1}
          value={pos}
          onChange={(e) => set(Number(e.target.value))}
          aria-valuetext={`${format(shown)}, ${progress}%`}
          className="peer absolute inset-0 z-10 w-full cursor-pointer opacity-0"
        />

        {/* The handle carries the progress the value produces; it stops at the rail ends rather than spill. */}
        <span
          className={cn(
            "pointer-events-none absolute top-1/2 z-0 flex h-7 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 bg-background type-meta-strong tabular-nums shadow-raised transition-[left,box-shadow,color] duration-75",
            "peer-hover:ring-4 peer-hover:ring-[color-mix(in_oklab,var(--type-accent,var(--primary))_20%,transparent)]",
            "peer-focus-visible:ring-4 peer-focus-visible:ring-ring/50",
            past || complete ? "border-success text-success" : "border-[var(--type-accent,var(--primary))]",
            !touched && "text-muted-foreground"
          )}
          style={{ left: handleLeft }}
          aria-hidden
        >
          {progress}%
        </span>
      </div>

      {/* Scale captions: start at the baseline, the target under its mark. */}
      <div className="relative mt-1.5 h-8 type-meta tabular-nums">
        <Caption left={at(domain.baselinePos)} edge={domain.baselinePos / domain.max} value={format(domain.valueAt(domain.baselinePos))} label={startLabel} />
        {domain.targetPos != null && targetLabel ? (
          <Caption left={at(domain.targetPos)} edge={domain.targetPos / domain.max} value={format(domain.valueAt(domain.targetPos))} label={targetLabel} />
        ) : (
          <Caption left="100%" edge={1} value={format(domain.valueAt(domain.max))} label="" />
        )}
      </div>
    </div>
  );
}

function NudgeButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-9 items-center justify-center rounded-control-sm border border-border text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** A caption pinned under a point on the rail; near either end it anchors to that edge instead of centring past it. */
function Caption({ left, edge, value, label }: { left: string; edge: number; value: string; label: string }) {
  const transform = edge < 0.12 ? "translateX(0)" : edge > 0.88 ? "translateX(-100%)" : "translateX(-50%)";
  const align = edge < 0.12 ? "text-start" : edge > 0.88 ? "text-end" : "text-center";
  return (
    <div className={cn("absolute top-0 whitespace-nowrap leading-tight", align)} style={{ left, transform }}>
      <p className="font-medium text-foreground">{value}</p>
      {label ? <p className="text-muted-foreground">{label}</p> : null}
    </div>
  );
}


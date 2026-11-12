import { cn } from "@repo/ds/lib/utils";
import type { ReactNode } from "react";

/**
 * Insights' charts (D-90): one scale each, this year in the accent (`--chart-1`, a clear yellow-gold in both modes,
 * D-95), last year a dashed grey, labels in ink.
 */
export const THIS_YEAR = "var(--chart-1)";
export const LAST_YEAR = "var(--muted-foreground)";

/** Which line is which: a solid key for this year, a dashed one for last. */
export function YearKeys({ current, previous, mark = "line" }: { current: string; previous?: string | null; mark?: "line" | "bar" | "dot" }) {
  const swatch = (last: boolean) =>
    mark === "line" ? (
      <svg aria-hidden width="18" height="6" className="shrink-0">
        <line x1="1" y1="3" x2="17" y2="3" stroke={last ? LAST_YEAR : THIS_YEAR} strokeWidth="2" strokeDasharray={last ? "4 3" : undefined} />
      </svg>
    ) : (
      <span
        aria-hidden
        className={cn("shrink-0", mark === "dot" ? "size-2.5 rounded-full" : "size-2.5 rounded-[3px]", last && mark === "dot" && "border-2 bg-transparent")}
        style={last ? (mark === "dot" ? { borderColor: LAST_YEAR } : { background: `color-mix(in oklab, ${LAST_YEAR} 45%, transparent)` }) : { background: THIS_YEAR }}
      />
    );
  return (
    <span className="ms-auto flex items-center gap-4 type-caption text-muted-foreground">
      <span className="flex items-center gap-1.5">{swatch(false)}{current}</span>
      {previous ? <span className="flex items-center gap-1.5">{swatch(true)}{previous}</span> : null}
    </span>
  );
}

export interface LinePoint {
  x: number;
  y: number;
}

/** A line chart on one scale: this year solid with a soft fill, last year dashed, ticks along the bottom. */
export function LineChart({
  current, previous, xMax, yMax, yTicks, xTicks, suffix = "", height = 180, label,
}: {
  current: LinePoint[];
  previous?: LinePoint[] | null;
  xMax: number;
  yMax: number;
  yTicks: number[];
  xTicks: { x: number; label: string }[];
  suffix?: string;
  height?: number;
  label: string;
}) {
  const X = (v: number) => (xMax === 0 ? 0 : (v / xMax) * 100);
  const Y = (v: number) => 100 - (yMax === 0 ? 0 : (Math.min(v, yMax) / yMax) * 100);
  const path = (points: LinePoint[]) => points.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ");
  const end = current.at(-1);
  return (
    <figure aria-label={label} className="m-0">
      <div className="relative ms-9" style={{ height }}>
        {yTicks.map((tick) => (
          <span key={tick} className="absolute inset-x-0 border-t border-dashed border-border" style={{ top: `${Y(tick)}%` }}>
            <i className="absolute -start-9 -translate-y-1/2 type-caption not-italic tabular-nums text-muted-foreground">
              {tick}
              {suffix}
            </i>
          </span>
        ))}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
          {current.length > 1 ? (
            <polygon
              points={`${X(current[0]!.x)},100 ${path(current)} ${X(end!.x)},100`}
              fill={`color-mix(in oklab, ${THIS_YEAR} 14%, transparent)`}
            />
          ) : null}
          {previous && previous.length > 1 ? (
            <polyline points={path(previous)} fill="none" stroke={LAST_YEAR} strokeWidth="1.75" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          ) : null}
          {current.length > 1 ? (
            <polyline points={path(current)} fill="none" stroke={THIS_YEAR} strokeWidth="2.25" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          ) : null}
        </svg>
        {end ? (
          <span
            aria-hidden
            className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card rtl:translate-x-1/2"
            style={{ insetInlineStart: `${X(end.x)}%`, top: `${Y(end.y)}%`, background: THIS_YEAR }}
          />
        ) : null}
      </div>
      <div className="relative ms-9 mt-2 h-4">
        {xTicks.map((tick) => (
          <span
            key={`${tick.x}-${tick.label}`}
            className="absolute -translate-x-1/2 type-caption whitespace-nowrap text-muted-foreground rtl:translate-x-1/2"
            style={{ insetInlineStart: `${X(tick.x)}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Columns this year beside last year's, each with its count on top. */
export function PairedColumns({
  columns, max, height = 180, label,
}: {
  columns: { key: string; label: string; current: number; previous?: number | null; onOpen?: () => void; tip: string }[];
  max: number;
  height?: number;
  label: string;
}) {
  const h = (v: number) => (max === 0 ? 0 : (v / max) * height);
  return (
    <figure aria-label={label} className="m-0 grid items-end gap-2" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
      {columns.map((column) => (
        <button
          key={column.key}
          type="button"
          onClick={column.onOpen}
          disabled={!column.onOpen}
          title={column.tip}
          className="group flex flex-col items-center gap-2 rounded-inset outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
        >
          {/* Room above the tallest column for its count. */}
          <span className="flex items-end gap-1" style={{ height: height + 22 }}>
            <Column value={column.current} height={h(column.current)} color={THIS_YEAR} />
            {column.previous != null ? (
              <Column value={column.previous} height={h(column.previous)} color={`color-mix(in oklab, ${LAST_YEAR} 45%, transparent)`} muted />
            ) : null}
          </span>
          <span className="text-center type-caption leading-tight whitespace-nowrap text-foreground group-enabled:group-hover:underline">{column.label}</span>
        </button>
      ))}
    </figure>
  );
}

function Column({ value, height, color, muted = false }: { value: number; height: number; color: string; muted?: boolean }) {
  return (
    <span className="flex w-7 flex-col items-center justify-end gap-1">
      <span className={cn("type-caption font-semibold tabular-nums", muted ? "text-muted-foreground" : "text-foreground")}>{value}</span>
      <span className="w-full rounded-t-[6px]" style={{ height: Math.max(height, value > 0 ? 3 : 0), background: color }} />
    </span>
  );
}

/** A bar on its row's track; empty tracks are striped (D-83). */
export function Bar({ share, color = THIS_YEAR, thin = false }: { share: number; color?: string; thin?: boolean }) {
  return (
    <span className={cn("relative block overflow-hidden rounded-full", thin ? "h-1.5" : "h-3 bar-stripes")}>
      <span className="absolute inset-y-0 start-0 rounded-full" style={{ width: `${Math.max(0, Math.min(100, share))}%`, background: color }} />
    </span>
  );
}

/** A row that opens its people: a name with its count, the chart part, a figure at the end. */
export function FigureRow({ name, sub, chart, figure, onOpen, columns = "minmax(150px, 190px) minmax(0, 1fr) 64px" }: {
  name: ReactNode;
  sub?: ReactNode;
  chart: ReactNode;
  figure: ReactNode;
  onOpen?: () => void;
  columns?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      className="grid w-full items-center gap-4 rounded-inset px-2 py-1.5 text-start outline-none hover:bg-inlay/60 focus-visible:ring-2 focus-visible:ring-ring disabled:hover:bg-transparent"
      style={{ gridTemplateColumns: columns }}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate type-label font-semibold">{name}</span>
        {sub ? <span className="truncate type-caption text-muted-foreground">{sub}</span> : null}
      </span>
      <span className="min-w-0">{chart}</span>
      <span className="text-end type-label font-semibold tabular-nums">{figure}</span>
    </button>
  );
}

/** This year's share as a dot, last year's as a ring, joined by green when it rose and red when it fell. */
export function Dumbbell({ current, previous, lo, hi }: { current: number; previous: number | null; lo: number; hi: number }) {
  const x = (v: number) => ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * 100;
  const up = previous === null || current >= previous;
  return (
    <span className="relative block h-5">
      <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
      {previous !== null ? (
        <>
          <span
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
            style={{
              insetInlineStart: `${x(Math.min(current, previous))}%`,
              width: `${Math.abs(x(current) - x(previous))}%`,
              background: `color-mix(in oklab, ${up ? "var(--success)" : "var(--destructive)"} 45%, transparent)`,
            }}
          />
          <span
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-card rtl:translate-x-1/2"
            style={{ insetInlineStart: `${x(previous)}%`, borderColor: LAST_YEAR }}
          />
        </>
      ) : null}
      <span
        className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card rtl:translate-x-1/2"
        style={{ insetInlineStart: `${x(current)}%`, background: THIS_YEAR }}
      />
    </span>
  );
}

/** The axis above a column of dumbbells. */
export function ShareAxis({ lo, hi, columns }: { lo: number; hi: number; columns: string }) {
  const ticks = [lo, lo + (hi - lo) / 4, lo + (hi - lo) / 2, lo + ((hi - lo) * 3) / 4, hi].map((v) => Math.round(v));
  return (
    <div className="grid gap-4 px-2" style={{ gridTemplateColumns: columns }}>
      <span />
      <span className="relative h-4">
        {ticks.map((tick) => (
          <span
            key={tick}
            className="absolute -translate-x-1/2 type-caption tabular-nums text-muted-foreground rtl:translate-x-1/2"
            style={{ insetInlineStart: `${((tick - lo) / (hi - lo)) * 100}%` }}
          >
            {tick}%
          </span>
        ))}
      </span>
      <span />
    </div>
  );
}

/** The scale a set of shares needs: tens around them, at least forty points wide. */
export function shareRange(values: number[]): { lo: number; hi: number } {
  if (values.length === 0) return { lo: 0, hi: 100 };
  let lo = Math.max(0, Math.floor((Math.min(...values) - 5) / 10) * 10);
  let hi = Math.min(100, Math.ceil((Math.max(...values) + 5) / 10) * 10);
  while (hi - lo < 40) {
    if (lo > 0) lo -= 10;
    if (hi - lo < 40 && hi < 100) hi += 10;
  }
  return { lo, hi };
}

/** A round top for a scale: 4, 8, 12 … under 20, then tens, then the next round hundred. */
export function niceMax(value: number): number {
  if (value <= 0) return 4;
  const step = value <= 20 ? 4 : value <= 100 ? 10 : value <= 500 ? 50 : 100;
  return Math.ceil(value / step) * step;
}

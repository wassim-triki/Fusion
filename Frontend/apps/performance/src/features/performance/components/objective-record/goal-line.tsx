"use client";

import type { ObjectiveStatus, ProgressMilestoneDto, ProgressUpdateDto } from "@repo/api";
import { cn } from "@repo/ds";
import { dateFormatter } from "@repo/ds/lib/dates";
import { useLocale } from "next-intl";

/** A state's colour, for the line and its dots. */
export const STATUS_STROKE: Record<ObjectiveStatus | "none", string> = {
  OnTrack: "var(--success)",
  AtRisk: "var(--primary)",
  OffTrack: "var(--destructive)",
  none: "var(--foreground)",
};

const at = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** Where a date sits between a goal's start and end, 0 to 1. */
export function positionIn(start: string, end: string, iso: string): number {
  const span = Math.max(1, at(end) - at(start));
  return Math.max(0, Math.min(1, (at(iso.slice(0, 10)) - at(start)) / span));
}

/** Where the goal should be by a day: its share of the way, as progress 0–100, on a straight pace from start to end. */
export function paceOn(start: string, end: string, iso: string): number {
  return positionIn(start, end, iso) * 100;
}

const y = (progress: number) => 92 - Math.max(-0.05, Math.min(1.08, progress / 100)) * 84;

/**
 * A goal's year as one drawing (D-76): its progress as a line through each update, against the dashed pace from
 * nothing at its start to all of it at its end; today a rule, and where it should be by now marked on it. Milestones
 * sit along the bottom on their due dates. Progress is the measure's share done (0–100), so every kind of measure
 * reads on the same scale; the labels beside the drawing carry the measure's own units.
 */
export function GoalLine({
  start,
  end,
  today,
  updates,
  milestones,
  status,
  height = 168,
  ghost = false,
  className,
}: {
  start: string;
  end: string;
  today: string;
  /** Oldest first. */
  updates: Pick<ProgressUpdateDto, "recordedAt" | "resultingProgress" | "status">[];
  milestones?: ProgressMilestoneDto[];
  status: ObjectiveStatus | null;
  height?: number;
  /** Before anything is measured: the pace alone, faint (D-48). */
  ghost?: boolean;
  className?: string;
}) {
  const x = (iso: string) => positionIn(start, end, iso) * 100;
  const now = x(today);
  const stroke = STATUS_STROKE[status ?? "none"];
  const points = [{ at: start, progress: 0 }, ...updates.map((u) => ({ at: u.recordedAt.slice(0, 10), progress: u.resultingProgress }))]
    .filter((p) => p.at <= today);
  const last = points[points.length - 1]!;

  return (
    <div className={cn("relative", className)} style={{ height }}>
      <span aria-hidden className="absolute inset-x-0 bottom-[8%] h-px bg-border" />
      <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
        <line x1="0" y1={y(0)} x2="100" y2={y(100)} stroke="var(--muted-foreground)" strokeWidth="1.5" strokeDasharray="5 5"
          vectorEffect="non-scaling-stroke" opacity={ghost ? 0.5 : 0.7} />
        {!ghost && points.length > 1 ? (
          <polyline points={points.map((p) => `${x(p.at)},${y(p.progress)}`).join(" ")} fill="none" stroke={stroke} strokeWidth="2.25"
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ) : null}
      </svg>
      {!ghost
        ? points.slice(1).map((p, i, all) => (
            <span
              key={`${p.at}-${i}`}
              aria-hidden
              className={cn("absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card", i === all.length - 1 ? "size-3" : "size-2")}
              style={{ left: `${x(p.at)}%`, top: `${y(p.progress)}%`, background: stroke }}
            />
          ))
        : null}
      {!ghost && today < end ? (
        <span
          aria-hidden
          className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-muted-foreground bg-card"
          style={{ left: `${now}%`, top: `${y(paceOn(start, end, today))}%` }}
        />
      ) : null}
      {milestones?.map((m) => (
        <span
          key={m.id}
          aria-hidden
          className={cn("absolute bottom-[8%] size-2.5 -translate-x-1/2 translate-y-1/2 rotate-45 rounded-detail border-2 border-card",
            m.isCompleted ? "bg-success" : m.dueDate && m.dueDate < today ? "bg-destructive" : "bg-muted-foreground/60")}
          style={{ left: `${x(m.dueDate ?? end)}%` }}
        />
      ))}
      <span aria-hidden className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${now}%` }} />
      {!ghost && points.length > 1 ? <span className="sr-only">{Math.round(last.progress)}%</span> : null}
    </div>
  );
}

/** Every other month under a goal's line. */
export function GoalMonths({ start, end }: { start: string; end: string }) {
  const locale = useLocale();
  const name = dateFormatter({ month: "short" }, locale);
  const months: string[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  for (let i = 0; i < 14; i++) {
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    const iso = `${year}-${String(month).padStart(2, "0")}-01`;
    if (iso > end) break;
    if (i % 2 === 0) months.push(iso);
  }
  return (
    <div aria-hidden className="relative mt-1.5 h-4">
      {months.map((m) => (
        <span key={m} className="absolute -translate-x-1/2 type-meta text-muted-foreground" style={{ left: `${positionIn(start, end, m) * 100}%` }}>
          {name.format(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1))}
        </span>
      ))}
    </div>
  );
}

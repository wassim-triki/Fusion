"use client";

import type { AgendaSourceKind, ObjectiveStatus, OneOnOneBeatDto } from "@repo/api";
import { cn } from "@repo/ds/lib/utils";
import { Check, MessageSquare, RefreshCw, Sparkles, Star, Target } from "@repo/ds/icons";
import { rhythmPosition, rhythmWindow, shortDay } from "./one-on-one-lib";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";
import { useOneOnOneWords } from "./one-on-one-lib";

const SOURCE_ICON: Record<AgendaSourceKind, typeof Target> = {
  Objective: Target,
  UpdateRequest: RefreshCw,
  Feedback: MessageSquare,
  Praise: Star,
  Action: Check,
  Starter: Sparkles,
};


/**
 * Where a talking point came from, as an icon well: the shape tells sources apart, and only an objective in trouble
 * takes a tint, because that is state.
 */
export function SourceWell({ kind, status, size = "md" }: { kind: AgendaSourceKind; status?: ObjectiveStatus | null; size?: "sm" | "md" }) {
  const Icon = SOURCE_ICON[kind];
  const risky = kind === "Objective" && (status === "AtRisk" || status === "OffTrack");
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-control border",
        size === "sm" ? "size-7" : "size-9",
        risky ? "border-primary-ring bg-primary-tint text-primary-ink" : "border-border bg-inlay text-muted-foreground",
      )}
    >
      <Icon className={size === "sm" ? "size-3.5" : "size-4"} />
    </span>
  );
}

/** A meeting time as a block: the day over the time; today's in amber. */
export function TimeBlock({ iso, size = "md", className }: { iso: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const w = useOneOnOneWords();
  const { day, time, today } = w.timeBlock(iso);
  if (size === "sm") {
    return (
      <span
        className={cn(
          "inline-flex items-baseline gap-1.5 rounded-control-sm px-2 py-1",
          today ? "bg-primary-tint text-primary-ink ring-1 ring-primary-ring" : "bg-inlay text-foreground",
          className,
        )}
      >
        <span className={cn("type-eyebrow", today ? "" : "text-muted-foreground")}>{day}</span>
        <span className="type-label tabular-nums">{time}</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 flex-col items-center justify-center rounded-control text-center",
        size === "lg" ? "w-20 py-2.5" : "w-16 py-2",
        today ? "bg-primary-tint text-primary-ink ring-1 ring-primary-ring" : "bg-inlay text-foreground",
        className,
      )}
    >
      <span className={cn("type-eyebrow", today ? "" : "text-muted-foreground")}>{day}</span>
      <span className={size === "lg" ? "type-metric" : "type-label tabular-nums"}>{time}</span>
    </span>
  );
}

/** Week labels over the rhythm strips, with today marked. */
export function RhythmScale({ className }: { className?: string }) {
  const format = useFormat();
  const tr = useTranslations("oneOnOnes.RhythmScale");
  const window = rhythmWindow();
  const day = 86_400_000;
  const ticks = [-42, -28, -14, 0, 14].map((offset) => window.start + (offset + 42) * day);
  return (
    <div className={cn("relative h-4", className)} aria-hidden>
      {ticks.map((t, i) => (
        <span
          key={t}
          className={cn("absolute -translate-x-1/2 whitespace-nowrap type-meta", i === 3 ? "font-semibold text-primary-ink" : "text-muted-foreground")}
          style={{ left: `${rhythmPosition(t, window) * 100}%` }}
        >
          {i === 3 ? tr("today") : shortDay(new Date(t), format.locale)}
        </span>
      ))}
    </div>
  );
}

/**
 * A series' last six weeks and next meeting on one line: held meetings filled, missed ones hollow, the next ringed.
 * A next meeting beyond the window sits at the end.
 */
export function RhythmStrip({ beats, label }: { beats: readonly OneOnOneBeatDto[]; label: string }) {
  const format = useFormat();
  const t = useTranslations("oneOnOnes.RhythmStrip");
  const window = rhythmWindow();
  const today = rhythmPosition(Date.now(), window);
  const held = beats.filter((b) => b.state === "Completed").length;
  const missed = beats.filter((b) => b.state === "NotHeld").length;
  return (
    <div className="relative h-7" role="img" aria-label={t("heldMissedInTheLast", { label, held, missed })}>
      <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
      <span className="absolute top-0.5 bottom-0.5 w-px bg-primary/50" style={{ left: `${today * 100}%` }} />
      {beats.map((beat) => (
        <span
          key={`${beat.at}-${beat.state}`}
          title={`${shortDay(beat.at, format.locale)}: ${beat.state === "Completed" ? "held" : beat.state === "NotHeld" ? "missed" : "next"}`}
          className={cn(
            "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full",
            beat.state === "Completed" && "bg-success",
            beat.state === "NotHeld" && "border-2 border-muted-foreground/60 bg-card",
            beat.state === "Upcoming" && "border-2 border-primary bg-card ring-4 ring-primary-tint",
          )}
          style={{ left: `${rhythmPosition(beat.at, window) * 100}%` }}
        />
      ))}
    </div>
  );
}

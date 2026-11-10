import type { ReactNode } from "react";
import { Check, CircleAlert, TriangleAlert, X } from "../icons";
import { cn } from "../lib/utils";

/** A thing's state: green, amber, red, or quiet. */
export type StateTone = "ok" | "warn" | "bad" | "muted";

const TONE: Record<StateTone, { className: string; Icon: typeof Check | null }> = {
  ok: { className: "text-success", Icon: Check },
  warn: { className: "text-primary-ink", Icon: TriangleAlert },
  bad: { className: "text-destructive", Icon: X },
  muted: { className: "text-muted-foreground font-medium", Icon: CircleAlert },
};

/**
 * A state as its word in its state colour with its glyph beside it (D-78): On track ✓, At risk ⚠, Off track ✕.
 * Never a pill: state is carried by where a thing sits, a bar's colour or this word (D-52).
 */
export function StateWord({ tone, children, glyph = true, className }: { tone: StateTone; children: ReactNode; glyph?: boolean; className?: string }) {
  const { className: toneClass, Icon } = TONE[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold", toneClass, className)}>
      {glyph && Icon ? <Icon aria-hidden className="size-3.5" /> : null}
      {children}
    </span>
  );
}

import type { ReactNode } from "react";
import { cn } from "../lib/utils";

/** A thing's state: green, amber, red, or quiet. */
export type StateTone = "ok" | "warn" | "bad" | "muted";

const STEPS: Record<Exclude<StateTone, "muted">, { lit: number; className: string }> = {
  ok: { lit: 3, className: "text-success" },
  warn: { lit: 2, className: "text-warning" },
  bad: { lit: 1, className: "text-destructive" },
};

// Three bars rising left to right: x, y, height in a 20×20 box.
const BARS = [[2, 11, 6], [8, 7, 10], [14, 3, 14]] as const;

/**
 * A state as a small three-step meter in its colour with the word in ink beside it (D-96): three bars On track, two
 * At risk, one Off track, the rest faint. At risk and Off track say since when (D-97); On track and headings over a
 * group of people stay the word alone. Never a pill (D-52).
 */
export function StateWord({ tone, children, since, className }: {
  tone: StateTone;
  children: ReactNode;
  /** When it turned, already in words ("since 12 Jul"); shown for At risk and Off track only. */
  since?: ReactNode;
  className?: string;
}) {
  if (tone === "muted") {
    return <span className={cn("inline-flex items-center whitespace-nowrap text-[13px] font-medium text-muted-foreground", className)}>{children}</span>;
  }
  const { lit, className: toneClass } = STEPS[tone];
  return (
    <span className={cn("inline-flex items-center gap-[7px] whitespace-nowrap text-[13px] font-semibold text-foreground", className)}>
      <svg viewBox="0 0 20 20" aria-hidden className={cn("size-[18px] shrink-0", toneClass)}>
        {BARS.map(([x, y, h], i) => (
          <rect key={x} x={x} y={y} width={4} height={h} rx={1.6}
            className={i < lit ? "fill-current" : "fill-muted-foreground/35"} />
        ))}
      </svg>
      {children}
      {since && tone !== "ok" ? <span className="font-normal text-muted-foreground">{since}</span> : null}
    </span>
  );
}

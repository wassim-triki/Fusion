import { cn } from "../lib/utils";

/** The bar's fill colour: the company's, or a state's. */
export type BarTone = "primary" | "ok" | "warn" | "bad" | "muted";

const FILL: Record<BarTone, string> = {
  primary: "bg-primary",
  ok: "bg-success",
  warn: "bg-primary",
  bad: "bg-destructive",
  muted: "bg-muted-foreground/60",
};

/**
 * A progress bar (D-83): a rounded track with its fill; an empty bar is striped, never a flat track, so "nothing
 * yet" reads at a glance. `value` is 0–100; `segments` draws a plan as one bar by weight instead.
 */
export function Bar({
  value,
  tone = "primary",
  segments,
  label,
  size = "md",
  className,
}: {
  value?: number;
  tone?: BarTone;
  /** Several fills side by side, each a share of the whole (a plan's goals by weight). */
  segments?: { value: number; tone?: BarTone; label?: string }[];
  /** Names the bar for assistive tech. */
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const total = segments ? segments.reduce((sum, segment) => sum + segment.value, 0) : (value ?? 0);
  const empty = total <= 0;
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.max(0, Math.min(100, Math.round(total)))}
      data-empty={empty ? "" : undefined}
      className={cn(
        "flex w-full overflow-hidden rounded-full",
        size === "sm" ? "h-1.5" : size === "lg" ? "h-2.5" : "h-2",
        empty ? "bar-stripes" : "bg-inlay",
        className,
      )}
    >
      {segments
        ? segments.map((segment, index) => (
            <i
              key={index}
              title={segment.label}
              className={cn("block h-full transition-[width] duration-500", FILL[segment.tone ?? tone], index > 0 && "border-s border-card")}
              style={{ width: `${Math.max(0, Math.min(100, segment.value))}%` }}
            />
          ))
        : !empty ? (
            <i className={cn("block h-full rounded-full transition-[width] duration-500", FILL[tone])} style={{ width: `${Math.min(100, value ?? 0)}%` }} />
          ) : null}
    </span>
  );
}

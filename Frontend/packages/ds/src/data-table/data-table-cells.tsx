import type { ReactNode } from "react";
import { ChevronRight } from "../icons";
import { cn } from "../lib/utils";

/*
 * The standard cell vocabulary. Every cell is one line of `text-sm` or two lines (a `text-sm` value over
 * a `text-xs` muted detail), so any column sits in the same 56px row and tables read alike.
 */

/** An entity or a value with an optional detail line and leading visual (avatar, icon). */
export function DataTableCellStack({
  primary,
  secondary,
  leading,
  className,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  leading?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">
          {primary}
        </div>
        {secondary ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {secondary}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A quantity: tabular figures, with an optional muted detail line. */
export function DataTableCellNumber({
  value,
  secondary,
  className,
}: {
  value: ReactNode;
  secondary?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-sm font-medium tabular-nums text-foreground">
        {value}
      </div>
      {secondary ? (
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {secondary}
        </div>
      ) : null}
    </div>
  );
}

/** A 0–100 measure: a slim bar with its figure beside it, on one line. */
export function DataTableCellProgress({
  value,
  tone = "primary",
  className,
}: {
  value: number;
  tone?: "primary" | "success" | "info";
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <span className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            "block h-full rounded-full",
            tone === "success"
              ? "bg-success"
              : tone === "info"
                ? "bg-info"
                : "bg-primary"
          )}
          style={{ width: `${clamped}%` }}
        />
      </span>
      <span className="w-9 shrink-0 text-end text-sm font-medium tabular-nums text-foreground">
        {Math.round(clamped)}%
      </span>
    </div>
  );
}

/** No value: a faint dash, or a short muted note when the absence itself means something. */
export function DataTableCellEmpty({ children }: { children?: ReactNode }) {
  return children ? (
    <span className="text-sm text-muted-foreground">{children}</span>
  ) : (
    <span className="text-sm text-muted-foreground/50" aria-label="None">
      —
    </span>
  );
}

/** The trailing affordance on a clickable row; brightens as the row is hovered or focused. */
export function DataTableRowChevron() {
  return (
    <ChevronRight
      aria-hidden
      className="ms-auto size-4 text-muted-foreground/50 transition-colors group-hover/row:text-primary group-focus-visible/row:text-primary"
    />
  );
}

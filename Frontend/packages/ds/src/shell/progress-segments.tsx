import { cn } from "../lib/utils";

/**
 * "1 of 5 done" with one segment per step (D-09): the setup guide's progress, on Home and wherever a step finishes.
 * A segmented bar, never a stepper; the words come from the caller.
 */
export function ProgressSegments({ done, total, label, className }: { done: number; total: number; label: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="type-meta text-muted-foreground tabular-nums">{label}</span>
      <span className="inline-flex gap-1" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label}>
        {Array.from({ length: total }, (_, index) => (
          <i
            key={index}
            className={cn("h-1.5 w-7 rounded-full border", index < done ? "border-transparent bg-primary" : "border-border bg-inlay")}
          />
        ))}
      </span>
    </div>
  );
}

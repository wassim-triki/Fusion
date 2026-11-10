import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export interface FlowStep {
  /** The step's name: "You", "Peers", "Mariam", "Results". */
  label: ReactNode;
  /** Quiet beside it: a date, or who holds it. */
  detail?: ReactNode;
}

/**
 * The line of a flow's steps (D-67): where a person stands in a review round, a request, any flow they go through.
 * Done steps are filled a step short of the brand, the current one lit with its words, the rest quiet.
 */
export function FlowSteps({ steps, current, label, className }: { steps: FlowStep[]; current: number; label: string; className?: string }) {
  return (
    <ol aria-label={label} className={cn("grid auto-cols-fr grid-flow-col gap-[3px]", className)}>
      {steps.map((step, index) => {
        const done = index < current;
        const on = index === current;
        return (
          <li key={index} aria-current={on ? "step" : undefined} className={cn("grid gap-1.5 text-xs", on ? "font-semibold text-foreground" : "text-muted-foreground")}>
            <span className="truncate">
              {step.label}
              {step.detail ? <span className="ms-1 font-normal text-muted-foreground">{step.detail}</span> : null}
            </span>
            <i aria-hidden className={cn("block h-[5px] rounded-full", on ? "bg-primary" : done ? "bg-primary/45" : "bg-inlay")} />
          </li>
        );
      })}
    </ol>
  );
}

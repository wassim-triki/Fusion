import type { ReactNode } from "react";
import { cn } from "@repo/ds/lib/utils";

/**
 * A titled surface for a step's content. Each step owns one or more panels, so
 * a step can lay out a single field or two columns without the shell imposing a
 * card it does not want.
 */
export function StepPanel({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  /** Optional control sat at the top-right of the header (e.g. a help icon). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-surface bg-card p-6", className)}>
      <header className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="type-section-title text-foreground">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

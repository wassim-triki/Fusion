import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export interface SectionProps {
  /** The section's name, inside its frame. */
  title?: ReactNode;
  /** Quiet, at the end of the title line: a count, "Next two weeks", "This device". */
  meta?: ReactNode;
  /** At the end of the title line: "Give praise", "My plan". */
  action?: ReactNode;
  /** Rows run edge to edge under a hairline instead of sitting in a padded body. */
  flush?: boolean;
  /** Heading level of the title. */
  as?: "h2" | "h3";
  /** "card" titles a side card or a settings block a size smaller than a page's sections. */
  size?: "section" | "card";
  id?: string;
  "aria-label"?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * One section of a page: its title and actions sit inside the frame, never on the canvas above it (B-225). A padded
 * body by default; `flush` for lists whose rows run edge to edge. DS lists set inside a padded body (`SettingsRows`)
 * bleed to the edges on their own.
 */
export function Section({ title, meta, action, flush, as: Heading = "h2", size = "section", id, className, children, ...rest }: SectionProps) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section
      id={id}
      data-slot="section"
      aria-labelledby={title ? headingId : undefined}
      aria-label={title ? undefined : rest["aria-label"]}
      className={cn("overflow-hidden rounded-surface bg-card", className)}
    >
      {title || action ? (
        <div className={cn("flex min-h-14 items-center justify-between gap-3 px-5 pt-3", flush ? "border-b border-border pb-3" : "pb-2")}>
          {title ? (
            <Heading id={headingId} className={cn("min-w-0 text-foreground", size === "card" ? "type-subsection-title" : "type-section-title")}>
              {title}
            </Heading>
          ) : (
            <span />
          )}
          {action || (meta !== undefined && meta !== null) ? (
            <div className="flex shrink-0 items-center gap-3">
              {meta !== undefined && meta !== null ? <span className="type-meta text-muted-foreground">{meta}</span> : null}
              {action}
            </div>
          ) : null}
        </div>
      ) : null}
      <div data-slot="section-body" data-padded={flush ? undefined : true} className={cn(!flush && "px-5 pb-5", !flush && !(title || action) && "pt-5")}>
        {children}
      </div>
    </section>
  );
}

import type { ReactNode } from "react";
import { cn } from "../lib/utils";

/**
 * Something that can't be taken back, previewed where it happens (D-72): the page's own card redrawn with the brand
 * outline, an eyebrow saying it's a preview, what it reaches (faces, counts, that it's final) as rows, and Cancel
 * beside the confirming action. Long work then shows its live count in the same frame (`progress`).
 */
export function InPlacePreview({
  eyebrow,
  title,
  detail,
  actions,
  progress,
  children,
  className,
}: {
  /** "Preview", or "Releasing" while it runs. */
  eyebrow: ReactNode;
  title: ReactNode;
  /** Under the title: when instead of when, who asked. */
  detail?: ReactNode;
  /** Cancel and the confirming action, end of the header. */
  actions?: ReactNode;
  /** While it runs: the bar and the faces landing as each one is done. */
  progress?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-live="polite"
      className={cn("relative grid gap-4 rounded-surface bg-card p-6 ring-[1.5px] ring-inset ring-primary animate-in fade-in-0 slide-in-from-bottom-1 duration-300", className)}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-2">
          <span className="type-eyebrow text-primary-ink">{eyebrow}</span>
          <span className="type-section-title text-foreground">{title}</span>
          {detail ? <span className="type-meta text-muted-foreground">{detail}</span> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2.5">{actions}</div> : null}
      </div>
      {progress ?? children}
    </section>
  );
}

/** A row of the preview: what the action reaches, as a label, a count and who. */
export function PreviewRow({ label, count, children }: { label: ReactNode; count?: ReactNode; children?: ReactNode }) {
  return (
    <div className="grid grid-cols-[230px_64px_minmax(0,1fr)] items-center gap-4 border-t border-border py-2.5 first:border-t-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{count}</span>
      <span className="flex min-w-0 items-center gap-2">{children}</span>
    </div>
  );
}

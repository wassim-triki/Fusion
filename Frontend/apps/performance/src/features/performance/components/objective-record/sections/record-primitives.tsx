import type { ReactNode } from "react";

/** A labelled section: an eyebrow over its content, the record's repeating rhythm. */
export function RecordSection({ label, action, children }: { label: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <p className="type-meta text-muted-foreground">{label}</p>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** The plain content surface sections place their body on. */
export const RECORD_SURFACE = "rounded-surface bg-popover p-4 dark:bg-card";

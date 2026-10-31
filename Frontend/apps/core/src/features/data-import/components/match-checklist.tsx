"use client";

import { useTranslations } from "next-intl";
import { ChartNoAxesColumn, Check, TriangleAlert } from "lucide-react";
import { cn } from "@repo/ds";

export type MatchChecklistLine = { label: string; value: string; done: boolean };

/** Where interpretation stands, one line per thing Match resolves. */
export function ImportMatchChecklist({ lines }: { lines: MatchChecklistLine[] }) {
  const t = useTranslations("dataImport");
  return (
    <section aria-labelledby="match-status-title" className="rounded-surface bg-card p-4">
      <header className="flex items-center gap-3">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <ChartNoAxesColumn className="size-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <h2 id="match-status-title" className="type-panel-title font-semibold text-foreground">
            {t("checklist.title")}
          </h2>
          <p className="type-meta text-muted-foreground">{t("checklist.description")}</p>
        </div>
      </header>
      <ul className="mt-4 divide-y divide-border overflow-hidden rounded-control border border-border">
        {lines.map((line) => (
          <li key={line.label} className="flex items-center gap-3 px-3 py-2">
            <StatusMark done={line.done} />
            <span className="type-meta min-w-0 flex-1 text-foreground">{line.label}</span>
            <span
              className={cn(
                "type-meta shrink-0 text-end tabular-nums",
                line.done ? "text-muted-foreground" : "font-medium text-primary-foreground dark:text-primary"
              )}
            >
              {line.value}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusMark({ done }: { done: boolean }) {
  const t = useTranslations("dataImport");
  return done ? (
    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-success text-white">
      <Check aria-hidden className="size-3" strokeWidth={3} />
      <span className="sr-only">{t("checklist.done")}</span>
    </span>
  ) : (
    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
      <TriangleAlert aria-hidden className="size-3" strokeWidth={2.5} />
      <span className="sr-only">{t("checklist.attention")}</span>
    </span>
  );
}

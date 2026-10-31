"use client";

import { useTranslations } from "next-intl";
import { BookOpen, Check, CircleHelp, Download } from "lucide-react";
import { Button, cn } from "@repo/ds";

/** The path from here to a published import, with the template as the way out of a hard file. */
export function ImportMatchNextSteps({
  remaining,
  onDownloadTemplate,
}: {
  remaining: number;
  onDownloadTemplate: () => void;
}) {
  const t = useTranslations("dataImport");
  const steps = [
    remaining
      ? { title: t("nextSteps.resolve", { count: remaining }), done: false }
      : { title: t("nextSteps.complete"), done: true },
    { title: t("nextSteps.continue"), done: false },
    { title: t("nextSteps.publish"), done: false },
  ];

  return (
    <section
      aria-labelledby="match-next-title"
      className="grid gap-5 rounded-surface bg-card p-4 sm:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div className="min-w-0">
        <header className="flex items-center gap-3">
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
            <BookOpen className="size-5" strokeWidth={1.75} />
          </span>
          <h2 id="match-next-title" className="type-panel-title font-semibold text-foreground">
            {t("nextSteps.title")}
          </h2>
        </header>
        <ol className="mt-4 space-y-2.5">
          {steps.map((step, index) => (
            <li key={step.title} className="flex items-center gap-3">
              <span
                aria-hidden
                className={cn(
                  "type-meta grid size-6 shrink-0 place-items-center rounded-full font-semibold tabular-nums",
                  step.done ? "bg-success text-white" : "bg-muted text-foreground"
                )}
              >
                {step.done ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
              </span>
              <p className="min-w-0 type-meta font-medium text-foreground">{step.title}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-5 sm:w-44 sm:border-t-0 sm:border-s sm:pt-0 sm:ps-5">
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
            <CircleHelp className="size-4.5" strokeWidth={1.75} />
          </span>
          <h3 className="type-label font-semibold text-foreground">{t("nextSteps.help")}</h3>
        </div>
        <p className="type-meta text-muted-foreground">{t("nextSteps.helpDescription")}</p>
        <Button
          variant="outline"
          size="sm"
          className="self-start border-primary/60 text-primary-foreground hover:bg-primary/10 dark:text-primary"
          onClick={onDownloadTemplate}
        >
          <Download aria-hidden />
          {t("nextSteps.download")}
        </Button>
      </div>
    </section>
  );
}

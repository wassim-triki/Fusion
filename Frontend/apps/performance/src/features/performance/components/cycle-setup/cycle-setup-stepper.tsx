"use client";

import Link from "next/link";
import { Check } from "@repo/ds/icons";
import { cn } from "@repo/ds/lib/utils";
import { SETUP_STEPS, setupStepHref, type SetupStep } from "./setup-readiness";
import { useTranslations } from "next-intl";

interface StepView {
  complete: boolean;
  accessible: boolean;
}

/**
 * The setup spine: numbered nodes with a title and caption, a connector that fills amber as steps
 * complete, and a glow on the step you're on. Completed / reachable steps navigate; a step whose
 * prerequisites don't exist yet stays quiet. Completion comes from domain truth, never local flags.
 */
export function CycleSetupStepper({
  current,
  state,
  cycleId,
}: {
  current: SetupStep;
  state: Record<SetupStep, StepView>;
  cycleId: string | null;
}) {
  const t = useTranslations("cycleSetup.steps");
  return (
    <ol className="mx-auto flex max-w-5xl items-start">
      {SETUP_STEPS.map((step, index) => {
        const view = state[step.key];
        const isCurrent = step.key === current;
        const isLast = index === SETUP_STEPS.length - 1;
        const navigable = view.accessible && !isCurrent;

        const node = (
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full border type-subsection-title tabular-nums transition-all",
              view.complete
                ? "border-transparent bg-primary text-primary-foreground"
                : isCurrent
                  ? "border-transparent bg-primary text-primary-foreground ring-4 ring-primary/20"
                  : "border-border bg-card text-muted-foreground",
            )}
          >
            {view.complete ? <Check className="size-4" aria-hidden /> : index + 1}
          </span>
        );

        return (
          <li key={step.key} className="relative flex flex-1 flex-col items-center text-center">
            <div className="relative z-10 flex items-center">
              {navigable ? (
                <Link
                  href={setupStepHref(step.key, cycleId)}
                  aria-label={t(`${step.key}.label`)}
                  className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {node}
                </Link>
              ) : (
                node
              )}
            </div>
            {!isLast ? (
              // Connector: from just past this node's centre to just before the next one's.
              <span
                className={cn(
                  "absolute top-[17px] inset-s-[calc(50%+30px)] inset-e-[calc(-50%+30px)] h-0.5 rounded-full transition-colors",
                  view.complete ? "bg-primary" : "bg-border",
                )}
                aria-hidden
              />
            ) : null}
            <div className="mt-3" aria-current={isCurrent ? "step" : undefined}>
              <div
                className={cn(
                  "type-label",
                  isCurrent || view.complete ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {t(`${step.key}.label`)}
              </div>
              <div className="type-meta mt-0.5 text-muted-foreground">{t(`${step.key}.caption`)}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

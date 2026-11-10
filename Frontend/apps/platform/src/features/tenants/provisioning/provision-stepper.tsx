"use client";

import { useTranslations } from "next-intl";
import { Check } from "@repo/ds/icons";
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@/components/reui/stepper";

/**
 * The four decisions provisioning is broken into, in the order they are made.
 * The identifiers are stable so navigation, validation, and analytics can refer
 * to a step by name rather than by position; each is labelled by its
 * `provisioning.steps.<id>` line.
 */
export const PROVISIONING_STEPS = [
  { id: "organization" },
  { id: "region-products" },
  { id: "initial-admin" },
  { id: "review" },
] as const;

export type ProvisioningStepId = (typeof PROVISIONING_STEPS)[number]["id"];

/**
 * Progress across the provisioning wizard.
 *
 * A map, not a control: it reports where the operator is and how far is left.
 * The value is driven from outside (`currentStep`), so the steps read out their
 * state rather than changing it on click; navigation is layered on once the
 * wizard owns that behavior.
 */
export function ProvisioningStepper({
  currentStep,
  onStepChange,
  className,
}: {
  /** Zero-based index of the step being worked on. */
  currentStep: number;
  /** Jump to a step (zero-based); every step is directly reachable. */
  onStepChange?: (step: number) => void;
  className?: string;
}) {
  const t = useTranslations("provisioning.steps");
  return (
    <Stepper
      // reui counts steps from 1; the workspace speaks in 0-based indexes.
      value={currentStep + 1}
      onValueChange={(value) => onStepChange?.(value - 1)}
      indicators={{ completed: <Check className="size-3.5" /> }}
      className={className}
    >
      <StepperNav aria-label={t("progress")} className="justify-center">
        {PROVISIONING_STEPS.map((step, index) => (
          <StepperItem key={step.id} step={index + 1} className="relative !flex-none">
            <StepperTrigger className="gap-2.5">
              <StepperIndicator className="size-7 border tabular-nums data-[state=inactive]:border-border data-[state=inactive]:bg-transparent data-[state=inactive]:text-muted-foreground data-[state=active]:border-primary data-[state=completed]:border-primary">
                {index + 1}
              </StepperIndicator>
              {/* Only the active label survives on narrow screens, so the row
                  never overflows; the numbers still carry the sequence. */}
              <StepperTitle className="hidden whitespace-nowrap data-[state=active]:inline data-[state=active]:text-primary-ink data-[state=inactive]:text-muted-foreground md:inline">
                {t(step.id)}
              </StepperTitle>
            </StepperTrigger>

            {/* A fixed-width connector, so the gap between steps stays equal
                no matter how long each step's label is. */}
            {index < PROVISIONING_STEPS.length - 1 ? (
              <StepperSeparator className="mx-3 !w-12 !flex-none bg-border group-data-[state=completed]/step:bg-primary md:mx-4 md:!w-20" />
            ) : null}
          </StepperItem>
        ))}
      </StepperNav>
    </Stepper>
  );
}

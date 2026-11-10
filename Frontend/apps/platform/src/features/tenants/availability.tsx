"use client";

import type { IconComponent } from "@repo/ds/icons";
import { Button } from "@repo/ds/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@repo/ds/components/ui/tooltip";
import { cn } from "@repo/ds/lib/utils";
import { useTenantWords } from "./language";

/**
 * How this feature says what it does not know or cannot do yet.
 *
 * Two silences that must never blur into one: a capability the product has not
 * built is a different fact from a number whose owner is not wired up, and both
 * differ again from a real zero. Substituting a plausible value for either
 * would make the record untrustworthy exactly where an operator most needs to
 * trust it.
 *
 * Shared by the tenant record and the directory so the two cannot drift into
 * describing the same absence differently. The two sentences are
 * `TenantWords.notAvailable` and `TenantWords.notConnected`.
 */

/**
 * An action whose place in the workflow is settled but whose behaviour is not
 * built. It stays visible so the surface reads as complete, and stays focusable
 * so the reason is reachable without a pointer.
 *
 * `aria-disabled` rather than `disabled`: a truly disabled control is skipped by
 * the keyboard, which would leave the explanation to pointer users only. And
 * the reason lives in the accessible name rather than in the tooltip alone —
 * a tooltip is exposed only while open, so on its own it leaves the control
 * sounding perfectly ordinary.
 */
export function UnavailableAction({
  label,
  icon: Icon,
  explanation,
  variant = "outline",
  size = "sm",
}: {
  label: string;
  icon?: IconComponent;
  explanation?: string;
  variant?: "outline" | "ghost";
  size?: "sm" | "default";
}) {
  const words = useTenantWords();
  const reason = explanation ?? words.notAvailable;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={variant}
            size={size}
            aria-disabled="true"
            // The explanation goes in the label rather than in an extra
            // visually-hidden node: `sr-only` is absolutely positioned, and
            // without a positioned ancestor its containing block is the page
            // itself, so a scroll container cannot clip it and it stretches the
            // document past the viewport.
            aria-label={`${label} — ${reason}`}
            onClick={(event) => event.preventDefault()}
            className={cn(
              "shrink-0 cursor-default bg-transparent text-muted-foreground hover:bg-transparent hover:text-muted-foreground",
              variant === "outline" && "border-dashed"
            )}
          >
            {Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
            {label}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * One way of saying "this belongs here and does not work yet".
 *
 * It names what will occupy the place instead of repeating the same sentence
 * once per line. Six rows of identical unavailable text says nothing six times;
 * one statement plus the list of what is coming says it once and stays
 * readable.
 */
export function CapabilityList({
  items,
  state,
}: {
  items: readonly string[];
  /** Defaults to "not available in this build". */
  state?: string;
}) {
  const words = useTenantWords();
  return (
    <>
      {/* The panel's headline fact, so it carries weight rather than receding
          into the same grey as the labels around it. */}
      <p className="text-sm font-medium text-foreground/80">{state ?? words.notAvailable}</p>
      <ul className="mt-2 flex flex-wrap gap-x-2 gap-y-1.5">
        {items.map((item) => (
          <li
            key={item}
            className="rounded-control border border-border/70 bg-inlay px-2 py-0.5 text-xs text-foreground"
          >
            {item}
          </li>
        ))}
      </ul>
    </>
  );
}

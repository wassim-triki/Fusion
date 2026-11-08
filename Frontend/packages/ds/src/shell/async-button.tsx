"use client";

import type { ComponentProps, ReactNode } from "react";
import { Button } from "../components/ui/button";
import { Spinner } from "../components/ui/spinner";
import { cn } from "../lib/utils";

/**
 * Fusion's convention for a control that starts an ordinary asynchronous action.
 *
 * While the request is in flight the control shows one centred progress
 * indicator and nothing else, at unchanged size and position. Only this control
 * is disabled; the surface around it does not move, and there is no page-level
 * overlay.
 *
 * Two details are easy to get wrong on their own, which is why they live here:
 *
 * - the label keeps its space while hidden. Removing it outright collapses the
 *   button to the spinner's width, so a row of actions reflows around it;
 * - the label is not replaced by progressive wording. `Saving…` beside a
 *   spinner says the same thing twice, and a label that changes length moves
 *   everything after it.
 *
 * The accessible name survives the swap through `aria-label`, and `aria-busy`
 * reports the state, so the control does not go quiet while it works.
 *
 * Its action changes something, so while changes are locked it stays greyed with the reason (`writes`, B-220);
 * pass `writes={false}` for one that only reads.
 */
export function AsyncButton({
  pending,
  children,
  /**
   * The accessible name to keep while the label is hidden. Needed only when the
   * label is not a plain string — otherwise it is read from the children.
   */
  pendingLabel,
  className,
  disabled,
  writes = true,
  ...props
}: ComponentProps<typeof Button> & {
  pending: boolean;
  children: ReactNode;
  pendingLabel?: string;
}) {
  const label =
    pendingLabel ?? (typeof children === "string" ? children : undefined);

  return (
    <Button
      {...props}
      writes={writes}
      disabled={disabled || pending}
      aria-busy={pending}
      aria-label={pending ? label : props["aria-label"]}
      className={cn("relative", className)}
    >
      {/* Held in layout rather than removed, so the width does not change. */}
      <span
        aria-hidden={pending}
        className={cn(
          "inline-flex items-center gap-[inherit]",
          pending && "invisible"
        )}
      >
        {children}
      </span>

      {pending ? (
        <span className="absolute inset-0 flex items-center justify-center">
          {/* Hidden from assistive tech: the button already reports itself busy,
              and the spinner's own status role would announce it twice. */}
          <Spinner aria-hidden="true" className="size-4" />
        </span>
      ) : null}
    </Button>
  );
}

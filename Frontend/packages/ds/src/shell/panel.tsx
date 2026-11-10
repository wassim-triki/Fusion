"use client";

import type { ComponentProps, ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "../icons";
import { cn } from "../lib/utils";
import { Button } from "../components/ui/button";

/**
 * The panel (D-61): a record's quick look opens over the page it was opened from, floating a step in from the edge
 * with a scrim behind it; Escape and the scrim close it. One shell for every record: a goal, a change, a person.
 * `PanelHeader` holds the title line, `PanelBody` scrolls, `PanelFooter` holds the actions.
 */
export function Panel({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </DialogPrimitive.Root>
  );
}

export function PanelContent({
  className,
  children,
  width = "md",
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { width?: "md" | "lg" }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
      <DialogPrimitive.Content
        data-slot="panel"
        className={cn(
          "fixed inset-y-2.5 inset-e-2.5 z-50 flex w-[calc(100%-1.25rem)] flex-col overflow-hidden rounded-surface bg-popover text-popover-foreground shadow-overlay ring-1 ring-foreground/10 outline-none duration-300 data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-right-6 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-right-6 rtl:data-open:slide-in-from-left-6 rtl:data-closed:slide-out-to-left-6",
          width === "lg" ? "sm:w-[620px]" : "sm:w-[580px]",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close asChild>
          <Button variant="ghost" size="icon-sm" className="absolute top-3.5 inset-e-3.5 text-muted-foreground">
            <X />
            <span className="sr-only">Close</span>
          </Button>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function PanelHeader({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex items-center gap-3 px-6 pt-5 pb-2 pe-14", className)}>{children}</div>;
}

export function PanelTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("type-page-title text-foreground", className)} {...props} />;
}

export function PanelDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("type-meta text-muted-foreground", className)} {...props} />;
}

export function PanelBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("grid flex-1 content-start gap-4 overflow-y-auto overscroll-contain px-6 pt-2 pb-6", className)}>{children}</div>;
}

export function PanelFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex items-center justify-end gap-2.5 border-t border-border px-5 py-3.5", className)}>{children}</div>;
}

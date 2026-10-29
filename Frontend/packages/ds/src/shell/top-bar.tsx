import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export interface TopBarProps {
  /** Left side — typically the module breadcrumb. Stays at the left, unchanged. */
  left?: ReactNode;
  /** The page's own controls on the right, such as notifications (optional). */
  children?: ReactNode;
  className?: string;
}

/**
 * Shared shell, Core and Performance top bar: breadcrumb (left) and the page's own controls (right): the bell, then
 * language and theme. Sits inside the AppShell sticky header slot.
 */
export function TopBar({ left, children, className }: TopBarProps) {
  return (
    <div className={cn("flex h-12 items-center justify-between gap-3 px-6", className)}>
      <div className="flex min-w-0 items-center">{left}</div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

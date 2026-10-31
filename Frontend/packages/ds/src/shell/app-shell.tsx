import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export interface AppShellProps {
  /** The module sidebar (typically <ModuleSidebar .../>). */
  sidebar: ReactNode;
  /** Optional sticky top bar (breadcrumb + page-level controls). */
  header?: ReactNode;
  /** Optional banner shown above content (e.g. tenant-context notice). */
  banner?: ReactNode;
  /** A bar across the top of the content column, above the header (seeing Fusion as someone). */
  notice?: ReactNode;
  children: ReactNode;
  /** Override the main scroll-area background. Defaults to the off-white app surface. */
  contentClassName?: string;
}

/**
 * Shared Core + Performance application frame: dark sidebar + off-white content surface,
 * with optional sticky header and banner slots. White cards/surfaces sit on the off-white base.
 */
export function AppShell({ sidebar, header, banner, notice, children, contentClassName }: AppShellProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {sidebar}
      <div className="flex min-w-0 flex-1 flex-col">
        {notice}
        {header ? (
          // eslint-disable-next-line no-restricted-syntax -- the sticky header blurs what scrolls under it, so it is translucent at rest
          <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            {header}
          </header>
        ) : null}
        {banner}
        {/* `relative` makes this the containing block for its own descendants.
            Without it an absolutely-positioned child — including anything using
            Tailwind's `sr-only` — resolves against the page instead, escapes
            this scroll container, and stretches the document so the whole shell
            scrolls. */}
        <main className={cn("relative flex-1 overflow-y-auto", contentClassName)}>
          {children}
        </main>
      </div>
    </div>
  );
}

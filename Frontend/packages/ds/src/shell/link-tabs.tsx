"use client";

import Link from "next/link";
import { cn } from "../lib/utils";

export interface LinkTab {
  key: string;
  label: string;
  href: string;
  /** How many the tab holds, said after its label (People's views). */
  count?: number;
}

export interface LinkTabsProps {
  /** Names the strip for assistive tech ("Aicha Bouazizi's page"). */
  label: string;
  tabs: LinkTab[];
  current: string;
  className?: string;
}

/**
 * Fusion's one tab strip (B-198): each tab is an address, so a tab can be linked to and the back button works. The
 * active tab takes the company's color as an outline with a subtle fill, as selected filters do; the rest stay quiet.
 */
export function LinkTabs({ label, tabs, current, className }: LinkTabsProps) {
  return (
    <nav aria-label={label} className={cn("flex gap-1 overflow-x-auto", className)}>
      {tabs.map((tab) => {
        const active = tab.key === current;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-9 shrink-0 items-center rounded-full border px-3.5 type-label whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-primary/45 bg-primary-tint text-primary-ink"
                : "border-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            )}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className={cn("ms-1.5 tabular-nums", active ? "text-primary-ink" : "text-muted-foreground/80")}>{tab.count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

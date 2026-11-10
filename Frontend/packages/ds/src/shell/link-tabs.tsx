"use client";

import Link from "next/link";
import type { IconComponent } from "../icons";
import { cn } from "../lib/utils";

export interface LinkTab {
  key: string;
  label: string;
  href: string;
  /** The tab's glyph, before its label (D-78). */
  icon?: IconComponent;
  /** How many the tab holds, said after its label (People's views). */
  count?: number;
  /** In another module (another app): a full navigation instead of a client-side one. */
  external?: boolean;
}

export interface LinkTabsProps {
  /** Names the strip for assistive tech ("Aicha Bouazizi's page"). */
  label: string;
  tabs: LinkTab[];
  current: string;
  className?: string;
}

/**
 * Fusion's one tab strip (B-198): each tab is an address, so a tab can be linked to and the back button works. Tabs
 * carry an icon (D-78); the active one lifts to a card with its glyph in the brand, the rest stay quiet.
 */
export function LinkTabs({ label, tabs, current, className }: LinkTabsProps) {
  return (
    <nav aria-label={label} className={cn("flex gap-1 overflow-x-auto", className)}>
      {tabs.map((tab) => {
        const active = tab.key === current;
        const Anchor = tab.external ? "a" : Link;
        const Icon = tab.icon;
        return (
          <Anchor
            key={tab.key}
            href={tab.href}
            {...(tab.external ? {} : { scroll: false })}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 type-label whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-border bg-card font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            )}
          >
            {Icon ? <Icon aria-hidden className={cn("size-4", active ? "text-primary-ink" : "text-muted-foreground")} /> : null}
            {tab.label}
            {tab.count !== undefined ? (
              <span className={cn("ms-0.5 tabular-nums", active ? "text-muted-foreground" : "text-muted-foreground/80")}>{tab.count}</span>
            ) : null}
          </Anchor>
        );
      })}
    </nav>
  );
}

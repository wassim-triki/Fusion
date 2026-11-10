"use client";

import type { ComponentType } from "react";
import { ChevronsUpDown, LogOut } from "../icons";
import { useTranslations } from "next-intl";
import { cn } from "../lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Skeleton } from "../components/ui/skeleton";

export interface ShellUserPanelLink {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
}

export interface ShellUserPanelProps {
  /** Display name; falls back to a generic label when signed out. */
  name?: string | null;
  /** Secondary line (role / access profile). */
  secondaryLabel?: string | null;
  collapsed?: boolean;
  links?: ShellUserPanelLink[];
  onSignOut?: () => void;
  signInHref?: string;
  /**
   * Auth state not yet known: renders an avatar + text skeleton instead of the
   * signed-out "Sign in" fallback, so authenticated cold boots never flash it.
   */
  pending?: boolean;
}

/**
 * Dark-surface user panel for the shared shell sidebar. Auth-agnostic: the consuming app passes
 * plain props derived from its own `useAuth()`, keeping `@repo/ds` free of an auth dependency.
 */
export function ShellUserPanel({
  name,
  secondaryLabel,
  collapsed = false,
  links = [],
  onSignOut,
  signInHref = "/auth/signin",
  pending = false,
}: ShellUserPanelProps) {
  const t = useTranslations("ds.sidebar");
  if (pending) {
    return (
      <div
        className={cn("flex items-center gap-2.5 p-1.5", collapsed && "justify-center")}
        aria-busy
        aria-label={t("loadingAccount")}
      >
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
        {!collapsed ? (
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        ) : null}
      </div>
    );
  }

  if (!name) {
    return (
      <a
        href={signInHref}
        className={cn(
          "flex items-center gap-2 rounded-control px-2 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
          collapsed && "justify-center"
        )}
      >
        <LogOut className="h-4 w-4 rotate-180" />
        {!collapsed ? <span>{t("signIn")}</span> : null}
      </a>
    );
  }

  const initial = name.charAt(0).toUpperCase() || "U";
  const avatar = (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">
      {initial}
    </span>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-2.5 rounded-control p-1.5 text-start outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          collapsed && "justify-center"
        )}
      >
        {avatar}
        {!collapsed ? (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{name}</span>
              {secondaryLabel ? (
                <span className="truncate text-xs text-sidebar-foreground/55">{secondaryLabel}</span>
              ) : null}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-sidebar-foreground/50" />
          </>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-56">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <DropdownMenuItem key={link.href} asChild>
              <a href={link.href} className="flex items-center gap-2.5">
                <Icon className="h-4 w-4" />
                {link.label}
              </a>
            </DropdownMenuItem>
          );
        })}
        {links.length > 0 && onSignOut ? <DropdownMenuSeparator /> : null}
        {onSignOut ? (
          <DropdownMenuItem onSelect={onSignOut} className="flex items-center gap-2.5">
            <LogOut className="h-4 w-4" />
            {t("signOut")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

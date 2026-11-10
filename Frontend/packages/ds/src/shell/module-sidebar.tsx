"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Lock,
} from "lucide-react";
import { cn } from "../lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Skeleton } from "../components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip";
import type { ModuleSidebarProps, ShellNavItem } from "./types";

function isItemActive(activePath: string, item: ShellNavItem): boolean {
  const target = item.href;
  if (item.exact || target === "/") {
    return activePath === target;
  }
  return activePath === target || activePath.startsWith(`${target}/`);
}

/**
 * Core + Performance shared sidebar. Dark surface over the shared preset tokens, answering:
 * which tenant, which module, what context, and what work area. Lives in `@repo/ds/shell` so the
 * two user-owned modules share one shell without touching the cross-org `@repo/ui` AppSidebar.
 */
export function ModuleSidebar({
  brandTitle,
  brandSubtitle,
  brandIcon: BrandIcon,
  activePath,
  sections,
  modules,
  currentModuleKey,
  tenantSwitcher,
  contextLabel,
  userPanel,
  collapsible = true,
  pending = false,
}: ModuleSidebarProps) {
  const t = useTranslations("ds.sidebar");
  const [collapsed, setCollapsed] = useState(false);
  const switchable = (modules?.length ?? 0) > 1;
  const currentModule = modules?.find((m) => m.key === currentModuleKey);

  useEffect(() => {
    // At tablet widths a full navigation column turns a record into a narrow
    // reading pane. The rail still preserves every destination and its labels
    // remain available through the explicit expand control.
    const query = window.matchMedia("(max-width: 1023px)");
    if (query.matches) setCollapsed(true);

    const handleChange = (event: MediaQueryListEvent) => {
      if (event.matches) setCollapsed(true);
    };

    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <aside
        data-collapsed={collapsed}
        className={cn(
          "relative flex h-screen shrink-0 flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
          collapsed ? "w-[68px]" : "w-[264px]"
        )}
      >
        {/* Brand + module switcher */}
        <div className="flex flex-col gap-3 px-3 pt-4 pb-3">
          {switchable && currentModule ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "flex items-center gap-2.5 rounded-control p-1.5 text-start outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  collapsed && "justify-center"
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-sidebar-primary text-sidebar-primary-foreground">
                  <BrandIcon className="h-5 w-5" />
                </span>
                {!collapsed ? (
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold leading-tight">
                      {brandTitle}
                    </span>
                    {brandSubtitle ? (
                      <span className="truncate text-xs text-sidebar-foreground/60">
                        {brandSubtitle}
                      </span>
                    ) : null}
                  </span>
                ) : null}
                {!collapsed ? (
                  <ChevronsUpDown className="h-4 w-4 shrink-0 text-sidebar-foreground/50" />
                ) : null}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60">
                <DropdownMenuLabel>{t("switchModule")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {modules!.map((m) => {
                  const Icon = m.icon;
                  const active = m.key === currentModuleKey;
                  return (
                    <DropdownMenuItem key={m.key} asChild>
                      <a href={m.href} className="flex items-center gap-2.5">
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-medium">
                            {m.label}
                          </span>
                          {m.description ? (
                            <span className="truncate text-xs text-muted-foreground">
                              {m.description}
                            </span>
                          ) : null}
                        </span>
                        {active ? (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        ) : null}
                      </a>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div
              className={cn(
                "flex items-center gap-2.5 p-1.5",
                collapsed && "justify-center"
              )}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-sidebar-primary text-sidebar-primary-foreground">
                <BrandIcon className="h-5 w-5" />
              </span>
              {!collapsed ? (
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold leading-tight">
                    {brandTitle}
                  </span>
                  {brandSubtitle ? (
                    <span className="truncate text-xs text-sidebar-foreground/60">
                      {brandSubtitle}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>
          )}

          {!collapsed && tenantSwitcher ? <div>{tenantSwitcher}</div> : null}
          {!collapsed && contextLabel ? (
            <p className="px-1.5 text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/50">
              {contextLabel}
            </p>
          ) : null}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 pb-3">
          {pending ? (
            // Nav content unknown (auth hydrating): skeleton rows matching real
            // item geometry so resolution swaps in place without layout shift.
            <div aria-busy aria-label={t("loadingNavigation")}>
              {Array.from({ length: 2 }).map((_, gi) => (
                <div key={gi} className="mb-4">
                  {!collapsed ? (
                    <Skeleton className="mx-2 mb-2.5 h-2.5 w-16" />
                  ) : null}
                  <div className="flex flex-col gap-0.5">
                    {Array.from({ length: 4 }).map((__, i) => (
                      <div
                        key={i}
                        className={cn(
                          "flex items-center gap-3 px-2.5 py-2",
                          collapsed && "justify-center"
                        )}
                      >
                        <Skeleton className="h-4 w-4 shrink-0 rounded-detail" />
                        {!collapsed ? <Skeleton className="h-4 flex-1" /> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
          sections.map((section, si) => (
            <div key={`${section.title ?? "section"}-${si}`} className="mb-4">
              {!collapsed && section.title ? (
                <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/45">
                  {section.title}
                </p>
              ) : null}
              <ul className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                  const active = isItemActive(activePath, item);
                  const Icon = item.icon;
                  const content = (
                    <span
                      className={cn(
                        "group relative flex items-center gap-3 rounded-control px-2.5 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                        item.disabled &&
                          "cursor-not-allowed opacity-40 hover:bg-transparent",
                        collapsed && "justify-center"
                      )}
                    >
                      {active ? (
                        <span className="absolute inset-s-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-e-full bg-sidebar-primary" />
                      ) : null}
                      <Icon className="h-4 w-4 shrink-0" />
                      {!collapsed ? (
                        <span className="flex-1 truncate">{item.label}</span>
                      ) : null}
                      {!collapsed && item.disabled ? (
                        <Lock className="h-3.5 w-3.5 shrink-0 opacity-70" />
                      ) : null}
                      {!collapsed && item.badge != null && !item.disabled ? (
                        <span className="ms-auto rounded-full bg-sidebar-primary/15 px-1.5 py-0.5 text-[11px] font-semibold text-sidebar-primary">
                          {item.badge}
                        </span>
                      ) : null}
                    </span>
                  );

                  // Module-relative href; Next.js auto-prepends the app basePath.
                  const target = item.navigateHref ?? item.href;
                  const node = item.disabled ? (
                    <div
                      aria-disabled
                      aria-label={collapsed ? item.label : undefined}
                    >
                      {content}
                    </div>
                  ) : item.pending ? (
                    // Access state resolving: looks enabled, navigates nowhere.
                    // Resolves to a Link (no visual change) or gains a lock icon.
                    <div
                      aria-disabled
                      aria-label={collapsed ? item.label : undefined}
                      className="cursor-default"
                    >
                      {content}
                    </div>
                  ) : item.shellRoute ? (
                    // Leaves this app's basePath, so it is a document load by
                    // nature; Link would rewrite it into a module-relative path.
                    <a href={target} aria-label={collapsed ? item.label : undefined}>
                      {content}
                    </a>
                  ) : (
                    <Link
                      href={target}
                      aria-label={collapsed ? item.label : undefined}
                    >
                      {content}
                    </Link>
                  );

                  if (collapsed || (item.disabled && item.disabledReason)) {
                    return (
                      <li key={item.href}>
                        <Tooltip>
                          <TooltipTrigger asChild>{node}</TooltipTrigger>
                          <TooltipContent side="right">
                            {item.disabled && item.disabledReason
                              ? item.disabledReason
                              : item.label}
                          </TooltipContent>
                        </Tooltip>
                      </li>
                    );
                  }
                  return <li key={item.href}>{node}</li>;
                })}
              </ul>
            </div>
          ))
          )}
        </nav>

        {/* Footer: user panel */}
        {userPanel ? (
          <div className="border-t border-sidebar-border p-3">
            {userPanel(collapsed)}
          </div>
        ) : null}

        {/* Collapse toggle */}
        {collapsible ? (
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? t("expand") : t("collapse")}
            className="absolute -inset-e-5 top-7 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-sidebar-foreground/70 shadow-raised transition-colors hover:text-sidebar-foreground md:-inset-e-3 md:top-9 md:h-6 md:w-6"
          >
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronLeft className="h-3.5 w-3.5" />
            )}
          </button>
        ) : null}
      </aside>
    </TooltipProvider>
  );
}

"use client";

import type { CSSProperties } from "react";
import { useState, useRef, useEffect, useId } from "react";
import Link from "next/link";
import { visibleFusionModules } from "@repo/api";
import { useFusionViewer } from "@repo/api/react";
import * as Popover from "@radix-ui/react-popover";
import {
  LayoutGrid,
  ChevronsUpDown,
  Search,
  Check,
  BrainCircuit,
  BookOpen,
  BarChart2,
  Users,
  Video,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { SidebarModule } from "./types";

/** Sibling Fusion apps (not served under this Next module’s basePath) — use full-page `<a>`. */
const EXTERNAL_MODULE_PREFIXES = [
  "/core",
  "/learning",
  "/performance",
  "/recruitment",
  "/onboarding",
  "/interview",
] as const;

function isExternalModuleHref(href: string) {
  if (href.startsWith("http://") || href.startsWith("https://")) return true;
  return EXTERNAL_MODULE_PREFIXES.some(
    (p) => href === p || href.startsWith(`${p}/`)
  );
}

const DEFAULT_MODULES: SidebarModule[] = [
  { label: "Core", href: "/core", icon: BrainCircuit },
  { label: "Learning", href: "/learning", icon: BookOpen },
  { label: "Performance", href: "/performance", icon: BarChart2 },
  { label: "Recruitment", href: "/recruitment", icon: Users },
  { label: "Interview", href: "/interview", icon: Video },
];

interface ModuleSwitcherProps {
  activeModule: string;
  modules?: SidebarModule[];
  collapsed?: boolean;
  /** Stitch executive-console styling (stone + EY yellow accents) */
  variant?: "default" | "stitch";
  /** Optional local theme override for the trigger surface. */
  triggerStyle?: CSSProperties;
  /** Optional local theme override for the portal content surface. */
  contentStyle?: CSSProperties;
}

export function ModuleSwitcher({
  activeModule,
  modules: givenModules,
  collapsed = false,
  variant = "default",
  triggerStyle,
  contentStyle,
}: ModuleSwitcherProps) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const _popoverId = useId();
  const { viewer } = useFusionViewer();
  // The same rule as the shell's switcher: only what this person's company has.
  const offered = new Set(visibleFusionModules(viewer).map((entry) => entry.href));
  const modules = givenModules ?? DEFAULT_MODULES.filter((module) => offered.has(module.href));

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (open) {
      const id = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(id);
    }
    setSearch("");
  }, [open]);

  const filtered = modules.filter((m) =>
    m.label.toLowerCase().includes(search.toLowerCase())
  );

  const ActiveIcon =
    modules.find((m) => m.label === activeModule)?.icon ?? LayoutGrid;

  const stitchTrigger = cn(
    "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors duration-200",
    "border-stone-300 bg-white text-stone-900 shadow-sm",
    "hover:bg-stone-50 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-800/80",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(48_95%_48%)] focus-visible:ring-offset-2 focus-visible:ring-offset-stone-100 dark:focus-visible:ring-offset-stone-900",
    open &&
      "border-stone-400 bg-stone-50 dark:border-stone-500 dark:bg-stone-800"
  );
  const defaultTrigger = cn(
    "flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2",
    "text-sm font-medium text-foreground bg-sidebar",
    "hover:bg-accent transition-colors duration-200",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    open && "bg-accent border-muted-foreground/30"
  );

  if (collapsed) {
    return (
      <div className="flex justify-center px-2 py-1">
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg",
            variant === "stitch"
              ? "border border-stone-300 bg-white shadow-sm dark:border-stone-600 dark:bg-stone-800"
              : "bg-accent"
          )}
          title={activeModule}
        >
          <ActiveIcon
            className={cn(
              "h-4 w-4",
              variant === "stitch"
                ? "text-stone-600 dark:text-stone-300"
                : "text-muted-foreground"
            )}
          />
        </div>
      </div>
    );
  }

  // Render a static button before hydration to avoid Radix ID mismatch
  if (!mounted) {
    return (
      <button
        style={triggerStyle}
        className={variant === "stitch" ? stitchTrigger : defaultTrigger}
        type="button"
      >
        <LayoutGrid
          className={cn(
            "h-4 w-4 shrink-0",
            variant === "stitch"
              ? "text-stone-500 dark:text-stone-400"
              : "text-muted-foreground"
          )}
        />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <ActiveIcon
            className={cn(
              "h-4 w-4 shrink-0",
              variant === "stitch"
                ? "text-stone-600 dark:text-stone-300"
                : "text-muted-foreground/60"
            )}
          />
          <span className="truncate">{activeModule}</span>
        </span>
        <ChevronsUpDown
          className={cn(
            "h-4 w-4 shrink-0",
            variant === "stitch"
              ? "text-stone-500 dark:text-stone-400"
              : "text-muted-foreground/60"
          )}
        />
      </button>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          style={triggerStyle}
          className={variant === "stitch" ? stitchTrigger : defaultTrigger}
        >
          <LayoutGrid
            className={cn(
              "h-4 w-4 shrink-0",
              variant === "stitch"
                ? "text-stone-500 dark:text-stone-400"
                : "text-muted-foreground"
            )}
          />
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <ActiveIcon
              className={cn(
                "h-4 w-4 shrink-0",
                variant === "stitch"
                  ? "text-stone-600 dark:text-stone-300"
                  : "text-muted-foreground/60"
              )}
            />
            <span className="truncate">{activeModule}</span>
          </span>
          <ChevronsUpDown
            className={cn(
              "h-4 w-4 shrink-0 transition-transform duration-200",
              variant === "stitch"
                ? "text-stone-500 dark:text-stone-400"
                : "text-muted-foreground/60",
              open &&
                (variant === "stitch"
                  ? "text-stone-800 dark:text-stone-100"
                  : "text-foreground")
            )}
          />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={6}
          style={{
            width: "var(--radix-popover-trigger-width)",
            ...contentStyle,
          }}
          className={cn(
            "z-[100] overflow-hidden shadow-lg",
            variant === "stitch"
              ? "core-ui-root rounded-md border border-stone-200 bg-white text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
              : "rounded-lg border border-border bg-popover",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "data-[side=bottom]:slide-in-from-top-2"
          )}
        >
          {/* Search */}
          <div
            className={cn(
              "flex items-center px-3",
              variant === "stitch"
                ? "border-b border-stone-200 dark:border-stone-700"
                : "border-b border-border/60"
            )}
          >
            <Search
              className={cn(
                "mr-2 h-3.5 w-3.5 shrink-0",
                variant === "stitch"
                  ? "text-stone-400"
                  : "text-muted-foreground/60"
              )}
            />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search modules…"
              className={cn(
                "flex-1 bg-transparent py-2.5 text-sm focus:outline-none",
                variant === "stitch"
                  ? "text-stone-900 placeholder:text-stone-400 focus-visible:ring-0 dark:text-stone-100 dark:placeholder:text-stone-500"
                  : "placeholder:text-muted-foreground/60"
              )}
            />
          </div>

          {/* Module list */}
          <div className="p-1">
            <p
              className={cn(
                "px-2 py-1.5 text-xs font-bold uppercase tracking-[0.08em]",
                variant === "stitch"
                  ? "text-stone-500 dark:text-stone-400"
                  : "text-muted-foreground/60"
              )}
            >
              Navigate to
            </p>

            {filtered.length === 0 ? (
              <p
                className={cn(
                  "px-3 py-4 text-center text-sm",
                  variant === "stitch"
                    ? "text-stone-500"
                    : "text-muted-foreground/60"
                )}
              >
                No modules found
              </p>
            ) : (
              filtered.map((mod) => {
                const Icon = mod.icon;
                const isActive = mod.label === activeModule;
                const itemClass = cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-200",
                  variant === "stitch"
                    ? isActive
                      ? "bg-[#f9d61a] font-semibold text-[#221b00] shadow-sm"
                      : "text-stone-800 hover:bg-stone-100 dark:text-stone-100 dark:hover:bg-stone-800"
                    : isActive
                      ? "bg-foreground font-medium text-background"
                      : "text-foreground hover:bg-accent"
                );
                const iconClass = cn(
                  "h-4 w-4 shrink-0",
                  variant === "stitch"
                    ? isActive
                      ? "text-[#6d5d00]"
                      : "text-stone-500 dark:text-stone-400"
                    : isActive
                      ? "text-background"
                      : "text-muted-foreground"
                );
                const inner = (
                  <>
                    <Icon className={iconClass} />
                    <span className="flex-1 text-left">{mod.label}</span>
                    {isActive && (
                      <Check
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          variant === "stitch"
                            ? "text-[#6d5d00]"
                            : "text-background"
                        )}
                      />
                    )}
                  </>
                );

                if (isExternalModuleHref(mod.href)) {
                  return (
                    <a key={mod.label} href={mod.href} className={itemClass}>
                      {inner}
                    </a>
                  );
                }

                return (
                  <Link key={mod.label} href={mod.href} className={itemClass}>
                    {inner}
                  </Link>
                );
              })
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

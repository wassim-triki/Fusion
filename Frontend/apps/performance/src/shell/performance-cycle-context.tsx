"use client";

import { usePathname, useRouter } from "next/navigation";
import { useHydratedWorkspaceAccess } from "@repo/auth";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ds/components/ui/dropdown-menu";
import { Check, ChevronsUpDown } from "@repo/ds/icons";
import { CycleContextBar } from "@/features/performance/components/cycle-context-bar";
import { useCurrentCycle } from "@/features/performance/api/use-performance";
import { useWorkspaceContext } from "@/features/performance/api/use-workspace";

import { isCycleAddress, withCycle } from "@/lib/performance-routes";
import { resolvePerformanceWorkspaceAccessState } from "./performance-workspace-access";
import { useTranslations } from "next-intl";

/** Destinations that belong to people, not cycles: the cycle switcher never follows into them. */
const CYCLE_FREE_ROUTES = ["/one-on-ones", "/feedback", "/settings"];
import { useFormat } from "@repo/ds/lib/use-format";

/**
 * The top-bar binding of the Cycle context: which Cycle the workspace is showing, and — when the caller
 * may see more than one — a switch to another. Switching keeps the current workspace; a record that
 * belongs to its own Cycle returns to Overview for the chosen one. Access, error, and no-Cycle states
 * belong to the page body; here they simply render nothing.
 */
export function PerformanceCycleContext() {
  const format = useFormat();
  const t = useTranslations("common.PerformanceCycleContext");
  const router = useRouter();
  const pathname = usePathname();
  // 1:1s and Feedback belong to people, not cycles (S-07): no cycle context to show or switch there.
  const path = pathname.replace(/^\/performance/, "") || "/";
  const cycleFree = CYCLE_FREE_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
  // The header reads nothing until the session is confirmed to enter Performance, and never on cycle-free routes.
  const { state: access } = useHydratedWorkspaceAccess(resolvePerformanceWorkspaceAccessState);
  const enabled = access === "allowed" && !cycleFree;
  const detail = useCurrentCycle(enabled);
  const context = useWorkspaceContext(enabled);
  const cycle = detail.data?.cycle ?? null;
  if (cycleFree) return null;

  if (access === "loading" || access === "sign-in-required" || context.isLoading || detail.isLoading) {
    return <Skeleton className="h-5 w-72 max-w-full" aria-hidden />;
  }
  if (access !== "allowed" || context.error) return null;
  if (!cycle) return null;

  const cycles = context.data?.cycles ?? [];
  const bar = <CycleContextBar cycle={cycle} phase={detail.data?.phase} />;
  if (cycles.length < 2) return bar;

  const select = (id: string) => {
    const workspace = isCycleAddress(path) ? "/" : path;
    router.push(withCycle(workspace, id));
  };

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {bar}
      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t("switchCycle")}
        >
          <ChevronsUpDown className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-72">
          {cycles.map((option) => (
            <DropdownMenuItem key={option.id} onSelect={() => select(option.id)} className="items-start gap-2.5">
              <Check className={option.id === cycle.id ? "mt-0.5 size-4" : "mt-0.5 size-4 opacity-0"} aria-hidden />
              <span className="min-w-0">
                <span className="block truncate text-foreground">{option.name}</span>
                <span className="block type-meta text-muted-foreground">
                  {t(`state.${option.state}`)} · {format.range(option.startDate, option.endDate)}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

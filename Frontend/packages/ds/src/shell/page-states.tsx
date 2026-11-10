import type { ComponentType, ReactNode } from "react";
import { Inbox, Lock } from "../icons";
import { useTranslations } from "next-intl";
import { cn } from "../lib/utils";
import { Skeleton } from "../components/ui/skeleton";
import { PageContainer, type PageContainerProps } from "./page";
import { PageStateDrawing, type PageStateDrawingKind } from "./page-state-drawings";

interface BaseStateProps {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  headingLevel?: 1 | 2 | 3;
}

function StateShell({
  icon: Icon,
  title,
  description,
  action,
  className,
  headingLevel = 3,
}: BaseStateProps) {
  const Heading = headingLevel === 1 ? "h1" : headingLevel === 2 ? "h2" : "h3";

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-surface border border-dashed border-border px-6 py-14 text-center",
        className
      )}
    >
      {Icon ? (
        <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </span>
      ) : null}
      <Heading className="text-base font-semibold text-foreground">
        {title}
      </Heading>
      {description ? (
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** Empty state: explains what's missing and what to do next. */
export function PageEmpty(props: BaseStateProps) {
  return <StateShell icon={props.icon ?? Inbox} {...props} />;
}

/** A standing notice that isn't a failure, like a cycle that hasn't started or a view narrowed to someone's team. */
export function PagePermissionNotice(props: Omit<BaseStateProps, "icon">) {
  return <StateShell icon={Lock} {...props} />;
}

const OPEN_SEARCH_EVENT = "fusion:open-search";

/** Opens the top bar's search, the one search there is. */
export function openTopBarSearch() {
  window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
}

/** Lets the top bar's search answer {@link openTopBarSearch}; returns the way to stop listening. */
export function onOpenTopBarSearch(open: () => void): () => void {
  window.addEventListener(OPEN_SEARCH_EVENT, open);
  return () => window.removeEventListener(OPEN_SEARCH_EVENT, open);
}

export interface PageStateProps {
  drawing: PageStateDrawingKind;
  /** A page gets the drawing and the Lora title; a card with room a small drawing; a slim row one line. */
  size?: "page" | "card" | "row";
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Under the actions on a page: who to ask, the reference code, the countdown, the search. */
  footer?: ReactNode;
  headingLevel?: 1 | 2 | 3;
  className?: string;
}

/**
 * One family for every way a page or a piece of one fails (B-302): plain words, one small drawing, a next step. No
 * status codes, no box; the frame stays around it. Ordinary empty states stay with {@link PageEmpty}.
 */
export function PageState({
  drawing,
  size = "page",
  title,
  description,
  actions,
  footer,
  headingLevel = 1,
  className,
}: PageStateProps) {
  if (size === "row") {
    return (
      <div className={cn("flex items-center gap-3", className)}>
        <p className="text-sm text-muted-foreground">{title}</p>
        {actions}
      </div>
    );
  }

  if (size === "card") {
    return (
      <div className={cn("m-auto flex flex-col items-center gap-2 py-2 text-center", className)}>
        <PageStateDrawing kind={drawing} size="small" />
        <p className="text-sm text-muted-foreground">{title}</p>
        {actions ? <div className="mt-1 flex flex-wrap justify-center gap-2">{actions}</div> : null}
      </div>
    );
  }

  const Heading = headingLevel === 1 ? "h1" : headingLevel === 2 ? "h2" : "h3";
  return (
    <div className={cn("mx-auto flex max-w-[40rem] flex-col items-center gap-3 px-6 py-16 text-center", className)}>
      <PageStateDrawing kind={drawing} />
      <Heading className="mt-2 text-balance font-editorial text-[1.9375rem] font-medium leading-[1.18] tracking-[-0.012em] text-foreground">
        {title}
      </Heading>
      {description ? (
        <p className="max-w-[54ch] text-pretty text-[0.9375rem] text-muted-foreground">{description}</p>
      ) : null}
      {actions ? <div className="mt-3 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
      {footer ? <div className="mt-4 flex flex-col items-center gap-2 text-sm text-muted-foreground">{footer}</div> : null}
    </div>
  );
}

export interface PageLoadingProps {
  /** Number of skeleton rows for list-style loading. */
  rows?: number;
  className?: string;
  label?: string;
}

/** Calm, specific loading state (skeleton rows). */
export function PageLoading({ rows = 5, className, label }: PageLoadingProps) {
  const t = useTranslations("ds.states");
  return (
    <div className={cn("space-y-2", className)} aria-busy aria-label={label ?? t("loading")}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export interface PageListSkeletonProps {
  /** Compact rows shown below the lead card. */
  rows?: number;
  className?: string;
  label?: string;
}

/**
 * Loading placeholder for a "door" list: one lead card + a few compact rows.
 * Content-only (no container) so it drops in under a real PageHeader. The shape
 * is fixed by design — never sized to the eventual record count — so it reads as
 * a full list regardless of how many rows load.
 */
export function PageListSkeleton({ rows = 3, className, label }: PageListSkeletonProps) {
  const t = useTranslations("ds.states");
  return (
    <div className={cn("space-y-3", className)} aria-busy aria-label={label ?? t("loadingList")}>
      <div className="rounded-surface bg-card p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1 space-y-2.5">
            <Skeleton className="h-5 w-28 rounded-full" />
            <Skeleton className="h-7 w-64 max-w-full" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="flex items-center gap-8 lg:shrink-0">
            <div className="space-y-2">
              <Skeleton className="h-7 w-12" />
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-7 w-12" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="size-5 shrink-0 rounded-detail" />
          </div>
        </div>
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-control border border-border bg-card px-5 py-4"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="size-4 shrink-0 rounded-detail" />
        </div>
      ))}
    </div>
  );
}

export interface PageSkeletonProps {
  /** Number of content skeleton rows below the header placeholder. */
  rows?: number;
  width?: PageContainerProps["width"];
  label?: string;
}

/**
 * Neutral in-frame page fallback: header-shaped placeholder + content rows.
 * Title-less by design — never fakes a page name. Use for route-level
 * loading boundaries and access-resolution holds inside the app shell.
 */
export function PageSkeleton({ rows = 6, width = "default", label }: PageSkeletonProps) {
  const t = useTranslations("ds.states");
  return (
    <PageContainer width={width}>
      <div aria-busy aria-label={label ?? t("loadingPage")}>
        <div className="mb-6 space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <PageLoading rows={rows} label={label} />
      </div>
    </PageContainer>
  );
}

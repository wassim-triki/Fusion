import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "../lib/utils";

type KpiTone = "default" | "warning" | "danger" | "success" | "info";

const VALUE_TONE: Record<KpiTone, string> = {
  default: "text-foreground",
  warning: "text-warning",
  danger: "text-destructive",
  success: "text-success",
  info: "text-info",
};

export interface KpiStatProps {
  label: string;
  value: string | number;
  /** Small subtext under the value (scope, comparison, etc.). */
  hint?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  /** Whole tile becomes a link to the underlying list/detail. */
  href?: string;
  tone?: KpiTone;
  className?: string;
}

/** Decision-oriented KPI tile: uppercase label, big tabular value, optional icon + link. */
export function KpiStat({
  label,
  value,
  hint,
  icon: Icon,
  href,
  tone = "default",
  className,
}: KpiStatProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="type-eyebrow text-muted-foreground">
          {label}
        </p>
        {Icon ? (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-control bg-muted text-muted-foreground">
            <Icon className="size-4" />
          </span>
        ) : href ? (
          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover/kpi:text-primary" />
        ) : null}
      </div>
      <p className={cn("type-metric mt-2", VALUE_TONE[tone])}>
        {value}
      </p>
      {hint ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </>
  );

  const base = cn(
    "group/kpi flex flex-col rounded-surface bg-card p-4",
    href && "transition-colors hover:border-primary/40 hover:bg-muted/10",
    className
  );

  if (href) {
    return (
      <Link href={href} className={base}>
        {body}
      </Link>
    );
  }
  return <div className={base}>{body}</div>;
}

/** Responsive grid for KPI tiles. */
export function KpiGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>
      {children}
    </div>
  );
}

export interface DashboardSectionProps {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Titled dashboard section with consistent rhythm and an optional right-aligned action. */
export function DashboardSection({
  title,
  description,
  action,
  children,
  className,
}: DashboardSectionProps) {
  return (
    <section className={cn("space-y-3", className)}>
      {title || action ? (
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            {title ? (
              <h2 className="type-subsection-title text-foreground">{title}</h2>
            ) : null}
            {description ? (
              <p className="text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** A plain white panel (card surface) for dashboard content that isn't a KPI. */
export function DashboardPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-surface bg-card p-4",
        className
      )}
    >
      {children}
    </div>
  );
}

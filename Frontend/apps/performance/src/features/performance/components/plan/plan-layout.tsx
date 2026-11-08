import type { ReactNode } from "react";
import { cn } from "@repo/ds/lib/utils";
import { useTranslations } from "next-intl";

/**
 * The Plan's document + sidebar layout. Objects are framed, columns are not: the main column is a
 * section heading over a list of objective cards on the canvas, and the sidebar is an unframed, sticky
 * properties column split by hairlines. Neither column has a bottom edge, so their heights never need
 * to match — the list ends where its content ends.
 */
export function PlanDocument({ main, sidebar }: { main: ReactNode; sidebar?: ReactNode }) {
  if (!sidebar) return <div className="min-w-0">{main}</div>;
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-10">
      <div className="min-w-0">{main}</div>
      <aside className="border-t border-border pt-6 lg:sticky lg:top-6 lg:border-t-0 lg:pt-0">{sidebar}</aside>
    </div>
  );
}

/** A section's title with its quiet count, for the DS `Section` title line. */
export function SectionTitle({ label, count }: { label: ReactNode; count?: number }) {
  return (
    <span className="flex items-baseline gap-2">
      {label}
      {count !== undefined ? <span className="type-meta tabular-nums text-muted-foreground">{count}</span> : null}
    </span>
  );
}

/**
 * The plan's weight composition: one segment per objective, sized by its weight, over the unallocated
 * remainder, coloured as the cards are (aligned in the accent, standalone in info). It says what "100% weighted" only asserted — how the plan's weight is split — and the total
 * reads plainly once complete, amber while short, red when over.
 */
export function PlanWeightStrip({ segments }: { segments: { weight: number; aligned: boolean }[] }) {
  const t = useTranslations("plan.PlanWeightStrip");
  const total = segments.reduce((sum, s) => sum + s.weight, 0);
  const tone = total === 100 ? "text-foreground" : "text-destructive";
  return (
    <div className="flex items-center gap-2.5">
      <span className="type-meta text-muted-foreground">{t("weight")}</span>
      <div className="flex h-1.5 w-32 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        {segments.map((segment, i) => (
          <span
            key={i}
            className={cn("h-full first:rounded-s-full", segment.aligned ? "bg-primary" : "bg-info")}
            style={{ width: `${Math.min(segment.weight, 100)}%` }}
          />
        ))}
      </div>
      <span className={cn("type-meta-strong tabular-nums", tone)}>
        {Math.round(total)}%<span className="sr-only"> {t("ofPlanWeightAllocated")}</span>
      </span>
    </div>
  );
}

/** One group of sidebar properties. Groups are separated by hairlines, never boxed. */
export function SidebarSection({
  label,
  children,
  className,
}: {
  label?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border-t border-border py-6 first:border-t-0 first:pt-0 last:pb-0", className)}>
      {label ? <h2 className="type-meta text-muted-foreground">{label}</h2> : null}
      {children}
    </section>
  );
}

import type { ReactNode } from "react";
import Link from "next/link";
import type { OverviewChipDto } from "@repo/api";
import { ArrowRight, Check, ChevronRight } from "@repo/ds/icons";
import { Button } from "@repo/ds/components/ui/button";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { cn } from "@repo/ds/lib/utils";
import { PersonInitials } from "@repo/performance-ui";
import { appHref } from "./overview-model";
import { useTranslations } from "next-intl";

/**
 * One Overview row: a label column (what it is about, a short fact and where its workspace is) and the facts beside
 * it, like a receipt. Rows are unframed and separated by a hairline so the page reads as one ranked list.
 */
export function OverviewRow({
  label,
  sub,
  link,
  children,
}: {
  label: string;
  sub?: ReactNode;
  link?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="grid gap-4 border-t border-border py-7 md:grid-cols-[188px_minmax(0,1fr)] md:gap-7">
      <div className="space-y-1 pt-0.5">
        <h2 className="type-panel-title text-foreground">{label}</h2>
        {sub ? <p className="type-meta text-muted-foreground">{sub}</p> : null}
        {link ? (
          <Link href={appHref(link.href)} className="mt-3 inline-flex items-center gap-1 type-label text-foreground hover:text-primary">
            {link.label}
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </Link>
        ) : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export type Tone = "attention" | "ok" | "risk" | "off" | "quiet";

const DOT: Record<Tone, string | null> = {
  attention: "bg-primary",
  ok: "bg-success",
  risk: "bg-warning",
  off: "bg-destructive",
  quiet: null,
};

/** What the row says right now: one statement, with its dot when it needs the person or reports a state. */
export function Headline({ children, tone = "quiet", action }: { children: ReactNode; tone?: Tone; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <p className={cn("flex min-w-0 items-center gap-2.5 type-section-title", tone === "quiet" ? "text-foreground/80" : "text-foreground")}>
        {DOT[tone] ? <span className={cn("size-2 shrink-0 rounded-full", DOT[tone])} aria-hidden /> : null}
        <span className="min-w-0">{children}</span>
      </p>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** The row's one action: primary when the row needs the person, outline otherwise. */
export function RowAction({ href, children, primary }: { href: string; children: ReactNode; primary?: boolean }) {
  return (
    <Button asChild variant={primary ? "default" : "outline"}>
      <Link href={appHref(href)}>
        {children}
        {primary ? <ArrowRight className="size-4" data-icon="inline-end" aria-hidden /> : null}
      </Link>
    </Button>
  );
}

export type Fact = { label: ReactNode; tone?: Tone };

/** Supporting facts in one line; a fact with a state carries its dot. */
export function Facts({ facts, className }: { facts: (Fact | null | false | undefined)[]; className?: string }) {
  const shown = facts.filter((fact): fact is Fact => Boolean(fact));
  if (shown.length === 0) return null;
  return (
    <ul className={cn("mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 type-body-secondary text-muted-foreground", className)}>
      {shown.map((fact, index) => (
        <li key={index} className="inline-flex items-center gap-1.5">
          {fact.tone && DOT[fact.tone] ? <span className={cn("size-2 rounded-full", DOT[fact.tone])} aria-hidden /> : null}
          <span>{fact.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** A number set in bold within a fact. */
export const N = ({ children }: { children: ReactNode }) => <b className="font-semibold tabular-nums text-foreground">{children}</b>;

/** Up to six people as chips with their state, those who need the viewer marked. Never a roster. */
export function Chips({ chips, word }: { chips: OverviewChipDto[]; word: (chip: OverviewChipDto) => string }) {
  const t = useTranslations("overview.Chips");
  if (chips.length === 0) return null;
  return (
    <ul className="mt-4 flex flex-wrap gap-2" aria-label={t("people")}>
      {chips.map((chip) => {
        const body = (
          <>
            <PersonInitials name={chip.name} size="sm" />
            <span className="min-w-0">
              <span className="block truncate type-label text-foreground">{chip.name}</span>
              <span className={cn("block truncate type-meta", chip.needsYou ? "text-primary" : "text-muted-foreground")}>{word(chip)}</span>
            </span>
          </>
        );
        const className = cn(
          "flex items-center gap-2.5 rounded-control py-1.5 pe-3 ps-1.5",
          chip.needsYou
            ? "bg-primary/10 ring-1 ring-inset ring-primary/50"
            : chip.state === "NotStarted"
              ? "border border-dashed border-border"
              : "bg-card ring-1 ring-inset ring-border",
        );
        return (
          <li key={chip.employeeId}>
            {chip.href ? (
              <Link href={appHref(chip.href)} className={cn(className, "transition-colors hover:bg-inlay")}>{body}</Link>
            ) : (
              <span className={className}>{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A short framed list of records, each row opening one. */
export function MiniList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="mt-4 divide-y divide-border overflow-hidden rounded-surface bg-card ring-1 ring-inset ring-border">
      {children}
    </ul>
  );
}

export function MiniItem({ href, title, sub, trailing }: { href: string; title: ReactNode; sub?: ReactNode; trailing?: ReactNode }) {
  return (
    <li>
      <Link href={appHref(href)} className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-inlay">
        <span className="min-w-0 flex-1">
          <span className="block truncate type-label text-foreground">{title}</span>
          {sub ? <span className="block truncate type-meta text-muted-foreground">{sub}</span> : null}
        </span>
        {trailing}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </li>
  );
}

/** A single progress line: track, fill and figure. Missing reads as missing. */
export function ProgressLine({ value, has, className }: { value: number; has: boolean; className?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <span className="relative h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-inlay">
        {has ? <span className="absolute inset-y-0 inset-s-0 rounded-full bg-primary" style={{ width: `${clamped}%` }} /> : null}
      </span>
      <span className={cn("w-10 shrink-0 text-end type-label tabular-nums", has ? "text-foreground" : "text-muted-foreground")}>
        {has ? `${Math.round(value)}%` : "—"}
      </span>
    </span>
  );
}

/** A segmented bar of counts (states or statuses), each segment sized by its count. */
export function SegmentBar({ segments, label }: { segments: { count: number; className: string }[]; label: string }) {
  const total = segments.reduce((sum, s) => sum + s.count, 0);
  if (total === 0) return null;
  return (
    <div role="img" aria-label={label} className="mt-4 flex h-2 gap-[3px]">
      {segments.filter((s) => s.count > 0).map((s, i) => (
        <span key={i} className={cn("min-w-1.5 rounded-full", s.className)} style={{ width: `${(s.count / total) * 100}%` }} />
      ))}
    </div>
  );
}

/** A path of steps (where a review or a setup stands). */
export function StepsStrip({ steps }: { steps: { label: string; detail?: string | null; state: "done" | "current" | "upcoming" }[] }) {
  const t = useTranslations("overview.StepsStrip");
  return (
    <ol className="mt-5 flex items-start" aria-label={t("whereThisStands")}>
      {steps.map((step, index) => (
        <li key={`${step.label}-${index}`} className="relative min-w-0 flex-1 pe-3">
          {index < steps.length - 1 ? (
            <span aria-hidden className={cn("absolute top-3 inset-e-1 inset-s-8 h-px", step.state === "done" ? "bg-success" : "bg-border")} />
          ) : null}
          <span
            className={cn(
              "relative grid size-6 place-items-center rounded-detail type-mark ring-1 ring-inset",
              step.state === "done" && "bg-success text-background ring-success",
              step.state === "current" && "bg-primary/15 text-primary ring-primary",
              step.state === "upcoming" && "bg-inlay text-muted-foreground ring-border",
            )}
          >
            {step.state === "done" ? <Check className="size-3.5" aria-hidden /> : index + 1}
          </span>
          <span className={cn("mt-2 block truncate type-label", step.state === "current" ? "text-primary" : "text-foreground")}>{step.label}</span>
          {step.detail ? <span className="block truncate type-meta text-muted-foreground">{step.detail}</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function RowSkeleton() {
  return (
    <div className="space-y-2 border-t border-border py-7" aria-hidden>
      <Skeleton className="h-5 w-64 max-w-full" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { AlertCircle, ArrowRight, CalendarDays, CheckCircle2, CircleMinus, Info, ListChecks, TriangleAlert } from "lucide-react";
import { Button, Calendar, Popover, PopoverContent, PopoverTrigger, Spinner, cn } from "@repo/ds";
import type { WorkforceReviewCountsDto } from "@repo/api";
import { useWorkforceDate } from "@/features/people/components/workforce-ui";
import type { ReviewNotice } from "../model/review-view";

type BannerState = "blocked" | "noop" | "ready";

export function bannerState(counts: WorkforceReviewCountsDto): BannerState {
  return counts.blocked > 0 ? "blocked" : counts.create === 0 ? "noop" : "ready";
}


/** Where the proposal stands, the counts that decide it, and the date it describes. */
export function WorkforceReviewBanner({
  counts,
  asOf,
  changingAsOf,
  onChangeAsOf,
}: {
  counts: WorkforceReviewCountsDto;
  asOf: string;
  changingAsOf: boolean;
  onChangeAsOf: (date: string) => void;
}) {
  const t = useTranslations("wfImport.banner");
  const state = bannerState(counts);
  const Icon = state === "blocked" ? AlertCircle : state === "noop" ? CircleMinus : CheckCircle2;
  const facts = [
    t("reviewed", { count: counts.total }),
    t("created", { count: counts.create }),
    counts.existing > 0 ? t("existing", { count: counts.existing }) : null,
    t("notImported", { count: counts.notImported }),
    t("blockers", { count: counts.openDecisionCount }),
  ].filter((fact): fact is string => fact !== null);

  return (
    <section
      aria-label={t("label")}
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-4 rounded-surface border p-4 sm:pe-5",
        state === "blocked"
          ? "border-destructive/35 bg-linear-to-r from-destructive/[0.08] via-card to-card"
          : state === "noop"
            ? "border-border bg-card"
            : "border-success/35 bg-linear-to-r from-success/[0.09] via-card to-card"
      )}
    >
      <div className="flex min-w-0 items-center gap-4">
        <span
          aria-hidden
          className={cn(
            "grid size-12 shrink-0 place-items-center rounded-full",
            state === "blocked" ? "bg-destructive/15 text-destructive" : state === "noop" ? "bg-muted text-muted-foreground" : "bg-success text-background"
          )}
        >
          <Icon className="size-6" strokeWidth={state === "ready" ? 2.25 : 1.75} />
        </span>
        <div className="min-w-0">
          <h2 className="type-page-title text-foreground">{t(state)}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 type-body text-muted-foreground">
            {facts.map((fact, index) => (
              <span key={fact} className="flex items-center gap-2">
                {index > 0 ? <span aria-hidden className="text-muted-foreground/60">•</span> : null}
                <span className="tabular-nums">{fact}</span>
              </span>
            ))}
          </p>
        </div>
      </div>
      <AsOfPicker value={asOf} busy={changingAsOf} onChange={onChangeAsOf} />
    </section>
  );
}

/**
 * The workforce-as-of date is an input to the proposal: moving it re-derives who is active, former or
 * not imported. Which dates are allowed is CoreHR's rule, so the server answers for it.
 */
function AsOfPicker({ value, busy, onChange }: { value: string; busy: boolean; onChange: (date: string) => void }) {
  const t = useTranslations("wfImport.banner");
  const workforceDate = useWorkforceDate();
  const [open, setOpen] = useState(false);
  const selected = parseCalendarDate(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" disabled={busy} className="h-10 gap-2 font-normal">
          {busy ? <Spinner className="size-4" aria-hidden /> : <CalendarDays className="size-4 text-muted-foreground" aria-hidden />}
          <span className="text-muted-foreground">{t("asOf")}</span>
          <span className="font-semibold text-foreground">{workforceDate(value)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <Calendar
          mode="single"
          autoFocus
          defaultMonth={selected}
          selected={selected}
          onSelect={(date) => {
            if (!date) return;
            setOpen(false);
            const next = toCalendarDate(date);
            if (next !== value) onChange(next);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

const FINDING_TONE = {
  destructive: { icon: AlertCircle, badge: "bg-destructive/15 text-destructive", count: "bg-destructive/15 text-destructive" },
  warning: { icon: TriangleAlert, badge: "bg-warning/15 text-warning", count: "bg-warning/15 text-warning" },
  info: { icon: Info, badge: "bg-muted text-foreground", count: "bg-muted text-muted-foreground" },
} as const;

/** Every finding in one panel, most severe first, each leading to the people it concerns. */
export function WorkforceReviewNotices({ notices, onView }: { notices: ReviewNotice[]; onView: (notice: ReviewNotice) => void }) {
  const t = useTranslations("wfImport.findings");
  if (notices.length === 0) return null;
  const blocking = notices.some((n) => n.tone === "destructive");
  return (
    <section aria-labelledby="review-findings-title" className="rounded-surface bg-card p-4 sm:p-5">
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-muted text-foreground">
            <ListChecks className="size-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <h2 id="review-findings-title" className="type-section-title text-foreground">
              {t("title")}
            </h2>
            <p className="type-body text-muted-foreground">
              {blocking ? t("blocking") : t("worth")}
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-border px-3 py-1 type-meta tabular-nums text-muted-foreground">
          {t("count", { count: notices.length })}
        </span>
      </header>
      <ul className="mt-4 divide-y divide-border">
        {notices.map((notice) => {
          const tone = FINDING_TONE[notice.tone];
          const Icon = tone.icon;
          const primary = notice.tone === "destructive";
          return (
            <li
              key={notice.key}
              className={cn(
                "flex flex-wrap items-center gap-x-5 gap-y-3 px-3 py-3.5 sm:flex-nowrap",
                primary && "rounded-control border border-destructive/30 bg-destructive/[0.07]"
              )}
            >
              <div className="flex shrink-0 items-center gap-4">
                <span aria-hidden className={cn("grid size-10 place-items-center rounded-full", tone.badge)}>
                  <Icon className="size-5" strokeWidth={1.75} />
                </span>
                <span
                  className={cn(
                    "grid h-8 min-w-11 place-items-center rounded-full px-2.5 type-label font-semibold tabular-nums",
                    tone.count,
                    notice.count === null && "invisible"
                  )}
                >
                  {notice.count ?? 0}
                </span>
              </div>
              <div className="min-w-0 flex-1 border-border sm:border-s sm:ps-5">
                <p className="type-label font-semibold text-foreground">{notice.title}</p>
                <p className="mt-0.5 type-body text-muted-foreground">{notice.detail}</p>
              </div>
              <Button
                variant={primary ? "default" : "outline"}
                onClick={() => onView(notice)}
                className={cn("ms-auto shrink-0 font-semibold", !primary && "text-primary-foreground dark:text-primary")}
              >
                {notice.action}
                <ArrowRight aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// An ISO calendar date (YYYY-MM-DD) as a local date, without the UTC drift `new Date("YYYY-MM-DD")` adds.
function parseCalendarDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : undefined;
}

function toCalendarDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

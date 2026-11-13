"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { CalibrationCardDto, CalibrationLevelDto } from "@repo/api";
import { cn } from "@repo/ds";
import { Button } from "@repo/ds/components/ui/button";
import { Input } from "@repo/ds/components/ui/input";
import { AsyncButton } from "@repo/ds/shell";
import { PersonInitials } from "@repo/performance-ui";
import { reviewHref } from "@/lib/performance-routes";

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

interface Mark {
  /** Position along the scale, in levels from the lowest (0) to the highest (n − 1). */
  at: number;
  tag: string;
  tone: "wa" | "mu";
}

/**
 * A flagged review (D-70): who and who reviewed them, why it's flagged drawn on the scale, the manager's words, and the
 * decision: keep the manager's level in one click, or pick another and say why (the manager reads it).
 */
export function FlagCard({ card, scale, pending, onKeep, onChange }: {
  card: CalibrationCardDto;
  scale: CalibrationLevelDto[];
  pending: boolean;
  onKeep: () => Promise<unknown>;
  onChange: (rating: number, reason: string) => Promise<unknown>;
}) {
  const t = useTranslations("calibration.FlagCard");
  const [pick, setPick] = useState(card.rating);
  const [why, setWhy] = useState("");
  const changing = pick !== card.rating;
  const manager = firstName(card.reviewerName);
  const level = (value: number) => scale.find((l) => l.value === value)?.label ?? String(value);
  const index = (value: number) => Math.max(0, scale.findIndex((l) => l.value === value));
  const lowest = scale[0]?.value ?? 1;
  const flag = card.flag;

  const why_ = flag.kind === "goals" ? t("why.goals")
    : flag.kind === "moved" ? (flag.lastRating! > card.rating ? t("why.down", { count: flag.lastRating! - card.rating }) : t("why.up", { count: card.rating - flag.lastRating! }))
      : flag.kind === "ratesHigh" ? t("why.ratesHigh", { name: manager }) : t("why.ratesLow", { name: manager });
  const marks: Mark[] = flag.kind === "goals"
    ? [{ at: index(card.rating), tag: t("mark.rating", { name: manager }), tone: "wa" }, { at: (flag.grade ?? 0) * (scale.length - 1), tag: t("mark.goals", { grade: `${Math.round((flag.grade ?? 0) * 100)}%` }), tone: "mu" }]
    : flag.kind === "moved"
      ? [{ at: index(flag.lastRating!), tag: t("mark.lastYear"), tone: "mu" }, { at: index(card.rating), tag: t("mark.thisYear"), tone: "wa" }]
      : [{ at: flag.managerAverage! - lowest, tag: t("mark.average", { name: manager, count: flag.managerReviews! }), tone: "wa" },
        { at: flag.everyoneAverage! - lowest, tag: t("mark.everyone", { count: flag.everyoneReviews! }), tone: "mu" }];

  return (
    <article className="grid gap-4 rounded-surface bg-card px-6 pb-5 pt-[22px] animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
      <header className="flex items-center gap-3.5">
        <PersonInitials name={card.name} size="lg" className="size-11" />
        <div className="grid">
          <b className="text-[15.5px] font-semibold text-foreground">{card.name}</b>
          <span className="text-sm text-muted-foreground">
            {card.jobTitle ? t("roleReviewedBy", { role: card.jobTitle, name: card.reviewerName }) : t("reviewedBy", { name: card.reviewerName })}
          </span>
        </div>
        <span className="ms-auto text-[15px] font-semibold text-warning">{why_}</span>
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)_330px] items-center gap-[34px]">
        <Track marks={marks} scale={scale} />
        {card.words ? (
          <div className="flex items-start gap-3">
            <PersonInitials name={card.reviewerName} size="sm" />
            <div className="grid gap-[3px]">
              <span className="text-sm text-muted-foreground">{t("words", { name: manager })}</span>
              <q className="font-serif text-[14.5px] leading-relaxed text-foreground">{card.words}</q>
            </div>
          </div>
        ) : <span />}
      </div>
      <footer className="flex flex-wrap items-center gap-3 pt-3.5 shadow-[0_-1px_0_var(--border)]">
        <div role="group" aria-label={t("ratingFor", { name: card.name })} className="inline-flex rounded-control bg-inlay p-[3px]">
          {scale.map((l) => (
            <button key={l.value} type="button" aria-pressed={pick === l.value} onClick={() => setPick(l.value)}
              className={cn("rounded-[14px] px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground",
                pick === l.value && "bg-card font-semibold text-foreground shadow-sm",
                changing && l.value === card.rating && "ring-[1.5px] ring-inset ring-muted-foreground/60")}>
              {l.label}
            </button>
          ))}
        </div>
        {changing ? (
          <form className="flex min-w-[320px] flex-1 items-center gap-2 animate-in fade-in-0 duration-200"
            onSubmit={(event) => { event.preventDefault(); if (why.trim()) void onChange(pick, why.trim()); }}>
            <Input autoFocus value={why} onChange={(event) => setWhy(event.target.value)} maxLength={2000}
              placeholder={t("whyPlaceholder", { name: manager })} aria-label={t("why.label")} className="h-9 flex-1" />
            <Button type="button" variant="ghost" onClick={() => { setPick(card.rating); setWhy(""); }}>{t("cancel")}</Button>
            <AsyncButton type="submit" pending={pending} disabled={!why.trim()}>{t("changeTo", { level: level(pick) })}</AsyncButton>
          </form>
        ) : (
          <>
            <Link href={reviewHref(card.reviewId)} className="ms-auto text-sm font-medium text-primary-ink hover:underline">{t("readTheReview")}</Link>
            <AsyncButton pending={pending} onClick={() => void onKeep()}>{t("keep", { level: level(card.rating) })}</AsyncButton>
          </>
        )}
      </footer>
    </article>
  );
}

/** The scale as a line with its levels, the flag's two marks on it and the gap between them lit. */
function Track({ marks, scale }: { marks: Mark[]; scale: CalibrationLevelDto[] }) {
  const span = Math.max(1, scale.length - 1);
  const xs = marks.map((m) => Math.max(0, Math.min(1, m.at / span)) * 100);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const edge = (x: number) => (x < 8 ? "translate-x-[-12px]" : x > 92 ? "-translate-x-[calc(100%-12px)]" : "-translate-x-1/2");
  return (
    <div className="relative mx-2.5 h-[70px]" aria-hidden>
      <div className="absolute inset-x-0 top-9 h-1 rounded-full bg-inlay" />
      <div className="absolute top-9 h-1 bg-warning/55" style={{ insetInlineStart: `${lo}%`, width: `${hi - lo}%` }} />
      {scale.map((l, i) => {
        const x = (i / span) * 100;
        return (
          <span key={l.value}>
            <span className="absolute top-[33px] -ms-px h-2.5 w-0.5 rounded-sm bg-muted-foreground/45" style={{ insetInlineStart: `${x}%` }} />
            <span className={cn("absolute top-[52px] whitespace-nowrap text-[11.5px] text-muted-foreground", i === 0 ? "" : i === scale.length - 1 ? "-translate-x-full" : "-translate-x-1/2")}
              style={{ insetInlineStart: `${x}%` }}>{l.label}</span>
          </span>
        );
      })}
      {marks.map((m, i) => (
        <span key={m.tag}>
          <span className={cn("absolute top-[31px] -ms-[7px] size-3.5 rounded-full shadow-[0_0_0_3px_var(--card)] transition-[inset-inline-start] duration-500",
            m.tone === "wa" ? "bg-warning" : "bg-muted-foreground")} style={{ insetInlineStart: `${xs[i]}%` }} />
          <span className={cn("absolute top-0 whitespace-nowrap rounded-full bg-inlay px-[9px] py-[3px] text-xs font-semibold", edge(xs[i]!),
            m.tone === "wa" ? "text-warning" : "text-muted-foreground")} style={{ insetInlineStart: `${xs[i]}%` }}>{m.tag}</span>
        </span>
      ))}
    </div>
  );
}

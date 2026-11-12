"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { CalibrationDto, CalibrationEveryoneDto, CalibrationPersonDto } from "@repo/api";
import { cn } from "@repo/ds";
import { Button } from "@repo/ds/components/ui/button";
import { Input } from "@repo/ds/components/ui/input";
import { Users } from "@repo/ds/icons";
import { AsyncButton } from "@repo/ds/shell";
import { AvatarStack, PersonInitials } from "@repo/performance-ui";
import { firstName } from "./flag-card";

/** Up to this many people the plot names each face. */
const NAMED = 12;
const TICKS = [1, 0.8, 0.5, 0];

/**
 * Calibration's Everyone view (D-71, B-433): each person placed by their rating (across) and their goals' grade (up),
 * the two corners where rating and goals disagree marked with how many sit there, and each level's count against last
 * year underneath. A face dragged onto another level changes the rating, with a reason. Potential isn't rated.
 */
export function CalibrationPlot({ calibration, everyone, pending, onChange }: {
  calibration: CalibrationDto;
  everyone: CalibrationEveryoneDto;
  pending: boolean;
  onChange: (person: CalibrationPersonDto, rating: number, reason: string) => Promise<unknown>;
}) {
  const t = useTranslations("calibration.Grid");
  const locale = useLocale();
  const scale = [...calibration.scale].sort((a, b) => a.value - b.value);
  const levels = scale.length;
  const band = (rating: number) => (rating <= calibration.bandLowTop ? 0 : rating <= calibration.bandMidTop ? 1 : 2);
  const index = (rating: number) => Math.max(0, scale.findIndex((l) => l.value === rating));
  const label = (rating: number) => scale.find((l) => l.value === rating)?.label ?? String(rating);
  const graded = everyone.people.filter((p) => p.grade !== null);
  const ungraded = everyone.people.filter((p) => p.grade === null);
  const named = graded.length <= NAMED;
  const height = named ? 480 : 560;
  const pad = named ? 34 : 20;
  const y = (grade: number) => pad + (1 - Math.min(1, Math.max(0, grade))) * (height - pad * 2);
  const share = (n: number) => `${(n / levels) * 100}%`;
  const lowLevels = scale.filter((l) => band(l.value) === 0).length;
  const highLevels = scale.filter((l) => band(l.value) === 2).length;
  const below = graded.filter((p) => p.grade! >= 0.8 && band(p.rating) === 0).length;
  const above = graded.filter((p) => p.grade! < 0.5 && band(p.rating) === 2).length;
  const tick = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [drop, setDrop] = useState<{ person: CalibrationPersonDto; to: number } | null>(null);
  const [why, setWhy] = useState("");
  const onDrop = (to: number) => {
    const person = everyone.people.find((p) => p.reviewId === dragging);
    setDragging(null);
    setOver(null);
    if (!person || person.released || person.rating === to) return;
    setWhy("");
    setDrop({ person, to });
  };

  return (
    <div className="grid gap-3">
      {drop ? (
        <form className="flex items-center gap-3 rounded-inset bg-card px-3.5 py-3 ring-[1.5px] ring-inset ring-primary animate-in fade-in-0 duration-200"
          onSubmit={(event) => {
            event.preventDefault();
            if (!why.trim()) return;
            void onChange(drop.person, drop.to, why.trim()).then(() => setDrop(null));
          }}>
          <PersonInitials name={drop.person.name} size="md" />
          <span className="text-sm text-foreground"><b className="font-semibold">{drop.person.name}</b>, {t("fromTo", { from: label(drop.person.rating), to: label(drop.to) })}</span>
          <Input autoFocus value={why} onChange={(event) => setWhy(event.target.value)} maxLength={2000} className="h-9 flex-1"
            placeholder={t("whyPlaceholder", { name: firstName(drop.person.reviewerName) })} aria-label={t("why")} />
          <Button type="button" variant="ghost" onClick={() => setDrop(null)}>{t("cancel")}</Button>
          <AsyncButton type="submit" pending={pending} disabled={!why.trim()}>{t("change")}</AsyncButton>
        </form>
      ) : null}

      <div className="grid gap-2 ps-12">
        <span className="-ms-12 font-semibold text-foreground">{t("goalsGrade")}</span>
        <div className="relative rounded-surface bg-card" style={{ height }} role="group" aria-label={t("plotLabel")}>
          {scale.map((l, i) => (
            <div key={l.value} className={cn("absolute inset-y-0 transition-colors duration-200", i > 0 && "border-s border-border",
              over === l.value && "bg-primary/10")}
              style={{ insetInlineStart: share(i), width: share(1) }}
              onDragOver={(event) => { if (dragging) { event.preventDefault(); setOver(l.value); } }}
              onDragLeave={() => setOver((o) => (o === l.value ? null : o))}
              onDrop={(event) => { event.preventDefault(); onDrop(l.value); }} />
          ))}
          {lowLevels ? (
            <Zone start={0} span={lowLevels} levels={levels} top={6} bottom={height - y(0.8)} tone="destructive" count={below} label={t("ratedBelow")} labelAt="bottom" />
          ) : null}
          {highLevels ? (
            <Zone start={levels - highLevels} span={highLevels} levels={levels} top={y(0.5)} bottom={6} tone="warning" count={above} label={t("ratedAbove")} labelAt="top" />
          ) : null}
          {TICKS.map((g) => (
            <div key={g} className="pointer-events-none absolute inset-x-0" style={{ top: y(g) }}>
              {g === 0.8 || g === 0.5 ? <div className="border-t border-dashed border-border" /> : null}
              <span className="absolute -start-12 w-[34px] -translate-y-1/2 text-end text-[13.5px] font-semibold tabular-nums text-foreground">{tick.format(g)}</span>
            </div>
          ))}
          {graded.map((p) => {
            const x = (index(p.rating) + (named ? 0.08 + jitter(p.reviewId) * 0.42 : 0.14 + jitter(p.reviewId) * 0.72)) / levels;
            return (
              <span key={p.reviewId} title={`${p.name} · ${label(p.rating)} · ${tick.format(p.grade!)}`} draggable={!p.released}
                onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; setDragging(p.reviewId); }}
                onDragEnd={() => { setDragging(null); setOver(null); }}
                className={cn("absolute z-10 flex -translate-y-1/2 items-center gap-2", named ? "" : "-translate-x-1/2", !p.released && "cursor-grab")}
                style={{ insetInlineStart: `${x * 100}%`, top: y(p.grade!) }}>
                <span className={cn("rounded-full",
                  p.rating !== p.originalRating ? "ring-[1.5px] ring-primary ring-offset-2 ring-offset-card"
                    : p.flagged && !p.decided ? "ring-[1.5px] ring-warning ring-offset-2 ring-offset-card" : "")}>
                  <PersonInitials name={p.name} size={named ? "lg" : "sm"} />
                </span>
                {named ? <b className="text-[13.5px] font-semibold whitespace-nowrap text-foreground">{firstName(p.name)}</b> : null}
              </span>
            );
          })}
        </div>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${levels}, minmax(0, 1fr))` }}>
          {scale.map((l) => {
            const s = everyone.spread.find((x) => x.value === l.value);
            const count = s?.count ?? 0;
            const delta = count - (s?.lastYear ?? 0);
            return (
              <div key={l.value} className="flex items-center justify-center gap-2.5 pt-3">
                <span className="font-editorial text-[1.75rem] leading-none font-medium tabular-nums text-foreground">{count}</span>
                <div className="grid">
                  <b className="text-sm font-semibold text-foreground">{l.label}</b>
                  {everyone.lastCycleName ? (
                    <span className={cn("text-[12.5px]", delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground")}>
                      {delta ? t("onLast", { delta: delta > 0 ? `+${delta}` : `−${-delta}`, cycle: everyone.lastCycleName }) : t("sameAsLast", { cycle: everyone.lastCycleName })}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><Users aria-hidden className="size-3.5" />{t("dragHint")}</span>
        {ungraded.length ? (
          <span className="ms-auto inline-flex items-center gap-2.5">
            <AvatarStack names={ungraded.map((p) => p.name)} size="sm" max={4} />{t("ungraded", { count: ungraded.length })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Zone({ start, span, levels, top, bottom, tone, count, label, labelAt }: {
  start: number;
  span: number;
  levels: number;
  top: number;
  bottom: number;
  tone: "destructive" | "warning";
  count: number;
  label: string;
  labelAt: "top" | "bottom";
}) {
  return (
    <div className={cn("pointer-events-none absolute rounded-inset ring-[1.5px] ring-inset",
      tone === "destructive" ? "bg-destructive/10 ring-destructive/45 text-destructive" : "bg-warning/12 ring-warning/45 text-warning")}
      style={{ insetInlineStart: `calc(${(start / levels) * 100}% + 6px)`, width: `calc(${(span / levels) * 100}% - 12px)`, top, bottom }}>
      {count ? (
        <span className={cn("absolute start-3.5 flex items-baseline gap-2 text-sm font-semibold", labelAt === "top" ? "top-3" : "bottom-3")}>
          <span className="font-editorial text-2xl leading-none tabular-nums">{count}</span>{label}
        </span>
      ) : null}
    </div>
  );
}

/** A steady spread across the level's column, from the review's id. */
function jitter(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

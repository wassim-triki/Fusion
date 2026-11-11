"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { CalibrationDto, CalibrationEveryoneDto, CalibrationPersonDto } from "@repo/api";
import { cn } from "@repo/ds";
import { Button } from "@repo/ds/components/ui/button";
import { Input } from "@repo/ds/components/ui/input";
import { Users } from "@repo/ds/icons";
import { AsyncButton } from "@repo/ds/shell";
import { PersonInitials } from "@repo/performance-ui";
import { firstName } from "./flag-card";

const FACES = 8;

/** The goals' grade rows (D-71), highest first. */
const ROWS = [(g: number) => g >= 0.8, (g: number) => g >= 0.5 && g < 0.8, (g: number) => g < 0.5];

/**
 * Calibration's full view (D-71): the spread against last year, and everyone's rating against their goals' grade with
 * faces dragged across the rating's bands to change it, with a reason. Potential isn't rated.
 */
export function CalibrationGrid({ calibration, everyone, pending, onChange }: {
  calibration: CalibrationDto;
  everyone: CalibrationEveryoneDto;
  pending: boolean;
  onChange: (person: CalibrationPersonDto, rating: number, reason: string) => Promise<unknown>;
}) {
  const t = useTranslations("calibration.Grid");
  const scale = calibration.scale;
  const band = (rating: number) => (rating <= calibration.bandLowTop ? 0 : rating <= calibration.bandMidTop ? 1 : 2);
  const bands = [0, 1, 2].map((b) => scale.filter((l) => band(l.value) === b));
  const mid = bands[1]!;
  const columns = [
    bands[0]!.length === 1 ? bands[0]![0]!.label : t("below", { level: mid[0]?.label ?? "" }),
    mid.length === 1 ? mid[0]!.label : `${mid[0]?.label} – ${mid[mid.length - 1]?.label}`,
    bands[2]!.length === 1 ? bands[2]![0]!.label : t("above", { level: mid[mid.length - 1]?.label ?? "" }),
  ];
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ person: CalibrationPersonDto; to: number } | null>(null);
  const [why, setWhy] = useState("");
  const level = (value: number) => scale.find((l) => l.value === value)?.label ?? String(value);
  const graded = everyone.people.filter((p) => p.grade !== null);
  const ungraded = everyone.people.length - graded.length;

  // The level a face lands on in another band: the one nearest its rating now.
  const landing = (rating: number, target: number) => {
    const options = bands[target]!.map((l) => l.value);
    return options.reduce((best, v) => (Math.abs(v - rating) < Math.abs(best - rating) ? v : best), options[0]!);
  };
  const onDrop = (target: number) => {
    const person = everyone.people.find((p) => p.reviewId === dragging);
    setDragging(null);
    setOver(null);
    if (!person || person.released || band(person.rating) === target || !bands[target]!.length) return;
    setWhy("");
    setDrop({ person, to: landing(person.rating, target) });
  };
  const max = Math.max(1, ...everyone.spread.map((s) => Math.max(s.count, s.lastYear)));

  return (
    <div className="grid grid-cols-[330px_minmax(0,1fr)] items-start gap-[18px]">
      <section className="grid gap-4 rounded-surface bg-card px-6 py-[22px]">
        <div className="flex items-center">
          <h2 className="type-section-title text-foreground">{t("spread")}</h2>
          <span className="ms-auto text-sm text-muted-foreground">{t("rated", { count: everyone.people.length })}</span>
        </div>
        <div className="grid gap-3.5">
          {[...everyone.spread].reverse().map((s) => (
            <div key={s.value} className="grid grid-cols-[minmax(0,1fr)_40px] items-center gap-x-2.5 gap-y-1.5">
              <span className="text-sm text-foreground">{level(s.value)}</span>
              <span className="text-end font-semibold tabular-nums text-foreground">{s.count}</span>
              <div className="col-span-2 grid gap-[3px]">
                <div className="h-2 overflow-hidden rounded-full bg-inlay"><i className="block h-full rounded-full bg-primary" style={{ width: `${(s.count / max) * 100}%` }} /></div>
                {everyone.lastCycleName ? (
                  <div className="h-1 overflow-hidden rounded-full"><i className="block h-full rounded-full bg-muted-foreground/50" style={{ width: `${(s.lastYear / max) * 100}%` }} /></div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-3.5 rounded-full bg-primary" />{calibration.cycleName}</span>
          {everyone.lastCycleName ? <span className="inline-flex items-center gap-1.5"><i className="h-1 w-3.5 rounded-full bg-muted-foreground/50" />{everyone.lastCycleName}</span> : null}
        </div>
      </section>

      <section className="grid gap-3.5 rounded-surface bg-card px-6 py-[22px]">
        <div className="flex items-center">
          <h2 className="type-section-title text-foreground">{t("ratingAgainstGrade")}</h2>
          <span className="ms-auto text-sm text-muted-foreground">{t("gradeFromMeasures")}</span>
        </div>
        {drop ? (
          <form className="flex items-center gap-3 rounded-inset bg-popover px-3.5 py-3 ring-[1.5px] ring-inset ring-primary animate-in fade-in-0 duration-200"
            onSubmit={(event) => {
              event.preventDefault();
              if (!why.trim()) return;
              void onChange(drop.person, drop.to, why.trim()).then(() => setDrop(null));
            }}>
            <PersonInitials name={drop.person.name} size="md" />
            <span className="text-sm text-foreground"><b className="font-semibold">{drop.person.name}</b>, {t("fromTo", { from: level(drop.person.rating), to: level(drop.to) })}</span>
            <Input autoFocus value={why} onChange={(event) => setWhy(event.target.value)} maxLength={2000} className="h-9 flex-1"
              placeholder={t("whyPlaceholder", { name: firstName(drop.person.reviewerName) })} aria-label={t("why")} />
            <Button type="button" variant="ghost" onClick={() => setDrop(null)}>{t("cancel")}</Button>
            <AsyncButton type="submit" pending={pending} disabled={!why.trim()}>{t("change")}</AsyncButton>
          </form>
        ) : null}
        <div className="grid grid-cols-[92px_repeat(3,minmax(0,1fr))] grid-rows-[repeat(3,minmax(126px,auto))_26px] gap-1.5">
          {ROWS.map((inRow, r) => (
            <RowCells key={r} label={t(`rows.${r}` as "rows.0")}>
              {[0, 1, 2].map((c) => {
                const key = `${r}-${c}`;
                const who = graded.filter((p) => inRow(p.grade!) && band(p.rating) === c);
                return (
                  <div key={key}
                    onDragOver={(event) => { if (dragging) { event.preventDefault(); setOver(key); } }}
                    onDragLeave={() => setOver((o) => (o === key ? null : o))}
                    onDrop={(event) => { event.preventDefault(); onDrop(c); }}
                    className={cn("grid content-start gap-2 rounded-[14px] bg-inlay px-3 py-2.5 transition-[box-shadow,background-color] duration-200",
                      over === key && "bg-primary/10 ring-[1.5px] ring-inset ring-primary")}>
                    <span className="text-[22px] font-semibold tabular-nums text-foreground">{who.length}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {who.slice(0, FACES).map((p) => (
                        <span key={p.reviewId} title={`${p.name} · ${level(p.rating)}`} draggable={!p.released}
                          onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; setDragging(p.reviewId); }}
                          onDragEnd={() => { setDragging(null); setOver(null); }}
                          className={cn("rounded-full", !p.released && "cursor-grab",
                            p.rating !== p.originalRating ? "ring-[1.5px] ring-primary ring-offset-2 ring-offset-inlay"
                              : p.flagged && !p.decided ? "ring-[1.5px] ring-warning ring-offset-2 ring-offset-inlay" : "")}>
                          <PersonInitials name={p.name} size="md" />
                        </span>
                      ))}
                    </div>
                    {who.length > FACES ? <span className="text-[12.5px] text-muted-foreground">{t("andMore", { count: who.length - FACES })}</span> : null}
                  </div>
                );
              })}
            </RowCells>
          ))}
          <div />
          {columns.map((c) => <div key={c} className="flex justify-center text-center text-[12.5px] text-muted-foreground">{c}</div>)}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Users aria-hidden className="size-3.5" />{t("dragHint")}</span>
          {ungraded ? <span className="ms-auto">{t("ungraded", { count: ungraded })}</span> : null}
        </div>
      </section>
    </div>
  );
}

function RowCells({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="grid content-center text-[12.5px] leading-tight text-muted-foreground">{label}</div>
      {children}
    </>
  );
}

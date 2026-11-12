"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { fusionAttentionQueryKeys, performanceQueryKeys, type YearDto, type YearPersonDto, type YearReleaseDto } from "@repo/api";
import { useApiQueryClient } from "@repo/api/query";
import { cn } from "@repo/ds";
import { Button } from "@repo/ds/components/ui/button";
import { Bell, Check, Clock, Lock, Send } from "@repo/ds/icons";
import { AvatarStack, PersonInitials } from "@repo/performance-ui";
import { useApis } from "../../api/use-performance";
import { calibrationHref } from "@/lib/performance-routes";

const BATCH = 8;
const HOLD_MS = 1200;

/** The flagged reviews looked at, as the next step's body before release: who, and what they go out with. */
export function LookedAt({ release }: { release: YearReleaseDto }) {
  const t = useTranslations("year.Release");
  if (!release.lookedAt.length) return null;
  return (
    <div className="flex flex-wrap gap-x-[22px] gap-y-3">
      {release.lookedAt.map((d) => (
        <div key={d.employeeId} className="flex items-center gap-2.5">
          <PersonInitials name={d.name} size="md" />
          <div className="grid">
            <b className="text-[13.5px] font-semibold text-foreground">{d.name}</b>
            <span className="text-sm text-muted-foreground">{d.kept ? t("kept", { level: d.to }) : t("changed", { from: d.from, to: d.to })}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export interface ReleaseRun {
  done: number;
  total: number;
}

/**
 * Releases the ready reviews in batches (P5): the count climbs as each batch goes out. `onReleased` hears the count
 * before Performance and Home's work refresh, so the moment can stay on screen as the year moves on.
 */
export function useReleaseRun(year: YearDto, onReleased: (count: number) => void) {
  const { performance } = useApis();
  const cache = useApiQueryClient();
  const [run, setRun] = useState<ReleaseRun | null>(null);
  const start = async () => {
    const move = year.nextMove;
    const release = move?.release;
    if (!move?.roundId || !release) return 0;
    const ids = release.reviewIds;
    let version = release.roundVersion;
    let done = 0;
    setRun({ done: 0, total: ids.length });
    try {
      for (let i = 0; i < ids.length; i += BATCH) {
        const result = await performance.finalizeReviewRound(move.roundId, version, ids.slice(i, i + BATCH));
        version = result.version;
        done += result.finalized.length;
        setRun({ done, total: ids.length });
      }
      onReleased(done);
    } finally {
      setRun(null);
      await Promise.all([
        cache.invalidateQueries({ queryKey: performanceQueryKeys.all() }),
        cache.invalidateQueries({ queryKey: fusionAttentionQueryKeys.all() }),
      ]);
    }
    return done;
  };
  return { run, start };
}

/**
 * Releasing results as the moment it is (D-72, B-433): the people who get their year today as the headline, held to
 * confirm because it can't be taken back; what goes out by level; who follows after a look and who once written. The
 * same card counts them out while it runs and says they're out after.
 */
export function ReleaseMoment({ release, affected, roundId, insteadOf, run, released, pending, caret, onRelease, onCancel, onDone }: {
  release: YearReleaseDto;
  affected: number;
  roundId: string | null;
  /** "Today instead of Thu 19 Nov" when results were due another day. */
  insteadOf: string | null;
  run: ReleaseRun | null;
  /** After: how many went out, and the day. */
  released: { count: number; day: string } | null;
  pending: boolean;
  caret?: ReactNode;
  onRelease: () => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("year.Release");
  const phase = released ? "after" : run ? "running" : "before";
  const out = released ? released.count : run ? run.done : affected;
  const share = phase === "running" && run ? run.done / Math.max(1, run.total) : 1;

  return (
    <section aria-live="polite" className="relative grid gap-[26px] rounded-surface bg-card px-9 pt-8 pb-7 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
      {caret}
      <div className="flex items-start gap-7">
        <div className="grid flex-1 gap-2.5">
          {phase === "after" ? (
            <span className="inline-flex items-center gap-2 justify-self-start rounded-full bg-success-subtle py-1.5 ps-2 pe-3.5 font-semibold text-success">
              <Check aria-hidden className="size-[18px]" />{t("releasedOn", { day: released!.day })}
            </span>
          ) : (
            <span className="type-eyebrow text-primary-ink">{phase === "running" ? t("releasing") : t("eyebrow")}</span>
          )}
          <h2 className="font-editorial text-[3.375rem] leading-[1.05] font-medium tracking-[-0.02em] text-balance text-foreground">
            {phase === "before" ? t("headline", { count: affected })
              : phase === "running" ? <><span className="tabular-nums text-success">{run!.done}</span> {t("ofOut", { total: run!.total })}</>
                : t("areOut", { count: released!.count })}
          </h2>
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            {phase === "before" ? (insteadOf ? <><Clock aria-hidden className="size-4" />{insteadOf}</> : null)
              : phase === "running" ? <><Clock aria-hidden className="size-4" />{t("keepOpen")}</>
                : <><Bell aria-hidden className="size-4" />{t("told")}</>}
          </span>
        </div>
        {phase === "before" ? (
          <div className="grid shrink-0 justify-items-end gap-3">
            <HoldButton label={t("hold", { count: affected })} holding={t("keepHolding")} disabled={pending} onHeld={onRelease} />
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground"><Lock aria-hidden className="size-4" />{t("cantTakeBack")}</span>
            <Button variant="ghost" size="sm" onClick={onCancel}>{t("cancel")}</Button>
          </div>
        ) : phase === "running" ? (
          <div className="grid w-[260px] shrink-0 justify-items-end gap-2.5">
            <span className="font-editorial text-xl tabular-nums text-foreground">{t("toGo", { count: run!.total - run!.done })}</span>
            <div className="h-2 w-full overflow-hidden rounded-full bg-inlay">
              <i className="block h-full rounded-full bg-success transition-[width] duration-300" style={{ width: `${share * 100}%` }} />
            </div>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-2.5">
            <Button variant="ghost" onClick={onDone}>{t("done")}</Button>
            <Button asChild size="lg"><Link href="/year/setup">{t("setUpNextYear")}</Link></Button>
          </div>
        )}
      </div>

      <div className={cn("grid border-t border-border", release.toLookAt && release.stillWriting ? "grid-cols-[2.2fr_1fr_1fr]"
        : release.toLookAt || release.stillWriting ? "grid-cols-[2.2fr_1fr]" : "grid-cols-1")}>
        <Column first number={out} label={phase === "after" ? t("out") : phase === "running" ? t("goingOut") : t("ready")}
          when={release.lookedAt.length ? t("withLookedAt", { count: release.lookedAt.length }) : t("eachTold")}>
          <Mix release={release} share={share} />
        </Column>
        {release.toLookAt ? (
          <Column number={release.toLookAt} label={t("toLookAt")} when={t("whenLookedAt")}>
            {roundId ? <Button asChild variant="outline" className="justify-self-start"><Link href={calibrationHref(roundId)}>{t("lookAt", { count: release.toLookAt })}</Link></Button> : null}
          </Column>
        ) : null}
        {release.stillWriting ? (
          <Column number={release.stillWriting} label={t("stillWriting")} when={t("whenSubmitted")}>
            <Faces people={release.stillWritingFaces} />
          </Column>
        ) : null}
      </div>
    </section>
  );
}

function Column({ number, label, when, first = false, children }: { number: number; label: string; when: string; first?: boolean; children?: ReactNode }) {
  return (
    <div className={cn("grid content-start gap-1.5 pt-[22px] pb-1", first ? "pe-7" : "border-s border-border px-7 last:pe-0")}>
      <span className="font-editorial text-[2.75rem] leading-none font-medium tabular-nums text-foreground">{number}</span>
      <b className="mt-1 text-[15px] font-semibold text-foreground">{label}</b>
      <span className="text-sm text-muted-foreground">{when}</span>
      {children ? <div className="mt-3 grid">{children}</div> : null}
    </div>
  );
}

// What goes out by level, the highest strongest; while it runs each segment fills with the share out.
const TONES = ["bg-primary", "bg-primary/75", "bg-primary/45", "bg-primary/25", "bg-primary/15"];

function Mix({ release, share }: { release: YearReleaseDto; share: number }) {
  if (!release.mix.length) return null;
  const tone = (i: number) => TONES[Math.min(i, TONES.length - 1)]!;
  return (
    <div className="grid gap-2.5">
      <div className="flex h-3.5 gap-[3px]">
        {release.mix.map((m, i) => (
          <span key={m.value} className="block overflow-hidden rounded-full bg-inlay" style={{ flex: m.count }}>
            <i className={cn("block h-full rounded-full transition-[width] duration-300", tone(i))} style={{ width: `${share * 100}%` }} />
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-[18px] gap-y-1.5 text-sm">
        {release.mix.map((m, i) => (
          <span key={m.value} className="inline-flex items-center gap-[7px]">
            <i className={cn("size-2.5 rounded-full", tone(i))} />
            <b className="font-semibold tabular-nums text-foreground">{m.count}</b>
            <span className="text-muted-foreground">{m.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Press and hold to confirm something final: the fill runs while held; letting go early stops it. */
function HoldButton({ label, holding, disabled, onHeld }: { label: string; holding: string; disabled: boolean; onHeld: () => void }) {
  const [held, setHeld] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHeld(false);
  };
  const start = () => {
    if (disabled || timer.current) return;
    setHeld(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHeld(false);
      onHeld();
    }, HOLD_MS);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <Button size="lg" disabled={disabled} aria-label={label}
      className="relative h-[52px] overflow-hidden px-[26px] text-base select-none touch-none"
      onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && !event.repeat) { event.preventDefault(); start(); } }}
      onKeyUp={(event) => { if (event.key === "Enter" || event.key === " ") stop(); }}
      onContextMenu={(event) => event.preventDefault()}>
      <i aria-hidden className={cn("absolute inset-0 origin-left bg-black/15 ease-linear rtl:origin-right",
        held ? "scale-x-100 transition-transform" : "scale-x-0 transition-none")} style={{ transitionDuration: held ? `${HOLD_MS}ms` : undefined }} />
      <span className="relative inline-flex items-center gap-2"><Send aria-hidden className="size-4" />{held ? holding : label}</span>
    </Button>
  );
}

/** After release, on later visits that day: the count out today, each person and their manager told. */
export function ReleasedToday({ count }: { count: number }) {
  const t = useTranslations("year.Release");
  return (
    <div className="flex items-center gap-2.5 text-sm text-foreground">
      <Check aria-hidden className="size-4" />{t("outToday", { count })}
    </div>
  );
}

function Faces({ people }: { people: YearPersonDto[] }) {
  return people.length ? <AvatarStack names={people.map((p) => p.name)} size="md" max={4} /> : null;
}

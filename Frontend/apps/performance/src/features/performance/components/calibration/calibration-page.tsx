"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { CalibrationCardDto, CalibrationDto, CalibrationPersonDto, YearDto } from "@repo/api";
import { cn } from "@repo/ds";
import { Button } from "@repo/ds/components/ui/button";
import { Clock, Sparkles } from "@repo/ds/icons";
import { PageContainer, PageSkeleton } from "@repo/ds/shell";
import { AvatarStack, PersonInitials } from "@repo/performance-ui";
import { reportPerformanceFailure } from "../../api/performance-failure";
import { useCalibration, useCalibrationDecisions, useCalibrationEveryone } from "../../api/use-calibration";
import { useYear } from "../../api/use-workspace";
import { ContentUnavailable } from "../content-unavailable";
import { FlowSection, StepFlow, type FlowColumn } from "../year/step-flow";
import { yearPosition } from "../year/year-timeline";
import { day, daysBetween } from "../year/year-words";
import { CalibrationGrid } from "./calibration-grid";
import { FlagCard, firstName } from "./flag-card";

/**
 * Calibration by exception (D-35, D-70, D-71): only the flagged reviews, each with why, kept in one click or changed
 * with a reason; the rest are ready as rated. Everyone's view, one click away, puts each rating against the goals'
 * grade. Releasing results happens on the Year page, previewed in place (D-72).
 */
export function CalibrationPage({ roundId }: { roundId: string }) {
  const t = useTranslations("calibration.Page");
  const calibration = useCalibration(roundId);
  if (calibration.isLoading) return <PageSkeleton rows={4} label={t("loading")} />;
  if (calibration.error) return <ContentUnavailable error={calibration.error} onRetry={calibration.refetch} />;
  if (!calibration.data) return <PageSkeleton rows={4} label={t("loading")} />;
  return <Calibration data={calibration.data} />;
}

function Calibration({ data }: { data: CalibrationDto }) {
  const t = useTranslations("calibration.Page");
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const everyoneView = params.get("view") === "everyone";
  const year = useYear(data.cycleId);
  const everyone = useCalibrationEveryone(data.roundId, everyoneView);
  const { decide, undo } = useCalibrationDecisions(data.roundId);
  const level = (value: number) => data.scale.find((l) => l.value === value)?.label ?? String(value);
  const show = (view: "flagged" | "everyone") => {
    const next = new URLSearchParams(params.toString());
    if (view === "everyone") next.set("view", "everyone"); else next.delete("view");
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  const open = data.flagged.filter((card) => !card.decision);
  const decided = data.flagged.filter((card) => card.decision);
  const undoDecision = (reviewId: string, version: number) =>
    undo.mutateAsync({ reviewId, expectedVersion: version }).catch((error) => reportPerformanceFailure(error, t("couldntUndo")));
  const decideOn = async (reviewId: string, rating: number, reason: string | null, said: string, version: number) => {
    try {
      const result = await decide.mutateAsync({ reviewId, rating, reason, expectedVersion: version });
      toast.success(said, result.released ? undefined : { action: { label: t("undo"), onClick: () => void undoDecision(reviewId, result.version) } });
    } catch (error) {
      reportPerformanceFailure(error, t("couldntSave"));
    }
  };
  const keep = (card: CalibrationCardDto) => decideOn(card.reviewId, card.rating, null,
    t("keptToast", { level: level(card.rating), name: firstName(card.name), manager: firstName(card.reviewerName) }), card.version);
  const change = (card: { reviewId: string; name: string; reviewerName: string; version: number }, rating: number, reason: string) =>
    decideOn(card.reviewId, rating, reason, t("changedToast", { name: firstName(card.name), level: level(rating), manager: firstName(card.reviewerName) }), card.version);

  const resultsOn = year.data?.steps.find((s) => s.phase === "ResultsOut")?.start ?? null;
  const releaseButton = (count: number) => data.canRelease && count > 0
    ? <Button asChild><Link href="/?release=1">{t("release", { count })}</Link></Button> : null;
  const inCount = data.ready.count + data.toLookAt.count + data.released;
  const total = inCount + data.writing.count;

  return (
    <PageContainer>
      <div className="grid max-w-[1120px] gap-[18px]">
        <div className="flex items-end gap-4 pt-2">
          <div className="grid gap-1">
            <h1 className="type-display text-foreground">{t("title")}</h1>
            <span className="text-muted-foreground">{t("round", { cycle: data.cycleName, round: data.roundName })}</span>
          </div>
          <div role="tablist" aria-label={t("views")} className="ms-auto inline-flex rounded-control bg-inlay p-[3px]">
            <ViewTab on={!everyoneView} onClick={() => show("flagged")}>
              {open.length ? t("toLookAtCount", { count: open.length }) : t("toLookAt")}
            </ViewTab>
            <ViewTab on={everyoneView} onClick={() => show("everyone")}>{t("everyone")}</ViewTab>
          </div>
        </div>

        {everyoneView ? (
          everyone.error ? <ContentUnavailable error={everyone.error} onRetry={everyone.refetch} />
            : !everyone.data ? <PageSkeleton rows={3} label={t("loading")} />
              : <CalibrationGrid calibration={data} everyone={everyone.data} pending={decide.isLoading}
                  onChange={(person: CalibrationPersonDto, rating, reason) => change(person, rating, reason)} />
        ) : (
          <>
            {year.data ? <ThinYear year={year.data} resultsOn={resultsOn} /> : null}
            {data.flagged.length === 0 && inCount > 0 ? (
              <NextCard title={t("allReadyAsRated", { count: inCount - data.released })} due={resultsOn ? t("resultsOut", { day: day(resultsOn, locale) }) : undefined}
                action={<><Button variant="outline" onClick={() => show("everyone")}>{t("lookAtEveryone")}</Button>{releaseButton(data.ready.count)}</>}>
                <span className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Sparkles aria-hidden className="size-4 text-primary-ink" />{t("checkedAsTheyCame")}</span>
              </NextCard>
            ) : data.flagged.length > 0 && open.length === 0 ? (
              <NextCard title={t("allReady", { count: data.ready.count })} due={resultsOn ? t("resultsOut", { day: day(resultsOn, locale) }) : undefined}
                action={releaseButton(data.ready.count)}>
                {data.writing.count ? (
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <AvatarStack names={data.writing.people.map((p) => p.name)} size="sm" max={2} />
                    {t("stillWritingGoOut", { count: data.writing.count })}
                  </span>
                ) : null}
              </NextCard>
            ) : inCount === 0 ? (
              <NextCard title={t("nothingInYet")} due={resultsOn ? t("resultsOut", { day: day(resultsOn, locale) }) : undefined} />
            ) : null}
            {decided.length ? (
              <div className="grid gap-1">
                {decided.map((card) => (
                  <DecidedRow key={card.reviewId} card={card} level={level} onUndo={() => void undoDecision(card.reviewId, card.version)} />
                ))}
              </div>
            ) : null}
            {open.map((card) => (
              <FlagCard key={card.reviewId} card={card} scale={data.scale} pending={decide.isLoading}
                onKeep={() => keep(card)} onChange={(rating, reason) => change(card, rating, reason)} />
            ))}
            <FlowSection title={t("reviews")} right={t("inOf", { count: inCount, total })}>
              <StepFlow total={total} columns={flow(data, (key) => t(`flow.${key}`))} />
            </FlowSection>
          </>
        )}
      </div>
    </PageContainer>
  );
}

function flow(data: CalibrationDto, word: (key: "writing" | "ready" | "toLookAt") => string): FlowColumn[] {
  const faces = (group: CalibrationDto["ready"]) => group.people.map((p) => ({ employeeId: p.employeeId, name: p.name }));
  return [
    { key: "writing", label: word("writing"), tone: "mu", count: data.writing.count, people: faces(data.writing) },
    { key: "ready", label: word("ready"), tone: "ok", count: data.ready.count + data.released, people: faces(data.ready) },
    data.toLookAt.count
      ? { key: "toLookAt", label: word("toLookAt"), tone: "wa", count: data.toLookAt.count, people: faces(data.toLookAt), here: true, stateHead: true }
      : { key: "toLookAt", label: word("toLookAt"), tone: "wa", count: 0, people: [], ghost: 2 },
  ];
}

function ViewTab({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={on} onClick={onClick}
      className={cn("rounded-[14px] px-3.5 py-1.5 text-sm transition-colors", on ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
      {children}
    </button>
  );
}

function NextCard({ title, due, action, children }: { title: string; due?: string; action?: ReactNode; children?: ReactNode }) {
  const t = useTranslations("calibration.Page");
  return (
    <section aria-live="polite" className="grid gap-4 rounded-surface bg-card px-[26px] py-6 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
      <div className="flex items-start justify-between gap-[18px]">
        <div className="grid gap-2">
          <span className="text-[12.5px] text-muted-foreground">{t("yourNextStep")}</span>
          <h2 className="text-2xl font-semibold leading-tight tracking-[-0.01em] text-foreground">{title}</h2>
          {due ? <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground"><Clock aria-hidden className="size-[15px]" />{due}</span> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2.5">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function DecidedRow({ card, level, onUndo }: { card: CalibrationCardDto; level: (value: number) => string; onUndo: () => void }) {
  const t = useTranslations("calibration.Page");
  const decision = card.decision!;
  return (
    <div className="flex items-center gap-3 rounded-inset bg-card py-3 pe-[18px] ps-3.5 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
      <PersonInitials name={card.name} size="md" />
      <b className="text-sm font-semibold text-foreground">{card.name}</b>
      <span className="text-sm text-foreground">{decision.kept ? t("kept", { level: level(card.rating) }) : t("fromTo", { from: level(card.rating), to: level(decision.rating) })}</span>
      {decision.reason ? <q className="truncate font-serif text-[13.5px] text-muted-foreground">{decision.reason}</q> : null}
      <span className="ms-auto shrink-0 text-sm text-muted-foreground">{t("managerTold", { name: firstName(card.reviewerName) })}</span>
      <button type="button" onClick={onUndo} className="shrink-0 text-sm font-medium text-primary-ink hover:underline">{t("undo")}</button>
    </div>
  );
}

/** The year as a thin line above the page (the drawing's thinYear): its name and step, filled to today, when results are due. */
function ThinYear({ year, resultsOn }: { year: YearDto; resultsOn: string | null }) {
  const t = useTranslations("calibration.Page");
  const phase = useTranslations("year.phase");
  const locale = useLocale();
  const span = Math.max(1, daysBetween(year.startDate, year.endDate));
  const at = yearPosition(year.startDate, year.endDate, year.today);
  return (
    <div className="flex items-center gap-3.5">
      <span className="shrink-0 text-sm"><b className="font-semibold text-foreground">{year.name}</b> <span className="text-muted-foreground">{year.phase ? phase(year.phase) : ""}</span></span>
      <div className="relative flex h-1.5 flex-1 gap-[3px]" aria-hidden>
        {year.steps.map((step) => {
          const width = (Math.max(1, daysBetween(step.start, step.end)) / span) * 100;
          const fill = step.state === "Done" ? 100 : step.state === "Ahead" ? 0
            : Math.max(0, Math.min(100, (daysBetween(step.start, year.today) / Math.max(1, daysBetween(step.start, step.end))) * 100));
          return (
            <div key={step.phase} className="relative h-full overflow-hidden rounded-full bg-inlay" style={{ width: `calc(${width}% - 2px)` }}>
              <i className={cn("absolute inset-y-0 start-0 block", step.state === "Current" ? "bg-primary" : "bg-primary/45")} style={{ width: `${fill}%` }} />
            </div>
          );
        })}
        <span className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-foreground" style={{ insetInlineStart: `${at * 100}%` }} />
      </div>
      {resultsOn ? <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] text-muted-foreground"><Clock aria-hidden className="size-[15px]" />{t("resultsOut", { day: day(resultsOn, locale) })}</span> : null}
    </div>
  );
}

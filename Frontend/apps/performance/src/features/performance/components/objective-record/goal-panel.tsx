"use client";

import type { ElementType } from "react";
import type { MeasurementDto, ObjectiveProgressDto, ObjectiveStatus, ProgressUpdateDto } from "@repo/api";
import { cn } from "@repo/ds";
import { Button } from "@repo/ds/components/ui/button";
import { ArrowRight, ArrowUp, FileText, Link2, Paperclip, TrendingUp } from "@repo/ds/icons";
import { Bar, Said } from "@repo/ds/shell";
import { PersonInitials } from "@repo/performance-ui";
import { useLocale, useTranslations } from "next-intl";
import { useEvidenceOpener, useObjectiveProgress, useProgressHistoryPager } from "../../api/use-performance";
import { reportPerformanceFailure } from "../../api/performance-failure";
import { dayMonth } from "../year/year-words";
import { GoalLine, GoalMonths, paceOn, STATUS_STROKE } from "@repo/performance-ui";
import { GoalState } from "./goal-state";
import type { ObjectiveRecord } from "./objective-record-model";
import type { ObjectiveRef } from "./objective-ref";


const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/** A value in the measure's own units: "42.1%", "21 incidents". */
export function valueIn(measurement: MeasurementDto | null, value: number): string {
  const v = +value.toFixed(1);
  const unit = measurement?.unit?.trim();
  return !unit || unit === "%" || unit.startsWith("%") ? `${v}%` : `${v} ${unit}`;
}

/** Progress (0–100) back in the measure's units, for a numeric measure; else the percent. */
export function progressIn(measurement: MeasurementDto | null, progress: number): string {
  if (measurement?.method === "NumericTarget" && measurement.baseline != null && measurement.target != null)
    return valueIn(measurement, measurement.baseline + ((measurement.target - measurement.baseline) * progress) / 100);
  return `${Math.round(progress)}%`;
}

/**
 * The top of an opened goal (D-77, D-83): the path up to the company's goal, then the title, who owns it with its
 * state and its weight, and the measure in words.
 */
export function GoalHead({ record, onOpen, titleAs: Title = "h2" }: { record: ObjectiveRecord; onOpen: (ref: ObjectiveRef) => void; titleAs?: ElementType }) {
  const t = useTranslations("objective.GoalPanel");
  const status = record.source.status?.value ?? null;
  const plan = record.source.plan;
  const owner = plan?.owner.name ?? record.accountable.name ?? null;
  return (
    <div className="grid gap-3">
      {record.parent ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen(record.parent!.ref)}
            className="inline-flex min-w-0 items-center gap-2 rounded-control bg-card px-2.5 py-1.5 text-start type-meta text-foreground hover:bg-section"
          >
            <ArrowUp aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{record.parent.title}</span>
          </button>
          <ArrowRight aria-hidden className="size-3.5 text-muted-foreground" />
          <span className="type-meta text-muted-foreground">{t("thisGoal")}</span>
        </div>
      ) : record.kind !== "company" ? (
        <span className="inline-flex items-center gap-2 type-meta text-muted-foreground">
          <ArrowUp aria-hidden className="size-3.5" />
          {t("supportsNothingAbove")}
        </span>
      ) : null}
      {/* The sheet's own title styles would shrink it; the goal's title reads in the editorial face, as drawn (D-83). */}
      <Title className="type-page-title text-foreground" style={{ fontFamily: "var(--font-editorial)", fontSize: "1.625rem", lineHeight: 1.2, fontWeight: 500 }}>
        {record.title}
      </Title>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 type-meta text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <PersonInitials name={owner} size="xs" />
          {record.kind === "company" ? (
            <span><b className="font-semibold text-foreground">{t("companyGoal")}</b>, {owner}</span>
          ) : record.kind === "team" ? (
            <span><b className="font-semibold text-foreground">{record.source.node.orgUnitName ?? t("unitGoal")}</b>, {owner}</span>
          ) : (
            <b className="font-semibold text-foreground">{owner}</b>
          )}
        </span>
        {status ? <GoalState status={status} since={record.source.status?.since} /> : null}
        {record.kind === "plan" && record.planWeight !== null ? (
          <span>{t("ofThePlan", { weight: Math.round(record.planWeight) })}</span>
        ) : null}
      </div>
      <p className="type-body text-muted-foreground">{record.source.node.measurementSummary}</p>
    </div>
  );
}

/**
 * The goal's year at a glance (D-76): the figure now, where it should be by now, the way to update it, over its line
 * against the pace. Before it runs (a draft plan, direction not yet published) the line is the pace alone.
 */
export function GoalHero({ record, onUpdate }: { record: ObjectiveRecord; onUpdate?: () => void }) {
  const t = useTranslations("objective.GoalPanel");
  const locale = useLocale();
  const today = todayIso();
  const progress = useObjectiveProgress(record.can.readProgressHistory ? record.ref.cycleId : null,
    record.can.readProgressHistory ? record.ref.objectiveId : null).data;
  const m = record.measurement;
  const derived = record.progress.has ? record.progress.derived : 0;
  const updates = [...(progress?.history ?? [])].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const milestones = progress?.milestones ?? [];
  const status = record.source.status?.value ?? null;

  let figure: string;
  let unitWord: string | null = null;
  if (m?.method === "WeightedMilestones") {
    figure = String(m.milestones.filter((ms) => ms.isCompleted).length);
    unitWord = t("ofMilestones", { count: m.milestones.length });
  } else if (m?.method === "NumericTarget") {
    figure = record.isExecuting && progress?.currentActual != null ? valueIn(m, progress.currentActual) : valueIn(m, m.baseline ?? 0);
    unitWord = record.isExecuting ? null : t("now");
  } else {
    figure = `${Math.round(derived)}%`;
    unitWord = t("done");
  }
  const sub = !record.isExecuting
    ? t("aimingFor", { target: m?.method === "NumericTarget" && m.target != null ? valueIn(m, m.target) : "100%", day: dayMonth(record.endDate, locale) })
    : today < record.endDate ? t("shouldBe", { value: progressIn(m, paceOn(record.startDate, record.endDate, today)) }) : null;

  return (
    <section className="grid gap-3 rounded-surface bg-card p-5" aria-label={t("theGoalsYear")}>
      <div className="flex items-end gap-3">
        <span className="type-metric-lg tabular-nums text-foreground">{figure}</span>
        {unitWord ? <span className="pb-1 type-meta text-muted-foreground">{unitWord}</span> : null}
        {sub ? <span className="pb-1 type-meta text-muted-foreground">{sub}</span> : null}
        {onUpdate ? (
          <Button size="sm" className="ms-auto" onClick={onUpdate}>
            <TrendingUp aria-hidden className="size-4" />
            {t("updateProgress")}
          </Button>
        ) : null}
      </div>
      <div className="relative pe-14">
        {m?.method !== "WeightedMilestones" ? (
          <>
            <span className="absolute end-0 top-[8%] -translate-y-1/2 type-meta tabular-nums text-muted-foreground">
              {m?.method === "NumericTarget" && m.target != null ? valueIn(m, m.target) : "100%"}
            </span>
            <span className="absolute end-0 top-[92%] -translate-y-1/2 type-meta tabular-nums text-muted-foreground">
              {m?.method === "NumericTarget" && m.baseline != null ? valueIn(m, m.baseline) : "0%"}
            </span>
          </>
        ) : null}
        <GoalLine
          start={record.startDate}
          end={record.endDate}
          today={today}
          updates={updates}
          milestones={m?.method === "WeightedMilestones" ? milestones : undefined}
          status={status}
          ghost={!record.isExecuting}
          height={m?.method === "WeightedMilestones" ? 120 : 168}
        />
        <GoalMonths start={record.startDate} end={record.endDate} />
      </div>
    </section>
  );
}

/**
 * What happened to the goal, newest first (D-83): each update's value, how much it moved, its state and the owner's
 * words. Before the goal runs, the shape of the updates to come, faint.
 */
export function GoalStory({ record }: { record: ObjectiveRecord }) {
  const t = useTranslations("objective.GoalPanel");
  const locale = useLocale();
  const progress = useObjectiveProgress(record.can.readProgressHistory ? record.ref.cycleId : null,
    record.can.readProgressHistory ? record.ref.objectiveId : null);
  if (!record.can.readProgressHistory) return null;

  if (!record.isExecuting) {
    return (
      <section className="grid gap-3">
        <div className="flex items-center gap-3">
          <h3 className="type-section-title text-foreground">{t("updates")}</h3>
          <span className="ms-auto type-meta text-muted-foreground">{t("onceApproved")}</span>
        </div>
        <div className="grid gap-4" aria-hidden>
          {[46, 60, 38].map((width) => (
            <div key={width} className="grid grid-cols-[64px_14px_minmax(0,1fr)] items-start gap-3">
              <span className="mt-1 h-2.5 w-10 rounded-full bg-muted-foreground/15" />
              <span className="mt-1 size-2.5 rounded-full bg-inlay" />
              <span className="mt-1 h-3 rounded-full bg-muted-foreground/15" style={{ width: `${width}%` }} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (!progress.data) return null;
  return <StoryList record={record} progress={progress.data} locale={locale} />;
}

function StoryList({ record, progress, locale }: { record: ObjectiveRecord; progress: ObjectiveProgressDto; locale: string }) {
  const t = useTranslations("objective.GoalPanel");
  const pager = useProgressHistoryPager(record.ref.cycleId, record.ref.objectiveId, progress.history, progress.historyNextCursor);
  const evidence = useEvidenceOpener(record.ref.cycleId);
  const history: ProgressUpdateDto[] = [...pager.items].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  return (
    <section className="grid gap-3">
      <h3 className="type-section-title text-foreground">{t("updates")}</h3>
      {history.length === 0 ? (
        <p className="type-body text-muted-foreground">{t("noUpdatesYet")}</p>
      ) : (
        <ol className="grid">
          {history.map((update, i) => (
            <StoryItem key={update.id} update={update} measurement={record.measurement} first={i === history.length - 1 && !pager.hasMore} locale={locale}
              onOpenEvidence={(id) => void evidence.open(id).catch((error) => reportPerformanceFailure(error, t("couldntOpenEvidence")))} />
          ))}
        </ol>
      )}
      {pager.hasMore ? (
        <Button variant="ghost" size="sm" className="justify-self-start" disabled={pager.loadingMore} onClick={() => void pager.loadMore()}>
          {t("olderUpdates")}
        </Button>
      ) : null}
    </section>
  );
}

function StoryItem({ update, measurement, first, locale, onOpenEvidence }: {
  update: ProgressUpdateDto; measurement: MeasurementDto | null; first: boolean; locale: string; onOpenEvidence: (id: string) => void;
}) {
  const t = useTranslations("objective.GoalPanel");
  const value = measurement?.method === "WeightedMilestones"
    ? update.milestoneChanges.map((c) => `${c.completed ? "✓" : "↺"} ${c.title ?? ""}`).join(", ") || `${Math.round(update.resultingProgress)}%`
    : measurement?.method === "NumericTarget" && update.value != null ? valueIn(measurement, update.value) : `${Math.round(update.resultingProgress)}%`;
  const delta = Math.round(update.deltaProgress * 10) / 10;
  return (
    <li className="grid grid-cols-[64px_14px_minmax(0,1fr)] gap-3 pb-5 last:pb-0">
      <span className="pt-0.5 type-meta tabular-nums text-muted-foreground">{dayMonth(update.recordedAt, locale)}</span>
      <span className="relative flex justify-center">
        <span className="relative z-10 mt-1.5 size-2.5 rounded-full" style={{ background: STATUS_STROKE[update.status ?? "none"] }} />
        {!first ? <span aria-hidden className="absolute inset-y-0 top-4 w-px bg-border" /> : null}
      </span>
      <div className="grid min-w-0 gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <b className="type-label tabular-nums text-foreground">{value}</b>
          {delta !== 0 ? <span className={cn("type-meta tabular-nums", delta > 0 ? "text-success" : "text-destructive")}>{delta > 0 ? `+${delta}` : delta}</span> : null}
          {update.status ? <GoalState status={update.status} /> : null}
          {update.isCorrection ? <span className="type-meta text-muted-foreground">{t("correction")}</span> : null}
        </div>
        {update.contextNote ? <Said>{update.contextNote}</Said> : null}
        {update.evidence.length ? (
          <div className="flex flex-wrap gap-2">
            {update.evidence.map((item) =>
              item.kind === "Link" && item.url ? (
                <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-control bg-card px-2 py-1 type-meta text-foreground hover:bg-section">
                  <Link2 aria-hidden className="size-3.5" />{item.fileName ?? item.url}
                </a>
              ) : item.kind === "File" && item.downloadPath && !item.isRemovedUnderRetention ? (
                <button key={item.id} type="button" onClick={() => onOpenEvidence(item.id)} className="inline-flex items-center gap-1.5 rounded-control bg-card px-2 py-1 type-meta text-foreground hover:bg-section">
                  <Paperclip aria-hidden className="size-3.5" />{item.fileName}
                </button>
              ) : (
                <span key={item.id} className="inline-flex items-center gap-1.5 rounded-control bg-card px-2 py-1 type-meta text-muted-foreground">
                  <FileText aria-hidden className="size-3.5" />{item.referenceText ?? item.fileName}
                </span>
              ),
            )}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** A company or unit goal's units carrying it, each with its progress (D-83). */
export function GoalUnits({ record, onOpen }: { record: ObjectiveRecord; onOpen: (ref: ObjectiveRef) => void }) {
  const t = useTranslations("objective.GoalPanel");
  if (record.kind === "plan" || record.children.length === 0) return null;
  const people = record.source.alignedPlanObjectives.length;
  return (
    <section className="grid gap-3">
      <div className="flex items-center gap-3">
        <h3 className="type-section-title text-foreground">{t("unitsCarryingIt")}</h3>
        {people ? <span className="ms-auto type-meta text-muted-foreground">{t("peoplesGoalsSupportIt", { count: people })}</span> : null}
      </div>
      <div className="grid divide-y divide-border">
        {record.children.map((child) => (
          <div key={child.id} className="py-1">
            <button
              type="button"
              onClick={() => onOpen({ cycleId: record.ref.cycleId, objectiveId: child.id })}
              className="-mx-2 grid w-[calc(100%+1rem)] grid-cols-[32px_minmax(0,1fr)_120px] items-center gap-3 rounded-control px-2 py-2.5 text-start hover:bg-section"
            >
              <PersonInitials name={child.accountablePersonName} size="md" />
              <span className="grid min-w-0 gap-0.5">
                <span className="type-narrative truncate text-foreground">{child.title}</span>
                <span className="truncate type-meta text-muted-foreground">
                  {[child.orgUnitName, child.accountablePersonName?.split(" ")[0]].filter(Boolean).join(", ")}
                </span>
              </span>
              <span className="grid gap-1.5">
                <span className="justify-self-end type-label tabular-nums">{child.hasProgress ? `${Math.round(child.derivedProgress)}%` : "–"}</span>
                <Bar value={child.hasProgress ? Math.min(100, child.derivedProgress) : 0} size="sm" label={child.title} />
              </span>
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}


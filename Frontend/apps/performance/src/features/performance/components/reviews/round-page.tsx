"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { ReviewRoundDto, ReviewStage, ReviewStageProgressDto } from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { Input } from "@repo/ds/components/ui/input";
import { DatePicker } from "@repo/ds/components/ui/date-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ds/components/ui/popover";
import { Textarea } from "@repo/ds/components/ui/textarea";
import { AsyncButton, PageContainer, PageHeader, PagePermissionNotice, PageSkeleton, StatusBadge } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { AvatarStack, PersonInitials } from "@repo/performance-ui";
import { Bell, CalendarDays, Check, FileText, Send } from "@/lib/icons";
import { RecordCycleScope, useWorkspaceContext } from "../../api/use-workspace";
import { useReviewRound, useReviewRoundFinalization, useReviewRoundMutations } from "../../api/use-reviews";
import { useScheduleCommands } from "../../api/use-review-work";
import { useApis } from "../../api/use-performance";
import { ContentUnavailable } from "../content-unavailable";
import { calibrationHref, reviewHref, withCycle } from "@/lib/performance-routes";
import { CountTile, DueChip, SectionHeading, dayLabel } from "./review-parts";
import { RoundSetup } from "./round-setup";
import { useRecentRecord } from "@repo/api/react";
import { useTranslations } from "next-intl";
import { reportPerformanceFailure } from "@/features/performance/api/performance-failure";
import { useFormat } from "@repo/ds/lib/use-format";
import type { Format } from "@repo/ds/lib/use-format";
import type { Say } from "@/i18n/say";

/** One round's page in each state (boards 04–07): setup while Draft, monitoring while running, the outcome once closed. */
export function RoundPage() {
  const t = useTranslations("reviews.RoundPage");
  const format = useFormat();
  const { roundId } = useParams<{ roundId: string }>();
  const context = useWorkspaceContext();
  const isAdmin = context.data?.capabilities.administers ?? false;
  const query = useReviewRound(roundId, isAdmin);
  useRecentRecord(
    "performance",
    query.data ? { label: query.data.name, kind: "Review round", href: `/performance/reviews/rounds/${query.data.id}` } : null,
  );
  if (context.isLoading || (isAdmin && query.isLoading)) return <PageSkeleton rows={7} width="wide" label={t("loadingTheRound")} />;
  if (context.error) return <ContentUnavailable error={context.error} onRetry={context.refetch} subject={t("performanceWorkspace")} />;
  if (!isAdmin) return <PagePermissionNotice title={t("administrationOnly")} description={t("reviewRoundsAreRunBy")} />;
  if (query.error) return <ContentUnavailable error={query.error} onRetry={query.refetch} subject={t("reviewRound")} />;
  const round = query.data;
  if (!round) return <PageSkeleton rows={7} width="wide" label={t("loadingTheRound")} />;
  const canCalibrate = context.data?.capabilities.canCalibrate ?? false;

  return (
    <RecordCycleScope cycleId={round.cycleId}>
      <PageContainer width="wide">
        <PageHeader className="mb-4"
          back={{ href: withCycle("/reviews", round.cycleId), label: t("reviews") }}
          title={<span className="inline-flex flex-wrap items-center gap-3">{round.name}<RoundBadge round={round} /></span>}
          description={describe(round, (key, values) => t(`describe.${key}` as "describe.draft", values as never), format)}
          actions={round.state === "Active" ? <RunningActions round={round} canCalibrate={canCalibrate} /> : null}
        />
        {round.state === "Draft" ? <RoundSetup round={round} /> : round.state === "Active" ? <RoundRunning round={round} /> : <RoundClosed round={round} />}
      </PageContainer>
    </RecordCycleScope>
  );
}

/** Sits inside the page title, so it resets to the system face rather than inherit the title's serif. */
function RoundBadge({ round }: { round: ReviewRoundDto }) {
  const t = useTranslations("reviews.RoundBadge");
  return round.state === "Active" ? <StatusBadge className="font-sans" tone="warning" dot>{t("running")}</StatusBadge>
    : round.state === "Draft" ? <StatusBadge className="font-sans" tone="neutral" dot>{t("draft")}</StatusBadge>
    : <StatusBadge className="font-sans" tone="muted" dot>{t("closed")}</StatusBadge>;
}

function describe(round: ReviewRoundDto, say: Say, format: Format): string {
  if (round.state === "Draft") return say("draft", { cycle: round.cycleName });
  const people = round.progress ? round.progress.stages.find((s) => s.stage === "ManagerAssessment")?.total ?? 0 : round.outcome?.total ?? 0;
  if (round.state === "Active")
    return say("active", { count: people, day: dayLabel(round.launchedAt?.slice(0, 10), format.locale), period: format.range(round.periodStart, round.periodEnd) });
  const period = format.range(round.periodStart, round.periodEnd);
  return round.outcome?.releasedAt ? say("released", { period, day: dayLabel(round.outcome.releasedAt.slice(0, 10), format.locale) }) : period;
}

// ── Running (board 06) ─────────────────────────────────────────────────────────────

function RunningActions({ round, canCalibrate }: { round: ReviewRoundDto; canCalibrate: boolean }) {
  const t = useTranslations("reviews.RunningActions");
  const finalize = useReviewRoundFinalization(round.id, round.cycleId);
  const { close } = useReviewRoundMutations(round.cycleId, round.id);
  const ready = round.progress?.readyToFinalize ?? 0;
  const manager = round.progress?.stages.find((s) => s.stage === "ManagerAssessment");
  const resolved = round.progress ? round.progress.finalized + round.progress.closed : 0;
  const total = (manager?.total ?? 0) + (round.progress?.closed ?? 0);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <MoveDueDates round={round} />
      {round.calibrationEnabled && canCalibrate ? (
        <Button variant="outline" asChild><Link href={withCycle(calibrationHref(round.id), round.cycleId)}>{t("calibration")}</Link></Button>
      ) : null}
      {total > 0 && resolved === total ? (
        <AsyncButton pending={close.isLoading} onClick={() => void close.mutateAsync(round.version)
          .then(() => toast.success(t("roundClosed")))
          .catch((error) => reportPerformanceFailure(error, t("theRoundCouldntClose")))}>
          {t("closeRound")}
        </AsyncButton>
      ) : (
        <AsyncButton pending={finalize.isLoading} disabled={ready === 0} onClick={() => void finalize.mutateAsync(round.version)
          .then((result) => toast.success((result.finalized.length === 1 ? t("reviewReleased", { length: result.finalized.length }) : t("reviewsReleased", { length: result.finalized.length }))))
          .catch((error) => reportPerformanceFailure(error, t("readyReviewsCouldntBeReleased")))}>
          <Send className="size-4" aria-hidden />{ready ? t("finalizeAndRelease", { ready }) : t("finalizeAndRelease2")}
        </AsyncButton>
      )}
    </div>
  );
}

const STAGES: { stage: ReviewStage; key: "selfAssessment" | "peerInput" | "managerAssessment" }[] = [
  { stage: "SelfAssessment", key: "selfAssessment" },
  { stage: "PeerInput", key: "peerInput" },
  { stage: "ManagerAssessment", key: "managerAssessment" },
];

/** HR moves one or more stage dates for the whole round, with a reason; everyone affected is told (D-02). */
function MoveDueDates({ round }: { round: ReviewRoundDto }) {
  const format = useFormat();
  const t = useTranslations("reviews.MoveDueDates");
  const { moveRound } = useScheduleCommands();
  const { performance } = useApis();
  const [open, setOpen] = useState(false);
  const stages = STAGES.filter((s) => s.stage === "SelfAssessment" ? round.selfAssessmentEnabled : s.stage === "PeerInput" ? round.peerInputEnabled : true);
  const current = (key: (typeof STAGES)[number]["key"]) => round.schedule[key].date;
  const [dates, setDates] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const changed = stages.filter((s) => dates[s.key] && dates[s.key] !== current(s.key));
  const submit = async () => {
    try {
      for (const [index, stage] of changed.entries()) {
        // Each move changes the round's version: read it again before the next one.
        const version = index === 0 ? round.version : (await performance.getReviewRound(round.id)).version;
        await moveRound.mutateAsync({ roundId: round.id, request: { expectedVersion: version, stage: stage.stage, dueDate: dates[stage.key]!, reason: reason.trim() } });
      }
      toast.success(t("dueDatesMovedEveryoneAffected"));
      setOpen(false);
      setDates({});
      setReason("");
    } catch (error) {
      reportPerformanceFailure(error, t("theDueDatesCouldntMove"));
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button variant="outline"><CalendarDays className="size-4" aria-hidden />{t("dueDates")}</Button></PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-5">
        <p className="type-panel-title text-foreground">{t("moveDueDates")}</p>
        <p className="mt-0.5 type-meta text-muted-foreground">{t("everyoneAffectedIsNotifiedRecorded")}</p>
        <div className="mt-4 space-y-2.5">
          {stages.map((stage) => (
            <div key={stage.key} className="flex items-center gap-3">
              <span className="flex-1 type-label text-foreground">{t(`stage.${stage.key}`)}</span>
              {dates[stage.key] && dates[stage.key] !== current(stage.key) ? <span className="type-meta text-muted-foreground line-through">{dayLabel(current(stage.key), format.locale)}</span> : null}
              <DatePicker aria-label={t("due", { label: t(`stage.${stage.key}`) })} className="w-40" min={round.schedule.launchDay} max={round.cycleEnd}
                value={dates[stage.key] ?? current(stage.key)} onChange={(value) => setDates({ ...dates, [stage.key]: value })} />
            </div>
          ))}
        </div>
        <Textarea className="mt-4" aria-label={t("reason")} placeholder={t("whyTheDatesMove")} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
          <AsyncButton pending={moveRound.isLoading} disabled={changed.length === 0 || !reason.trim()} onClick={() => void submit()}>
            {changed.length > 1 ? t("moveDates") : t("moveDate")}
          </AsyncButton>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RoundRunning({ round }: { round: ReviewRoundDto }) {
  const format = useFormat();
  const tr = useTranslations("reviews.RoundRunning");
  const progress = round.progress!;
  const today = new Date().toISOString().slice(0, 10);
  const stage = (name: string) => progress.stages.find((s) => s.stage === name);
  const self = stage("SelfAssessment");
  const peers = stage("PeerInput");
  const manager = stage("ManagerAssessment");
  const released = stage("Released");
  const lists = progress.teams.reduce((sum, t) => sum + t.listsToApprove, 0);
  const tile = (s: ReviewStageProgressDto | undefined, label: string, foot: string, tone: "success" | "primary" = "success") => s ? (
    <CountTile label={label} value={s.done} total={s.total} tone={tone} foot={foot}
      aside={s.dueDate ? <DueChip date={s.dueDate} late={s.dueDate < today && s.open > 0} label={tr("due", { dueDate: dayLabel(s.dueDate, format.locale) })} /> : null} />
  ) : null;

  return (
    <div className="space-y-10">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tile(self, tr("selfTile"), self?.late ? tr("openLate", { open: self.open, late: self.late }) : tr("open", { open: self?.open ?? 0 }))}
        {tile(peers, tr("peerTile"), lists ? tr("declinedLists", { declined: peers?.declined ?? 0, count: lists }) : tr("declined", { declined: peers?.declined ?? 0 }))}
        {tile(manager, tr("managerTile"), tr("readyToWrite", { count: manager?.readyToWrite ?? 0 }), "primary")}
        {released ? <CountTile label={tr("released")} value={released.done} total={released.total} foot={round.calibrationEnabled ? tr("afterCalibration") : tr("readyToRelease", { count: progress.readyToFinalize })} /> : null}
      </div>

      <section aria-labelledby="teams-heading">
        <SectionHeading id="teams-heading" title={tr("byTeam")} count={progress.teams.length} aside={tr("furthestBehindFirst")} />
        <div className="overflow-x-auto rounded-surface bg-card">
          <table className="w-full min-w-[52rem] text-start">
            <thead className="bg-inlay">
              <tr className="type-meta text-muted-foreground">
                <th scope="col" className="px-5 py-3 font-semibold">{tr("team")}</th>
                {round.selfAssessmentEnabled ? <th scope="col" className="px-3 py-3 font-semibold">{tr("self")}</th> : null}
                {round.peerInputEnabled ? <th scope="col" className="px-3 py-3 font-semibold">{tr("peers")}</th> : null}
                <th scope="col" className="px-3 py-3 font-semibold">{tr("manager")}</th>
                <th scope="col" className="px-5 py-3"><span className="sr-only">{tr("attention")}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {progress.teams.map((team, index) => (
                <tr key={team.reviewerEmployeeId}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <PersonInitials name={team.reviewerDisplayName} size="md" />
                      <div className="min-w-0">
                        <p className="type-label text-foreground">{team.orgUnitName ?? team.reviewerDisplayName}</p>
                        <p className="type-meta text-muted-foreground">{team.reviewerDisplayName} · {team.people} {team.people === 1 ? tr("person") : tr("people")}</p>
                      </div>
                    </div>
                  </td>
                  {round.selfAssessmentEnabled ? <td className="px-3 py-3.5"><RatioBar done={team.self.done} total={team.self.total} warn={index === 0 && team.self.done * 2 < team.self.total} /></td> : null}
                  {round.peerInputEnabled ? <td className="px-3 py-3.5"><RatioBar done={team.peers.done} total={team.peers.total} /></td> : null}
                  <td className="px-3 py-3.5"><span className="type-body tabular-nums text-foreground">{team.manager.done}/{team.manager.total}</span></td>
                  <td className="px-5 py-3.5 text-end">
                    {team.listsToApprove ? <StatusBadge tone="warning" dot>{team.listsToApprove} {team.listsToApprove === 1 ? tr("list") : tr("lists")} {tr("toApprove")}</StatusBadge> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-3">
        <section aria-labelledby="reminders-heading">
          <h2 id="reminders-heading" className="mb-3 type-meta text-muted-foreground">{tr("reminders")}</h2>
          <div className="rounded-surface bg-card p-5">
            {progress.nextReminder ? (
              <div className="flex gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary-tint text-primary"><Bell className="size-4" aria-hidden /></span>
                <div>
                  <p className="type-label text-foreground">{tr("next", { date: dayLabel(progress.nextReminder.date, format.locale) })}</p>
                  <p className="type-meta text-muted-foreground">{reminderCounts(progress.nextReminder, (key, values) => tr(`reminder.${key}` as "reminder.self", values as never))}</p>
                </div>
              </div>
            ) : <p className="type-body-secondary text-muted-foreground">{tr("nothingOpenToRemind")}</p>}
            <p className="mt-3 type-meta text-muted-foreground">{tr("n3DaysBeforeEachDue")}</p>
          </div>
        </section>
        <section aria-labelledby="activity-heading">
          <h2 id="activity-heading" className="mb-3 type-meta text-muted-foreground">{tr("roundActivity")}</h2>
          <Activity round={round} />
        </section>
        <section aria-labelledby="config-heading">
          <h2 id="config-heading" className="mb-3 type-meta text-muted-foreground">{tr("configurationFrozenAtLaunch")}</h2>
          <FrozenConfiguration round={round} />
        </section>
      </div>
    </div>
  );
}

function reminderCounts(next: NonNullable<NonNullable<ReviewRoundDto["progress"]>["nextReminder"]>, say: Say) {
  return [
    next.selfAssessments ? say("self", { count: next.selfAssessments }) : null,
    next.peerLists ? say("peerLists", { count: next.peerLists }) : null,
    next.peerInputs ? say("peerInputs", { count: next.peerInputs }) : null,
    next.managerAssessments ? say("managers", { count: next.managerAssessments }) : null,
  ].filter(Boolean).join(" · ");
}

function RatioBar({ done, total, warn = false }: { done: number; total: number; warn?: boolean }) {
  if (total === 0) return <span className="type-meta text-muted-foreground">–</span>;
  const share = total ? (done / total) * 100 : 0;
  return (
    <span className="flex items-center gap-3">
      <span className="h-1.5 w-32 overflow-hidden rounded-full bg-inlay"><span className={cn("block h-full rounded-full", warn ? "bg-warning" : "bg-success")} style={{ width: `${share}%` }} /></span>
      <span className="type-meta tabular-nums text-muted-foreground">{done}/{total}</span>
    </span>
  );
}

function Activity({ round }: { round: ReviewRoundDto }) {
  const format = useFormat();
  const t = useTranslations("reviews.Activity");
  if (round.activity.length === 0) return <p className="type-body-secondary text-muted-foreground">{t("noActivityYet")}</p>;
  return (
    <ol className="space-y-4">
      {round.activity.slice(0, 6).map((entry, index) => (
        <li key={`${entry.kind}-${entry.at}-${index}`} className="flex gap-3">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success text-background"><Check className="size-3" aria-hidden /></span>
          <div className="min-w-0">
            <p className="type-label text-foreground">{entry.text}</p>
            <p className="type-meta text-muted-foreground">{[dayLabel(entry.at.slice(0, 10), format.locale), entry.actorName].filter(Boolean).join(" · ")}</p>
            {entry.detail ? <p className="mt-0.5 type-body-secondary text-muted-foreground">{entry.detail}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function FrozenConfiguration({ round }: { round: ReviewRoundDto }) {
  const t = useTranslations("reviews.FrozenConfiguration");
  const config = round.configuration;
  if (!config) return null;
  const chips: string[] = [
    ...(config.selfAssessment ? [t("self")] : []),
    ...(config.peerInput ? [t("peers")] : []),
    ...(config.objectiveRatings ? [t("objectiveRatings")] : []),
    ...(config.competencies.length ? [t("competencies", { count: config.competencies.length })] : []),
    ...(config.questions || config.peerInput ? [t("questions", { length: round.questions.length })] : []),
    ...(config.potential ? [t("potential")] : []),
    ...(config.calibration ? [t("calibration")] : []),
  ];
  return (
    <ul className="flex flex-wrap gap-2" aria-label={t("frozenConfiguration")}>
      {chips.map((chip) => <li key={chip} className="rounded-control bg-card px-2.5 py-1 type-meta-strong text-foreground">{chip}</li>)}
    </ul>
  );
}

// ── Closed (board 07) ──────────────────────────────────────────────────────────────

function RoundClosed({ round }: { round: ReviewRoundDto }) {
  const format = useFormat();
  const t = useTranslations("reviews.RoundClosed");
  const outcome = round.outcome!;
  const max = Math.max(1, ...outcome.distribution.map((b) => b.count));
  const top = outcome.distribution.reduce((best, b) => (b.count > best.count ? b : best), outcome.distribution[0] ?? { value: 0, label: "", count: 0 });
  return (
    <div className="space-y-10">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CountTile label={t("released")} value={outcome.released} foot={t("ofReviews", { total: outcome.total })} />
        <CountTile label={t("acknowledged")} value={outcome.acknowledged} total={outcome.released}
          foot={outcome.notAcknowledged.length ? t("notYet", { count: outcome.notAcknowledged.length }) : t("everyone")} />
        <CountTile label={t("calibrated")} value={outcome.calibratedChanged}
          foot={outcome.calibratedChanged ? t("ratingsChanged", { down: outcome.calibratedDown, up: outcome.calibratedUp }) : t("noRatingChanged")} />
        <CountTile label={t("closedWithoutAResult")} value={outcome.closedWithoutResult.length} foot={outcome.closedWithoutResult.length ? t("eachWithReason") : t("noneFoot")} />
      </div>

      <section aria-labelledby="ratings-heading" className="rounded-surface bg-card p-6">
        <div className="mb-6 flex items-baseline justify-between">
          <h2 id="ratings-heading" className="type-section-title text-foreground">{t("finalRatings")}</h2>
          <span className="type-meta text-muted-foreground">{t("released2", { released: outcome.released })}</span>
        </div>
        <div className="grid h-56 items-end gap-4" style={{ gridTemplateColumns: `repeat(${Math.max(1, outcome.distribution.length)}, minmax(0, 1fr))` }}
          role="img" aria-label={outcome.distribution.map((b) => `${b.label} ${b.count}`).join(", ")}>
          {outcome.distribution.map((bucket) => (
            <div key={bucket.value} className="flex h-full flex-col items-center justify-end gap-2">
              <span className="type-label tabular-nums text-foreground">{bucket.count}</span>
              <span className={cn("w-full rounded-control", bucket.value === top.value ? "bg-primary" : "bg-primary/60")}
                style={{ height: `${Math.max(4, (bucket.count / max) * 100)}%` }} />
              <span className="text-center type-meta text-muted-foreground">{bucket.label}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-3">
        <section aria-labelledby="closed-heading">
          <h2 id="closed-heading" className="mb-3 type-meta text-muted-foreground">{t("closedWithoutAResult")}</h2>
          {outcome.closedWithoutResult.length ? (
            <ul className="divide-y divide-border rounded-surface bg-card">
              {outcome.closedWithoutResult.map((closed) => (
                <li key={closed.reviewId}>
                  <Link href={reviewHref(closed.reviewId)} className="flex items-center gap-3 px-4 py-3 hover:bg-inlay/60">
                    <PersonInitials name={closed.subjectDisplayName} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block type-label text-foreground">{closed.subjectDisplayName}</span>
                      <span className="block type-meta text-muted-foreground">{closed.reason}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="type-body-secondary text-muted-foreground">{t("none")}</p>}
        </section>
        <section aria-labelledby="unack-heading">
          <h2 id="unack-heading" className="mb-3 type-meta text-muted-foreground">{t("notAcknowledgedYet", { length: outcome.notAcknowledged.length })}</h2>
          {outcome.notAcknowledged.length ? (
            <div className="flex flex-wrap items-center gap-3">
              <AvatarStack names={outcome.notAcknowledged.map((p) => p.displayName)} size="sm" max={4} />
              {outcome.nextAcknowledgementReminder ? <span className="type-meta text-muted-foreground">{t("nextReminder", { nextAcknowledgementReminder: dayLabel(outcome.nextAcknowledgementReminder, format.locale) })}</span> : null}
            </div>
          ) : <p className="type-body-secondary text-muted-foreground">{t("everyoneHasAcknowledged")}</p>}
        </section>
        <section aria-labelledby="records-heading">
          <h2 id="records-heading" className="mb-3 type-meta text-muted-foreground">{t("records")}</h2>
          <RecordsTile released={outcome.released} />
        </section>
      </div>
    </div>
  );
}

function RecordsTile({ released }: { released: number }): ReactNode {
  const t = useTranslations("reviews.RecordsTile");
  return (
    <div className="flex items-center gap-3 rounded-surface bg-card px-4 py-3.5">
      <span className="flex size-9 items-center justify-center rounded-control bg-inlay text-muted-foreground"><FileText className="size-4" aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="block type-label text-foreground">{t("review", { released })} {released === 1 ? t("pdf") : t("pdfs")}</span>
        <span className="block type-meta text-muted-foreground">{t("onePerPersonFromThe")}</span>
      </span>
    </div>
  );
}

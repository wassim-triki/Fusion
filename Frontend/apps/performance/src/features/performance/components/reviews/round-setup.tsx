"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ReviewQuestionAudience, ReviewRoundDto, ReviewRoundIssueCode, ReviewRoundSubjectDto, UpdateReviewRoundRequest } from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { FilterChips } from "@repo/ds/choice";
import { Checkbox } from "@repo/ds/components/ui/checkbox";
import { Input } from "@repo/ds/components/ui/input";
import { DatePicker } from "@repo/ds/components/ui/date-picker";
import { NativeSelect, NativeSelectOption } from "@repo/ds/components/ui/native-select";
import { Switch } from "@repo/ds/components/ui/switch";
import { AsyncButton, StatusBadge } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { PersonInitials } from "@repo/performance-ui";
import { ArrowRight, Check, Growth, Layers, MessageSquare, Pencil, Rocket, Scale, Star, Target, Users, X } from "@/lib/icons";
import { useCompetencies } from "../../api/use-performance";
import { useEligibleReviewers, useReviewRoundMutations } from "../../api/use-reviews";
import { useReviewQuestions } from "../../api/use-review-work";
import { roundHref, withCycle } from "@/lib/performance-routes";
import { dayLabel } from "./review-parts";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";
import { reportPerformanceFailure } from "@/features/performance/api/performance-failure";

const AUDIENCES: { audience: ReviewQuestionAudience }[] = [{ audience: "Person" }, { audience: "Manager" }, { audience: "Peer" }];

const ISSUES: readonly ReviewRoundIssueCode[] = ["NoSubjects", "NoQuestions", "NoPeerQuestions", "NoCompetencies", "DueDateBeforeLaunch", "DueDateAfterCycleEnd", "ManagerBeforeSelf", "RoundRunning"];

/**
 * A Draft round set up on one page (board 04): six sections edited in any order and saved as they change, with readiness
 * and Launch kept in view. A launch blocked by a running round names it and links to it (board 05, B-060).
 */
export function RoundSetup({ round }: { round: ReviewRoundDto }) {
  const format = useFormat();
  const t = useTranslations("reviews.RoundSetup");
  const router = useRouter();
  const { update, updatePopulation, launch } = useReviewRoundMutations(round.cycleId, round.id);
  const questions = useReviewQuestions();
  const competencies = useCompetencies();
  const [saving, setSaving] = useState(false);

  const save = async (patch: Partial<UpdateReviewRoundRequest>) => {
    const pickedIds = round.questions.map((q) => q.questionId);
    setSaving(true);
    try {
      await update.mutateAsync({
        expectedVersion: round.version,
        name: round.name,
        periodStart: round.periodStart,
        periodEnd: round.periodEnd,
        selfAssessmentEnabled: round.selfAssessmentEnabled,
        objectiveRatingsEnabled: round.objectiveRatingsEnabled,
        calibrationEnabled: round.calibrationEnabled,
        selfAssessmentDueDate: round.schedule.selfAssessment.followsDefault ? null : round.schedule.selfAssessment.date,
        managerAssessmentDueDate: round.schedule.managerAssessment.followsDefault ? null : round.schedule.managerAssessment.date,
        competencyIds: round.competencyIds,
        peerInputEnabled: round.peerInputEnabled,
        questionsEnabled: round.questionsEnabled,
        potentialEnabled: round.potentialEnabled,
        peerInputDueDate: round.schedule.peerInput.followsDefault ? null : round.schedule.peerInput.date,
        peerInputDueDateSet: true,
        questionIds: pickedIds,
        ...patch,
      });
    } catch (error) {
      reportPerformanceFailure(error, t("thisChangeCouldntBeSaved"));
    } finally {
      setSaving(false);
    }
  };

  const readiness = round.readiness;
  const included = round.subjects.filter((s) => !s.isExcluded);
  const doLaunch = async () => {
    try {
      const launched = await launch.mutateAsync(round.version);
      toast.success(t("reviewsOpened", { reviewCount: launched.reviewCount }));
      router.refresh();
    } catch (error) {
      reportPerformanceFailure(error, t("theRoundCouldntLaunch"));
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        <SetupSection number="01" title={t("period")} aside={t("withinTheCycle")}>
          <div className="flex flex-wrap items-center gap-3">
            <DateField label={t("reviewPeriodStarts")} value={round.periodStart} min={round.cycleStart} max={round.cycleEnd}
              onCommit={(value) => void save({ periodStart: value })} />
            <span className="type-meta text-muted-foreground">{t("to")}</span>
            <DateField label={t("reviewPeriodEnds")} value={round.periodEnd} min={round.periodStart} max={round.cycleEnd}
              onCommit={(value) => void save({ periodEnd: value })} />
            <span className="ms-auto type-meta text-muted-foreground">{months(round.periodStart, round.periodEnd)} · {format.range(round.periodStart, round.periodEnd)}</span>
          </div>
        </SetupSection>

        <SetupSection number="02" title={t("whatTheReviewAsksFor")} aside={t("of7On", { round: componentsOn(round) })}>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <ComponentToggle icon={<Pencil className="size-4" aria-hidden />} title={t("selfAssessment")} detail={t("thePersonReflectsFirst")}
              checked={round.selfAssessmentEnabled} onChange={(on) => void save({ selfAssessmentEnabled: on, ...(on ? {} : { peerInputEnabled: false }) })} />
            <ComponentToggle icon={<Users className="size-4" aria-hidden />} title={t("peerInput")} detail={t("n15ColleaguesManagerApproves")}
              checked={round.peerInputEnabled} disabled={!round.selfAssessmentEnabled} onChange={(on) => void save({ peerInputEnabled: on })} />
            <ComponentToggle icon={<Target className="size-4" aria-hidden />} title={t("objectiveRatings")} detail={t("aRatingPerObjective")}
              checked={round.objectiveRatingsEnabled} onChange={(on) => void save({ objectiveRatingsEnabled: on })} />
            <ComponentToggle icon={<Star className="size-4" aria-hidden />} title={t("competencies")} detail={t("chosen", { length: round.competencyIds.length })}
              checked={round.competencyIds.length > 0}
              onChange={(on) => void save({ competencyIds: on ? (competencies.data ?? []).filter((c) => c.state === "Active").map((c) => c.id) : [] })} />
            <ComponentToggle icon={<MessageSquare className="size-4" aria-hidden />} title={t("questions")} detail={t("fromTheLibrary", { length: round.questions.filter((q) => q.audience !== "Peer").length })}
              checked={round.questionsEnabled} onChange={(on) => void save({ questionsEnabled: on })} />
            <ComponentToggle icon={<Growth className="size-4" aria-hidden />} title={t("potential")} detail={t("managerOnly")}
              checked={round.potentialEnabled} onChange={(on) => void save({ potentialEnabled: on })} />
            <ComponentToggle icon={<Scale className="size-4" aria-hidden />} title={t("calibration")} detail={t("beforeReleaseFacilitatedByHr")}
              checked={round.calibrationEnabled} onChange={(on) => void save({ calibrationEnabled: on })} />
          </div>
          {round.competencyIds.length > 0 || (competencies.data?.length ?? 0) > 0 ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="type-meta text-muted-foreground">{t("competencies")}</span>
              <FilterChips
                type="multiple"
                label={t("competencies")}
                value={round.competencyIds}
                onChange={(competencyIds) => void save({ competencyIds })}
                options={(competencies.data ?? [])
                  .filter((competency) => competency.state === "Active")
                  .map((competency) => ({ value: competency.id, label: competency.name }))}
              />
            </div>
          ) : null}
        </SetupSection>

        <SetupSection number="03" title={t("questions")} aside={t("fromTheLibrary2")}>
          {!round.questionsEnabled && !round.peerInputEnabled ? (
            <p className="type-body-secondary text-muted-foreground">{t("questionsAndPeerInputAre")}</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {AUDIENCES.filter((a) => a.audience === "Peer" ? round.peerInputEnabled : round.questionsEnabled).map(({ audience }) => {
                const library = (questions.data ?? []).filter((q) => q.audience === audience && q.state === "Active");
                const picked = round.questions.filter((q) => q.audience === audience).map((q) => q.questionId);
                return (
                  <div key={audience} className="rounded-surface bg-inlay p-4">
                    <p className="mb-2 flex items-center justify-between type-label text-foreground">{t(`audience.${audience}`)}<span className="type-meta tabular-nums text-muted-foreground">{picked.length}</span></p>
                    <ul className="divide-y divide-border">
                      {library.map((question) => {
                        const on = picked.includes(question.id);
                        return (
                          <li key={question.id} className="py-2">
                            <label className="flex items-start gap-2.5">
                              <Checkbox className="mt-0.5" checked={on} disabled={!on && picked.length >= 5}
                                onCheckedChange={(checked) => {
                                  const others = round.questions.filter((q) => q.audience !== audience).map((q) => q.questionId);
                                  const mine = library.map((q) => q.id).filter((id) => (id === question.id ? checked === true : picked.includes(id)));
                                  void save({ questionIds: [...others, ...mine] });
                                }} />
                              <span className={cn("type-body", on ? "text-foreground" : "text-muted-foreground")}>{question.text}</span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </SetupSection>

        <SetupSection number="04" title={t("dueDates")} aside={t("reminders3DaysBeforeThe")}>
          <DueTimeline round={round} />
          <div className="mt-4 divide-y divide-border">
            {round.selfAssessmentEnabled ? (
              <DueRow label={t("selfAssessment")} date={round.schedule.selfAssessment.date} min={round.schedule.launchDay} max={round.cycleEnd}
                caption={round.schedule.selfAssessment.followsDefault ? t("daysAfterLaunch", { offsetDays: round.schedule.selfAssessment.offsetDays }) : t("setByYou")}
                onReset={round.schedule.selfAssessment.followsDefault ? undefined : () => void save({ selfAssessmentDueDate: null })}
                onCommit={(value) => void save({ selfAssessmentDueDate: value })} />
            ) : null}
            {round.peerInputEnabled ? (
              <DueRow label={t("peerInput")} date={round.schedule.peerInput.date} min={round.schedule.launchDay} max={round.cycleEnd}
                caption={round.schedule.peerInput.followsDefault ? t("daysAfterLaunch", { offsetDays: round.schedule.peerInput.offsetDays }) : t("setByYou")}
                onReset={round.schedule.peerInput.followsDefault ? undefined : () => void save({ peerInputDueDate: null, peerInputDueDateSet: true })}
                onCommit={(value) => void save({ peerInputDueDate: value, peerInputDueDateSet: true })} />
            ) : null}
            <DueRow label={t("managerAssessment")} date={round.schedule.managerAssessment.date} min={round.schedule.launchDay} max={round.cycleEnd}
              caption={round.schedule.managerAssessment.followsDefault ? t("daysAfterTheSelfAssessment", { offsetDays: round.schedule.managerAssessment.offsetDays }) : t("setByYou")}
              onReset={round.schedule.managerAssessment.followsDefault ? undefined : () => void save({ managerAssessmentDueDate: null })}
              onCommit={(value) => void save({ managerAssessmentDueDate: value })} />
          </div>
        </SetupSection>

        <SetupSection number="05" title={t("whosIn")}>
          <WhoIsIn round={round} onChange={(changes) => updatePopulation.mutateAsync({ expectedVersion: round.version, subjects: changes })
            .catch((error) => reportPerformanceFailure(error, t("thisChangeCouldntBeSaved")))} />
        </SetupSection>

        <SetupSection number="06" title={t("reviewers")} aside={t("managerAtCycleStartFrom")}>
          <Reviewers round={round} onAssign={(subject, reviewerId) => updatePopulation.mutateAsync({
            expectedVersion: round.version,
            subjects: [{ participantId: subject.participantId, isExcluded: subject.isExcluded, exclusionReason: subject.exclusionReason, reviewerEmployeeId: reviewerId }],
          }).catch((error) => reportPerformanceFailure(error, t("theReviewerCouldntBeChanged")))} />
        </SetupSection>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-surface bg-card p-5">
          <p className="type-meta text-muted-foreground">{readiness?.ready ? t("readyToLaunch") : t("launch")}</p>
          <ul className="mt-3 space-y-2.5">
            <ReadyLine ok>{t("periodInsideTheCycle")}</ReadyLine>
            <ReadyLine ok={!readiness?.issues.some((i) => i === "NoQuestions" || i === "NoPeerQuestions" || i === "NoCompetencies")}>
              {t("componentsCompetencies", { round: componentsOn(round), length: round.competencyIds.length })}
            </ReadyLine>
            {round.questionsEnabled || round.peerInputEnabled ? (
              <ReadyLine ok={!readiness?.issues.some((i) => i === "NoQuestions" || i === "NoPeerQuestions")}>
                {t("questionsFor", { length: round.questions.length })} {new Set(round.questions.map((q) => q.audience)).size} {t("audiences")}
              </ReadyLine>
            ) : null}
            <ReadyLine ok={!readiness?.issues.some((i) => i.startsWith("DueDate") || i === "ManagerBeforeSelf")}>{t("dueDatesBeforeTheCycle")}</ReadyLine>
            <ReadyLine ok={(readiness?.subjectIssueCount ?? 0) === 0 && !readiness?.issues.includes("NoSubjects")}>
              {included.length} {included.length === 1 ? t("person") : t("people")}{(readiness?.subjectIssueCount ?? 0) > 0 ? " " + t("toResolve", { subjectIssueCount: readiness!.subjectIssueCount }) : t("eachWithAReviewer")}
            </ReadyLine>
            <ReadyLine ok={!readiness?.runningRound}>{readiness?.runningRound ? t("anotherRoundIsRunning") : t("noOtherRoundRunning")}</ReadyLine>
          </ul>
          {readiness?.issues.filter((i) => i !== "RoundRunning").map((issue) => (
            <p key={issue} className="mt-2 type-meta text-destructive">{ISSUES.includes(issue) ? t(`issue.${issue}`) : issue}</p>
          ))}
          {readiness?.runningRound ? (
            <div className="mt-4 rounded-surface border border-destructive/40 bg-inlay p-4">
              <div className="flex items-start gap-3">
                <span className="flex size-9 items-center justify-center rounded-control bg-primary-tint text-primary"><Layers className="size-4" aria-hidden /></span>
                <div className="min-w-0">
                  <p className="type-label text-foreground">{readiness.runningRound.name}</p>
                  <p className="type-meta text-muted-foreground">{t("runningSincePeople", { dayLabel: dayLabel(readiness.runningRound.launchedAt?.slice(0, 10), format.locale), reviewCount: readiness.runningRound.reviewCount })}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-card"><span className="block h-full rounded-full bg-success" style={{ width: `${pct(readiness.runningRound.selfSubmitted, readiness.runningRound.selfRequired)}%` }} /></span>
                <span className="type-meta tabular-nums text-muted-foreground">{t("selfManager", { selfSubmitted: pct(readiness.runningRound.selfSubmitted, readiness.runningRound.selfRequired), managerSubmitted: pct(readiness.runningRound.managerSubmitted, readiness.runningRound.managerRequired) })}</span>
              </div>
              <p className="mt-3 type-body-secondary text-foreground">{t("launchThisRoundOnceThe", { name: readiness.runningRound.name })}</p>
              <Button className="mt-3" size="sm" variant="outline" asChild>
                <Link href={withCycle(roundHref(readiness.runningRound.id), round.cycleId)}>{t("open", { name: readiness.runningRound.name })}<ArrowRight className="size-3.5" aria-hidden /></Link>
              </Button>
            </div>
          ) : null}
          {readiness?.ready ? (
            <p className="mt-5 flex items-baseline gap-3 border-t border-border pt-4">
              <span className="type-metric text-foreground">{readiness.launchCount}</span>
              <span className="type-meta text-muted-foreground">{t("reviewsOpenAtOnceEach")}</span>
            </p>
          ) : null}
          <AsyncButton className="mt-4 w-full" pending={launch.isLoading} disabled={!readiness?.ready || saving} onClick={() => void doLaunch()}>
            <Rocket className="size-4" aria-hidden />{t("launchRound")}
          </AsyncButton>
          <p className="mt-2 text-center type-meta text-muted-foreground">
            {readiness?.ready ? t("settingsFreezeAtLaunchDue") : saving ? t("saving") : t("thisDraftStaysSaved")}
          </p>
        </div>
      </aside>
    </div>
  );
}

function pct(done: number, total: number) {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

function componentsOn(round: ReviewRoundDto) {
  return [round.selfAssessmentEnabled, round.peerInputEnabled, round.objectiveRatingsEnabled, round.competencyIds.length > 0,
    round.questionsEnabled, round.potentialEnabled, round.calibrationEnabled].filter(Boolean).length;
}

function months(start: string, end: string) {
  const from = new Date(`${start}T00:00:00`);
  const to = new Date(`${end}T00:00:00`);
  const count = (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth() + 1;
  return `${count} ${count === 1 ? "month" : "months"}`;
}

function SetupSection({ number, title, aside, children }: { number: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={`setup-${number}`} className="rounded-surface bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="flex size-8 items-center justify-center rounded-control bg-primary-tint type-label tabular-nums text-primary">{number}</span>
        <h2 id={`setup-${number}`} className="type-panel-title text-foreground">{title}</h2>
        {aside ? <span className="ms-auto type-meta text-muted-foreground">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

function ComponentToggle({ icon, title, detail, checked, disabled, onChange }: {
  icon: ReactNode; title: string; detail: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void;
}) {
  return (
    <label className={cn("flex items-center gap-3 rounded-control bg-inlay px-3.5 py-3", disabled && "opacity-60")}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-card text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block type-label text-foreground">{title}</span>
        <span className="block type-meta text-muted-foreground">{detail}</span>
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
    </label>
  );
}

function DateField({ label, value, min, max, onCommit }: { label: string; value: string; min?: string; max?: string; onCommit: (value: string) => void }) {
  return (
    <DatePicker aria-label={label} className="w-44" value={value} min={min} max={max}
      onChange={(next) => { if (next && next !== value) onCommit(next); }} />
  );
}

function DueRow({ label, date, caption, min, max, onCommit, onReset }: {
  label: string; date: string; caption: string; min: string; max: string; onCommit: (value: string) => void; onReset?: () => void;
}) {
  const format = useFormat();
  const t = useTranslations("reviews.DueRow");
  return (
    <div className="grid items-center gap-3 py-3 sm:grid-cols-[11rem_11rem_minmax(0,1fr)]">
      <span className="type-label text-foreground">{label}</span>
      <DateField label={t("due", { label })} value={date} min={min} max={max} onCommit={onCommit} />
      <span className="flex items-center gap-2 type-meta text-muted-foreground">
        {dayLabel(date, format.locale)} · {caption}
        {onReset ? <Button size="sm" variant="ghost" onClick={onReset}>{t("useTheDefault")}</Button> : null}
      </span>
    </div>
  );
}

function DueTimeline({ round }: { round: ReviewRoundDto }) {
  const format = useFormat();
  const t = useTranslations("reviews.DueTimeline");
  const marks = [
    { label: t("launch"), date: round.schedule.launchDay, tone: "bg-primary" },
    ...(round.selfAssessmentEnabled ? [{ label: round.peerInputEnabled && round.schedule.peerInput.date === round.schedule.selfAssessment.date ? t("selfPeers") : t("self"), date: round.schedule.selfAssessment.date, tone: "bg-info" }] : []),
    ...(round.peerInputEnabled && round.schedule.peerInput.date !== round.schedule.selfAssessment.date ? [{ label: t("peers"), date: round.schedule.peerInput.date, tone: "bg-info" }] : []),
    { label: t("manager"), date: round.schedule.managerAssessment.date, tone: "bg-primary" },
    { label: t("cycleEnds"), date: round.cycleEnd, tone: "bg-muted-foreground" },
  ];
  const start = new Date(`${round.schedule.launchDay}T00:00:00`).getTime();
  const span = Math.max(1, new Date(`${round.cycleEnd}T00:00:00`).getTime() - start);
  return (
    <div className="relative h-14" role="img" aria-label={marks.map((m) => `${m.label} ${dayLabel(m.date, format.locale)}`).join(", ")}>
      <span className="absolute inset-x-0 top-2.5 h-1 rounded-full bg-inlay" />
      {marks.map((mark, index) => {
        const left = Math.min(100, Math.max(0, ((new Date(`${mark.date}T00:00:00`).getTime() - start) / span) * 100));
        return (
          <span key={`${mark.label}-${index}`} className={cn("absolute top-0 flex flex-col", left > 85 ? "-translate-x-full items-end" : left < 8 ? "items-start" : "-translate-x-1/2 items-center")} style={{ left: `${left}%` }}>
            <span className={cn("size-3.5 rounded-full border-2 border-card", mark.tone)} />
            <span className="mt-1.5 whitespace-nowrap type-meta text-muted-foreground">{mark.label} · {dayLabel(mark.date, format.locale)}</span>
          </span>
        );
      })}
    </div>
  );
}

function WhoIsIn({ round, onChange }: {
  round: ReviewRoundDto;
  onChange: (changes: { participantId: string; isExcluded: boolean; exclusionReason: string | null; reviewerEmployeeId: string | null }[]) => Promise<unknown>;
}) {
  const t = useTranslations("reviews.WhoIsIn");
  const [managing, setManaging] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const included = round.subjects.filter((s) => !s.isExcluded).length;
  const total = round.subjects.length;
  const excluded = round.subjects.filter((s) => s.isExcluded);
  const share = total ? included / total : 0;
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className="relative size-20 shrink-0" role="img" aria-label={t("ofInTheRound", { included, total })}>
        <svg viewBox="0 0 80 80" className="size-20 -rotate-90" aria-hidden>
          <circle cx="40" cy="40" r={r} fill="none" strokeWidth="6" className="stroke-inlay" />
          <circle cx="40" cy="40" r={r} fill="none" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${share * c} ${c}`} className="stroke-success" />
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="type-label tabular-nums text-foreground">{included}</span>
          <span className="type-meta text-muted-foreground">{t("of", { total })}</span>
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="type-body-secondary text-muted-foreground">{excluded.length ? t("everyoneInTheCycleExcept") : t("everyoneInTheCycle")}</p>
          <Button size="sm" variant="ghost" onClick={() => setManaging(!managing)}>{managing ? t("done") : t("manage")}</Button>
        </div>
        <ul className="mt-2 divide-y divide-border">
          {(managing ? round.subjects : excluded).map((subject) => (
            <li key={subject.participantId} className="flex flex-wrap items-center gap-3 py-2">
              <PersonInitials name={subject.subjectDisplayName} size="sm" />
              <span className="min-w-40 flex-1 type-label text-foreground">{subject.subjectDisplayName}</span>
              {subject.isExcluded ? (
                <>
                  <StatusBadge tone="muted">{subject.exclusionReason ?? t("leftOut")}</StatusBadge>
                  {managing ? <Button size="sm" variant="ghost" onClick={() => void onChange([{ participantId: subject.participantId, isExcluded: false, exclusionReason: null, reviewerEmployeeId: subject.reviewerEmployeeId }])}>{t("include")}</Button> : null}
                </>
              ) : managing ? (
                <span className="flex items-center gap-2">
                  <Input aria-label={t("whyIsLeftOut", { subjectDisplayName: subject.subjectDisplayName })} className="h-8 w-48" placeholder={t("reason")}
                    value={reasons[subject.participantId] ?? ""} onChange={(event) => setReasons({ ...reasons, [subject.participantId]: event.target.value })} />
                  <Button size="sm" variant="outline" disabled={!reasons[subject.participantId]?.trim()}
                    onClick={() => void onChange([{ participantId: subject.participantId, isExcluded: true, exclusionReason: reasons[subject.participantId]!.trim(), reviewerEmployeeId: subject.reviewerEmployeeId }])}>
                    <X className="size-3.5" aria-hidden />{t("leaveOut")}
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Reviewers({ round, onAssign }: { round: ReviewRoundDto; onAssign: (subject: ReviewRoundSubjectDto, reviewerId: string) => Promise<unknown> }) {
  const t = useTranslations("reviews.Reviewers");
  const [changing, setChanging] = useState<string | null>(null);
  const eligible = useEligibleReviewers(round.id, Boolean(changing));
  const included = round.subjects.filter((s) => !s.isExcluded);
  const assigned = included.filter((s) => s.reviewerBasis === "AdministrativeAssignment");
  const needing = included.filter((s) => s.readinessIssues.length > 0);
  const shown = useMemo(() => [...needing, ...assigned.filter((s) => !needing.includes(s))], [needing, assigned]);
  return (
    <div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div className="flex items-center gap-3 rounded-control bg-inlay px-4 py-3">
          <Users className="size-4 text-success" aria-hidden />
          <span><span className="type-label tabular-nums text-foreground">{included.length - assigned.length}</span> <span className="type-meta text-muted-foreground">{t("reviewedByTheirManager")}</span></span>
        </div>
        <div className="flex items-center gap-3 rounded-control bg-inlay px-4 py-3">
          <Pencil className="size-4 text-info" aria-hidden />
          <span><span className="type-label tabular-nums text-foreground">{assigned.length}</span> <span className="type-meta text-muted-foreground">{t("assignedByYou")}</span></span>
        </div>
      </div>
      {shown.length ? (
        <ul className="mt-3 divide-y divide-border rounded-control border border-border">
          {shown.map((subject) => (
            <li key={subject.participantId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <PersonInitials name={subject.subjectDisplayName} size="sm" />
              <span className="min-w-36 flex-1 type-label text-foreground">{subject.subjectDisplayName}
                {subject.readinessIssues.length ? <span className="ms-2 type-meta text-destructive">{issueText(subject.readinessIssues[0]!.code, (code) => t(`issue.${code}` as "issue.SelfReview"))}</span> : null}
              </span>
              {changing === subject.participantId ? (
                <NativeSelect aria-label={t("reviewerFor", { subjectDisplayName: subject.subjectDisplayName })} className="w-56"
                  defaultValue="" onChange={(event) => { if (event.target.value) void onAssign(subject, event.target.value).then(() => setChanging(null)); }}>
                  <NativeSelectOption value="" disabled>{eligible.isLoading ? t("loading") : t("chooseAReviewer")}</NativeSelectOption>
                  {(eligible.data ?? []).filter((p) => p.employeeId !== subject.subjectEmployeeId).map((person) => (
                    <NativeSelectOption key={person.employeeId} value={person.employeeId}>{person.displayName}</NativeSelectOption>
                  ))}
                </NativeSelect>
              ) : (
                <>
                  <span className="type-meta text-muted-foreground">{t("reviewedBy")}</span>
                  <span className="flex items-center gap-2 type-label text-foreground">
                    {subject.reviewerDisplayName ? <PersonInitials name={subject.reviewerDisplayName} size="xs" /> : null}
                    {subject.reviewerDisplayName ?? t("nobody")}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setChanging(subject.participantId)}>{t("change")}</Button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function issueText(code: string, say: (code: string) => string) {
  switch (code) {
    case "InactiveSubject":
    case "MissingReviewer":
    case "InactiveReviewer":
    case "SelfReview":
      return say(code);
    default: return code;
  }
}

function ReadyLine({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 type-body">
      <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", ok ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
        {ok ? <Check className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}
      </span>
      <span className={ok ? "text-foreground" : "font-medium text-foreground"}>{children}</span>
    </li>
  );
}

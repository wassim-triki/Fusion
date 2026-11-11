"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type { PerformanceReviewDto } from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { DatePicker } from "@repo/ds/components/ui/date-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ds/components/ui/popover";
import { Textarea } from "@repo/ds/components/ui/textarea";
import { AsyncButton, PageHeader, StatusBadge } from "@repo/ds/shell";
import { useSay } from "@repo/ds/lib/say";
import { useFormat } from "@repo/ds/lib/use-format";
import { AvatarStack, PersonInitials } from "@repo/performance-ui";
import { Ban, CalendarDays } from "@repo/ds/icons";
import { useReviewAssessmentMutations } from "../../api/use-reviews";
import { useScheduleCommands } from "../../api/use-review-work";
import { reportPerformanceFailure } from "@/features/performance/api/performance-failure";
import { roundHref, withCycle } from "@/lib/performance-routes";
import type { Say } from "@/i18n/say";
import { StageTrack, dayLabel, type Step } from "./review-parts";

/** HR's operational view of one review (board 14): where it stands, reminders, activity, moving a date or closing it. */

const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

function reviewSteps(record: PerformanceReviewDto, perspective: "subject" | "reviewer" | "hr", say: Say, locale: string): Step[] {
  const on = (value: string | null | undefined) => dayLabel(value, locale);
  const order = ["SelfAssessment", "ManagerAssessment", "Calibration", "ReadyToFinalize", "Finalized"];
  const at = order.indexOf(record.state);
  const late = (record.schedule?.daysLate ?? 0) > 0;
  const state = (index: number): Step["state"] => (record.state === "Closed" ? "todo" : index < at ? "done" : index === at ? (late ? "late" : "current") : "todo");
  const reviewer = first(record.reviewerDisplayName);
  const subject = first(record.subjectDisplayName);
  const steps: Step[] = [];
  if (record.selfAssessmentEnabled)
    steps.push({
      label: perspective === "subject" ? say("yourSelf") : perspective === "hr" ? say("self") : say("theirSelf", { subject }),
      detail: record.selfAssessment?.submittedAt ? on(record.selfAssessment.submittedAt.slice(0, 10)) : say("due", { day: on(record.schedule?.selfAssessmentDue) }),
      state: state(0),
    });
  steps.push({
    label: perspective === "reviewer" ? say("yourReview") : say("theirAssessment", { reviewer }),
    detail: record.managerAssessment?.submittedAt && perspective === "reviewer" ? on(record.managerAssessment.submittedAt.slice(0, 10)) : say("due", { day: on(record.schedule?.managerAssessmentDue) }),
    state: state(1),
  });
  if (record.calibrationEnabled) steps.push({ label: say("calibration"), detail: say("hr"), state: record.state === "Calibration" ? "current" : state(2) });
  steps.push({ label: perspective === "subject" ? say("yourResult") : say("released"), detail: record.finalizedAt ? on(record.finalizedAt.slice(0, 10)) : say("releasedByHr"), state: record.state === "Finalized" ? "done" : "todo" });
  return steps;
}

// ── HR (board 14) ──────────────────────────────────────────────────────────────────

export function AdministratorView({ record, written }: { record: PerformanceReviewDto; written: ReactNode }) {
  const format = useFormat();
  const t = useTranslations("reviews.AdministratorView");
  const rs = useSay("reviews.steps");
  const late = record.schedule?.daysLate ?? 0;
  const stage = record.state === "SelfAssessment" ? t("selfAssessment") : record.state === "ManagerAssessment" ? t("managerAssessment") : null;
  const peers = record.peers;
  return (
    <div className="pb-16">
      <PageHeader className="mb-4"
        back={{ href: withCycle(roundHref(record.reviewRoundId), record.cycleId), label: record.reviewRoundName }}
        leading={<PersonInitials name={record.subjectDisplayName} size="xl" />}
        title={record.subjectDisplayName}
        description={[record.reviewRoundName, record.subjectJobTitle, record.subjectOrgUnitName, t("reviewedBy", { reviewerDisplayName: record.reviewerDisplayName })].filter(Boolean).join(" · ")}
        actions={<div className="flex items-center gap-2">
          {record.canMoveDueDate ? <MoveReviewDueDate record={record} /> : null}
          {record.canClose ? <CloseWithoutResult record={record} /> : null}
        </div>}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="rounded-surface bg-card p-5" aria-label={t("whereTheReviewStands")}>
          {late > 0 && stage ? <StatusBadge tone="danger" dot>{stage} {late === 1 ? t("aDay") : t("days", { late })} {t("late")}</StatusBadge> : null}
          {record.state === "Closed" ? <StatusBadge tone="muted">{t("closedWithoutAResult")}{record.closeReason ? ` · ${record.closeReason}` : ""}</StatusBadge> : null}
          <StageTrack className="mt-4" label={t("reviewStages")} steps={reviewSteps(record, "hr", rs, format.locale)} />
          <div className="mt-5 grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
            <div className="rounded-control bg-inlay p-3">
              <p className="type-meta text-muted-foreground">{t("peers")}</p>
              {peers?.people.length ? (
                <p className="mt-1.5 flex items-center gap-2"><AvatarStack names={peers.people.map((p) => p.displayName)} size="xs" />
                  <span className="type-label tabular-nums">{peers.people.filter((p) => p.state === "Answered").length} {t("of", { length: peers.people.length })}</span></p>
              ) : <p className="mt-1.5 type-meta text-muted-foreground">{record.peerInputEnabled ? t("noneYet") : t("notAsked")}</p>}
            </div>
            <div className="rounded-control bg-inlay p-3">
              <p className="type-meta text-muted-foreground">{t("remindersSent")}</p>
              <p className="mt-1.5 type-body text-foreground"><strong className="tabular-nums">{record.schedule?.remindersSent.length ?? 0}</strong>
                {record.schedule?.remindersSent.length ? <span className="type-meta text-muted-foreground"> {t("last", { dayLabel: dayLabel(record.schedule.remindersSent.at(-1)!.slice(0, 10), format.locale) })}</span> : null}</p>
            </div>
            <div className="rounded-control bg-inlay p-3">
              <p className="type-meta text-muted-foreground">{t("nextReminder")}</p>
              <p className="mt-1.5 type-body text-foreground">{record.schedule?.nextReminder ? <strong>{dayLabel(record.schedule.nextReminder, format.locale)}</strong> : t("none")}</p>
            </div>
          </div>
        </section>
        <section aria-labelledby="hr-activity" className="rounded-surface bg-card p-5">
          <h2 id="hr-activity" className="mb-3 type-meta text-muted-foreground">{t("activity")}</h2>
          <ol className="divide-y divide-border">
            {record.activity.map((entry, index) => (
              <li key={`${entry.kind}-${index}`} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 py-2.5">
                <span className="type-meta text-muted-foreground">{dayLabel(entry.at.slice(0, 10), format.locale)}</span>
                <span>
                  <span className="block type-body text-foreground">{entry.text}</span>
                  {entry.detail ? <span className="block type-meta text-muted-foreground">{entry.detail}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
      {record.state !== "SelfAssessment" && record.state !== "Closed" ? (
        <div className="mt-10">{written}</div>
      ) : null}
    </div>
  );
}

function MoveReviewDueDate({ record }: { record: PerformanceReviewDto }) {
  const format = useFormat();
  const t = useTranslations("reviews.MoveReviewDueDate");
  const { moveReview } = useScheduleCommands();
  const [open, setOpen] = useState(false);
  const current = record.state === "SelfAssessment" ? record.schedule?.selfAssessmentDue : record.schedule?.managerAssessmentDue;
  const [date, setDate] = useState(current ?? "");
  const [reason, setReason] = useState("");
  const subject = first(record.subjectDisplayName);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button variant="outline"><CalendarDays className="size-4" aria-hidden />{t("moveDueDate")}</Button></PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-5">
        <p className="type-panel-title text-foreground">{t("moveSDueDate", { subject })}</p>
        <p className="mt-0.5 type-meta text-muted-foreground">{t("onlyThisReviewAndAre", { subject, reviewerDisplayName: first(record.reviewerDisplayName) })}</p>
        <div className="mt-4 flex items-center gap-3">
          <span className="flex-1 type-label text-foreground">{record.state === "SelfAssessment" ? t("selfAssessment") : t("managerAssessment")}</span>
          {date && date !== current ? <span className="type-meta text-muted-foreground line-through">{dayLabel(current, format.locale)}</span> : null}
          <DatePicker aria-label={t("newDueDate")} className="w-40" value={date} onChange={setDate} />
        </div>
        <Textarea className="mt-4" aria-label={t("reason")} placeholder={t("whyItMoves")} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
          <AsyncButton pending={moveReview.isLoading} disabled={!date || date === current || !reason.trim()}
            onClick={() => void moveReview.mutateAsync({ reviewId: record.id, request: { expectedVersion: record.version, dueDate: date, reason: reason.trim() } })
              .then(() => { toast.success(t("sDueDateMoved", { subject })); setOpen(false); setReason(""); })
              .catch((error) => reportPerformanceFailure(error, t("theDueDateCouldntMove")))}>
            {t("moveDate")}
          </AsyncButton>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CloseWithoutResult({ record }: { record: PerformanceReviewDto }) {
  const t = useTranslations("reviews.CloseWithoutResult");
  const mutations = useReviewAssessmentMutations(record.id, record.cycleId);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button variant="ghost"><Ban className="size-4" aria-hidden />{t("closeWithoutAResult")}</Button></PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-5">
        <p className="type-panel-title text-foreground">{t("closeSReviewWithoutA", { subjectDisplayName: first(record.subjectDisplayName) })}</p>
        <p className="mt-0.5 type-meta text-muted-foreground">{t("noRatingIsReleasedAnd")}</p>
        <Textarea className="mt-4" aria-label={t("reason")} placeholder={t("leftTheCompanyOn10")} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
          <AsyncButton variant="destructive" pending={mutations.close.isLoading} disabled={!reason.trim()}
            onClick={() => void mutations.close.mutateAsync({ expectedVersion: record.version, reason: reason.trim() })
              .then(() => { toast.success(t("reviewClosed")); setOpen(false); })
              .catch((error) => reportPerformanceFailure(error, t("theReviewCouldntClose")))}>
            {t("closeReview")}
          </AsyncButton>
        </div>
      </PopoverContent>
    </Popover>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { PerformanceReviewDto } from "@repo/api";
import { cn } from "@repo/ds";
import { Button } from "@repo/ds/components/ui/button";
import { Textarea } from "@repo/ds/components/ui/textarea";
import { Download, OneOnOnes } from "@repo/ds/icons";
import { AsyncButton, StateWord } from "@repo/ds/shell";
import { PersonInitials } from "@repo/performance-ui";
import { useAcknowledge, useDownloadReviewPdf, useReviewActions } from "../../api/use-review-work";
import { reportPerformanceFailure } from "../../api/performance-failure";
import { day, dayMonth } from "../year/year-words";
import { Grade, gradeOf, names, planGrade, useMeasureWords } from "./review-form";

/**
 * The released review, read like a letter (D-73): from the manager, the overall rating on top, then their words, the
 * goals with their grades, how the person worked against their own view, and the peers' words with their names (D-69).
 * Acknowledged in place; Talk it over in our 1:1 puts it on the next agenda (D-74).
 */
export function ReviewLetter({ record }: { record: PerformanceReviewDto }) {
  const t = useTranslations("reviews.Letter");
  const locale = useLocale();
  const words = useMeasureWords();
  const { reviewer } = names(record);
  const label = (value: number | null | undefined) => record.ratingScale.find((l) => l.value === value)?.label ?? null;
  const goals = record.items.filter((i) => i.kind === "Objective");
  const competencies = record.items.filter((i) => i.kind === "Competency");
  const finalGrade = (item: (typeof goals)[number]) => gradeOf(item, "manager");
  // Reviews released before goals were graded (D-38) carry no grade: their goals read without numbers.
  const graded = goals.some((g) => g.grade != null || g.managerGrade != null);
  const managerWords = record.questions.filter((q) => q.audience === "Manager" && q.managerAnswer);
  const peers = (record.peers?.people ?? []).filter((p) => p.answers?.length);
  const lastYear = record.year?.lastResult?.label;
  const selfOverall = label(record.selfAssessment?.overallRating);
  const download = useDownloadReviewPdf();

  return (
    <div className="mx-auto grid max-w-[860px] gap-[18px] pb-16 pt-1.5">
      <div className="flex items-end gap-4 pt-2">
        <PersonInitials name={record.reviewerDisplayName} size="xl" />
        <div className="grid gap-1">
          <span className="text-sm text-muted-foreground">{t("from", { name: record.reviewerDisplayName, day: record.finalizedAt ? day(record.finalizedAt, locale) : "" })}</span>
          <h1 className="type-display text-foreground">{t("title", { round: record.reviewRoundName })}</h1>
        </div>
        {record.canDownloadPdf ? (
          <Button variant="ghost" size="sm" className="ms-auto"
            onClick={() => void download(record.id, `${record.reviewRoundName}.pdf`).catch((error) => reportPerformanceFailure(error, t("couldntDownload")))}>
            <Download aria-hidden className="size-4" />{t("download")}
          </Button>
        ) : null}
      </div>

      <AcknowledgeBar record={record} />

      <section className="grid gap-3.5 rounded-surface bg-card px-6 py-[22px]">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-end gap-[34px]">
          <div className="grid gap-2">
            <span className="text-[13px] text-muted-foreground">{t("overallFrom", { name: reviewer })}</span>
            <span className="type-narrative text-[44px] font-medium leading-none tracking-[-0.01em] text-foreground">{label(record.finalRating) ?? "–"}</span>
            <span className="text-[13px] text-muted-foreground">{lastYear ? t("lastYear", { label: lastYear }) : t("firstReview")}</span>
          </div>
          {graded ? (
            <div className="grid justify-items-end gap-1.5">
              <span className="text-[13px] text-muted-foreground">{t("yourGoals")}</span>
              <span className="text-[30px] font-semibold tabular-nums text-foreground">{planGrade(goals, finalGrade).toFixed(2)}</span>
              <span className="text-[13px] text-muted-foreground">{t("forTheYear")}</span>
            </div>
          ) : null}
          {selfOverall ? (
            <div className="grid justify-items-end gap-1.5">
              <span className="text-[13px] text-muted-foreground">{t("youSaid")}</span>
              <span className="flex items-center gap-2"><PersonInitials name={record.subjectDisplayName} size="xs" /><b className="text-base font-semibold text-foreground">{selfOverall}</b></span>
              <span className="text-[13px] text-muted-foreground">{t("inYourSelfReview")}</span>
            </div>
          ) : null}
        </div>
      </section>

      {managerWords.length ? (
        <section className="grid gap-[22px] rounded-surface bg-card px-6 py-[22px]">
          {managerWords.map((q) => (
            <div key={q.questionId} className="grid gap-2">
              <span className="type-narrative text-base font-medium text-foreground">{q.text}</span>
              <p className="type-narrative whitespace-pre-line text-[17px] leading-[1.62] text-foreground">{q.managerAnswer}</p>
            </div>
          ))}
        </section>
      ) : null}

      {goals.length ? (
        <section className="grid gap-3.5 rounded-surface bg-card px-6 py-[22px]">
          <div className="flex items-center gap-3">
            <h2 className="type-section-title text-foreground">{t("yourGoals")}</h2>
            {graded ? (
              <span className="ms-auto text-sm text-muted-foreground">
                <span className="text-[17px] font-semibold tabular-nums text-foreground">{planGrade(goals, finalGrade).toFixed(2)}</span> {t("forTheYear")}
              </span>
            ) : null}
          </div>
          <div>
            {goals.map((item) => (
              <div key={item.itemId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-[22px] border-t border-border px-1 py-3.5 first:border-t-0">
                <div className="grid min-w-0 gap-0.5">
                  <span className="type-narrative text-[15.5px] font-medium text-foreground">{item.title}</span>
                  {item.measurementSummary ? <span className="text-[13px] text-muted-foreground">{item.measurementSummary}</span> : null}
                  {item.managerGradeReason ? <span className="text-[13px] text-muted-foreground">{t("gradeChanged", { name: reviewer, reason: item.managerGradeReason })}</span> : null}
                </div>
                {graded ? <Grade value={finalGrade(item)} words={words(item)} /> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {competencies.length ? (
        <section className="grid gap-1 rounded-surface bg-card px-6 py-[22px]">
          <div className="mb-1.5 flex items-center gap-3">
            <h2 className="type-section-title text-foreground">{t("howYouWorked")}</h2>
            <span className="ms-auto flex items-center gap-[18px] text-[12.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-[7px]"><i aria-hidden className="inline-block h-1.5 w-3.5 rounded-full bg-primary" />{reviewer}</span>
              <span className="inline-flex items-center gap-[7px]"><PersonInitials name={record.subjectDisplayName} size="xs" className="size-4 text-[8px]" />{t("you")}</span>
            </span>
          </div>
          {competencies.map((item, index) => {
            const at = record.ratingScale.findIndex((l) => l.value === item.managerRating);
            const mine = record.ratingScale.findIndex((l) => l.value === item.selfRating);
            return (
              <div key={item.itemId} className={cn("flex items-center gap-3 pb-1.5 pt-3", index > 0 && "border-t border-border")}>
                <b className="flex-1 text-sm font-semibold text-foreground">{item.title}</b>
                <span className="w-[110px] text-end text-[13px] text-foreground">{label(item.managerRating) ?? "–"}</span>
                <div className="relative ms-[18px] grid w-[300px] grid-cols-5 gap-[3px]" aria-hidden>
                  {record.ratingScale.map((level, i) => <i key={level.value} className={cn("h-1.5 rounded-full", i === at ? "bg-primary" : "bg-inlay")} />)}
                  {mine >= 0 ? (
                    <span className="absolute -top-[18px] -translate-x-1/2" style={{ insetInlineStart: `${((mine + 0.5) / record.ratingScale.length) * 100}%` }}>
                      <PersonInitials name={record.subjectDisplayName} size="xs" className="size-4 text-[8px]" />
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </section>
      ) : null}

      {peers.length ? (
        <section className="grid gap-1 rounded-surface bg-card px-6 py-[22px]">
          <div className="mb-1.5 flex items-center gap-3">
            <h2 className="type-section-title text-foreground">{t("fromYourPeers")}</h2>
            <span className="ms-auto text-[13px] text-muted-foreground">{t("answered", { count: peers.length })}</span>
          </div>
          {peers.map((peer, index) => (
            <div key={peer.employeeId} className={cn("grid grid-cols-[30px_minmax(0,1fr)] items-start gap-3 py-3", index > 0 && "border-t border-border")}>
              <PersonInitials name={peer.displayName} size="sm" />
              <div className="grid gap-1">
                <span className="text-[13px] text-muted-foreground">{peer.displayName}</span>
                {peer.answers!.map((answer) => (
                  <span key={answer.questionId} className="type-narrative text-[15.5px] leading-normal text-foreground">“{answer.text}”</span>
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

/**
 * Acknowledge in place, the bar staying in view (D-74): the manager sees when it's read; the person may ask to talk it
 * over in the next 1:1, and leave a comment once read.
 */
function AcknowledgeBar({ record }: { record: PerformanceReviewDto }) {
  const t = useTranslations("reviews.Letter");
  const locale = useLocale();
  const acknowledge = useAcknowledge(record.id);
  const actions = useReviewActions(record.id);
  const { reviewer } = names(record);
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState(record.acknowledgement?.comment ?? "");
  const talk = record.talkItOverAt ? (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><OneOnOnes aria-hidden className="size-3.5" />{t("onAgenda", { day: day(record.talkItOverAt, locale) })}</span>
  ) : null;
  const talkButton = record.talkItOverAt ? null : (
    <AsyncButton variant="outline" pending={actions.talkItOver.isLoading}
      onClick={() => void actions.talkItOver.mutateAsync(undefined).then((r) => toast.success(t("onAgenda", { day: day(r.at, locale) })))
        .catch((error) => reportPerformanceFailure(error, t("couldntTalk", { name: reviewer })))}>
      <OneOnOnes aria-hidden className="size-4" />{t("talkItOver")}
    </AsyncButton>
  );

  if (!record.acknowledgement) {
    return (
      <div className="sticky top-0 z-[2] flex flex-wrap items-center gap-3 rounded-surface bg-card py-3.5 pe-4 ps-5 shadow-[0_10px_24px_-18px_oklch(0_0_0/0.6)]">
        <PersonInitials name={record.reviewerDisplayName} size="sm" />
        <span className="text-sm text-foreground">{t("seesWhenRead", { name: reviewer })}</span>
        {talk}
        <div className="ms-auto flex items-center gap-2">
          {talkButton}
          {record.canAcknowledge ? (
            <AsyncButton pending={acknowledge.isLoading}
              onClick={() => void acknowledge.mutateAsync(null).then(() => toast.success(t("acknowledged", { name: reviewer })))
                .catch((error) => reportPerformanceFailure(error, t("couldntAcknowledge")))}>
              {t("acknowledge")}
            </AsyncButton>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className="sticky top-0 z-[2] grid gap-3 rounded-surface bg-card py-3.5 pe-4 ps-5 shadow-[0_10px_24px_-18px_oklch(0_0_0/0.6)] animate-in fade-in-0 slide-in-from-bottom-1">
      <div className="flex flex-wrap items-center gap-3">
        <StateWord tone="ok">{t("acknowledgedOn", { day: dayMonth(record.acknowledgement.at, locale) })}</StateWord>
        <span className="text-[13px] text-muted-foreground">{t("told", { name: reviewer })}</span>
        {talk}
        <div className="ms-auto flex items-center gap-2">
          {talkButton}
          {!commenting ? (
            <button type="button" className="text-[13px] font-semibold text-primary-ink hover:underline" onClick={() => setCommenting(true)}>
              {record.acknowledgement.comment ? t("editComment") : t("addComment", { name: reviewer })}
            </button>
          ) : null}
        </div>
      </div>
      {commenting ? (
        <div className="grid gap-2">
          <Textarea aria-label={t("commentFor", { name: reviewer })} rows={3} maxLength={1000} autoFocus value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCommenting(false)}>{t("cancel")}</Button>
            <AsyncButton pending={actions.comment.isLoading} disabled={!comment.trim()}
              onClick={() => void actions.comment.mutateAsync(comment.trim()).then(() => { setCommenting(false); toast.success(t("commentSent", { name: reviewer })); })
                .catch((error) => reportPerformanceFailure(error, t("couldntComment")))}>
              {t("send")}
            </AsyncButton>
          </div>
        </div>
      ) : record.acknowledgement.comment ? (
        <p className="type-narrative text-[15px] text-muted-foreground">“{record.acknowledgement.comment}”</p>
      ) : null}
    </div>
  );
}

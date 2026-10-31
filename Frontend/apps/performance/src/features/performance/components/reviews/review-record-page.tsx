"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type {
  PerformanceReviewDto,
  RatingScaleLevelDto,
  ReviewAnswerInput,
  ReviewItemAssessmentDto,
  ReviewItemResponseInput,
  ReviewMissingDto,
  ReviewPotential,
} from "@repo/api";
import { ApiError, REVIEW_POTENTIALS } from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { OptionCards } from "@repo/ds/choice";
import { Input } from "@repo/ds/components/ui/input";
import { DatePicker } from "@repo/ds/components/ui/date-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ds/components/ui/popover";
import { Textarea } from "@repo/ds/components/ui/textarea";
import { AsyncButton, PageContainer, PageHeader, PagePermissionNotice, PageSkeleton, StatusBadge } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { AvatarStack, ObjectiveStatusBadge, PersonInitials, ValueChip } from "@repo/performance-ui";
import { Ban, CalendarDays, Check, ChevronDown, Download, FeedbackIcon, FileText, Lock, OneOnOnes, Send, Star, Target, UserRoundCheck } from "@/lib/icons";
import { useReview, useReviewAssessmentMutations } from "../../api/use-reviews";
import { useAcknowledge, useDownloadReviewPdf, usePeerCommands, useScheduleCommands } from "../../api/use-review-work";
import { RecordCycleScope, useWorkspaceContext } from "../../api/use-workspace";
import { ContentUnavailable } from "../content-unavailable";
import { measurementSummary } from "../../lib";
import { CalibratedOutcome } from "./calibrated-outcome";
import { ReviewDraftBlock } from "./review-draft";
import { ColleaguePicker } from "../conversations/colleague-picker";
import { objectiveHref, roundHref, withCycle } from "@/lib/performance-routes";
import { DueChip, LevelCards, ProgressRing, SectionHeading, SegmentRating, StageTrack, dayLabel, dueIn, type Step } from "./review-parts";
import { useRecentRecord } from "@repo/api/react";
import { useTranslations } from "next-intl";
import { useSay } from "@repo/ds/lib/say";
import { reportPerformanceFailure } from "@/features/performance/api/performance-failure";
import { useFormat } from "@repo/ds/lib/use-format";
import type { Say } from "@/i18n/say";

/**
 * One review as a page (D12): the person writing (board 08), what they sent (09), their released result (13); the reviewer
 * beside the person's words and the evidence (12); HR's operational view (14). What each lens may see comes from the server.
 */
export function ReviewRecordPage() {
  const t = useTranslations("reviews.ReviewRecordPage");
  const { reviewId } = useParams<{ reviewId: string }>();
  const context = useWorkspaceContext();
  const review = useReview(reviewId, Boolean(context.data));
  useRecentRecord(
    "performance",
    review.data
      ? {
          label: t("sReview", { subjectDisplayName: review.data.subjectDisplayName }),
          kind: review.data.reviewRoundName,
          href: `/performance/reviews/${review.data.id}`,
        }
      : null,
  );
  if (context.isLoading || (context.data && review.isLoading)) return <PageSkeleton rows={7} width="wide" label={t("loadingReview")} />;
  if (context.error) return <ContentUnavailable error={context.error} onRetry={context.refetch} subject={t("performanceWorkspace")} />;
  if (review.error) return <ContentUnavailable error={review.error} onRetry={review.refetch} subject={t("review")} />;
  if (!review.data) return <PagePermissionNotice title={t("reviewUnavailable")} description={t("thisReviewCouldNotBe")} />;
  const record = review.data;
  return (
    <RecordCycleScope cycleId={record.cycleId}>
      <PageContainer width="wide">
        {record.lens === "Subject" ? <SubjectView record={record} />
          : record.lens === "Reviewer" ? <ReviewerView record={record} />
          : record.lens === "Administrator" ? <AdministratorView record={record} />
          : <ReviewerView record={record} />}
      </PageContainer>
    </RecordCycleScope>
  );
}

const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const levelLabel = (levels: RatingScaleLevelDto[], value: number | null | undefined) => levels.find((l) => l.value === value)?.label ?? null;
const ratingRequired = (record: PerformanceReviewDto, item: ReviewItemAssessmentDto) => item.kind === "Competency" || record.objectiveRatingsEnabled;

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

function YearChips({ record }: { record: PerformanceReviewDto }) {
  const t = useTranslations("reviews.YearChips");
  const year = record.year;
  if (!year) return null;
  const chips: { icon: ReactNode; text: string }[] = [
    { icon: <FeedbackIcon className="size-3.5" aria-hidden />, text: t("feedback", { feedback: year.feedback }) },
    { icon: <Star className="size-3.5" aria-hidden />, text: t("praise", { praise: year.praise }) },
    { icon: <OneOnOnes className="size-3.5" aria-hidden />, text: year.actionsDone ? t("oneOnOnesActions", { count: year.oneOnOnesHeld, actions: year.actionsDone }) : t("oneOnOnes", { count: year.oneOnOnesHeld }) },
    ...(year.developmentGoals ? [{ icon: <UserRoundCheck className="size-3.5" aria-hidden />, text: t("developmentGoals", { developmentGoals: year.developmentGoals }) }] : []),
    ...(year.lastResult ? [{ icon: <FileText className="size-3.5" aria-hidden />, text: t("lastResult", { round: year.lastResult.roundName, label: year.lastResult.label ?? t("released") }) }] : []),
  ];
  return (
    <ul className="flex flex-wrap justify-end gap-2" aria-label={t("sYear", { subjectDisplayName: first(record.subjectDisplayName) })}>
      {chips.map((chip) => (
        <li key={chip.text}>
          <Link href={`/people/${record.subjectEmployeeId}`} className="inline-flex items-center gap-1.5 rounded-control bg-inlay px-2.5 py-1 type-meta-strong text-foreground hover:bg-card">
            {chip.icon}{chip.text}
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ── The person (boards 08, 09, 13) ─────────────────────────────────────────────────

function SubjectView({ record }: { record: PerformanceReviewDto }) {
  const t = useTranslations("reviews.SubjectView");
  if (record.state === "Finalized") return <ReleasedView record={record} />;
  if (record.state === "Closed") return (
    <div className="mx-auto max-w-3xl">
      <SubjectHeading record={record} />
      <p className="type-body-secondary text-muted-foreground">{t("thisReviewWasClosedWithout")}</p>
    </div>
  );
  if (record.canEditSelfAssessment) return <SelfAssessmentWriter record={record} />;
  return <SubmittedView record={record} />;
}

function SubjectHeading({ record, actions, detail }: { record: PerformanceReviewDto; actions?: ReactNode; detail?: string }) {
  const t = useTranslations("reviews.SubjectHeading");
  return (
    <PageHeader className="mb-4"
      back={{ href: "/reviews", label: t("reviews") }}
      leading={<PersonInitials name={record.subjectDisplayName} size="xl" />}
      title={t("your", { toLowerCase: record.reviewRoundName.toLowerCase() })}
      description={detail ?? t("reviewsYou", { slice: record.periodStart.slice(0, 4), slice2: record.periodEnd.slice(0, 4), reviewerDisplayName: record.reviewerDisplayName })}
      actions={actions}
    />
  );
}

type ItemDraft = { reflection: string; selfRating: number | null; selfComment: string; assessment: string; managerRating: number | null };
const keyOf = (item: ReviewItemAssessmentDto) => `${item.kind}:${item.itemId}`;

/** Drafts for one side, autosaved a moment after the last change. The latest version follows each save. */
function useDraft(record: PerformanceReviewDto, side: "self" | "manager") {
  const t = useTranslations("reviews.useDraft");
  const mutations = useReviewAssessmentMutations(record.id, record.cycleId);
  const own = side === "self" ? record.selfAssessment : record.managerAssessment;
  const [summary, setSummary] = useState(own?.summary ?? "");
  const [overall, setOverall] = useState<number | null>(own?.overallRating ?? null);
  const [potential, setPotential] = useState<ReviewPotential | null>(record.potential);
  const [items, setItems] = useState<Record<string, ItemDraft>>(() => Object.fromEntries(record.items.map((item) => [keyOf(item), {
    reflection: item.selfReflection ?? "", selfRating: item.selfRating, selfComment: item.selfComment ?? "",
    assessment: item.managerAssessment ?? "", managerRating: item.managerRating,
  }])));
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(record.questions
    .filter((q) => q.audience === (side === "self" ? "Person" : "Manager"))
    .map((q) => [q.questionId, (side === "self" ? q.selfAnswer : q.managerAnswer) ?? ""])));
  const [savedAt, setSavedAt] = useState<Date | null>(own?.savedAt ? new Date(own.savedAt) : null);
  const [missing, setMissing] = useState<ReviewMissingDto | null>(null);
  const version = useRef(record.version);
  const dirty = useRef(false);
  if (record.version > version.current) version.current = record.version;

  const payload = () => {
    const itemInputs: ReviewItemResponseInput[] = record.items.map((item) => {
      const draft = items[keyOf(item)]!;
      return side === "self"
        ? { kind: item.kind, itemId: item.itemId, reflection: draft.reflection.trim() || null, rating: draft.selfRating, comment: draft.selfComment.trim() || null }
        : { kind: item.kind, itemId: item.itemId, assessment: draft.assessment.trim() || null, rating: draft.managerRating };
    });
    const answerInputs: ReviewAnswerInput[] = Object.entries(answers).map(([questionId, text]) => ({ questionId, text: text.trim() || null }));
    return { summary: summary.trim(), overallRating: overall, items: itemInputs, answers: answerInputs };
  };

  const save = async () => {
    // The server needs a summary on every save; an empty draft waits until one is written.
    if (!summary.trim()) return;
    const body = { ...payload(), expectedVersion: version.current };
    const result = side === "self"
      ? await mutations.saveSelf.mutateAsync(body)
      : await mutations.saveManager.mutateAsync({ ...body, potential: record.potentialEnabled ? potential : null });
    version.current = result.version;
    setSavedAt(new Date());
  };

  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => { dirty.current = false; void save().catch(() => undefined); }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- autosave follows the drafts only
  }, [summary, overall, potential, items, answers]);

  const touch = <T,>(setter: (value: T) => void) => (value: T) => { dirty.current = true; setMissing(null); setter(value); };

  const submit = async () => {
    try {
      const body = { ...payload(), expectedVersion: version.current };
      const result = side === "self"
        ? await mutations.submitSelf.mutateAsync(body)
        : await mutations.submitManager.mutateAsync({ ...body, potential: record.potentialEnabled ? potential : null });
      version.current = result.version;
      toast.success(side === "self" ? t("sentTo", { name: first(record.reviewerDisplayName) }) : t("submitted"));
    } catch (error) {
      if (error instanceof ApiError && error.details && typeof error.details === "object" && "extra" in error.details) {
        setMissing((error.details as { extra: ReviewMissingDto }).extra);
      }
      reportPerformanceFailure(error, t("thisCouldntBeSubmitted"));
    }
  };

  const updateItem = (item: ReviewItemAssessmentDto, patch: Partial<ItemDraft>) => touch(setItems)({ ...items, [keyOf(item)]: { ...items[keyOf(item)]!, ...patch } });
  return {
    summary, setSummary: touch(setSummary), overall, setOverall: touch(setOverall), potential, setPotential: touch(setPotential),
    items, updateItem, answers, setAnswer: (id: string, text: string) => touch(setAnswers)({ ...answers, [id]: text }),
    savedAt, missing, submit, pending: side === "self" ? mutations.submitSelf.isLoading : mutations.submitManager.isLoading,
    saving: side === "self" ? mutations.saveSelf.isLoading : mutations.saveManager.isLoading,
  };
}

function savedLabel(savedAt: Date | null, saving: boolean, say: Say) {
  if (saving) return say("saving");
  if (!savedAt) return null;
  const minutes = Math.round((Date.now() - savedAt.getTime()) / 60_000);
  return minutes < 1 ? say("savedNow") : say("savedAgo", { count: minutes });
}

function SelfAssessmentWriter({ record }: { record: PerformanceReviewDto }) {
  const format = useFormat();
  const t = useTranslations("reviews.SelfAssessmentWriter");
  const rs = useSay("reviews.steps");
  const partWords = useSay("reviews.parts");
  const draft = useDraft(record, "self");
  const objectives = record.items.filter((i) => i.kind === "Objective");
  const competencies = record.items.filter((i) => i.kind === "Competency");
  const questions = record.questions.filter((q) => q.audience === "Person");
  const missingItems = draft.missing?.items.map((m) => `${m.kind}:${m.itemId}`) ?? [];
  const left = [
    ...objectives.filter((i) => ratingRequired(record, i) && draft.items[keyOf(i)]?.selfRating === null).map(() => "objective"),
    ...competencies.filter((i) => draft.items[keyOf(i)]?.selfRating === null).map(() => "competency"),
  ];
  const unanswered = questions.filter((q) => !draft.answers[q.questionId]?.trim()).length;
  const parts = [
    left.length ? t("ratingsLeft", { count: left.length }) : null,
    unanswered ? t("questionsLeft", { count: unanswered }) : null,
    draft.overall === null ? "overall" : null,
    !draft.summary.trim() ? "summary" : null,
  ].filter(Boolean) as string[];
  const total = objectives.filter((i) => ratingRequired(record, i)).length + competencies.length + questions.length + 2;
  const done = total - left.length - unanswered - (draft.overall === null ? 1 : 0) - (!draft.summary.trim() ? 1 : 0);
  const late = (record.schedule?.daysLate ?? 0) > 0;

  return (
    <div className="max-w-4xl pb-24">
      <SubjectHeading record={record} detail={t("reviewsYou", { slice: record.periodStart.slice(0, 4), slice2: record.periodEnd.slice(0, 4), reviewerDisplayName: record.reviewerDisplayName, value: savedLabel(draft.savedAt, draft.saving, rs) ? ` · ${savedLabel(draft.savedAt, draft.saving, rs)}` : "" })} />

      <section aria-label={t("whereYourReviewStands")} className="rounded-surface bg-card p-5">
        <StageTrack label={t("yourReviewsStages")} steps={reviewSteps(record, "subject", rs, format.locale).map((s, i) => i === 1 ? { ...s, detail: t("seesYoursOnceYouSubmit") } : s)} />
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <PeersAsked record={record} />
          <div className="ms-auto"><YearChips record={record} /></div>
        </div>
      </section>

      {objectives.length ? (
        <section className="mt-10" aria-labelledby="objectives-heading">
          <SectionHeading id="objectives-heading" title={t("objectives")} count={objectives.length} aside={t("progressAndEvidenceFromYour")} />
          <div className="space-y-4">
            {objectives.map((item) => (
              <ObjectiveCard key={item.itemId} record={record} item={item}>
                <div className="mt-4 border-t border-border pt-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                    <span className="type-label text-foreground">{t("howItWent")}</span>
                    {record.objectiveRatingsEnabled ? (
                      <span className="flex items-center gap-2">
                        <span className="type-meta text-muted-foreground">{t("yourRating")}</span>
                        <SegmentRating label={t("yourRatingFor", { title: item.title })} levels={record.ratingScale} value={draft.items[keyOf(item)]!.selfRating}
                          onChange={(value) => draft.updateItem(item, { selfRating: value })} />
                        <span className="w-36 type-meta text-muted-foreground">{levelLabel(record.ratingScale, draft.items[keyOf(item)]!.selfRating)}</span>
                      </span>
                    ) : null}
                  </div>
                  <Textarea aria-label={t("howWent", { title: item.title })} className="min-h-24 type-narrative" maxLength={4000}
                    aria-invalid={missingItems.includes(keyOf(item)) || undefined}
                    value={draft.items[keyOf(item)]!.reflection} onChange={(e) => draft.updateItem(item, { reflection: e.target.value })} />
                </div>
              </ObjectiveCard>
            ))}
          </div>
        </section>
      ) : null}

      {competencies.length ? (
        <section className="mt-10" aria-labelledby="competencies-heading">
          <SectionHeading id="competencies-heading" title={t("competencies")}
            count={rs("of", { done: competencies.filter((c) => draft.items[keyOf(c)]?.selfRating !== null).length, total: competencies.length })} />
          <ul className="divide-y divide-border rounded-surface bg-card">
            {competencies.map((item) => (
              <li key={item.itemId} className={cn("grid items-center gap-3 px-5 py-3 md:grid-cols-[14rem_auto_minmax(0,1fr)]", missingItems.includes(keyOf(item)) && "bg-destructive/5")}>
                <ValueChip value={{ id: item.itemId, name: item.title }} />
                <SegmentRating label={t("yourRatingFor", { title: item.title })} levels={record.ratingScale} value={draft.items[keyOf(item)]!.selfRating}
                  onChange={(value) => draft.updateItem(item, { selfRating: value })} />
                <Input aria-label={t("commentOn", { title: item.title })} className="border-transparent bg-transparent" placeholder={t("addAComment")} maxLength={2000}
                  value={draft.items[keyOf(item)]!.selfComment} onChange={(e) => draft.updateItem(item, { selfComment: e.target.value })} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {questions.length ? (
        <section className="mt-10" aria-labelledby="questions-heading">
          <SectionHeading id="questions-heading" title={t("questions")} count={rs("of", { done: questions.length - unanswered, total: questions.length })} />
          <ul className="divide-y divide-border rounded-surface bg-card">
            {questions.map((question) => (
              <li key={question.questionId} className="p-5">
                <label htmlFor={`q-${question.questionId}`} className="type-label text-foreground">{question.text}</label>
                <Textarea id={`q-${question.questionId}`} className="mt-2 min-h-20 type-narrative" placeholder={t("writeYourAnswer")} maxLength={4000}
                  aria-invalid={draft.missing?.questions.includes(question.questionId) || undefined}
                  value={draft.answers[question.questionId] ?? ""} onChange={(e) => draft.setAnswer(question.questionId, e.target.value)} />
                {draft.missing?.questions.includes(question.questionId) ? <p className="mt-1.5 type-meta text-destructive">{t("answerThisBeforeSubmitting")}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-10" aria-labelledby="overall-heading">
        <SectionHeading id="overall-heading" title={t("yourOverallView")} />
        <div className="space-y-3 rounded-surface bg-card p-5">
          <ReviewDraftBlock reviewId={record.id} lens="self" subject={first(record.subjectDisplayName)} value={draft.summary} onInsert={draft.setSummary} />
          <LevelCards label={t("yourOverallRating")} levels={record.ratingScale} value={draft.overall} onChange={draft.setOverall} />
          <Textarea aria-label={t("yourSummary")} className="min-h-24 type-narrative" placeholder={t("sumUpYourYearIn")} maxLength={4000}
            aria-invalid={draft.missing?.summary || undefined} value={draft.summary} onChange={(e) => draft.setSummary(e.target.value)} />
        </div>
      </section>

      <div className="sticky bottom-4 mt-10 flex flex-wrap items-center gap-4 rounded-surface bg-popover px-5 py-3.5 shadow-overlay">
        <span className="flex gap-1" aria-hidden>
          {Array.from({ length: Math.min(total, 12) }, (_, i) => <span key={i} className={cn("h-1.5 w-6 rounded-full", i < Math.round((done / total) * Math.min(total, 12)) ? "bg-success" : "bg-inlay")} />)}
        </span>
        <span className="flex-1 type-meta text-muted-foreground">
          {parts.length ? <><strong className="font-semibold text-foreground">{parts.length} {parts.length === 1 ? t("part") : t("parts")} {t("left")}</strong> · {parts.join(", ")}</> : <strong className="font-semibold text-foreground">{t("readyToSubmit")}</strong>}
          {savedLabel(draft.savedAt, draft.saving, rs) ? ` · ${savedLabel(draft.savedAt, draft.saving, rs)}` : ""}
        </span>
        {record.schedule?.selfAssessmentDue ? <DueChip date={record.schedule.selfAssessmentDue} late={late} label={late ? dueIn(record.schedule.selfAssessmentDue, partWords) : t("due", { selfAssessmentDue: dayLabel(record.schedule.selfAssessmentDue, format.locale) })} /> : null}
        <AsyncButton pending={draft.pending} onClick={() => void draft.submit()}><Send className="size-4" aria-hidden />{t("submitSelfAssessment")}</AsyncButton>
      </div>
    </div>
  );
}

/** Who gives peer input: chosen while self-assessing, then the reviewer approves. The person never sees answers. */
function PeersAsked({ record }: { record: PerformanceReviewDto }) {
  const t = useTranslations("reviews.PeersAsked");
  const peers = record.peers;
  const [choosing, setChoosing] = useState(false);
  const [picked, setPicked] = useState<{ employeeId: string; displayName: string }[]>(() => peers?.people.map((p) => ({ employeeId: p.employeeId, displayName: p.displayName })) ?? []);
  const { nominate } = usePeerCommands(record.id);
  if (!record.peerInputEnabled || !peers) return null;
  const names = peers.people.map((p) => p.displayName);
  const reviewer = first(record.reviewerDisplayName);
  if (choosing) {
    return (
      <div className="w-full space-y-2">
        <p className="type-label text-foreground">{t("whoShouldGivePeerInput")} <span className="type-meta text-muted-foreground">{t("n1To5ColleaguesApproves", { reviewer })}</span></p>
        <ul className="flex flex-wrap gap-2">
          {picked.map((person) => (
            <li key={person.employeeId} className="inline-flex items-center gap-1.5 rounded-control bg-inlay py-1 pe-1 ps-2 type-meta text-foreground">
              {person.displayName}
              <Button size="icon" variant="ghost" className="size-6" aria-label={t("remove", { displayName: person.displayName })}
                onClick={() => setPicked(picked.filter((p) => p.employeeId !== person.employeeId))}>×</Button>
            </li>
          ))}
        </ul>
        {picked.length < 5 ? <ColleaguePicker value={null} exclude={[...picked.map((p) => p.employeeId), record.subjectEmployeeId, record.reviewerEmployeeId]}
          onChange={(person) => setPicked([...picked, { employeeId: person.employeeId, displayName: person.displayName }])} /> : null}
        <div className="flex gap-2">
          <AsyncButton size="sm" pending={nominate.isLoading} disabled={picked.length === 0}
            onClick={() => void nominate.mutateAsync({ ids: picked.map((p) => p.employeeId), version: record.version })
              .then(() => { setChoosing(false); toast.success(t("willReviewYourList", { reviewer })); })
              .catch((error) => reportPerformanceFailure(error, t("theListCouldntBeSaved")))}>
            {t("sendTo", { reviewer })}
          </AsyncButton>
          <Button size="sm" variant="ghost" onClick={() => setChoosing(false)}>{t("cancel")}</Button>
        </div>
      </div>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2 type-meta text-muted-foreground">
      {names.length ? <AvatarStack names={names} size="xs" /> : null}
      {names.length
        ? (peers.approved ? t("wereAskedTheirAnswersGo", { value: (names.length === 1 ? names[0] : `${names.slice(0, -1).map(first).join(", ")} and ${first(names[names.length - 1]!)}`) ?? "", reviewer }) : t("awaitApprovalTheirAnswersGo", { value: (names.length === 1 ? names[0] : `${names.slice(0, -1).map(first).join(", ")} and ${first(names[names.length - 1]!)}`) ?? "", reviewer }))
        : t("noColleaguesChosenForPeer")}
      {record.canNominatePeers ? <Button size="sm" variant="outline" onClick={() => setChoosing(true)}>{names.length ? t("change") : t("chooseColleagues")}</Button> : null}
    </span>
  );
}

function ObjectiveCard({ record, item, children }: { record: PerformanceReviewDto; item: ReviewItemAssessmentDto; children?: ReactNode }) {
  const format = useFormat();
  const t = useTranslations("reviews.ObjectiveCard");
  const words = useSay("common.words");
  const quote = item.feedback?.[0];
  return (
    <article className="rounded-surface bg-card p-5">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <Link href={objectiveHref({ cycleId: record.cycleId, objectiveId: item.itemId })} className="type-subsection-title text-foreground hover:underline">{item.title}</Link>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 type-meta text-muted-foreground">
            {item.status ? <ObjectiveStatusBadge status={item.status} /> : null}
            {item.measurement ? <span>{measurementSummary(item.measurement, words)}</span> : item.legacyMeasurementSummary ? <span>{item.legacyMeasurementSummary}</span> : null}
            {item.evidenceSummary.slice(0, 2).map((evidence, i) => <span key={i} className="inline-flex items-center gap-1 rounded-control bg-inlay px-2 py-0.5 text-foreground"><FileText className="size-3.5" aria-hidden />{evidence.label}</span>)}
          </div>
        </div>
        <ProgressRing value={item.progress} tone={item.status === "AtRisk" || item.status === "OffTrack" ? "warning" : "success"} />
      </div>
      {quote ? (
        <blockquote className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-control bg-inlay px-4 py-3">
          <p className="max-w-[60ch] type-narrative text-foreground">“{quote.message}”</p>
          <footer className="type-meta text-muted-foreground">{t("feedback", { authorName: first(quote.authorName), dayLabel: dayLabel(quote.sentAt.slice(0, 10), format.locale) })}</footer>
        </blockquote>
      ) : null}
      {children}
    </article>
  );
}

function SubmittedView({ record }: { record: PerformanceReviewDto }) {
  const format = useFormat();
  const t = useTranslations("reviews.SubmittedView");
  const rs = useSay("reviews.steps");
  const [open, setOpen] = useState<string | null>(null);
  const objectives = record.items.filter((i) => i.kind === "Objective");
  const competencies = record.items.filter((i) => i.kind === "Competency");
  const questions = record.questions.filter((q) => q.audience === "Person" && q.selfAnswer);
  const reviewer = first(record.reviewerDisplayName);
  return (
    <div className="max-w-4xl">
      <SubjectHeading record={record} />
      <section className="rounded-surface bg-card p-6">
        <div className="flex items-start gap-4">
          <span className="flex size-11 items-center justify-center rounded-control bg-success/15 text-success"><Check className="size-5" aria-hidden /></span>
          <div>
            <h2 className="type-page-title text-foreground">{record.selfAssessment?.submittedAt ? t("submitted", { dayLabel: dayLabel(record.selfAssessment.submittedAt.slice(0, 10), format.locale) }) : t("isWritingYourReview", { reviewer })}</h2>
            <p className="mt-0.5 type-meta text-muted-foreground">{t("writesTheirPartBy", { reviewer, managerAssessmentDue: dayLabel(record.schedule?.managerAssessmentDue, format.locale) })}</p>
          </div>
        </div>
        <StageTrack className="mt-6" label={t("yourReviewsStages")} steps={reviewSteps(record, "subject", rs, format.locale).map((s, i) => i === reviewSteps(record, "subject", rs, format.locale).length - 1 ? { ...s, detail: t("youllBeNotified") } : s)} />
      </section>
      {record.selfAssessment ? (
        <section className="mt-10" aria-labelledby="sent-heading">
          <SectionHeading id="sent-heading" title={t("whatYouSent")} aside={<span className="inline-flex items-center gap-1"><Lock className="size-3.5" aria-hidden />{t("locked")}</span>} />
          <ul className="divide-y divide-border rounded-surface bg-card">
            {objectives.map((item) => (
              <li key={item.itemId} className="flex items-center gap-4 px-5 py-3.5">
                <span className="min-w-0 flex-1">
                  <span className="block type-label text-foreground">{item.title}</span>
                  {item.selfReflection ? <span className="block truncate type-meta text-muted-foreground">“{item.selfReflection}”</span> : null}
                </span>
                {item.selfRating ? <span className="rounded-control-sm bg-primary px-2 type-label tabular-nums text-primary-foreground">{item.selfRating}</span> : null}
              </li>
            ))}
            {competencies.length ? (
              <Disclosure id="c" open={open} setOpen={setOpen} title={t("competencies")}
                summary={t("rated", { length: competencies.length, join: competencies.map((c) => `${c.title} ${c.selfRating ?? "–"}`).join(" · ") })}>
                {competencies.map((c) => <p key={c.itemId} className="type-body text-foreground">{c.title} · {c.selfRating ?? "–"}{c.selfComment ? ` · ${c.selfComment}` : ""}</p>)}
              </Disclosure>
            ) : null}
            {questions.length ? (
              <Disclosure id="q" open={open} setOpen={setOpen} title={t("questions")} summary={t("answered", { length: questions.length })}>
                {questions.map((q) => <div key={q.questionId}><p className="type-label text-foreground">{q.text}</p><p className="type-narrative text-foreground">{q.selfAnswer}</p></div>)}
              </Disclosure>
            ) : null}
            <Disclosure id="o" open={open} setOpen={setOpen}
              title={t("overall", { value: record.selfAssessment.overallRating ? ` · ${levelLabel(record.ratingScale, record.selfAssessment.overallRating)}` : "" })}
              summary={`“${record.selfAssessment.summary}”`}>
              <p className="type-narrative text-foreground">{record.selfAssessment.summary}</p>
            </Disclosure>
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Disclosure({ id, title, summary, open, setOpen, children }: {
  id: string; title: string; summary: string; open: string | null; setOpen: (id: string | null) => void; children: ReactNode;
}) {
  const expanded = open === id;
  return (
    <li>
      <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : id)}
        className="flex w-full items-center gap-4 px-5 py-3.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="min-w-0 flex-1">
          <span className="block type-label text-foreground">{title}</span>
          <span className="block truncate type-meta text-muted-foreground">{summary}</span>
        </span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", expanded && "rotate-180")} aria-hidden />
      </button>
      {expanded ? <div className="space-y-3 px-5 pb-4">{children}</div> : null}
    </li>
  );
}

function ReleasedView({ record }: { record: PerformanceReviewDto }) {
  const format = useFormat();
  const t = useTranslations("reviews.ReleasedView");
  const acknowledge = useAcknowledge(record.id);
  const download = useDownloadReviewPdf();
  const [comment, setComment] = useState("");
  const final = levelLabel(record.ratingScale, record.finalRating) ?? t("released");
  const objectives = record.items.filter((i) => i.kind === "Objective");
  const competencies = record.items.filter((i) => i.kind === "Competency");
  const managerAnswers = record.questions.filter((q) => q.audience === "Manager" && q.managerAnswer);
  const reviewer = first(record.reviewerDisplayName);
  return (
    <div className="max-w-4xl">
      <SubjectHeading record={record}
        detail={t("releasedReviewedBy", { dayLabel: dayLabel(record.finalizedAt?.slice(0, 10), format.locale), reviewerDisplayName: record.reviewerDisplayName })}
        actions={<div className="flex items-center gap-2">
          {record.acknowledgement ? <StatusBadge tone="success" dot>{t("acknowledged")}</StatusBadge> : <StatusBadge tone="warning" dot>{t("notAcknowledged")}</StatusBadge>}
          {record.canDownloadPdf ? <Button variant="outline" onClick={() => void download(record.id, `${record.reviewRoundName}.pdf`)}><Download className="size-4" aria-hidden />{t("pdf")}</Button> : null}
        </div>} />
      {/* A result to read, not a decision: a plain card, with amber only on the level reached. */}
      <section aria-label={t("yourResult")} className="rounded-surface bg-card p-6">
        <p className="type-meta text-muted-foreground">{t("yourResult")}</p>
        <h2 className="mt-2 type-display text-foreground">{final}</h2>
        <div className="mt-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${record.ratingScale.length}, minmax(0, 1fr))` }} aria-hidden>
          {record.ratingScale.map((level) => (
            <span key={level.value} className={cn("rounded-control px-3 py-2 type-label tabular-nums", level.value === record.finalRating ? "border border-primary bg-primary/20 text-primary" : "bg-card text-muted-foreground")}>{level.value}</span>
          ))}
        </div>
        {record.managerAssessment?.summary ? (
          <div className="mt-6 flex gap-4 border-t border-primary/30 pt-5">
            <PersonInitials name={record.reviewerDisplayName} size="lg" />
            <div>
              <p className="type-meta text-muted-foreground">{record.reviewerDisplayName}</p>
              <p className="mt-1 max-w-[65ch] type-narrative text-foreground">{record.managerAssessment.summary}</p>
            </div>
          </div>
        ) : null}
      </section>

      {objectives.length ? (
        <section className="mt-10" aria-labelledby="r-objectives">
          <SectionHeading id="r-objectives" title={t("objectives")} />
          <ul className="divide-y divide-border rounded-surface bg-card">
            {objectives.map((item) => (
              <li key={item.itemId} className="flex items-center gap-4 px-5 py-3.5">
                <span className="min-w-0 flex-1">
                  <span className="block type-label text-foreground">{item.title}</span>
                  <span className="block truncate type-meta text-muted-foreground">
                    {[item.progress !== null ? `${Math.round(item.progress)}%` : null, item.managerAssessment ? `“${item.managerAssessment}”` : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {item.managerRating ? <span className="type-label tabular-nums text-foreground">{item.managerRating} · {levelLabel(record.ratingScale, item.managerRating)}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {competencies.length ? (
        <section className="mt-10" aria-labelledby="r-competencies">
          <SectionHeading id="r-competencies" title={t("competencies")} />
          <div className="grid gap-3 md:grid-cols-2">
            {competencies.map((item) => (
              <div key={item.itemId} className="rounded-surface bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <ValueChip value={{ id: item.itemId, name: item.title }} />
                  {item.managerRating ? <span className="type-label tabular-nums text-foreground">{item.managerRating} · {levelLabel(record.ratingScale, item.managerRating)}</span> : null}
                </div>
                {item.managerAssessment ? <p className="mt-2 type-body-secondary text-muted-foreground">{item.managerAssessment}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {managerAnswers.length ? (
        <section className="mt-10" aria-labelledby="r-answers">
          <SectionHeading id="r-answers" title={t("sAnswers", { reviewer })} />
          <ul className="divide-y divide-border rounded-surface bg-card">
            {managerAnswers.map((q) => (
              <li key={q.questionId} className="p-5"><p className="type-label text-foreground">{q.text}</p><p className="mt-1 type-narrative text-foreground">{q.managerAnswer}</p></li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-6 rounded-surface bg-card p-5" aria-labelledby="ack-heading">
        <div className="flex items-start gap-3">
          <span className="flex size-9 items-center justify-center rounded-control bg-primary-tint text-primary"><Check className="size-4" aria-hidden /></span>
          <div>
            <h2 id="ack-heading" className="type-panel-title text-foreground">{record.acknowledgement ? t("youAcknowledgedThis", { dayLabel: dayLabel(record.acknowledgement.at.slice(0, 10), format.locale) }) : t("iveReadMyReview")}</h2>
            <p className="type-meta text-muted-foreground">{t("acknowledgingIsntAgreeingAndHr", { reviewer })}</p>
          </div>
        </div>
        {record.acknowledgement ? (
          record.acknowledgement.comment ? <p className="mt-3 type-narrative text-foreground">“{record.acknowledgement.comment}”</p> : null
        ) : record.canAcknowledge ? (
          <>
            <Textarea className="mt-4" aria-label={t("commentForYourReviewerAnd")} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="mt-3 flex items-center justify-between">
              <span className="type-meta tabular-nums text-muted-foreground">{comment.length} / 1,000</span>
              <AsyncButton pending={acknowledge.isLoading} onClick={() => void acknowledge.mutateAsync(comment.trim() || null)
                .then(() => toast.success(t("acknowledged2")))
                .catch((error) => reportPerformanceFailure(error, t("thisCouldntBeAcknowledged")))}>
                <Check className="size-4" aria-hidden />{t("acknowledge")}
              </AsyncButton>
            </div>
          </>
        ) : null}
      </section>
      <Link href={withCycle("/plan#development", record.cycleId)} className="mt-3 flex items-center gap-3 rounded-surface bg-card px-5 py-4 hover:bg-inlay/60">
        <span className="flex size-9 items-center justify-center rounded-control bg-primary-tint text-primary"><Target className="size-4" aria-hidden /></span>
        <span className="flex-1">
          <span className="block type-label text-foreground">{t("planYourDevelopment")}</span>
          <span className="block type-meta text-muted-foreground">{record.year?.developmentGoals ? t("goalsInYourPlan", { developmentGoals: record.year.developmentGoals }) : t("turnThisIntoAGoal")}</span>
        </span>
      </Link>
    </div>
  );
}

// ── The reviewer (board 12) ────────────────────────────────────────────────────────

function ReviewerView({ record }: { record: PerformanceReviewDto }) {
  const format = useFormat();
  const t = useTranslations("reviews.ReviewerView");
  const rs = useSay("reviews.steps");
  const parts = useSay("reviews.parts");
  const editable = record.canEditManagerAssessment;
  const draft = useDraft(record, "manager");
  const download = useDownloadReviewPdf();
  const subject = first(record.subjectDisplayName);
  const objectives = record.items.filter((i) => i.kind === "Objective");
  const competencies = record.items.filter((i) => i.kind === "Competency");
  const managerQuestions = record.questions.filter((q) => q.audience === "Manager");
  const personQuestions = record.questions.filter((q) => q.audience === "Person" && q.selfAnswer);
  const missingItems = draft.missing?.items.map((m) => `${m.kind}:${m.itemId}`) ?? [];
  const selfIn = Boolean(record.selfAssessment?.submittedAt);
  return (
    <div className="pb-16">
      <PageHeader className="mb-4"
        back={{ href: "/reviews", label: t("reviews") }}
        leading={<span className="flex"><PersonInitials name={record.subjectDisplayName} size="xl" /><PersonInitials name={record.reviewerDisplayName} size="xl" className="-ms-4 ring-2 ring-background" /></span>}
        title={record.subjectDisplayName}
        description={[record.reviewRoundName, record.subjectJobTitle,
          selfIn ? `self-assessment came in ${dayLabel(record.selfAssessment!.submittedAt!.slice(0, 10), format.locale)}` : null,
          editable ? savedLabel(draft.savedAt, draft.saving, rs) : null].filter(Boolean).join(" · ")}
        actions={editable ? <AsyncButton pending={draft.pending} onClick={() => void draft.submit()}><Send className="size-4" aria-hidden />{t("submitReview")}</AsyncButton>
          : record.canDownloadPdf ? <Button variant="outline" onClick={() => void download(record.id, `${record.reviewRoundName} ${record.subjectDisplayName}.pdf`)}><Download className="size-4" aria-hidden />{t("pdf")}</Button>
          : null}
      />

      <section aria-label={t("whereTheReviewStands")} className="flex flex-wrap items-start gap-6 rounded-surface bg-card p-5">
        <StageTrack className="min-w-[28rem] flex-1" label={t("reviewStages")} steps={reviewSteps(record, "reviewer", rs, format.locale)} />
        <YearChips record={record} />
      </section>
      {record.lens === "Reviewer" ? <CalibratedOutcome record={record} /> : null}
      {record.acknowledgement ? (
        <p className="mt-4 rounded-surface bg-card px-5 py-3 type-body text-foreground">
          {t("acknowledgedThis", { subject, dayLabel: dayLabel(record.acknowledgement.at.slice(0, 10), format.locale) })}{record.acknowledgement.comment ? `: “${record.acknowledgement.comment}”` : "."}
        </p>
      ) : null}
      {!selfIn && record.selfAssessmentEnabled && record.state === "SelfAssessment" ? (
        <p className="mt-4 type-body-secondary text-muted-foreground">{t("sSelfAssessmentIsntIn", { subject })}</p>
      ) : null}

      {record.state !== "SelfAssessment" ? (
        <>
          <p className="mt-6 flex gap-4 type-meta text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-info" />{t("sView", { subject })}</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-primary" />{t("yours")}</span>
          </p>
          {objectives.length ? (
            <section className="mt-6" aria-labelledby="m-objectives">
              <SectionHeading id="m-objectives" title={t("objectives")} count={record.objectiveRatingsEnabled ? rs("ofRated", { done: objectives.filter((o) => draft.items[keyOf(o)]?.managerRating !== null).length, total: objectives.length }) : objectives.length} />
              <div className="space-y-4">
                {objectives.map((item) => (
                  <ObjectiveCard key={item.itemId} record={record} item={item}>
                    <div className="mt-4 grid border-t border-border md:grid-cols-2">
                      <div className="py-4 md:pe-5">
                        <p className="mb-2 flex items-center justify-between gap-2 type-label text-foreground">
                          <span className="inline-flex items-center gap-2"><PersonInitials name={record.subjectDisplayName} size="xs" />{subject}</span>
                          {item.selfRating ? <span className="rounded-control-sm px-1.5 type-label tabular-nums text-info ring-1 ring-info">{item.selfRating}</span> : null}
                        </p>
                        <p className="type-narrative text-foreground">{item.selfReflection ?? <span className="text-muted-foreground">{t("noReflection")}</span>}</p>
                      </div>
                      <div className="border-border py-4 md:border-s md:ps-5">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-2 type-label text-foreground"><PersonInitials name={record.reviewerDisplayName} size="xs" />{t("you")}</span>
                          {record.objectiveRatingsEnabled ? (
                            <SegmentRating label={t("yourRatingFor", { title: item.title })} levels={record.ratingScale} value={draft.items[keyOf(item)]!.managerRating}
                              disabled={!editable} onChange={editable ? (value) => draft.updateItem(item, { managerRating: value }) : undefined} />
                          ) : null}
                        </div>
                        {editable ? (
                          <Textarea aria-label={t("yourViewOf", { title: item.title })} className="min-h-24 type-narrative" placeholder={t("yourViewOfThisObjective")} maxLength={4000}
                            aria-invalid={missingItems.includes(keyOf(item)) || undefined}
                            value={draft.items[keyOf(item)]!.assessment} onChange={(e) => draft.updateItem(item, { assessment: e.target.value })} />
                        ) : <p className="type-narrative text-foreground">{item.managerAssessment ?? <span className="text-muted-foreground">{t("noAssessment")}</span>}</p>}
                      </div>
                    </div>
                  </ObjectiveCard>
                ))}
              </div>
            </section>
          ) : null}

          {competencies.length ? (
            <section className="mt-10" aria-labelledby="m-competencies">
              <SectionHeading id="m-competencies" title={t("competencies")} count={rs("of", { done: competencies.filter((c) => draft.items[keyOf(c)]?.managerRating !== null).length, total: competencies.length })} />
              <div className="overflow-x-auto rounded-surface bg-card">
                <table className="w-full min-w-[48rem] text-start">
                  <thead className="bg-inlay"><tr className="type-meta text-muted-foreground">
                    <th scope="col" className="px-5 py-3 font-semibold">{t("competency")}</th>
                    <th scope="col" className="px-3 py-3 font-semibold">{subject}</th>
                    <th scope="col" className="px-3 py-3 font-semibold">{t("you")}</th>
                    <th scope="col" className="px-5 py-3 font-semibold">{t("comment")}</th>
                  </tr></thead>
                  <tbody className="divide-y divide-border">
                    {competencies.map((item) => (
                      <tr key={item.itemId} className={cn(missingItems.includes(keyOf(item)) && "bg-destructive/5")}>
                        <td className="px-5 py-3"><ValueChip value={{ id: item.itemId, name: item.title }} /></td>
                        <td className="px-3 py-3"><SegmentRating label={t("sRatingFor", { subject, title: item.title })} levels={record.ratingScale} value={null} theirs={item.selfRating} /></td>
                        <td className="px-3 py-3"><SegmentRating label={t("yourRatingFor", { title: item.title })} levels={record.ratingScale} value={draft.items[keyOf(item)]!.managerRating}
                          disabled={!editable} onChange={editable ? (value) => draft.updateItem(item, { managerRating: value }) : undefined} /></td>
                        <td className="px-5 py-3">{editable ? (
                          <Input aria-label={t("commentOn", { title: item.title })} className="border-transparent bg-transparent" placeholder={t("addAComment")} maxLength={4000}
                            value={draft.items[keyOf(item)]!.assessment} onChange={(e) => draft.updateItem(item, { assessment: e.target.value })} />
                        ) : <span className="type-body text-foreground">{item.managerAssessment}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <PeerAnswers record={record} />

          {personQuestions.length ? (
            <section className="mt-10" aria-labelledby="m-person-answers">
              <SectionHeading id="m-person-answers" title={t("sAnswers", { subject })} />
              <ul className="divide-y divide-border rounded-surface bg-card">
                {personQuestions.map((q) => <li key={q.questionId} className="p-5"><p className="type-label text-foreground">{q.text}</p><p className="mt-1 type-narrative text-foreground">{q.selfAnswer}</p></li>)}
              </ul>
            </section>
          ) : null}

          {managerQuestions.length ? (
            <section className="mt-10" aria-labelledby="m-questions">
              <SectionHeading id="m-questions" title={t("yourAnswers")} />
              <ul className="divide-y divide-border rounded-surface bg-card">
                {managerQuestions.map((q) => (
                  <li key={q.questionId} className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <label htmlFor={`m-${q.questionId}`} className="type-label text-foreground">{q.text}</label>
                      {editable ? <ReviewDraftBlock reviewId={record.id} kind="Question" questionId={q.questionId} lens="manager" subject={subject}
                        value={draft.answers[q.questionId] ?? ""} onInsert={(text) => draft.setAnswer(q.questionId, text)} className="shrink-0" /> : null}
                    </div>
                    {editable ? (
                      <Textarea id={`m-${q.questionId}`} className="mt-2 min-h-20 type-narrative" maxLength={4000}
                        aria-invalid={draft.missing?.questions.includes(q.questionId) || undefined}
                        value={draft.answers[q.questionId] ?? ""} onChange={(e) => draft.setAnswer(q.questionId, e.target.value)} />
                    ) : <p className="mt-1 type-narrative text-foreground">{q.managerAnswer}</p>}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="mt-10" aria-labelledby="m-overall">
            <SectionHeading id="m-overall" title={t("overall")} aside={record.selfAssessment?.overallRating ? t("theirView", { subject, level: levelLabel(record.ratingScale, record.selfAssessment.overallRating) ?? "" }) : undefined} />
            <div className="space-y-3 rounded-surface bg-card p-5">
              {editable ? <ReviewDraftBlock reviewId={record.id} lens="manager" subject={subject} value={draft.summary} onInsert={draft.setSummary} /> : null}
              <LevelCards label={t("yourOverallRating")} levels={record.ratingScale} value={draft.overall} theirs={record.selfAssessment?.overallRating}
                disabled={!editable} onChange={editable ? draft.setOverall : undefined} />
              {editable ? (
                <Textarea aria-label={t("yourSummary")} className="min-h-24 type-narrative" placeholder={t("whatShouldReadFirst", { subject })} maxLength={4000}
                  aria-invalid={draft.missing?.summary || undefined} value={draft.summary} onChange={(e) => draft.setSummary(e.target.value)} />
              ) : <p className="type-narrative text-foreground">{record.managerAssessment?.summary}</p>}
            </div>
          </section>

          {record.potentialEnabled ? (
            <section className="mt-10" aria-labelledby="m-potential">
              <SectionHeading id="m-potential" title={t("potential")} aside={<span className="inline-flex items-center gap-1"><Lock className="size-3.5" aria-hidden />{t("neverShownTo", { subject })}</span>} />
              <OptionCards
                label={t("potential")}
                value={draft.potential}
                disabled={!editable}
                onChange={draft.setPotential}
                className={cn(draft.missing?.potential && "rounded-surface ring-1 ring-destructive")}
                options={REVIEW_POTENTIALS.map((level) => ({
                  value: level,
                  label: parts(`potentialName.${level}`),
                  description: parts(`potential.${level}`),
                }))}
              />
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function PeerAnswers({ record }: { record: PerformanceReviewDto }) {
  const t = useTranslations("reviews.PeerAnswers");
  const rs = useSay("reviews.steps");
  const [all, setAll] = useState(false);
  const peers = record.peers;
  if (!peers || !peers.approved) return null;
  const answered = peers.people.filter((p) => p.state === "Answered");
  const declined = peers.people.filter((p) => p.state === "Declined");
  const questions = Array.from(new Set(answered.flatMap((p) => p.answers ?? []).map((a) => a.question)));
  const shown = all ? questions : questions.slice(0, 1);
  return (
    <section className="mt-10" aria-labelledby="m-peers">
      <SectionHeading id="m-peers" title={t("fromSPeers", { subjectDisplayName: first(record.subjectDisplayName) })} count={rs("of", { done: answered.length, total: peers.people.length })}
        aside={<span className="inline-flex items-center gap-1"><Lock className="size-3.5" aria-hidden />{t("youAndHrOnly")}</span>} />
      <div className="rounded-surface bg-card">
        {answered.length === 0 ? <p className="p-5 type-body-secondary text-muted-foreground">{t("noAnswersYet")}</p> : (
          <div className="divide-y divide-border">
            {shown.map((question) => (
              <div key={question} className="p-5">
                <p className="type-label text-foreground">{question}</p>
                <ul className="mt-2 space-y-2">
                  {answered.map((peer) => {
                    const answer = peer.answers?.find((a) => a.question === question);
                    return answer ? <li key={peer.employeeId} className="flex items-start gap-2.5"><PersonInitials name={peer.displayName} size="xs" className="mt-1" /><span className="type-narrative text-foreground">{answer.text}</span></li> : null;
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
        {questions.length > 1 ? (
          <button type="button" onClick={() => setAll(!all)} className="flex w-full items-center justify-between border-t border-border px-5 py-3 type-meta text-muted-foreground hover:text-foreground">
            <span>{all ? t("showingEveryQuestion") : (questions.length === 2 ? t("moreQuestion", { value: questions.length - 1 }) : t("moreQuestions", { value: questions.length - 1 }))}</span>
            <span className="inline-flex items-center gap-1 type-label text-foreground">{all ? t("showLess") : t("showAll")}<ChevronDown className={cn("size-4", all && "rotate-180")} aria-hidden /></span>
          </button>
        ) : null}
        {declined.map((peer) => (
          <p key={peer.employeeId} className="border-t border-border px-5 py-3 type-meta text-muted-foreground">
            <Ban className="me-1.5 inline size-3.5" aria-hidden />{t("declined", { displayName: peer.displayName })}{peer.declineNote ? `: “${peer.declineNote}”` : ""}
          </p>
        ))}
      </div>
    </section>
  );
}

// ── HR (board 14) ──────────────────────────────────────────────────────────────────

function AdministratorView({ record }: { record: PerformanceReviewDto }) {
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
        <div className="mt-10"><ReviewerView record={{ ...record, canEditManagerAssessment: false }} /></div>
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

"use client";

import { useParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { PerformanceReviewDto } from "@repo/api";
import { useRecentRecord } from "@repo/api/react";
import { cn } from "@repo/ds";
import { Button } from "@repo/ds/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ds/components/ui/popover";
import { X } from "@repo/ds/icons";
import { AsyncButton, FlowSteps, PageContainer, PageEmpty, PagePermissionNotice, PageSkeleton } from "@repo/ds/shell";
import { AvatarStack, PersonInitials } from "@repo/performance-ui";
import { useReview } from "../../api/use-reviews";
import { usePeerCommands, useReviewActions, useReviewYear } from "../../api/use-review-work";
import { RecordCycleScope, useWorkspaceContext } from "../../api/use-workspace";
import { reportPerformanceFailure } from "../../api/performance-failure";
import { ContentUnavailable } from "../content-unavailable";
import { ColleaguePicker } from "../conversations/colleague-picker";
import { dayMonth, fullDay } from "../year/year-words";
import { CalibratedOutcome } from "./calibrated-outcome";
import { AdministratorView } from "./review-admin";
import { ReviewLetter } from "./review-letter";
import { Answer, GoalGradeRow, names, planGrade, PotentialPick, Scale, gradeOf, useReviewDraftForm, type Side } from "./review-form";
import { citationNumbers, ReviewYear } from "./review-year";

/**
 * One review as a page (H3): written beside the person's year. The person's self-review opens on empty answers with a
 * draft a click away (D-68); the manager's opens drafted from the year, each sentence citing its source; the released
 * result reads like a letter (D-73). HR keeps its operational view.
 */
export function ReviewPage() {
  const t = useTranslations("reviews.Review");
  const { reviewId } = useParams<{ reviewId: string }>();
  const context = useWorkspaceContext();
  const review = useReview(reviewId, Boolean(context.data));
  useRecentRecord("performance", review.data
    ? { label: t("recent", { name: review.data.subjectDisplayName }), kind: review.data.reviewRoundName, href: `/performance/reviews/${review.data.id}` }
    : null);
  if (context.isLoading || (context.data && review.isLoading)) return <PageSkeleton rows={7} width="wide" label={t("loading")} />;
  if (context.error) return <ContentUnavailable error={context.error} onRetry={context.refetch} />;
  if (review.error) return <ContentUnavailable list="reviews" error={review.error} onRetry={review.refetch} />;
  if (!review.data) return <PagePermissionNotice title={t("unavailable")} description={t("unavailableDetail")} />;
  const record = review.data;
  return (
    <RecordCycleScope cycleId={record.cycleId}>
      <PageContainer width="wide">
        <ReviewFor record={record} />
      </PageContainer>
    </RecordCycleScope>
  );
}

function ReviewFor({ record }: { record: PerformanceReviewDto }) {
  const t = useTranslations("reviews.Review");
  if (record.lens === "Administrator") return <AdministratorView record={record} written={<WrittenReview record={record} side="manager" readOnly />} />;
  if (record.state === "Closed") return <PageEmpty headingLevel={1} title={t("closed")} description={record.closeReason ?? undefined} />;
  if (record.lens === "Subject") {
    if (record.state === "Finalized") return <ReviewLetter record={record} />;
    return <WrittenReview record={record} side="self" readOnly={!record.canEditSelfAssessment} />;
  }
  return <WrittenReview record={record} side="manager" readOnly={!record.canEditManagerAssessment} />;
}

/** The form with the year beside it, for the side writing it (or reading it once sent). */
function WrittenReview({ record, side, readOnly }: { record: PerformanceReviewDto; side: Side; readOnly: boolean }) {
  const t = useTranslations("reviews.Review");
  const locale = useLocale();
  const { subject, reviewer } = names(record);
  const self = side === "self";
  const year = useReviewYear(record.id, record.lens === "Subject" || record.lens === "Reviewer");
  const numbers = citationNumbers(year.data);
  const [cite, setCite] = useState<string | null>(null);
  const form = useReviewDraftForm(record, side);
  const goals = record.items.filter((i) => i.kind === "Objective");
  const competencies = record.items.filter((i) => i.kind === "Competency");
  const questions = record.questions.filter((q) => q.audience === (self ? "Person" : "Manager"));
  const selfIn = !record.selfAssessmentEnabled || record.state !== "SelfAssessment";
  const grade = (item: (typeof goals)[number]) => form.draft.grades[item.itemId]?.grade ?? gradeOf(item, side);

  const pick = (key: string) => {
    setCite(key);
    document.getElementById(`year-${key}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const send = () => form.send()
    .then(() => toast.success(self ? t("sentTo", { name: reviewer }) : t("reviewSent", { name: subject })))
    .catch((error) => reportPerformanceFailure(error, t("couldntSend")));

  const lastYear = record.year?.lastResult?.label;
  const pendingPeers = !self && record.peers ? record.peers.people.filter((p) => p.state === "Open").map((p) => p.displayName) : [];

  return (
    <div className="grid gap-4 pb-16">
      <ReviewHead record={record} side={side} readOnly={readOnly} onSend={send} sending={form.sending} />
      {!self && !readOnly ? <WaitingStrip record={record} /> : null}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_450px]">
        <div className="grid content-start gap-5">
          {goals.length ? (
            <section className="grid gap-3.5 rounded-surface bg-card px-6 py-[22px]">
              <div className="flex items-center gap-3">
                <h2 className="type-section-title text-foreground">{self ? t("yourGoals") : t("goals")}</h2>
                <span className="ms-auto text-sm text-muted-foreground">
                  <span className="text-[17px] font-semibold tabular-nums text-foreground">{planGrade(goals, grade).toFixed(2)}</span> {t("forTheYear")}
                </span>
              </div>
              <div>
                {goals.map((item) => (
                  <GoalGradeRow key={item.itemId} item={item} side={side} readOnly={readOnly} who={t("you")}
                    value={form.draft.grades[item.itemId] ?? null}
                    onChange={(next) => form.change((d) => ({ ...d, grades: { ...d.grades, [item.itemId]: next } }))} />
                ))}
              </div>
            </section>
          ) : null}
          {questions.length ? (
            <section className="grid gap-[22px] rounded-surface bg-card px-6 py-[22px]">
              {questions.map((q) => (
                <Answer key={q.questionId} reviewId={record.id} question={q} readOnly={readOnly} numbers={numbers} cite={cite} onCite={pick}
                  value={form.draft.answers[q.questionId] ?? { text: "", citations: [] }}
                  onChange={(next) => form.change((d) => ({ ...d, answers: { ...d.answers, [q.questionId]: next } }))}
                  draftLabel={self ? t("draftedFromYourYear") : t("draftedFromTheirYear", { name: subject })}
                  waitingLabel={!self && !selfIn ? t("draftsWhenSelfIsIn", { name: subject }) : undefined}
                  autoDraft={!self} />
              ))}
            </section>
          ) : null}
          {competencies.length ? (
            <section className="grid gap-3.5 rounded-surface bg-card px-6 py-[22px]">
              <h2 className="type-section-title text-foreground">{self ? t("howYouWorked") : t("howTheyWorked", { name: subject })}</h2>
              {competencies.map((item, index) => (
                <div key={item.itemId} className={cn("grid gap-2.5", index > 0 && "border-t border-border pt-3.5")}>
                  <div className="flex items-baseline gap-3">
                    <b className="text-sm font-semibold text-foreground">{item.title}</b>
                    {item.description ? <span className="ms-auto text-end text-[13px] text-muted-foreground">{item.description}</span> : null}
                  </div>
                  <Scale levels={record.ratingScale} label={item.title} readOnly={readOnly}
                    value={form.draft.ratings[item.itemId] ?? null}
                    onPick={(value) => form.change((d) => ({ ...d, ratings: { ...d.ratings, [item.itemId]: value } }))}
                    mine={!self && item.selfRating != null ? { value: item.selfRating, name: record.subjectDisplayName } : undefined} />
                </div>
              ))}
            </section>
          ) : null}
          <section className="grid gap-3.5 rounded-surface bg-card px-6 py-[22px]">
            <div className="flex items-center gap-3">
              <h2 className="type-section-title text-foreground">{self ? t("yourYearOverall") : t("overall")}</h2>
              <span className="ms-auto text-[13px] text-muted-foreground">
                {lastYear ? (self ? t("lastYearFrom", { name: reviewer, label: lastYear }) : t("lastYear", { label: lastYear })) : t("firstReview")}
              </span>
            </div>
            <Scale levels={record.ratingScale} label={self ? t("yourYearOverall") : t("overall")} readOnly={readOnly}
              value={form.draft.overall} onPick={(value) => form.change((d) => ({ ...d, overall: value }))}
              mine={!self && record.selfAssessment?.overallRating != null ? { value: record.selfAssessment.overallRating, name: record.subjectDisplayName } : undefined} />
            {!self && record.potentialEnabled ? (
              <div className="grid gap-2 border-t border-border pt-3.5">
                <span className="text-sm font-semibold text-foreground">{t("potential", { name: subject })}</span>
                <PotentialPick value={form.draft.potential} readOnly={readOnly} onPick={(p) => form.change((d) => ({ ...d, potential: p }))} />
              </div>
            ) : null}
          </section>
          {!self && record.calibration ? <CalibratedOutcome record={record} /> : null}
          {form.state === "saving" || form.state === "saved" ? (
            <span aria-live="polite" className="text-[13px] text-muted-foreground">{form.state === "saving" ? t("saving") : t("saved")}</span>
          ) : null}
        </div>
        <ReviewYear record={record} items={year.data} loading={year.isLoading} cite={cite} pendingPeers={pendingPeers}
          title={self ? t("yourYear") : t("theirYear", { name: subject })}
          since={t("since", { start: fullDay(record.periodStart, locale) })} />
      </div>
    </div>
  );
}

/** The person's face, whose review it is, where it stands (D-67) and the one action. */
function ReviewHead({ record, side, readOnly, onSend, sending }: {
  record: PerformanceReviewDto;
  side: Side;
  readOnly: boolean;
  onSend: () => Promise<unknown>;
  sending: boolean;
}) {
  const t = useTranslations("reviews.Review");
  const locale = useLocale();
  const actions = useReviewActions(record.id);
  const { subject, reviewer } = names(record);
  const self = side === "self";
  const schedule = record.schedule;
  const steps = [
    ...(record.selfAssessmentEnabled ? [{ key: "self", label: self ? t("steps.you") : t("steps.self", { name: subject }), detail: schedule?.selfAssessmentDue ? dayMonth(schedule.selfAssessmentDue, locale) : undefined }] : []),
    ...(record.peerInputEnabled ? [{ key: "peers", label: t("steps.peers") }] : []),
    { key: "manager", label: self ? reviewer : t("steps.you"), detail: schedule?.managerAssessmentDue ? dayMonth(schedule.managerAssessmentDue, locale) : undefined },
    { key: "results", label: t("steps.results") },
  ];
  const at = record.state === "SelfAssessment" ? "self" : record.state === "ManagerAssessment" ? "manager" : "results";
  const current = Math.max(0, steps.findIndex((s) => s.key === at));
  const job = [record.reviewRoundName, record.subjectJobTitle].filter(Boolean).join(", ");

  let action: ReactNode = null;
  if (self && !readOnly) {
    action = (
      <AsyncButton pending={sending} onClick={() => void onSend()}>
        <PersonInitials name={record.reviewerDisplayName} size="xs" className="size-[22px]" />
        {t("sendTo", { name: reviewer })}
      </AsyncButton>
    );
  } else if (self && record.canTakeBack) {
    action = (
      <AsyncButton variant="outline" pending={actions.takeBack.isLoading}
        onClick={() => void actions.takeBack.mutateAsync(undefined).then(() => toast.success(t("takenBack"))).catch((error) => reportPerformanceFailure(error, t("couldntTakeBack")))}>
        {t("takeItBack")}
      </AsyncButton>
    );
  } else if (!self && !readOnly) {
    action = (
      <AsyncButton pending={sending} disabled={record.state === "SelfAssessment"} title={record.state === "SelfAssessment" ? t("afterSelfReview", { name: subject }) : undefined}
        onClick={() => void onSend()}>
        {t("submitReview")}
      </AsyncButton>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4 pt-1">
      <PersonInitials name={record.subjectDisplayName} size="xl" className="size-[52px]" />
      <div className="grid min-w-0 gap-0.5">
        <h1 className="type-narrative text-[26px] font-medium leading-tight text-foreground">{self ? t("yourSelfReview") : record.subjectDisplayName}</h1>
        <span className="text-sm text-muted-foreground">{job}</span>
      </div>
      <div className="ms-auto flex flex-wrap items-center gap-4">
        <FlowSteps className="w-[420px] max-w-full" label={t("whereItStands")} current={current} steps={steps.map(({ label, detail }) => ({ label, detail }))} />
        {action}
      </div>
    </div>
  );
}

/**
 * What the manager's review still waits on (D-60): the self-review and the peers who haven't answered, a nudge each;
 * and who is asked, changed until the review is in (D-40).
 */
function WaitingStrip({ record }: { record: PerformanceReviewDto }) {
  const t = useTranslations("reviews.Review");
  const locale = useLocale();
  const actions = useReviewActions(record.id);
  const [nudged, setNudged] = useState<Set<string>>(new Set());
  const { subject } = names(record);
  const selfOpen = record.selfAssessmentEnabled && record.state === "SelfAssessment";
  const people = record.peers?.people ?? [];
  const open = people.filter((p) => p.state === "Open");
  const answered = people.filter((p) => p.state === "Answered").length;
  const nudge = (who: "self" | "peers") => actions.nudge.mutateAsync(who)
    .then(() => { setNudged((n) => new Set([...n, who])); toast.success(who === "self" ? t("nudgedOne", { name: subject }) : t("nudgedPeers")); })
    .catch((error) => reportPerformanceFailure(error, t("couldntNudge")));
  if (!selfOpen && !record.peerInputEnabled) return null;
  return (
    <div className="flex flex-wrap gap-2.5">
      {selfOpen ? (
        <div className="flex items-center gap-3 rounded-inset bg-card py-2.5 pe-3 ps-3.5">
          <PersonInitials name={record.subjectDisplayName} size="md" />
          <div className="grid">
            <b className="text-[13.5px] font-semibold text-foreground">{t("selfReview")}</b>
            <span className="text-[13px] text-muted-foreground">{record.schedule?.selfAssessmentDue ? t("writingDue", { day: dayMonth(record.schedule.selfAssessmentDue, locale) }) : t("writing")}</span>
          </div>
          {nudged.has("self") ? <span className="text-[13px] text-muted-foreground">{t("nudgedToday")}</span>
            : <AsyncButton size="sm" variant="outline" pending={actions.nudge.isLoading} onClick={() => void nudge("self")}>{t("nudge")}</AsyncButton>}
        </div>
      ) : null}
      {record.peerInputEnabled ? (
        <div className="flex items-center gap-3 rounded-inset bg-card py-2.5 pe-3 ps-3.5">
          {open.length ? <AvatarStack names={open.map((p) => p.displayName)} size="md" max={3} /> : people.length ? <AvatarStack names={people.map((p) => p.displayName)} size="md" max={3} /> : null}
          <div className="grid">
            <b className="text-[13.5px] font-semibold text-foreground">{t("peersAnswered", { answered, count: people.length })}</b>
            <span className="max-w-64 truncate text-[13px] text-muted-foreground">{open.length ? open.map((p) => p.displayName).join(", ") : people.length ? t("allAnswered") : t("nobodyAsked")}</span>
          </div>
          {open.length && !nudged.has("peers") ? <AsyncButton size="sm" variant="outline" pending={actions.nudge.isLoading} onClick={() => void nudge("peers")}>{t("nudgeThem")}</AsyncButton> : null}
          {nudged.has("peers") ? <span className="text-[13px] text-muted-foreground">{t("nudgedToday")}</span> : null}
          {record.canChangePeers ? <ChangePeers record={record} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Who is asked, as the manager changes it (D-40): Fusion's picks to start, up to five. */
function ChangePeers({ record }: { record: PerformanceReviewDto }) {
  const t = useTranslations("reviews.Review");
  const commands = usePeerCommands(record.id);
  const [open, setOpen] = useState(false);
  const people = record.peers?.people ?? [];
  const done = (state: string | null) => state === "Answered" || state === "Declined";
  const save = (ids: string[]) => commands.change.mutateAsync({ ids, version: record.version })
    .catch((error) => reportPerformanceFailure(error, t("couldntChangePeers")));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button size="sm" variant="ghost">{t("changeWho")}</Button></PopoverTrigger>
      <PopoverContent align="end" className="grid w-80 gap-3 p-4">
        <span className="text-sm font-semibold text-foreground">{t("whoIsAsked")}</span>
        <div className="grid gap-1.5">
          {people.map((p) => (
            <div key={p.employeeId} className="flex items-center gap-2.5">
              <PersonInitials name={p.displayName} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{p.displayName}</span>
              {p.source === "Fusion" ? <span className="text-xs text-muted-foreground">{t("pickedByFusion")}</span> : null}
              {done(p.state) ? <span className="text-xs text-muted-foreground">{p.state === "Answered" ? t("answered") : t("declined")}</span> : (
                <button type="button" aria-label={t("remove", { name: p.displayName })} className="text-muted-foreground hover:text-foreground"
                  onClick={() => void save(people.filter((x) => x.employeeId !== p.employeeId).map((x) => x.employeeId))}>
                  <X aria-hidden className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>
        {people.length < 5 ? (
          <ColleaguePicker value={null} placeholder={t("addSomeone")}
            exclude={[...people.map((p) => p.employeeId), record.subjectEmployeeId, record.reviewerEmployeeId]}
            onChange={(person) => void save([...people.map((p) => p.employeeId), person.employeeId])} />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}


"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type {
  PerformanceReviewDto,
  RatingScaleLevelDto,
  ReviewAnswerInput,
  ReviewCitation,
  ReviewItemAssessmentDto,
  ReviewItemResponseInput,
  ReviewPotential,
} from "@repo/api";
import { REVIEW_POTENTIALS } from "@repo/api";
import { cn } from "@repo/ds";
import { Button } from "@repo/ds/components/ui/button";
import { Input } from "@repo/ds/components/ui/input";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { Textarea } from "@repo/ds/components/ui/textarea";
import { Measurement, Pencil, Sparkles } from "@repo/ds/icons";
import { PersonInitials } from "@repo/performance-ui";
import { useReviewsApi } from "../../api/use-review-work";
import { useReviewAssessmentMutations } from "../../api/use-reviews";
import { useWorkspaceContext } from "../../api/use-workspace";
import { reportPerformanceFailure } from "../../api/performance-failure";
import { firstName } from "../year/year-words";

export type Side = "self" | "manager";

interface AnswerState { text: string; citations: ReviewCitation[] }
interface GradeState { grade: number; reason: string }

/** The side's goal grade: changed by hand with a reason (D-38), else the measure's. */
export function gradeOf(item: ReviewItemAssessmentDto, side: Side): number {
  return (side === "self" ? item.selfGrade : item.managerGrade) ?? item.grade ?? 0;
}

/** The plan's grade: goals' grades by their weights (shared evenly when none is set), D-25. */
export function planGrade(goals: readonly ReviewItemAssessmentDto[], grade: (item: ReviewItemAssessmentDto) => number): number {
  if (goals.length === 0) return 0;
  const weights = goals.map((g) => g.weight ?? 0);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return goals.reduce((sum, g) => sum + grade(g), 0) / goals.length;
  return goals.reduce((sum, g, i) => sum + grade(g) * weights[i]!, 0) / total;
}

/** The measure's words behind the grade's icon (D-51): "66 % of 85 %", "2 of 3 milestones done", "71 %". */
export function useMeasureWords() {
  const t = useTranslations("reviews.Form");
  return (item: ReviewItemAssessmentDto) => {
    const m = item.measurement;
    if (m?.method === "WeightedMilestones") return t("milestonesDone", { done: m.milestones.filter((x) => x.isCompleted).length, count: m.milestones.length });
    if (m?.method === "NumericTarget" && m.target != null) return t("valueOfTarget", { value: item.currentActual ?? m.baseline ?? 0, target: m.target, unit: m.unit ?? "" });
    return t("percent", { value: Math.round(item.progress ?? 0) });
  };
}

/** A goal's grade as the number alone, with a small measure icon whose tooltip carries the measure's words (D-51). */
export function Grade({ value, words, size = "md" }: { value: number; words: string; size?: "md" | "lg" }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("font-semibold tabular-nums tracking-[-0.01em] text-foreground", size === "lg" ? "text-[30px]" : "text-[22px]")}>{value.toFixed(2)}</span>
      <span tabIndex={0} role="img" aria-label={words} title={words}
        className="inline-grid size-6 cursor-help place-items-center rounded-lg text-muted-foreground outline-none hover:bg-inlay hover:text-foreground focus-visible:bg-inlay">
        <Measurement aria-hidden className="size-4" />
      </span>
    </span>
  );
}

/** The scale as five pills; the person's own pick marked with their face (the manager's form). */
export function Scale({ levels, value, onPick, label, readOnly, mine }: {
  levels: RatingScaleLevelDto[];
  value: number | null;
  onPick: (value: number) => void;
  label: string;
  readOnly?: boolean;
  mine?: { value: number | null; name: string };
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {levels.map((level) => (
        <button key={level.value} type="button" aria-pressed={value === level.value} disabled={readOnly}
          onClick={() => onPick(level.value)}
          className={cn("relative rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-default",
            value === level.value ? "bg-primary font-semibold text-primary-foreground" : "bg-inlay text-foreground enabled:hover:bg-foreground/[0.08]")}>
          {level.label}
          {mine && mine.value === level.value ? (
            <span className="absolute -end-1 -top-[7px]" title={mine.name}><PersonInitials name={mine.name} size="xs" className="size-4 text-[8px]" /></span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** What the form holds while it's being written; saved a moment after each change. */
interface Draft {
  answers: Record<string, AnswerState>;
  grades: Record<string, GradeState | null>;
  ratings: Record<string, number | null>;
  overall: number | null;
  potential: ReviewPotential | null;
}

function initial(record: PerformanceReviewDto, side: Side): Draft {
  const own = side === "self" ? "Person" : "Manager";
  const answers: Record<string, AnswerState> = {};
  for (const q of record.questions.filter((q) => q.audience === own)) {
    const text = (side === "self" ? q.selfAnswer : q.managerAnswer) ?? "";
    answers[q.questionId] = { text, citations: side === "self" ? q.selfCitations ?? [] : q.managerCitations ?? [] };
  }
  const grades: Record<string, GradeState | null> = {};
  const ratings: Record<string, number | null> = {};
  for (const item of record.items) {
    if (item.kind === "Objective") {
      const grade = side === "self" ? item.selfGrade : item.managerGrade;
      const reason = side === "self" ? item.selfGradeReason : item.managerGradeReason;
      grades[item.itemId] = grade != null ? { grade, reason: reason ?? "" } : null;
    } else ratings[item.itemId] = (side === "self" ? item.selfRating : item.managerRating) ?? null;
  }
  const assessment = side === "self" ? record.selfAssessment : record.managerAssessment;
  return { answers, grades, ratings, overall: assessment?.overallRating ?? null, potential: side === "manager" ? record.potential : null };
}

/**
 * One side's review being written (H3): saved a moment after each change, then sent. The words are the round's questions;
 * goals carry their measure's grade; competencies and the overall view on the company's scale.
 */
export function useReviewDraftForm(record: PerformanceReviewDto, side: Side) {
  const t = useTranslations("reviews.Form");
  const mutations = useReviewAssessmentMutations(record.id, record.cycleId);
  const [draft, setDraft] = useState<Draft>(() => initial(record, side));
  const version = useRef(record.version);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<unknown> | null>(null);
  const latest = useRef(draft);
  latest.current = draft;
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  useEffect(() => { version.current = record.version; }, [record.version]);

  const request = useCallback(() => {
    const d = latest.current;
    const items: ReviewItemResponseInput[] = record.items.map((item) => item.kind === "Objective"
      ? { kind: item.kind, itemId: item.itemId, grade: d.grades[item.itemId]?.grade ?? null, gradeReason: d.grades[item.itemId]?.reason ?? null }
      : { kind: item.kind, itemId: item.itemId, rating: d.ratings[item.itemId] ?? null });
    const answers: ReviewAnswerInput[] = Object.entries(d.answers).map(([questionId, a]) => ({
      questionId, text: a.text.trim() ? a.text.trim() : null, citations: a.citations.length ? a.citations : null,
    }));
    return { expectedVersion: version.current, summary: "", overallRating: d.overall, items, answers, potential: d.potential };
  }, [record.items]);

  const save = useCallback(async () => {
    if (saving.current) await saving.current.catch(() => undefined);
    setState("saving");
    const run = (side === "self" ? mutations.saveSelf.mutateAsync(request()) : mutations.saveManager.mutateAsync(request()))
      .then((result) => { version.current = result.version; setState("saved"); })
      .catch((error) => { setState("failed"); reportPerformanceFailure(error, t("couldntSave")); });
    saving.current = run;
    await run;
  }, [mutations.saveManager, mutations.saveSelf, request, side, t]);

  const change = useCallback((update: (d: Draft) => Draft) => {
    setDraft((d) => {
      const next = update(d);
      latest.current = next;
      return next;
    });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 700);
  }, [save]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const send = async () => {
    if (timer.current) clearTimeout(timer.current);
    if (saving.current) await saving.current.catch(() => undefined);
    const input = request();
    return side === "self" ? mutations.submitSelf.mutateAsync(input) : mutations.submitManager.mutateAsync(input);
  };
  const sending = side === "self" ? mutations.submitSelf.isLoading : mutations.submitManager.isLoading;
  return { draft, change, send, sending, state };
}

/** One of the round's questions: the person's or manager's words, drafted from the year with each sentence's source. */
export function Answer({ question, value, onChange, readOnly, numbers, cite, onCite, draftLabel, waitingLabel, autoDraft, reviewId }: {
  question: { questionId: string; text: string };
  value: AnswerState;
  onChange: (next: AnswerState) => void;
  readOnly: boolean;
  numbers: Map<string, number>;
  cite: string | null;
  onCite: (key: string) => void;
  /** "Drafted from your year" / "Drafted from Aicha's year". */
  draftLabel: string;
  /** Said where a draft has nothing to draw from yet (D-60). */
  waitingLabel?: string;
  /** The manager's review opens drafted (H3); the person's on empty answers with a draft a click away (D-68). */
  autoDraft: boolean;
  reviewId: string;
}) {
  const t = useTranslations("reviews.Form");
  const reviews = useReviewsApi();
  const context = useWorkspaceContext();
  const ai = context.data?.capabilities.aiAssistance === true;
  const [editing, setEditing] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [abstained, setAbstained] = useState(false);
  const tried = useRef(false);
  const cited = value.citations.length > 0;
  const empty = !value.text.trim();

  const draft = useCallback(async () => {
    setDrafting(true);
    try {
      const result = await reviews.draft(reviewId, "Question", question.questionId);
      if (result.outcome === "Abstained" || result.sentences.length === 0) { setAbstained(true); return; }
      const citations = result.sentences.map((s) => ({ text: s.text.trim(), key: s.sources[0]?.key ?? "" })).filter((c) => c.key);
      onChange({ text: citations.map((c) => c.text).join(" "), citations });
    } catch {
      setAbstained(true);
    } finally {
      setDrafting(false);
    }
  }, [onChange, question.questionId, reviewId, reviews]);

  useEffect(() => {
    if (autoDraft && ai && empty && !readOnly && !tried.current) {
      tried.current = true;
      void draft();
    }
  }, [ai, autoDraft, draft, empty, readOnly]);

  let right: ReactNode = null;
  if (editing) right = <Button size="sm" variant="outline" onClick={() => setEditing(false)}>{t("done")}</Button>;
  else if (!empty) {
    right = (
      <>
        {cited ? <span className="inline-flex items-center gap-1 text-xs font-medium text-primary-ink"><Sparkles aria-hidden className="size-3.5" />{draftLabel}</span>
          : <span className="text-xs text-muted-foreground">{t("yourWords")}</span>}
        {readOnly ? null : (
          <button type="button" className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary-ink hover:underline" onClick={() => setEditing(true)}>
            <Pencil aria-hidden className="size-3.5" />{t("edit")}
          </button>
        )}
      </>
    );
  } else if (!readOnly && ai && !drafting && !(autoDraft && abstained && waitingLabel)) {
    right = (
      <Button size="sm" variant="outline" onClick={() => void draft()}>
        <Sparkles aria-hidden className="size-[15px]" />{t("draftFromYear")}
      </Button>
    );
  } else if (empty && waitingLabel && abstained) {
    right = <span className="inline-flex items-center gap-1 text-xs font-medium text-primary-ink"><Sparkles aria-hidden className="size-3.5" />{waitingLabel}</span>;
  }

  let body: ReactNode;
  if (drafting) {
    body = (
      <div className="grid gap-2 rounded-inset bg-inlay px-4 py-3.5" aria-label={t("drafting")}>
        <Skeleton className="h-4 w-11/12" /><Skeleton className="h-4 w-10/12" /><Skeleton className="h-4 w-7/12" />
      </div>
    );
  } else if (editing || (empty && !readOnly)) {
    body = (
      <Textarea aria-label={question.text} placeholder={t("yourWordsPlaceholder")} rows={editing ? 5 : 4} autoFocus={editing}
        className="type-narrative min-h-24 resize-y text-[15.5px] leading-normal"
        value={value.text}
        onChange={(event) => onChange({ text: event.target.value, citations: [] })} />
    );
  } else if (cited) {
    body = (
      <div className="type-narrative rounded-inset bg-inlay px-4 py-3.5 text-[15.5px] leading-normal text-foreground">
        {value.citations.map((c, i) => {
          const n = numbers.get(c.key);
          return (
            <span key={i}>
              <span role="button" tabIndex={0} onClick={() => onCite(c.key)} onKeyDown={(e) => { if (e.key === "Enter") onCite(c.key); }}
                className={cn("cursor-pointer rounded-md transition-colors hover:bg-primary/[0.18]", cite === c.key && "bg-primary/[0.18]")}>
                {/* The number stays with the sentence's last word, never wrapping onto the next line. */}
                {c.text.slice(0, c.text.lastIndexOf(" ") + 1)}
                <span className="whitespace-nowrap">
                  {c.text.slice(c.text.lastIndexOf(" ") + 1)}
                  {n ? <span className="ms-[3px] inline-flex h-[18px] min-w-[18px] -translate-y-0.5 items-center justify-center rounded-md bg-card px-[5px] font-sans text-[11px] font-semibold text-muted-foreground">{n}</span> : null}
                </span>
              </span>{" "}
            </span>
          );
        })}
      </div>
    );
  } else if (!empty) {
    body = <div className="type-narrative whitespace-pre-line rounded-inset bg-inlay px-4 py-3.5 text-[15.5px] leading-normal text-foreground">{value.text}</div>;
  } else {
    body = <div className="rounded-inset bg-inlay px-4 py-3.5 text-sm text-muted-foreground">{t("noAnswer")}</div>;
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-3">
        <span className="type-narrative text-base font-medium text-foreground">{question.text}</span>
        <span className="ms-auto flex shrink-0 items-center gap-3">{right}</span>
      </div>
      {body}
    </div>
  );
}

/** A goal in the review: its measure's grade, changed only with a short reason (D-38). */
export function GoalGradeRow({ item, side, value, onChange, readOnly, who }: {
  item: ReviewItemAssessmentDto;
  side: Side;
  value: GradeState | null;
  onChange: (next: GradeState | null) => void;
  readOnly: boolean;
  /** Who changed it, for the line under the goal. */
  who: string;
}) {
  const t = useTranslations("reviews.Form");
  const words = useMeasureWords();
  const [editing, setEditing] = useState(false);
  const [grade, setGrade] = useState((value?.grade ?? item.grade ?? 0).toFixed(2));
  const [reason, setReason] = useState(value?.reason ?? "");
  const shown = value?.grade ?? item.grade ?? 0;
  const number = Number(grade);
  const valid = Number.isFinite(number) && number >= 0 && number <= 1 && reason.trim().length > 0;
  void side;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-[22px] gap-y-1.5 border-t border-border px-1 py-3.5 first:border-t-0">
      <div className="grid min-w-0 gap-0.5">
        <span className="type-narrative text-[15.5px] font-medium text-foreground">{item.title}</span>
        {item.measurementSummary ? <span className="text-[13px] text-muted-foreground">{item.measurementSummary}</span> : null}
        {editing ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Input type="number" step="0.05" min={0} max={1} aria-label={t("grade")} className="h-8 w-20" value={grade} onChange={(e) => setGrade(e.target.value)} />
            <Input aria-label={t("why")} placeholder={t("why")} className="h-8 min-w-48 flex-1" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button size="sm" disabled={!valid} onClick={() => { onChange({ grade: Math.round(number * 100) / 100, reason: reason.trim() }); setEditing(false); }}>{t("change")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>{t("cancel")}</Button>
          </div>
        ) : value ? (
          <span className="text-[13px] text-primary-ink">{t("changedBy", { who, reason: value.reason })}</span>
        ) : null}
      </div>
      <div className="grid justify-items-end gap-0.5">
        <Grade value={shown} words={words(item)} />
        <div className="flex items-center gap-2.5">
          {value ? (
            readOnly ? null : <button type="button" className="text-[12.5px] font-semibold text-primary-ink hover:underline" onClick={() => onChange(null)}>{t("useTheMeasure")}</button>
          ) : <span className="text-xs text-muted-foreground">{t("fromTheMeasure")}</span>}
          {readOnly || editing ? null : (
            <button type="button" className="text-[12.5px] font-semibold text-primary-ink hover:underline" onClick={() => setEditing(true)}>{t("change")}</button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The manager's potential, when the round asks for it (never shown to the person, D-24). */
export function PotentialPick({ value, onPick, readOnly }: { value: ReviewPotential | null; onPick: (p: ReviewPotential) => void; readOnly: boolean }) {
  const t = useTranslations("reviews.Form");
  return (
    <div role="group" aria-label={t("potential")} className="flex flex-wrap gap-1.5">
      {REVIEW_POTENTIALS.map((p) => (
        <button key={p} type="button" aria-pressed={value === p} disabled={readOnly} onClick={() => onPick(p)}
          className={cn("rounded-full px-3 py-1.5 text-[13px] font-medium", value === p ? "bg-primary font-semibold text-primary-foreground" : "bg-inlay text-foreground enabled:hover:bg-foreground/[0.08]")}>
          {t(`potentials.${p}`)}
        </button>
      ))}
    </div>
  );
}

/** The two people of a review by first name, for the form's words. */
export function names(record: PerformanceReviewDto) {
  return { subject: firstName(record.subjectDisplayName), reviewer: firstName(record.reviewerDisplayName) };
}

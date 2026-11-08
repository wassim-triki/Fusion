"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewDraftDto, ReviewDraftKind, ReviewDraftSourceDto } from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ds/components/ui/popover";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { cn } from "@repo/ds/lib/utils";
import { ArrowRight, FeedbackIcon, FileText, Lock, OneOnOnes, RefreshCw, RotateCcw, Sparkles, Star, Target, Users, X } from "@/lib/icons";
import { useReviewsApi } from "../../api/use-review-work";
import { useWorkspaceContext } from "../../api/use-workspace";
import { useTranslations } from "next-intl";

type DraftState =
  | { kind: "idle" }
  | { kind: "drafting" }
  | { kind: "ready"; draft: ReviewDraftDto }
  | { kind: "abstained" }
  | { kind: "inserted"; previous: string }
  | { kind: "hidden" };

/**
 * One AI draft for a review being written (D-26 to D-28): on request, one call at a time. Any failure hides it for the
 * rest of the visit, quietly. Nothing is stored; inserting fills the field the person saves.
 */
export function useReviewDraft(reviewId: string, kind: ReviewDraftKind, questionId?: string) {
  const reviews = useReviewsApi();
  const context = useWorkspaceContext();
  const available = context.data?.capabilities.aiAssistance === true;
  const [state, setState] = useState<DraftState>({ kind: "idle" });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setState({ kind: "drafting" });
    try {
      const draft = await reviews.draft(reviewId, kind, questionId);
      if (current.signal.aborted) return;
      setState(draft.outcome === "Abstained" || draft.sentences.length === 0 ? { kind: "abstained" } : { kind: "ready", draft });
    } catch {
      if (!current.signal.aborted) setState({ kind: "hidden" });
    }
  }, [reviews, reviewId, kind, questionId]);

  return { available: available && state.kind !== "hidden", state, setState, run };
}

const KIND_ICON: Record<string, typeof Target> = {
  objective: Target, evidence: FileText, feedback: FeedbackIcon, praise: Star, "one-on-one": OneOnOnes, "private-note": Lock, peer: Users,
};

const KINDS = ["objective", "evidence", "feedback", "praise", "one-on-one", "private-note", "peer"];

/**
 * Boards 12, 13 and 16. `lens` decides the voice of the copy: the manager drafts about the person, the person starts
 * from their own year. `onInsert` receives plain text; chips and the AI mark never reach the record.
 */
export function ReviewDraftBlock({ reviewId, kind = "Summary", questionId, lens, subject, value, onInsert, className }: {
  reviewId: string;
  kind?: ReviewDraftKind;
  questionId?: string;
  lens: "manager" | "self";
  subject: string;
  value: string;
  onInsert: (text: string) => void;
  className?: string;
}) {
  const t = useTranslations("reviews.ReviewDraftBlock");
  const { available, state, setState, run } = useReviewDraft(reviewId, kind, questionId);
  if (!available) return null;
  const title = lens === "self" ? t("startFromYourYear") : kind === "Question" ? t("draftAnAnswer") : t("draftFromSYear", { subject });

  if (state.kind === "idle") {
    return (
      <Button writes type="button" variant="ghost" size="sm" className={cn("h-8 gap-1.5 px-2 text-primary-ink hover:text-primary-ink", className)} onClick={() => void run()}>
        <Sparkles className="size-3.5" aria-hidden />{kind === "Question" ? t("draft") : title}
      </Button>
    );
  }
  if (state.kind === "inserted") {
    return (
      <p className={cn("flex items-center gap-2 type-meta text-muted-foreground", className)} role="status">
        <Sparkles className="size-3.5 text-primary-ink" aria-hidden />{t("insertedItsYoursToEdit")}
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => { onInsert(state.previous); setState({ kind: "idle" }); }}>
          <RotateCcw className="size-3.5" aria-hidden />{t("undo")}
        </Button>
      </p>
    );
  }
  const insert = (draft: ReviewDraftDto) => {
    const text = draft.sentences.map((sentence) => sentence.text).join(" ");
    onInsert(value.trim() ? `${value.trimEnd()}\n\n${text}` : text);
    setState({ kind: "inserted", previous: value });
  };
  return (
    <section aria-label={title} className={cn("overflow-hidden rounded-surface border border-border bg-inlay", className)}>
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary-ink"><Sparkles className="size-4" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="type-label text-foreground">{title}</p>
          <p className="type-meta text-muted-foreground">
            {state.kind === "ready" ? (lens === "self" ? t("sourcesYouCanSee", { count: state.draft.sourceCount }) : t("sources", { count: state.draft.sourceCount }))
              : state.kind === "abstained" ? t("tooLittleToDraftFrom") : t("drafting")}
          </p>
        </div>
        {state.kind === "ready" ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => void run()}><RefreshCw className="size-3.5" aria-hidden />{t("regenerate")}</Button>
        ) : null}
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("closeTheDraft")} onClick={() => setState({ kind: "idle" })}><X className="size-4" aria-hidden /></Button>
      </div>
      {state.kind === "drafting" ? (
        <div className="space-y-2 px-4 pb-4" role="status" aria-label={t("drafting")}>
          <Skeleton className="h-4 w-11/12" /><Skeleton className="h-4 w-10/12" /><Skeleton className="h-4 w-8/12" />
        </div>
      ) : null}
      {state.kind === "ready" ? (
        <ReadyDraft draft={state.draft} lens={lens} subject={subject} onDiscard={() => setState({ kind: "idle" })} onInsert={() => insert(state.draft)} />
      ) : null}
    </section>
  );
}

function ReadyDraft({ draft, lens, subject, onDiscard, onInsert }: {
  draft: ReviewDraftDto; lens: "manager" | "self"; subject: string; onDiscard: () => void; onInsert: () => void;
}) {
  const t = useTranslations("reviews.ReadyDraft");
  return (
    <>
      <div className="space-y-3 border-t border-border px-4 py-4">
        {draft.sentences.map((sentence, index) => (
          <p key={index} className="type-narrative text-foreground">
            {sentence.text}
            {sentence.sources.map((source, chip) => <SourceChip key={chip} source={source} subject={subject} />)}
          </p>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
        <p className="flex-1 type-meta text-muted-foreground">
          {draft.privateSentenceCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-warning">
              <Lock className="size-3.5" aria-hidden />
              {draft.privateSentenceCount} {draft.privateSentenceCount === 1 ? t("sentenceUses") : t("sentencesUse")} {t("sourcesCantSee", { subject })}
            </span>
          ) : sourceKinds(draft, (kind) => t(`kind.${kind}` as "kind.peer"))}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onDiscard}>{t("discard")}</Button>
        <Button type="button" size="sm" onClick={onInsert}>{lens === "self" ? t("useAsMyStartingPoint") : t("insert")}</Button>
      </div>
    </>
  );
}

function sourceKinds(draft: ReviewDraftDto, say: (kind: string) => string): string {
  const words = draft.sourceKinds.map((kind) => (KINDS.includes(kind) ? say(kind) : kind));
  return words.length ? words.join(", ").replace(/^./, (letter) => letter.toUpperCase()) : "";
}

function SourceChip({ source, subject }: { source: ReviewDraftSourceDto; subject: string }) {
  const t = useTranslations("reviews.SourceChip");
  const Icon = KIND_ICON[source.kind] ?? FileText;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn("ms-1.5 inline-flex max-w-[16rem] items-center gap-1 rounded-full px-2 py-0.5 align-middle type-meta-strong transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          source.subjectVisible ? "bg-card text-muted-foreground hover:text-foreground" : "border border-dashed border-warning text-warning")}
          aria-label={source.subjectVisible ? source.label : t("notVisible", { label: source.label, subject })}>
          {source.subjectVisible ? <Icon className="size-3 shrink-0" aria-hidden /> : <Lock className="size-3 shrink-0" aria-hidden />}
          <span className="truncate">{source.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3" align="start">
        <p className="flex items-center gap-2 type-label text-foreground"><Icon className="size-4 text-muted-foreground" aria-hidden />{source.label}</p>
        {!source.subjectVisible ? <p className="inline-flex items-center gap-1.5 type-meta text-warning"><Lock className="size-3.5" aria-hidden />{t("cantSeeThis", { subject })}</p> : null}
        <p className="type-body-secondary text-foreground">{source.excerpt}</p>
        {source.path ? (
          <div className="flex justify-end">
            <Button asChild variant="ghost" size="sm"><Link href={source.path.replace(/^\/performance/, "")}>{t("open")}<ArrowRight className="size-3.5" aria-hidden /></Link></Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

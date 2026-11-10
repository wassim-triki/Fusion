"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import type { PeerRequestDto } from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { Textarea } from "@repo/ds/components/ui/textarea";
import { AsyncButton, PageContainer, PageHeader, PageSkeleton, StatusBadge } from "@repo/ds/shell";
import { PersonInitials } from "@repo/performance-ui";
import { Ban, Eye, Lock, Send } from "@repo/ds/icons";
import { usePeerRequest, usePeerRequestCommands } from "../../api/use-review-work";
import { ContentUnavailable } from "../content-unavailable";
import { DueChip, dayLabel } from "./review-parts";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";
import { reportPerformanceFailure } from "@/features/performance/api/performance-failure";

/**
 * A colleague's input on someone's review (R4b, board 11): one column, the questions as a page, who reads the answers.
 * Answers save as you write and lock once sent; declining takes an optional note.
 */
export function PeerRequestPage() {
  const t = useTranslations("reviews.PeerRequestPage");
  const { requestId } = useParams<{ requestId: string }>();
  const query = usePeerRequest(requestId);
  if (query.error) return <ContentUnavailable list="reviews" error={query.error} onRetry={query.refetch} />;
  if (!query.data) return <PageSkeleton rows={5} label={t("loadingTheRequest")} />;
  return <PeerRequestForm request={query.data} />;
}

function PeerRequestForm({ request }: { request: PeerRequestDto }) {
  const format = useFormat();
  const t = useTranslations("reviews.PeerRequestForm");
  const router = useRouter();
  const commands = usePeerRequestCommands(request.id);
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(request.questions.map((q) => [q.questionId, q.answer ?? ""])));
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const dirty = useRef(false);
  const first = request.subjectDisplayName.split(" ")[0] ?? request.subjectDisplayName;
  const editable = request.canAnswer;

  // Autosave a moment after typing stops.
  useEffect(() => {
    if (!editable || !dirty.current) return;
    const timer = setTimeout(() => {
      dirty.current = false;
      commands.save.mutateAsync(Object.entries(answers).map(([questionId, text]) => ({ questionId, text })))
        .then(() => setSavedAt(new Date())).catch(() => undefined);
    }, 900);
    return () => clearTimeout(timer);
  }, [answers, editable, commands.save]);

  const send = async () => {
    const empty = request.questions.filter((q) => !answers[q.questionId]?.trim()).map((q) => q.questionId);
    setMissing(empty);
    if (empty.length) return;
    try {
      await commands.send.mutateAsync(Object.entries(answers).map(([questionId, text]) => ({ questionId, text })));
      toast.success(t("yourInputForWasSent", { first }));
      router.push("/reviews");
    } catch (error) {
      reportPerformanceFailure(error, t("yourInputCouldntBeSent"));
    }
  };

  const decline = async () => {
    try {
      await commands.decline.mutateAsync(note.trim() || null);
      toast.success(t("youDeclinedThisRequest"));
      router.push("/reviews");
    } catch (error) {
      reportPerformanceFailure(error, t("theRequestCouldntBeDeclined"));
    }
  };

  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl">
        <PageHeader className="mb-4"
          back={{ href: "/reviews", label: t("reviews") }}
          leading={<PersonInitials name={request.subjectDisplayName} size="xl" />}
          eyebrow={<span className="type-meta text-muted-foreground">{t("inputForA", { toLowerCase: request.reviewRoundName.toLowerCase() })}</span>}
          title={request.subjectDisplayName}
          actions={request.state === "Open" ? <DueChip date={request.dueDate} late={request.daysLate > 0} label={t("due", { dueDate: dayLabel(request.dueDate, format.locale) })} />
            : <StatusBadge tone={request.state === "Answered" ? "success" : "muted"} dot>{request.state === "Answered" ? t("sent") : request.state}</StatusBadge>}
        />

        <div className="flex flex-wrap items-center gap-3 rounded-surface bg-card px-4 py-3">
          <Eye className="size-4 text-muted-foreground" aria-hidden />
          <span className="type-label text-foreground">{t("readBy")}</span>
          <span className="ms-auto flex flex-wrap items-center gap-3">
            <span className="type-body text-foreground">{t("sReviewer", { first })}</span>
            <span className="type-body text-foreground">{t("hr")}</span>
            <span className="inline-flex items-center gap-1 type-meta text-muted-foreground"><Lock className="size-3.5" aria-hidden />{t("not", { first })}</span>
          </span>
        </div>

        {request.state === "Declined" ? (
          <p className="mt-8 type-body-secondary text-muted-foreground">{t("youDeclinedThisRequest2")}{request.declineNote ? `: “${request.declineNote}”` : "."}</p>
        ) : request.state === "Closed" ? (
          <p className="mt-8 type-body-secondary text-muted-foreground">{t("sReviewMovedOnBefore", { first })}</p>
        ) : null}

        {request.state !== "Declined" ? (
          <ol className="mt-8 space-y-8">
            {request.questions.map((question, index) => (
              <li key={question.questionId}>
                <p className="type-meta text-muted-foreground">{t("of", { value: index + 1, length: request.questions.length })}</p>
                <label htmlFor={`answer-${question.questionId}`} className="mt-1.5 block type-subsection-title text-foreground">{question.text}</label>
                <Textarea
                  id={`answer-${question.questionId}`}
                  className="mt-3 min-h-28 type-narrative"
                  maxLength={2000}
                  readOnly={!editable}
                  placeholder={editable ? t("writeYourAnswer") : undefined}
                  aria-invalid={missing.includes(question.questionId) || undefined}
                  value={answers[question.questionId] ?? ""}
                  onChange={(event) => {
                    dirty.current = true;
                    setMissing((current) => current.filter((id) => id !== question.questionId));
                    setAnswers((current) => ({ ...current, [question.questionId]: event.target.value }));
                  }}
                />
                {missing.includes(question.questionId) ? <p className="mt-1.5 type-meta text-destructive">{t("answerThisQuestionBeforeSending")}</p> : null}
              </li>
            ))}
          </ol>
        ) : null}

        {editable ? (
          <div className="mt-8 border-t border-border pt-5">
            {declining ? (
              <div className="space-y-3">
                <label htmlFor="decline-note" className="type-label text-foreground">{t("whyYoureDecliningOptional")}</label>
                <Textarea id="decline-note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)}
                  placeholder={t("haventWorkedWithSinceMarch", { first })} />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setDeclining(false)}>{t("keepAnswering")}</Button>
                  <AsyncButton variant="outline" pending={commands.decline.isLoading} onClick={() => void decline()}>{t("declineRequest")}</AsyncButton>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="ghost" onClick={() => setDeclining(true)}><Ban className="size-4" aria-hidden />{t("decline")}</Button>
                <span className="ms-auto type-meta text-muted-foreground">
                  {commands.save.isLoading ? t("saving") : savedAt ? t("saved", { savedAt: format.time(savedAt) }) : null}
                </span>
                <AsyncButton pending={commands.send.isLoading} onClick={() => void send()}><Send className="size-4" aria-hidden />{t("sendInput")}</AsyncButton>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </PageContainer>
  );
}

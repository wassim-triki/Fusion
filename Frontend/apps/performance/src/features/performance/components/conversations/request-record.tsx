"use client";

import { useState } from "react";
import { newClientId, type FeedbackInviteeDto, type FeedbackRequestDto } from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { Input } from "@repo/ds/components/ui/input";
import { Label } from "@repo/ds/components/ui/label";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { Textarea } from "@repo/ds/components/ui/textarea";
import { AsyncButton, PageContainer, PageHeader, StatusBadge } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { PersonInitials } from "@repo/performance-ui";
import { Check, Eye, Send } from "@/lib/icons";
import { useFeedbackRequest, useFeedbackRequestCommands } from "../../api/use-conversations";
import { formatDay } from "../one-on-ones/one-on-one-lib";
import { ContentUnavailable } from "../content-unavailable";
import { FEEDBACK_MAX } from "./composers";
import { DueBlock, SubjectChip, firstName } from "./conversation-parts";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";

/**
 * R8, one feedback request (S-03, D-13). The question is the page. The requester (and their manager or HR) see who
 * was asked and where each stands, then the answers as quotes; an invitee answers on a page of their own, or
 * declines. The due date is shown, never enforced.
 */
export function RequestRecord({ requestId }: { requestId: string }) {
  const t = useTranslations("conversations.RequestRecord");
  const query = useFeedbackRequest(requestId);
  if (query.error) return <ContentUnavailable error={query.error} onRetry={query.refetch} subject={t("thisRequest")} />;
  if (!query.data) return <RequestSkeleton />;
  return <RequestView request={query.data} />;
}

function RequestView({ request }: { request: FeedbackRequestDto }) {
  const format = useFormat();
  const t = useTranslations("conversations.RequestView");
  const commands = useFeedbackRequestCommands(request.id);
  const invitee = request.viewerRole === "Invitee";
  const open = request.state === "Open";
  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl">
        <PageHeader className="mb-4"
          back={{ href: "/feedback?tab=requests", label: t("requests") }}
          eyebrow={
            invitee ? (
              <span className="mb-3 flex items-center gap-3">
                <PersonInitials name={request.requester.name} size="lg" />
                <span className="min-w-0">
                  <span className="block type-label text-foreground">{t("askedYou", { name: request.requester.name ?? "" })}</span>
                  <span className="block type-meta text-muted-foreground">{formatDay(request.requestedAt, format.locale)}</span>
                </span>
              </span>
            ) : (
              <span className="mb-2 flex flex-wrap items-center gap-2">
                <StatusBadge tone={open ? "success" : "muted"} dot>{open ? t("open") : t("closed")}</StatusBadge>
                <span className="type-meta text-muted-foreground">
                  {t("asked", { requestedAt: formatDay(request.requestedAt, format.locale) })}
                  {open ? " " + t("due", { dueDate: format.date(request.dueDate) }) : request.closedAt ? " " + t("closed2", { closedAt: formatDay(request.closedAt, format.locale) }) : ""}
                </span>
              </span>
            )
          }
          title={request.question}
          actions={
            invitee && open ? <DueBlock date={request.dueDate} overdue={request.overdue} />
              : request.can.close ? (
                <AsyncButton variant="outline" pending={commands.close.isLoading} onClick={() => commands.close.mutate()}>
                  {t("closeRequest")}
                </AsyncButton>
              ) : null
          }
        />
        {request.subject ? <SubjectChip subject={request.subject} link className="mt-1" /> : null}
        <div className="mt-10 space-y-10">{invitee ? <InviteeView request={request} /> : <FullView request={request} />}</div>
      </div>
    </PageContainer>
  );
}

function statusLine(invitee: FeedbackInviteeDto, say: (key: string, values?: Record<string, string>) => string, locale: string): { text: string; tone: string } {
  if (invitee.status === "Answered") return { text: invitee.respondedAt ? say("answeredOn", { day: formatDay(invitee.respondedAt, locale) }) : say("statusAnswered"), tone: "text-success" };
  if (invitee.status === "Declined") return { text: say("statusDeclined"), tone: "text-muted-foreground" };
  return { text: say("statusWaiting"), tone: "text-muted-foreground" };
}

function FullView({ request }: { request: FeedbackRequestDto }) {
  const format = useFormat();
  const t = useTranslations("conversations.FullView");
  const invitees = request.invitees ?? [];
  const answers = request.answers ?? [];
  const waiting = invitees.filter((i) => i.status === "Waiting");
  const declined = invitees.filter((i) => i.status === "Declined" && i.declineReason);
  const counts = {
    answered: invitees.filter((i) => i.status === "Answered").length,
    declined: invitees.filter((i) => i.status === "Declined").length,
  };
  return (
    <>
      <section aria-labelledby="asked" className="rounded-surface bg-card px-5 pt-4 pb-5">
        <div className="mb-4 flex min-h-9 flex-wrap items-center justify-between gap-3">
          <h2 id="asked" className="type-section-title text-foreground">{t("asked")}</h2>
          <span className="type-meta tabular-nums text-muted-foreground">
            {t("answered", { answered: counts.answered })}{counts.declined > 0 ? " " + t("declined", { declined: counts.declined }) : ""}{waiting.length > 0 ? " " + t("waiting", { length: waiting.length }) : ""}
          </span>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {invitees.map((invitee) => {
            const status = statusLine(invitee, (key, values) => t(key as "statusWaiting", values as never), format.locale);
            return (
              <li key={invitee.person.id} className={cn("flex items-center gap-3 rounded-control bg-inlay px-4 py-3", invitee.status === "Declined" && "opacity-60")}>
                <PersonInitials
                  name={invitee.person.name}
                  className={cn("ring-2 ring-offset-2 ring-offset-inlay", invitee.status === "Answered" ? "ring-success" : invitee.status === "Waiting" ? "ring-border" : "ring-transparent")}
                />
                <span className="min-w-0">
                  <span className="block truncate type-label text-foreground">{invitee.person.name}</span>
                  <span className={cn("block type-meta", status.tone)}>{status.text}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="answers" className="rounded-surface bg-card px-5 pt-4 pb-5">
        <h2 id="answers" className="mb-4 flex min-h-9 items-center justify-between gap-2 type-section-title text-foreground">
          {t("answers")} <span className="type-meta tabular-nums text-muted-foreground">{answers.length}</span>
        </h2>
        <ul className="space-y-3">
          {answers.map((answer) => (
            <li key={answer.id} className="rounded-control bg-inlay p-5">
              <p className="type-narrative whitespace-pre-wrap text-foreground">{answer.message}</p>
              <div className="mt-5 flex items-center gap-3">
                <PersonInitials name={answer.author.name} />
                <span className="min-w-0 flex-1">
                  <span className="block type-label text-foreground">{answer.author.name}</span>
                  <span className="block type-meta text-muted-foreground">{formatDay(answer.sentAt, format.locale)}</span>
                </span>
              </div>
            </li>
          ))}
          {request.state === "Open"
            ? waiting.map((invitee) => (
                <li key={invitee.person.id} className="flex items-center gap-3 rounded-control border border-dashed border-border px-5 py-3.5">
                  <PersonInitials name={invitee.person.name} size="xs" />
                  <span className="flex-1 type-body-secondary text-muted-foreground">{t("hasntAnsweredYet", { name: firstName(invitee.person.name) })}</span>
                </li>
              ))
            : null}
          {answers.length === 0 && (request.state !== "Open" || waiting.length === 0) ? (
            <li className="type-body-secondary text-muted-foreground">{t("noAnswers")}</li>
          ) : null}
        </ul>
        {declined.length > 0 ? (
          <ul className="mt-4 space-y-1">
            {declined.map((invitee) => (
              <li key={invitee.person.id} className="type-meta text-muted-foreground">
                {t("declined2", { name: invitee.person.name ?? "", declineReason: invitee.declineReason ?? "" })}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </>
  );
}

function InviteeView({ request }: { request: FeedbackRequestDto }) {
  const format = useFormat();
  const t = useTranslations("conversations.InviteeView");
  const commands = useFeedbackRequestCommands(request.id);
  const [id] = useState(newClientId);
  const [message, setMessage] = useState("");
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const name = firstName(request.requester.name);

  if (request.myAnswer) {
    return (
      <section aria-label={t("yourAnswer")} className="rounded-surface bg-card p-6">
        <p className="mb-4 flex items-center gap-2 type-label text-success">
          <Check className="size-4" aria-hidden /> {t("answered", { sentAt: formatDay(request.myAnswer.sentAt, format.locale) })}
        </p>
        <p className="type-narrative whitespace-pre-wrap text-foreground">{request.myAnswer.message}</p>
      </section>
    );
  }
  if (request.mine?.status === "Declined") return <p className="type-body text-muted-foreground">{t("youDeclinedThisRequest")}</p>;
  if (!request.can.answer) return <p className="type-body text-muted-foreground">{t("closedThisRequest", { name: request.requester.name ?? "" })}</p>;

  return (
    <section aria-label={t("yourAnswer")} className="space-y-5">
      <div className="overflow-hidden rounded-surface bg-card">
        <Label htmlFor="answer-message" className="sr-only">{t("yourFeedbackFor", { name: request.requester.name ?? "" })}</Label>
        <Textarea
          id="answer-message"
          voice="narrative"
          className="min-h-56 resize-y rounded-none border-0 bg-transparent px-6 py-5 shadow-none focus-visible:ring-0 dark:bg-transparent"
          maxLength={FEEDBACK_MAX}
          placeholder={t("yourAnswerFor", { name })}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        <div className="flex items-center justify-between gap-3 border-t border-border bg-inlay px-6 py-2.5">
          <span className="flex items-center gap-1.5 type-meta text-muted-foreground">
            <Eye className="size-3.5" aria-hidden /> {t("andTheirManagerReadIt", { name })}
          </span>
          <span className="type-meta tabular-nums text-muted-foreground">{format.count(message.length)} / {format.count(FEEDBACK_MAX)}</span>
        </div>
      </div>
      {commands.answer.error ? <p className="type-body text-destructive" role="alert">{commands.answer.error.message}</p> : null}
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={() => setDeclining((value) => !value)} aria-expanded={declining}>{t("decline")}</Button>
        <AsyncButton
          pending={commands.answer.isLoading}
          disabled={!message.trim()}
          onClick={() => commands.answer.mutate({ feedbackId: id, message: message.trim() })}
        >
          <Send className="size-4" data-icon="inline-start" /> {t("sendAnswer")}
        </AsyncButton>
      </div>
      {declining ? (
        <div className="space-y-3 rounded-surface border border-border p-4">
          <Label htmlFor="decline-reason">{t("reason")} <span className="text-muted-foreground">{t("optional")}</span></Label>
          <Input id="decline-reason" maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} />
          <AsyncButton variant="outline" pending={commands.decline.isLoading} onClick={() => commands.decline.mutate(reason.trim() || null)}>
            {t("declineRequest")}
          </AsyncButton>
        </div>
      ) : null}
    </section>
  );
}

function RequestSkeleton() {
  const t = useTranslations("conversations.RequestSkeleton");
  return (
    <PageContainer>
      <div role="status" aria-label={t("loadingThisRequest")} className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="mt-8 h-48 w-full rounded-surface" />
      </div>
    </PageContainer>
  );
}

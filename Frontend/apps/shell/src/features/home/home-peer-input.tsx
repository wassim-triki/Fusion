"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { createPlatformApiClient, createReviewsApi, fusionAttentionQueryKeys, reviewQueryKeys, type PeerReasonDto } from "@repo/api";
import { useApiQuery } from "@repo/api/query";
import { Button, Textarea } from "@repo/ds";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@repo/ds/components/ui/avatar";
import { Clapping, MessagesSquare, Target, Users } from "@repo/ds/icons";
import { formatDate } from "@repo/ds/lib/dates";
import type { WorkListItem } from "@repo/ds/shell";

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";

/** The request a peer-input work item is about, from its path (`/performance/reviews/peer-requests/{id}`). */
export function peerRequestId(item: WorkListItem): string | null {
  const match = /\/peer-requests\/([0-9a-f-]{36})/i.exec(item.href);
  return match?.[1] ?? null;
}

/**
 * A colleague's view, given from Home in place (D-74): who asked and why them, the round's questions, and who reads the
 * answer, with their name (D-69). "I didn't work with them enough" declines; the row leaves once sent.
 */
export function HomePeerInput({ item, initiallyOpen }: { item: WorkListItem; initiallyOpen: boolean }) {
  const t = useTranslations("home.peerInput");
  const locale = useLocale();
  const requestId = peerRequestId(item)!;
  const api = useMemo(() => createReviewsApi(createPlatformApiClient()), []);
  const cache = useQueryClient();
  const [open, setOpen] = useState(initiallyOpen);
  const request = useApiQuery(reviewQueryKeys.peerRequest(requestId), (signal) => api.getPeerRequest(requestId, signal), { enabled: open });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"send" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = request.data;
  const subject = item.subject?.displayName ?? data?.subjectDisplayName ?? "";
  const asked = data ? t("asked", { name: data.reviewerDisplayName, day: formatDate(data.requestedAt.slice(0, 10), { locale }) }) : item.context;
  const value = (questionId: string, saved: string | null) => answers[questionId] ?? saved ?? "";
  const complete = data ? data.questions.every((q) => value(q.questionId, q.answer).trim()) : false;

  const finish = async (kind: "send" | "decline") => {
    if (!data) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === "send") await api.sendPeerAnswers(requestId, data.questions.map((q) => ({ questionId: q.questionId, text: value(q.questionId, q.answer).trim() })));
      else await api.declinePeerRequest(requestId, null);
      await cache.invalidateQueries({ queryKey: fusionAttentionQueryKeys.all() });
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : t("failed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="flex min-h-[68px] items-center gap-3.5 px-5 py-3">
        <Avatar className="size-10 shrink-0"><AvatarFallback hue={subject} className="text-sm">{initials(subject)}</AvatarFallback></Avatar>
        <span className="min-w-0 flex-1">
          <span className="block truncate type-label font-semibold text-foreground">{item.title}</span>
          <span className="block truncate type-meta text-muted-foreground">{asked}</span>
        </span>
        {item.dueOn ? <span className="hidden shrink-0 type-meta text-muted-foreground sm:inline">{t("due", { day: formatDate(item.dueOn, { weekday: true, locale }) })}</span> : null}
        {open ? null : <Button size="sm" variant="outline" onClick={() => setOpen(true)}>{item.actionLabel ?? t("answer")}</Button>}
      </div>
      {open ? (
        <div className="grid gap-3.5 pb-[22px] pe-[22px] ps-[72px] pt-1 animate-in fade-in-0 slide-in-from-top-1 duration-300">
          {!data ? (
            request.error ? <p role="alert" className="type-meta text-destructive">{t("failed")}</p> : (
              <div className="grid gap-2" aria-label={t("loading")}><Skeleton className="h-10 w-full rounded-inset" /><Skeleton className="h-20 w-full rounded-inset" /></div>
            )
          ) : (
            <>
              {data.reasons.length ? (
                <div className="grid gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="type-meta text-muted-foreground">{t("whyYou")}</span>
                    <span className="ms-auto type-meta text-muted-foreground">{t("picked", { name: firstName(subject) })}</span>
                  </div>
                  {data.reasons.map((reason, index) => <Reason key={index} reason={reason} subject={firstName(subject)} />)}
                </div>
              ) : null}
              {data.questions.map((q) => (
                <label key={q.questionId} className="grid gap-[7px]">
                  <span className="type-narrative text-base font-medium text-foreground">{q.text}</span>
                  <Textarea rows={3} placeholder={t("yourWords")} value={value(q.questionId, q.answer)} maxLength={2000}
                    onChange={(event) => setAnswers((a) => ({ ...a, [q.questionId]: event.target.value }))} />
                </label>
              ))}
              <div className="flex flex-wrap items-center gap-3">
                <span className="type-meta text-muted-foreground">{t("whoReads", { manager: firstName(data.reviewerDisplayName), name: firstName(subject) })}</span>
                {error ? <span role="alert" className="type-meta text-destructive">{error}</span> : null}
                <div className="ms-auto flex items-center gap-2">
                  <Button variant="ghost" disabled={busy !== null} onClick={() => void finish("decline")}>{t("didntWorkEnough", { name: firstName(subject) })}</Button>
                  <Button disabled={busy !== null || !complete} onClick={() => void finish("send")}>{t("sendTo", { name: firstName(data.reviewerDisplayName) })}</Button>
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Reason({ reason, subject }: { reason: PeerReasonDto; subject: string }) {
  const t = useTranslations("home.peerInput.reasons");
  const locale = useLocale();
  const day = reason.at ? formatDate(reason.at.slice(0, 10), { locale }) : "";
  const Icon = reason.kind === "goal" ? Target : reason.kind.startsWith("praise") ? Clapping : reason.kind === "teammate" ? Users : MessagesSquare;
  return (
    <div className="flex items-center gap-2.5 rounded-inset bg-inlay px-3 py-[9px] type-body-secondary text-foreground">
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        {reason.kind === "goal" ? <>{t("goal")} <span className="type-narrative font-medium">{reason.title}</span></> : t(reason.kind, { name: subject, day })}
      </span>
      {reason.excerpt ? <span className="ms-auto max-w-[45%] truncate type-narrative text-[13.5px] text-muted-foreground">“{reason.excerpt}”</span> : null}
    </div>
  );
}

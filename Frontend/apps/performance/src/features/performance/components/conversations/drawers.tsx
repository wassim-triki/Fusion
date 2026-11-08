"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useAuth } from "@repo/auth";
import { newClientId, type FeedbackDto, type PraiseDto } from "@repo/api";
import { useReactToPraise } from "@repo/api/query";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@repo/ds/components/ui/alert-dialog";
import { Button } from "@repo/ds/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@repo/ds/components/ui/sheet";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { AsyncButton, Said, StatusBadge } from "@repo/ds/shell";
import { AvatarStack, PersonInitials, PraiseReactions, ValueChip, usePerformanceWords } from "@repo/performance-ui";
import { ArrowRight, Check, Eye, Lock, OneOnOnes } from "@/lib/icons";
import { useDeletePraise, useFeedbackItem, useFeedbackRequest, useOneOnOne, useOneOnOneCommands, useOneOnOnes, usePraiseItem } from "../../api/use-conversations";
import { formatDay } from "../one-on-ones/one-on-one-lib";
import { SubjectChip, firstName } from "./conversation-parts";
import { REACTION_ICONS } from "./reaction-icons";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";
import { reportPerformanceFailure } from "../../api/performance-failure";

function DrawerFrame({
  open,
  onOpenChange,
  title,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-[34rem]">
        <div className="px-7 pt-6 pb-2">
          <SheetTitle className="type-meta text-muted-foreground">{title}</SheetTitle>
          <SheetDescription className="sr-only">{title}</SheetDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-7 pt-4 pb-8">{children}</div>
        {footer ? <div className="flex flex-wrap items-center gap-3 border-t border-border bg-popover px-7 py-4">{footer}</div> : null}
      </SheetContent>
    </Sheet>
  );
}

function Unavailable({ text }: { text: string }) {
  return <p className="type-body-secondary text-muted-foreground">{text}</p>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-4 border-t border-border py-3 first:border-t-0">
      <span className="type-meta text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * One piece of feedback in a reading view (S-12). The words are the record and lead; who, what about, who reads it and
 * the request it answers sit below. Nothing to edit: feedback is fixed once sent.
 */
export function FeedbackDrawer({ feedbackId, initial, onClose }: { feedbackId: string | null; initial?: FeedbackDto; onClose: () => void }) {
  const format = useFormat();
  const t = useTranslations("conversations.FeedbackDrawer");
  const item = useFeedbackItem(initial ? null : feedbackId);
  const feedback = initial ?? item.data;
  return (
    <DrawerFrame
      open={Boolean(feedbackId)}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={feedback ? t("feedback", { sentAt: formatDay(feedback.sentAt, format.locale) }) : t("feedback2")}
      footer={
        feedback ? (
          <>
            <span className="flex items-center gap-1.5 type-meta text-muted-foreground"><Lock className="size-3.5" aria-hidden /> {t("fixedOnceSent")}</span>
            <span className="flex-1" />
            <AddToNextOneOnOne feedback={feedback} />
          </>
        ) : null
      }
    >
      {feedback ? (
        <>
          <div className="flex items-center gap-2.5 text-muted-foreground" aria-hidden>
            <PersonInitials name={feedback.author.name} size="lg" />
            <ArrowRight className="size-4" />
            <PersonInitials name={feedback.receiver.name} size="lg" />
          </div>
          <Said className="mt-6">{feedback.message}</Said>
          <div className="mt-8">
            <Fact label={t("from")}><span className="type-label text-foreground">{feedback.author.name ?? t("aColleague")}</span></Fact>
            <Fact label={t("to")}><span className="type-label text-foreground">{feedback.receiver.name ?? t("aColleague")}</span></Fact>
            {feedback.subject ? <Fact label={t("about")}><SubjectChip subject={feedback.subject} link /></Fact> : null}
            <Fact label={t("whoReadsIt")}>
              <span className="flex items-center gap-2 type-body text-foreground">
                {feedback.visibility === "ManagerOnly" ? <Lock className="size-4 text-muted-foreground" aria-hidden /> : <Eye className="size-4 text-muted-foreground" aria-hidden />}
                {feedback.visibility === "ManagerOnly"
                  ? t("only", { value: feedback.addressedManager?.name ?? "the manager" })
                  : t("andTheirManager", { name: firstName(feedback.receiver.name) })}
              </span>
            </Fact>
            {feedback.requestQuestion ? (
              <Fact label={t("answers")}>
                <Link href={`/feedback/requests/${feedback.requestId}`} className="type-body text-foreground hover:underline">{feedback.requestQuestion}</Link>
              </Fact>
            ) : null}
          </div>
        </>
      ) : item.error ? (
        <Unavailable text={t("thisFeedbackIsntAvailableTo")} />
      ) : (
        <div aria-label={t("loadingFeedback")} className="space-y-4">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-28 w-full" />
        </div>
      )}
    </DrawerFrame>
  );
}

/**
 * Shared feedback to the caller or one of their reports can go on the next 1:1 with them, when the series offers it
 * as a talking point (the server's rule: since the last meeting, never manager-only).
 */
function AddToNextOneOnOne({ feedback }: { feedback: FeedbackDto }) {
  const t = useTranslations("conversations.AddToNextOneOnOne");
  const { user } = useAuth();
  const list = useOneOnOnes(feedback.visibility === "Shared");
  const row = feedback.receiver.id === user?.employeeId
    ? list.data?.withManager ?? null
    : list.data?.reports.find((r) => r.with.employeeId === feedback.receiver.id) ?? null;
  const series = useOneOnOne(row?.seriesId ?? null);
  const commands = useOneOnOneCommands(row?.seriesId ?? "");
  const meeting = series.data?.upcoming ?? null;
  if (!row || !meeting) return null;

  const onAgenda = meeting.agenda.some((i) => i.sourceKind === "Feedback" && i.sourceId === feedback.id);
  if (onAgenda) {
    return (
      <Link href={`/one-on-ones/${row.seriesId}`} className="flex items-center gap-1.5 type-label text-foreground hover:underline">
        <Check className="size-4 text-success" aria-hidden /> {t("onTheNext11")}
      </Link>
    );
  }
  if (!meeting.suggestions.some((s) => s.kind === "Feedback" && s.sourceId === feedback.id)) return null;
  return (
    <AsyncButton
      size="sm"
      variant="outline"
      pending={commands.addAgendaItem.isLoading}
      onClick={async () => {
        try {
          await commands.addAgendaItem.mutateAsync({ meetingId: meeting.id, request: { id: newClientId(), sourceKind: "Feedback", sourceId: feedback.id } });
          toast.success(t("addedToYourNext1", { displayName: firstName(row.with.displayName) }));
        } catch { /* reported by the command */ }
      }}
    >
      <OneOnOnes className="size-4" data-icon="inline-start" /> {t("addToNext11")}
    </AsyncButton>
  );
}

/**
 * One of your requests beside the list (B-228): the question, who was asked and where each stands, then the answers
 * in their words. Closing the request and the full history stay on its page.
 */
export function RequestDrawer({ requestId, onClose }: { requestId: string | null; onClose: () => void }) {
  const format = useFormat();
  const t = useTranslations("conversations.RequestDrawer");
  const item = useFeedbackRequest(requestId);
  const request = item.data && item.data.id === requestId ? item.data : undefined;
  const invitees = request?.invitees ?? [];
  const answers = request?.answers ?? [];
  const open = request?.state === "Open";
  return (
    <DrawerFrame
      open={Boolean(requestId)}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={
        request
          ? open
            ? t("yourRequestDue", { dueDate: format.date(request.dueDate) })
            : t("yourRequestClosed")
          : t("yourRequest")
      }
      footer={
        request ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/feedback/requests/${request.id}`}>{t("openTheRequest")}</Link>
          </Button>
        ) : null
      }
    >
      {request ? (
        <>
          <p className="type-panel-title text-foreground">{request.question}</p>
          {request.subject ? <SubjectChip subject={request.subject} link className="mt-3" /> : null}
          <h3 className="mt-8 type-meta text-muted-foreground">{t("asked")}</h3>
          <ul className="mt-2">
            {invitees.map((invitee) => (
              <li key={invitee.person.id} className="flex items-center gap-3 border-t border-border py-2.5 first:border-t-0">
                <PersonInitials name={invitee.person.name} size="sm" />
                <span className="min-w-0 flex-1 truncate type-label text-foreground">{invitee.person.name}</span>
                <StatusBadge tone={invitee.status === "Answered" ? "success" : invitee.status === "Declined" ? "muted" : "warning"} dot>
                  {invitee.status === "Answered" ? t("answered") : invitee.status === "Declined" ? t("declined") : t("waiting")}
                </StatusBadge>
              </li>
            ))}
          </ul>
          <h3 className="mt-8 type-meta text-muted-foreground">{t("answers", { count: answers.length })}</h3>
          {answers.length === 0 ? (
            <p className="mt-2 type-body-secondary text-muted-foreground">{t("noAnswersYet")}</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {answers.map((answer) => (
                <li key={answer.id} className="rounded-control bg-inlay p-4">
                  <Said>{answer.message}</Said>
                  <p className="mt-3 type-meta text-muted-foreground">
                    {answer.author.name ?? t("aColleague")} · {formatDay(answer.sentAt, format.locale)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : item.error ? (
        <Unavailable text={t("unavailable")} />
      ) : (
        <div aria-label={t("loading")} className="space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
    </DrawerFrame>
  );
}

/** One praise in full: the people praised lead, then the words, the value and the reactions; Delete for its author or HR. */
export function PraiseDrawer({ praiseId, onClose }: { praiseId: string | null; onClose: () => void }) {
  const t = useTranslations("conversations.PraiseDrawer");
  const words = usePerformanceWords();
  const item = usePraiseItem(praiseId);
  const react = useReactToPraise();
  const remove = useDeletePraise();
  const [confirming, setConfirming] = useState(false);
  const praise: PraiseDto | null | undefined = item.data?.praise;
  const recipients = praise ? words.joinNames(praise.recipients.map((r) => r.name)) : "";

  return (
    <DrawerFrame
      open={Boolean(praiseId)}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t("praise")}
      footer={praise?.canDelete ? (
        <Button variant="ghost" className="text-destructive" onClick={() => setConfirming(true)}>{t("deletePraise")}</Button>
      ) : null}
    >
      {item.data?.removed ? (
        <Unavailable text={t("thisPraiseWasRemoved")} />
      ) : praise ? (
        <>
          <div className="flex items-center gap-3">
            <AvatarStack names={praise.recipients.map((r) => r.name)} size="lg" max={4} />
            <div className="min-w-0">
              <p className="type-label text-foreground">{recipients}</p>
              <p className="type-meta text-muted-foreground">
                {t("from")} {praise.author.name ?? t("aColleague")} · <time dateTime={praise.givenAt}>{words.praiseTime(praise.givenAt)}</time>
              </p>
            </div>
          </div>
          <Said className="mt-6">{praise.message}</Said>
          <ValueChip value={praise.value} className="mt-5" />
          <div className="mt-6">
            <PraiseReactions
              praise={praise}
              icons={REACTION_ICONS}
              onReact={(kind, add) => react.mutate({ praiseId: praise.id, kind, add })}
            />
          </div>
          <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("deleteThisPraise")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("itDisappearsFromTheFeed", { recipients })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("keepIt")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={async () => {
                    try {
                      await remove.mutateAsync(praise.id);
                      toast.success(t("praiseDeleted"));
                      onClose();
                    } catch (error) {
                      reportPerformanceFailure(error, t("couldNotDelete"));
                    }
                  }}
                >
                  {t("deletePraise")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : item.error ? (
        <Unavailable text={t("thisPraiseIsntAvailable")} />
      ) : (
        <div aria-label={t("loadingPraise")} className="space-y-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
    </DrawerFrame>
  );
}

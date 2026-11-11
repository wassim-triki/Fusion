"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useAuth } from "@repo/auth";
import { newClientId, type FeedbackVisibility } from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { OptionCards } from "@repo/ds/choice";
import { DatePicker } from "@repo/ds/components/ui/date-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@repo/ds/components/ui/dialog";
import { Label } from "@repo/ds/components/ui/label";
import { Textarea } from "@repo/ds/components/ui/textarea";
import { AsyncButton } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { PersonInitials } from "@repo/performance-ui";
import { Lock, Send, Target, Users } from "@repo/ds/icons";
import { useAskForFeedback, useGiveFeedback } from "../../api/use-conversations";
import { usePersonSummary } from "../../api/use-performance";
import { localDate } from "../one-on-ones/one-on-one-lib";
import { ColleaguePicker, ColleaguesPicker, type PickedColleague } from "./colleague-picker";
import { firstName } from "./conversation-parts";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";

export const FEEDBACK_MAX = 2_000;
export const QUESTION_MAX = 300;
export const PRAISE_MAX = 500;
export const MAX_INVITEES = 5;
export const MAX_RECIPIENTS = 10;

/** An objective the composer is about, fixed by where it opened (the objective drawer, an "Ask about" suggestion). */
export interface FixedObjective {
  cycleId: string;
  objectiveId: string;
  title: string;
}

type Subject = { kind: "none" } | { kind: "objective"; cycleId: string; objectiveId: string };
const NOTHING: Subject = { kind: "none" };

function subjectFields(subject: Subject, fixed?: FixedObjective) {
  if (fixed) return { competencyId: null, cycleId: fixed.cycleId, objectiveId: fixed.objectiveId };
  return {
    competencyId: null,
    cycleId: subject.kind === "objective" ? subject.cycleId : null,
    objectiveId: subject.kind === "objective" ? subject.objectiveId : null,
  };
}

function Field({ label, htmlFor, meta, children }: { label: string; htmlFor?: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        {htmlFor ? <Label htmlFor={htmlFor}>{label}</Label> : <p className="type-label text-foreground">{label}</p>}
        {meta}
      </div>
      {children}
    </div>
  );
}

function Count({ value, max }: { value: string; max: number }) {
  const format = useFormat();
  return <span className="type-meta tabular-nums text-muted-foreground">{format.count(value.length)} / {format.count(max)}</span>;
}

const CHIP = "inline-flex h-8 items-center gap-1.5 rounded-control border px-3 type-label transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The owner's objectives the caller may name, read through the person summary's own visibility. */
function ObjectiveChoices({ ownerId, value, onChange }: { ownerId: string; value: Subject; onChange: (subject: Subject) => void }) {
  const summary = usePersonSummary(ownerId);
  const cycle = summary.data?.currentCycle?.isParticipant ? summary.data.currentCycle : null;
  return (
    <>
      {(cycle?.objectives ?? []).map((objective) => {
        const on = value.kind === "objective" && value.objectiveId === objective.objectiveId;
        return (
          <button
            key={objective.objectiveId}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange({ kind: "objective", cycleId: cycle!.cycleId, objectiveId: objective.objectiveId })}
            className={cn(CHIP, "max-w-full", on ? "border-primary-ring bg-primary-tint text-primary-ink" : "border-border text-muted-foreground hover:text-foreground")}
          >
            <Target className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{objective.title}</span>
          </button>
        );
      })}
    </>
  );
}

/** What it's about, as one choice among the owner's objectives, or nothing specific. */
function SubjectPicker({ ownerId, value, onChange }: { ownerId: string | null; value: Subject; onChange: (subject: Subject) => void }) {
  const t = useTranslations("conversations.SubjectPicker");
  return (
    // eslint-disable-next-line no-restricted-syntax -- objectives as chips with their titles, which the choice controls do not carry
    <div role="radiogroup" aria-label={t("about")} className="flex flex-wrap gap-2">
      {ownerId ? <ObjectiveChoices ownerId={ownerId} value={value} onChange={onChange} /> : null}
      <button
        type="button"
        role="radio"
        aria-checked={value.kind === "none"}
        onClick={() => onChange(NOTHING)}
        className={cn(CHIP, value.kind === "none" ? "border-foreground/30 bg-inlay text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
      >
        {t("nothingSpecific")}
      </button>
    </div>
  );
}

/** Who reads it, as two choices with the people in them. */
function VisibilityChoice({ value, onChange, receiver }: { value: FeedbackVisibility; onChange: (value: FeedbackVisibility) => void; receiver: PickedColleague | null }) {
  const t = useTranslations("conversations.VisibilityChoice");
  const name = receiver ? firstName(receiver.displayName) : null;
  const options: { value: FeedbackVisibility; title: string; people: ReactNode; who: string }[] = [
    {
      value: "Shared",
      title: t("shared"),
      people: (
        <span className="flex items-center">
          {receiver ? <PersonInitials name={receiver.displayName} size="xs" className="ring-2 ring-popover" /> : null}
          <span className={cn("grid size-6 place-items-center rounded-full bg-inlay ring-2 ring-popover", receiver && "-ms-1.5")}><Users className="size-3.5 text-muted-foreground" /></span>
        </span>
      ),
      who: t("sharedWho", { name: name ?? t("they") }),
    },
    {
      value: "ManagerOnly",
      title: t("managerOnly"),
      people: <span className="grid size-6 place-items-center rounded-full bg-inlay"><Lock className="size-3.5 text-muted-foreground" /></span>,
      who: name ? t("managerOnlyWho", { name }) : t("managerOnlyWhoAnon"),
    },
  ];
  return (
    <OptionCards
      columns={2}
      label={t("whoReadsIt")}
      value={value}
      onChange={onChange}
      options={options.map((option) => ({
        value: option.value,
        label: option.title,
        description: (
          <span className="flex items-center gap-2">
            {option.people}
            {option.who}
          </span>
        ),
      }))}
    />
  );
}

function FixedSubject({ objective }: { objective: FixedObjective }) {
  return (
    <span className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-control border border-primary-ring bg-primary-tint px-3 type-label text-primary-ink">
      <Target className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{objective.title}</span>
    </span>
  );
}

/**
 * Give feedback (D-13). The person comes first, then what it's about, the words, and who reads them. It's fixed once
 * sent, so the id is made once per composer: a retried send returns the original.
 */
export function FeedbackComposer({
  receiver: fixedReceiver,
  objective,
  onClose,
}: {
  receiver?: PickedColleague;
  objective?: FixedObjective;
  onClose: () => void;
}) {
  const t = useTranslations("conversations.FeedbackComposer");
  const { user } = useAuth();
  const give = useGiveFeedback();
  const [id] = useState(newClientId);
  const [receiver, setReceiver] = useState<PickedColleague | null>(fixedReceiver ?? null);
  const [changing, setChanging] = useState(!fixedReceiver);
  const [visibility, setVisibility] = useState<FeedbackVisibility>("Shared");
  const [subject, setSubject] = useState<Subject>(NOTHING);
  const [message, setMessage] = useState("");
  const ready = receiver && message.trim().length > 0;

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !give.isLoading) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[min(40rem,calc(100vw-2rem))] max-w-none sm:max-w-none gap-0 overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="type-meta text-muted-foreground">{t("giveFeedback")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 px-6 pt-4 pb-6">
          {receiver && !changing ? (
            <div className="flex items-center gap-4">
              <PersonInitials name={receiver.displayName} size="xl" />
              <div className="min-w-0 flex-1">
                <p className="truncate type-section-title text-foreground">{receiver.displayName}</p>
                {receiver.subtitle ? <p className="truncate type-meta text-muted-foreground">{receiver.subtitle}</p> : null}
              </div>
              {fixedReceiver ? null : <Button variant="ghost" size="sm" onClick={() => setChanging(true)}>{t("change")}</Button>}
            </div>
          ) : (
            <Field label={t("to")} htmlFor="feedback-to">
              <ColleaguePicker
                id="feedback-to"
                value={receiver}
                onChange={(next) => {
                  setReceiver(next);
                  setSubject(NOTHING);
                  if (next) setChanging(false);
                }}
                exclude={user?.employeeId ? [user.employeeId] : []}
              />
            </Field>
          )}
          <Field label={t("about")}>
            {objective ? <FixedSubject objective={objective} /> : <SubjectPicker ownerId={receiver?.employeeId ?? null} value={subject} onChange={setSubject} />}
          </Field>
          <Field label={t("feedback")} htmlFor="feedback-message" meta={<Count value={message} max={FEEDBACK_MAX} />}>
            <Textarea
              id="feedback-message"
              voice="narrative"
              className="min-h-36 resize-y"
              maxLength={FEEDBACK_MAX}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </Field>
          <Field label={t("whoReadsIt")}>
            <VisibilityChoice value={visibility} onChange={setVisibility} receiver={receiver} />
          </Field>
          {give.error ? <p className="type-body text-destructive" role="alert">{give.error.message}</p> : null}
        </div>
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-popover px-6 py-4">
          <span className="flex items-center gap-1.5 type-meta text-muted-foreground">
            <Lock className="size-3.5" aria-hidden /> {t("cantBeChangedOnceSent")}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={give.isLoading}>{t("cancel")}</Button>
            <AsyncButton
              pending={give.isLoading}
              disabled={!ready}
              onClick={async () => {
                if (!receiver) return;
                try {
                  await give.mutateAsync({
                    id,
                    receiverEmployeeId: receiver.employeeId,
                    visibility,
                    message: message.trim(),
                    ...subjectFields(subject, objective),
                  });
                  toast.success(t("feedbackSentTo", { displayName: receiver.displayName }));
                  onClose();
                } catch { /* shown above */ }
              }}
            >
              <Send className="size-4" data-icon="inline-start" />
              {receiver ? t("sendTo", { displayName: firstName(receiver.displayName) }) : t("sendFeedback")}
            </AsyncButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Ask 1–5 colleagues one question by a date (D-13), about one of your objectives, a value, or nothing specific. */
export function RequestComposer({ objective, people: initialPeople, onClose, onSent }: { objective?: FixedObjective; people?: PickedColleague[]; onClose: () => void; onSent?: (id: string) => void }) {
  const t = useTranslations("conversations.RequestComposer");
  const { user } = useAuth();
  const ask = useAskForFeedback();
  const [id] = useState(newClientId);
  const [people, setPeople] = useState<PickedColleague[]>(initialPeople ?? []);
  const [question, setQuestion] = useState("");
  const [subject, setSubject] = useState<Subject>(NOTHING);
  const due = new Date();
  due.setDate(due.getDate() + 14);
  const [dueDate, setDueDate] = useState(localDate(due));
  const ready = people.length > 0 && question.trim().length > 0 && Boolean(dueDate);

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !ask.isLoading) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[min(40rem,calc(100vw-2rem))] max-w-none sm:max-w-none gap-0 overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="type-meta text-muted-foreground">{t("askForFeedback")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 px-6 pt-4 pb-6">
          <Field label={t("yourQuestion")} htmlFor="request-question" meta={<Count value={question} max={QUESTION_MAX} />}>
            <Textarea
              id="request-question"
              voice="narrative"
              className="min-h-20 resize-none"
              maxLength={QUESTION_MAX}
              value={question}
              placeholder={objective ? t("howIsLanding", { title: objective.title }) : undefined}
              onChange={(event) => setQuestion(event.target.value)}
            />
          </Field>
          <Field label={t("ask")} htmlFor="request-people" meta={<span className="type-meta tabular-nums text-muted-foreground">{people.length} / {MAX_INVITEES}</span>}>
            <ColleaguesPicker id="request-people" value={people} onChange={setPeople} max={MAX_INVITEES} exclude={user?.employeeId ? [user.employeeId] : []} />
          </Field>
          <Field label={t("about")}>
            {objective ? <FixedSubject objective={objective} /> : <SubjectPicker ownerId={user?.employeeId ?? null} value={subject} onChange={setSubject} />}
          </Field>
          <Field label={t("answerBy")} htmlFor="request-due">
            <DatePicker id="request-due" value={dueDate} min={localDate(new Date())} onChange={setDueDate} className="w-48" />
          </Field>
          {ask.error ? <p className="type-body text-destructive" role="alert">{ask.error.message}</p> : null}
        </div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-popover px-6 py-4">
          <Button variant="ghost" onClick={onClose} disabled={ask.isLoading}>{t("cancel")}</Button>
          <AsyncButton
            pending={ask.isLoading}
            disabled={!ready}
            onClick={async () => {
              try {
                const request = await ask.mutateAsync({
                  id,
                  question: question.trim(),
                  inviteeEmployeeIds: people.map((p) => p.employeeId),
                  dueDate,
                  ...subjectFields(subject, objective),
                });
                toast.success((people.length === 1 ? t("askedColleague", { length: people.length }) : t("askedColleagues", { length: people.length })));
                onClose();
                onSent?.(request.id);
              } catch { /* shown above */ }
            }}
          >
            <Send className="size-4" data-icon="inline-start" />
            {people.length > 1 ? t("askColleagues", { length: people.length }) : t("sendRequest")}
          </AsyncButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

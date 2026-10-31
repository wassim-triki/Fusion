"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Archive, ArrowDown, ArrowUp, ChevronRight, Pencil, Plus, Trash2 } from "@/lib/icons";
import { ApiError, type FusionSettingsSection, type ReviewQuestionAudience, type ReviewQuestionDto } from "@repo/api";
import { Button, cn, Input } from "@repo/ds";
import { formatDate } from "@repo/ds/lib/dates";
import { PageError, SettingsPage, useSettingsSectionName } from "@repo/ds/shell";
import { useReviewQuestionCommands, useReviewQuestions } from "@/features/performance/api/use-review-work";
import { useRefreshSettingsSections } from "../api";

/** Who answers, in order; each audience's words are `questions.audiences.<audience>`. */
const AUDIENCES: readonly ReviewQuestionAudience[] = ["Person", "Manager", "Peer"];

type QuestionsT = ReturnType<typeof useTranslations<"settings.questions">>;

/** A failed change: the conflict by its status, other refusals as the service wrote them in English, else a plain line. */
function useFailure(): (error: unknown) => string {
  const t: QuestionsT = useTranslations("settings.questions");
  const english = useLocale() === "en";
  return (error) => {
    if (error instanceof ApiError && error.status === 409) return t("conflict");
    return english && error instanceof ApiError && error.errors[0] ? error.errors[0] : t("notSaved");
  };
}

type Commands = ReturnType<typeof useReviewQuestionCommands> & {
  reorderMove: (question: ReviewQuestionDto, by: -1 | 1) => Promise<unknown>;
};

function QuestionRow({
  question,
  first,
  last,
  editable,
  commands,
  onSaved,
  onError,
}: {
  question: ReviewQuestionDto;
  first: boolean;
  last: boolean;
  editable: boolean;
  commands: Commands;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const t = useTranslations("settings.questions");
  const locale = useLocale();
  const failure = useFailure();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(question.text);
  const inUse = Boolean(question.firstUsedAt);
  const run = (action: Promise<unknown>) => void action.then(onSaved).catch((error: unknown) => onError(failure(error)));

  if (editing) {
    return (
      <li className="flex flex-col gap-3 bg-inlay px-5 py-3">
        <Input aria-label={t("question")} value={text} onChange={(event) => setText(event.target.value)} autoFocus />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => { setText(question.text); setEditing(false); }}>
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            disabled={!text.trim() || text.trim() === question.text || commands.update.isLoading}
            onClick={() => run(commands.update.mutateAsync({ id: question.id, text: text.trim(), version: question.version }).then(() => setEditing(false)))}
          >
            {t("save")}
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex min-h-12 items-center gap-3 px-5 py-2">
      <span className="min-w-0 flex-1 type-subsection-title text-foreground">{question.text}</span>
      <span className="w-36 shrink-0 type-meta text-muted-foreground">
        {question.roundCount
          ? t("inRounds", { count: question.roundCount })
          : inUse ? t("inUseSince", { date: formatDate(question.firstUsedAt, { locale }) }) : t("notUsed")}
      </span>
      {editable ? (
        <span className="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" aria-label={t("moveUp", { text: question.text })} disabled={first} onClick={() => run(commands.reorderMove(question, -1))}>
            <ArrowUp className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t("moveDown", { text: question.text })} disabled={last} onClick={() => run(commands.reorderMove(question, 1))}>
            <ArrowDown className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t("edit", { text: question.text })} onClick={() => setEditing(true)}>
            <Pencil className="size-4" />
          </Button>
          {inUse ? (
            <Button variant="ghost" size="icon-sm" aria-label={t("archive", { text: question.text })}
              onClick={() => run(commands.archive.mutateAsync({ id: question.id, version: question.version }))}>
              <Archive className="size-4" />
            </Button>
          ) : (
            <Button variant="ghost" size="icon-sm" aria-label={t("delete", { text: question.text })} className="text-destructive"
              onClick={() => run(commands.remove.mutateAsync({ id: question.id, version: question.version }))}>
              <Trash2 className="size-4" />
            </Button>
          )}
        </span>
      ) : null}
    </li>
  );
}

function AddQuestion({ audience, commands, onSaved, onError }: { audience: ReviewQuestionAudience; commands: Commands; onSaved: () => void; onError: (message: string) => void }) {
  const t = useTranslations("settings.questions");
  const failure = useFailure();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) {
    return (
      <li>
        <button type="button" onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 px-5 py-2.5 text-start type-subsection-title text-muted-foreground transition-colors hover:text-foreground">
          <Plus aria-hidden className="size-4" />
          {t("addQuestion")}
        </button>
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-3 bg-inlay px-5 py-3">
      <Input aria-label={t(`newQuestion.${audience}`)} value={text}
        onChange={(event) => setText(event.target.value)} autoFocus />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => { setText(""); setOpen(false); }}>
          {t("cancel")}
        </Button>
        <Button
          size="sm"
          disabled={!text.trim() || commands.create.isLoading}
          onClick={() =>
            void commands.create
              .mutateAsync({ text: text.trim(), audience })
              .then(() => { setText(""); setOpen(false); onSaved(); })
              .catch((error: unknown) => onError(failure(error)))
          }
        >
          {t("add")}
        </Button>
      </div>
    </li>
  );
}

/** Settings › Review questions: the library, grouped by who answers. Questions used in a round archive; unused ones delete. */
export function ReviewQuestionsSettings({ section }: { section: FusionSettingsSection }) {
  const t = useTranslations("settings.questions");
  const title = useSettingsSectionName()(section);
  const editable = section.access === "manage";
  const query = useReviewQuestions();
  const base = useReviewQuestionCommands();
  const refresh = useRefreshSettingsSections();
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const questions = query.data ?? [];
  const active = (audience: ReviewQuestionAudience) =>
    questions.filter((q) => q.audience === audience && q.state === "Active").sort((a, b) => a.sortOrder - b.sortOrder);
  const archived = questions.filter((q) => q.state === "Archived");

  const commands: Commands = {
    ...base,
    /** Moves a question one place within its audience; the whole order saves at once. */
    reorderMove: (question: ReviewQuestionDto, by: -1 | 1) => {
      const ids = active(question.audience).map((q) => q.id);
      const index = ids.indexOf(question.id);
      [ids[index], ids[index + by]] = [ids[index + by]!, ids[index]!];
      return base.reorder.mutateAsync({ audience: question.audience, ids });
    },
  };
  const onSaved = () => {
    setError(null);
    void refresh();
  };

  if (query.error && !query.data) {
    return (
      <SettingsPage title={title}>
        <PageError title={t("didNotLoad")} onRetry={() => void query.refetch()} />
      </SettingsPage>
    );
  }

  return (
    <SettingsPage title={title} lastChange={section.lastChange} setUpAt={section.setUpAt} viewOnly={!editable} loading={query.isLoading}>
      {error ? <p role="alert" className="-mt-4 type-meta text-destructive">{error}</p> : null}
      <div className="overflow-hidden rounded-surface bg-card">
        {AUDIENCES.map((audience) => {
          const list = active(audience);
          return (
            <section key={audience} aria-label={t(`audiences.${audience}`)}>
              <h2 className="border-y border-border bg-inlay px-5 py-2 type-meta-strong text-foreground first:border-t-0">
                {t(`audiences.${audience}`)}
              </h2>
              <ul className="divide-y divide-border">
                {list.map((question, index) => (
                  <QuestionRow key={question.id} question={question} first={index === 0} last={index === list.length - 1}
                    editable={editable} commands={commands} onSaved={onSaved} onError={setError} />
                ))}
                {editable ? <AddQuestion audience={audience} commands={commands} onSaved={onSaved} onError={setError} /> : null}
              </ul>
            </section>
          );
        })}
      </div>
      {archived.length > 0 ? (
        <div className="flex flex-col gap-2">
          <button type="button" aria-expanded={showArchived} onClick={() => setShowArchived((value) => !value)}
            className="inline-flex w-fit items-center gap-2 type-meta-strong text-muted-foreground hover:text-foreground">
            <Archive aria-hidden className="size-3.5" />
            {t("archived", { count: archived.length })}
            <ChevronRight aria-hidden className={cn("size-3.5 transition-transform", showArchived && "rotate-90")} />
          </button>
          {showArchived ? (
            <ul className="divide-y divide-border overflow-hidden rounded-surface border border-dashed border-border">
              {archived.map((question) => (
                <li key={question.id} className="flex items-center gap-3 px-5 py-3 type-body text-muted-foreground">
                  <span className="flex-1">{question.text}</span>
                  <span className="type-meta">{t(`audiences.${question.audience}`)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </SettingsPage>
  );
}

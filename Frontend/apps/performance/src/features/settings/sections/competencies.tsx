"use client";

import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Archive, ChevronRight, Plus, Trash2, X } from "@/lib/icons";
import { ApiError, type CompetencyDto, type FusionSettingsSection } from "@repo/api";
import { useStagedSettings } from "@repo/api/react";
import { Button, cn, Input, Label, Textarea } from "@repo/ds";
import { formatDate } from "@repo/ds/lib/dates";
import { PageError, SettingsPage, StatusBadge, useSettingsSectionName } from "@repo/ds/shell";
import { ValueDot } from "@repo/performance-ui";
import { useCompetencies, useCompetencyMutations } from "@/features/performance/api/use-performance";
import { useRefreshSettingsSections } from "../api";

interface CompetencyDraft {
  name: string;
  description: string;
  behaviors: string[];
}

const EMPTY: CompetencyDraft = { name: "", description: "", behaviors: [""] };

function draftOf(item: CompetencyDto): CompetencyDraft {
  return { name: item.name, description: item.description, behaviors: item.behaviors.length ? item.behaviors : [""] };
}

function clean(draft: CompetencyDraft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    behaviors: draft.behaviors.map((behavior) => behavior.trim()).filter(Boolean),
  };
}

/** A failed save: the conflict by its status, other refusals as the service wrote them in English, else `fallback`. */
function message(error: unknown, fallback: string, conflict: string, english: boolean): string | null {
  if (!error) return null;
  if (error instanceof ApiError && error.status === 409) return conflict;
  return english && error instanceof ApiError && error.errors[0] ? error.errors[0] : fallback;
}

/** One competency open for editing: it saves on its own. In use, it archives; unused, it can be deleted. */
function CompetencyEditor({
  item,
  onClose,
  onSaved,
}: {
  item: CompetencyDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("settings.competencies");
  const locale = useLocale();
  const mutations = useCompetencyMutations();
  const saved = useMemo(() => (item ? draftOf(item) : EMPTY), [item]);
  const { create, update, archive, remove } = mutations;
  const persist = useCallback(
    async (draft: CompetencyDraft) => {
      if (item) await update.mutateAsync({ id: item.id, expectedVersion: item.version, ...clean(draft) });
      else await create.mutateAsync(clean(draft));
      onSaved();
    },
    [item, update, create, onSaved]
  );
  const staged = useStagedSettings(saved, persist, {
    leaveMessage: item ? t("leave", { name: item.name }) : t("leaveNew"),
  });
  const draft = staged.draft ?? saved;
  const inUse = Boolean(item?.firstUsedAt);
  const busy = staged.saving || archive.isLoading || remove.isLoading;
  const error = message(
    staged.error ?? (staged.conflict ? new ApiError(409, "Conflict", [], null) : null) ?? archive.error ?? remove.error,
    t("notSaved"),
    t("conflict"),
    locale === "en"
  );
  const setBehaviors = (behaviors: string[]) => staged.update((current) => ({ ...current, behaviors }));
  const prefix = item?.id ?? "new";

  return (
    <div className="flex flex-col gap-4 bg-inlay px-5 py-5">
      <div className="flex items-center gap-3">
        {item ? <ValueDot id={item.id} className="size-2.5" /> : null}
        <span className="flex-1 type-subsection-title text-foreground">{item?.name ?? t("new")}</span>
        {item && inUse ? (
          <StatusBadge tone="neutral">
            {item.usedIn.length
              ? t("usedIn", { cycles: item.usedIn.join(", ") })
              : t("inUseSince", { date: formatDate(item.firstUsedAt, { year: "always", locale }) })}
          </StatusBadge>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${prefix}-name`}>{t("name")}</Label>
        <Input id={`${prefix}-name`} value={draft.name} onChange={(event) => staged.update((current) => ({ ...current, name: event.target.value }))} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${prefix}-description`}>{t("meaning")}</Label>
        <Textarea
          id={`${prefix}-description`}
          rows={2}
          value={draft.description}
          onChange={(event) => staged.update((current) => ({ ...current, description: event.target.value }))}
        />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 type-subsection-title text-foreground">{t("behaviours")}</legend>
        {draft.behaviors.map((behavior, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              aria-label={t("behaviour", { number: index + 1 })}
              value={behavior}
              onChange={(event) => setBehaviors(draft.behaviors.map((b, i) => (i === index ? event.target.value : b)))}
            />
            {draft.behaviors.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("removeBehaviour", { number: index + 1 })}
                onClick={() => setBehaviors(draft.behaviors.filter((_, i) => i !== index))}
              >
                <X className="size-4" />
              </Button>
            ) : null}
          </div>
        ))}
        <button
          type="button"
          onClick={() => setBehaviors([...draft.behaviors, ""])}
          className="inline-flex w-fit items-center gap-2 rounded-control px-1 py-1 type-subsection-title text-foreground hover:underline"
        >
          <Plus aria-hidden className="size-4" />
          {t("addBehaviour")}
        </button>
      </fieldset>
      {error ? <p role="alert" className="type-meta text-destructive">{error}</p> : null}
      <div className="flex items-center gap-2">
        {item ? (
          inUse ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy || item.state === "Archived"}
              onClick={() => void archive.mutateAsync({ id: item.id, expectedVersion: item.version }).then(onSaved).catch(() => undefined)}
            >
              <Archive aria-hidden className="size-4" />
              {t("archive")}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void remove.mutateAsync({ id: item.id, expectedVersion: item.version }).then(onSaved).catch(() => undefined)}
            >
              <Trash2 aria-hidden className="size-4" />
              {t("delete")}
            </Button>
          )
        ) : null}
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          {t("cancel")}
        </Button>
        <Button size="sm" disabled={busy || !draft.name.trim() || (Boolean(item) && !staged.dirty)} onClick={() => void staged.submit()}>
          {item ? t("save") : t("add")}
        </Button>
      </div>
    </div>
  );
}

function CompetencyRow({ item, onOpen }: { item: CompetencyDto; onOpen?: () => void }) {
  const t = useTranslations("settings.competencies");
  const content = (
    <>
      <ValueDot id={item.id} className="mt-1.5 size-2.5" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="type-subsection-title text-foreground">{item.name}</span>
        <span className="type-meta text-muted-foreground">{item.description}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 type-meta text-muted-foreground">
        <span>{t("behaviourCount", { count: item.behaviors.length })}</span>
        {item.usedIn.length ? <span>{t("usedIn", { cycles: item.usedIn.join(", ") })}</span> : null}
      </span>
      {onOpen ? <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : null}
    </>
  );
  return onOpen ? (
    <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 px-5 py-4 text-start transition-colors hover:bg-inlay/60">
      {content}
    </button>
  ) : (
    <div className="flex items-start gap-3 px-5 py-4">{content}</div>
  );
}

/** Settings › Competencies: the company's competencies, each with its own hue wherever it appears. */
export function CompetenciesSettings({ section }: { section: FusionSettingsSection }) {
  const t = useTranslations("settings.competencies");
  const title = useSettingsSectionName()(section);
  const editable = section.access === "manage";
  const query = useCompetencies();
  const refresh = useRefreshSettingsSections();
  const [open, setOpen] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const active = (query.data ?? []).filter((item) => item.state === "Active");
  const archived = (query.data ?? []).filter((item) => item.state === "Archived");

  if (query.error && !query.data) {
    return (
      <SettingsPage title={title}>
        <PageError title={t("didNotLoad")} onRetry={() => void query.refetch()} />
      </SettingsPage>
    );
  }

  const closeAfterSave = () => {
    setOpen(null);
    void refresh();
  };

  return (
    <SettingsPage
      title={title}
      lastChange={section.lastChange}
      setUpAt={section.setUpAt}
      viewOnly={!editable}
      loading={query.isLoading}
      aside={
        editable ? (
          <Button variant="outline" size="sm" onClick={() => setOpen("new")} disabled={open === "new"}>
            <Plus aria-hidden className="size-4" />
            {t("add")}
          </Button>
        ) : null
      }
    >
      {active.length === 0 && open !== "new" ? (
        <p className="type-body-secondary text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-surface bg-card">
          {open === "new" ? (
            <li>
              <CompetencyEditor item={null} onClose={() => setOpen(null)} onSaved={closeAfterSave} />
            </li>
          ) : null}
          {active.map((item) => (
            <li key={item.id}>
              {open === item.id ? (
                <CompetencyEditor item={item} onClose={() => setOpen(null)} onSaved={closeAfterSave} />
              ) : (
                <CompetencyRow item={item} onOpen={editable ? () => setOpen(item.id) : undefined} />
              )}
            </li>
          ))}
        </ul>
      )}
      {archived.length > 0 ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((value) => !value)}
            className="inline-flex w-fit items-center gap-2 type-meta-strong text-muted-foreground hover:text-foreground"
          >
            <Archive aria-hidden className="size-3.5" />
            {t("archived", { count: archived.length })}
            <ChevronRight aria-hidden className={cn("size-3.5 transition-transform", showArchived && "rotate-90")} />
          </button>
          {showArchived ? (
            <ul className="divide-y divide-border overflow-hidden rounded-surface border border-dashed border-border">
              {archived.map((item) => (
                <li key={item.id}>
                  <CompetencyRow item={item} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </SettingsPage>
  );
}

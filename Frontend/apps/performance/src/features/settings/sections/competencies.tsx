"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Archive, Check, FileSpreadsheet, Pencil, Plus, Sparkles, Trash2, Upload, X } from "@repo/ds/icons";
import {
  ApiError,
  type CompetencyDto,
  type ExpectationSource,
  type FusionSettingsSection,
  type JobFamilyDto,
} from "@repo/api";
import { useStagedSettings } from "@repo/api/react";
import { Button, cn, Dialog, DialogContent, DialogTitle, Input, Label, Spinner, Textarea } from "@repo/ds";
import { formatDate } from "@repo/ds/lib/dates";
import { SettingsPage, StatusBadge, useSettingsSectionName } from "@repo/ds/shell";
import { ValueDot, VALUE_TONE, type ValueTone } from "@repo/performance-ui";
import { PageFailure } from "@repo/auth";
import {
  useCompetenciesByJob,
  useCompetencyExpectationMutations,
  useCompetencyMutations,
} from "@/features/performance/api/use-performance";
import { buildShellUrl } from "@/lib/shell-url";
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

/** One competency, opened from its row name: it saves on its own. In use, it archives; unused, it can be deleted. */
function CompetencyEditor({ item, onClose, onSaved }: { item: CompetencyDto | null; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("settings.competencies");
  const locale = useLocale();
  const { create, update, archive, remove } = useCompetencyMutations();
  const saved = useMemo(() => (item ? draftOf(item) : EMPTY), [item]);
  const persist = useCallback(
    async (draft: CompetencyDraft) => {
      if (item) await update.mutateAsync({ id: item.id, expectedVersion: item.version, ...clean(draft) });
      else await create.mutateAsync(clean(draft));
      onSaved();
    },
    [item, update, create, onSaved]
  );
  const staged = useStagedSettings(saved, persist, { leaveMessage: item ? t("leave", { name: item.name }) : t("leaveNew") });
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {item ? <ValueDot id={item.id} className="size-2.5" /> : null}
        <DialogTitle className="flex-1 type-panel-title text-foreground">{item?.name ?? t("new")}</DialogTitle>
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
            <Button writes variant="outline" size="sm" disabled={busy}
              onClick={() => void archive.mutateAsync({ id: item.id, expectedVersion: item.version }).then(onSaved).catch(() => undefined)}>
              <Archive aria-hidden className="size-4" />
              {t("archive")}
            </Button>
          ) : (
            <Button writes variant="ghost" size="sm" disabled={busy}
              onClick={() => void remove.mutateAsync({ id: item.id, expectedVersion: item.version }).then(onSaved).catch(() => undefined)}>
              <Trash2 aria-hidden className="size-4" />
              {t("delete")}
            </Button>
          )
        ) : null}
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          {t("cancel")}
        </Button>
        <Button writes size="sm" disabled={busy || !draft.name.trim() || (Boolean(item) && !staged.dirty)} onClick={() => void staged.submit()}>
          {item ? t("save") : t("add")}
        </Button>
      </div>
    </div>
  );
}

type CellKey = `${string}:${string}`;
const keyOf = (competencyId: string, levelId: string): CellKey => `${competencyId}:${levelId}`;

/** Words proposed for a cell and not saved yet: drafted from the jobs or read from the company's file. */
interface Proposal {
  text: string;
  source: Exclude<ExpectationSource, "Written">;
}

interface FileRead {
  name: string;
  read: number;
  of: number;
  unread: string[];
}

const initialsOf = (name: string) => name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("");

/** An empty cell (D-94): faint stripes, Write on hover; no "Not set". */
function EmptyCell({ onWrite, label }: { onWrite?: () => void; label: string }) {
  const t = useTranslations("settings.competencies");
  const stripes = "bg-[repeating-linear-gradient(135deg,color-mix(in_oklab,var(--muted-foreground)_15%,transparent)_0_1.5px,transparent_1.5px_8px)]";
  if (!onWrite) return <div aria-label={label || undefined} className={cn("min-h-[58px] rounded-inset", stripes)} />;
  return (
    <button
      type="button"
      onClick={onWrite}
      aria-label={label}
      className={cn("group grid min-h-[58px] place-items-center rounded-inset outline-none focus-visible:ring-2 focus-visible:ring-ring", stripes)}
    >
      <span className="inline-flex items-center gap-1.5 rounded-full bg-card py-1 ps-2 pe-3 type-meta-strong text-foreground opacity-0 shadow-[inset_0_0_0_1px_var(--border)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <Plus aria-hidden className="size-3.5" />
        {t("write")}
      </span>
    </button>
  );
}

/** A cell open for writing: Enter saves, Shift+Enter breaks a line, Escape leaves it as it was. */
function CellEditor({ initial, label, onSave, onCancel }: { initial: string; label: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && text.trim() !== initial.trim()) onSave(text);
    else onCancel();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  };
  return (
    <Textarea
      autoFocus
      aria-label={label}
      value={text}
      maxLength={500}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
      className="min-h-[58px] resize-none rounded-inset bg-field px-[18px] py-3.5 font-editorial text-[16px] leading-[1.45]"
    />
  );
}

/** Settings › Competencies (D-41, D-94, D-101): what each job asks, family by family, one competency at a time as a ladder. */
export function CompetenciesSettings({ section }: { section: FusionSettingsSection }) {
  const t = useTranslations("settings.competencies");
  const title = useSettingsSectionName()(section);
  const editable = section.access === "manage";
  const query = useCompetenciesByJob();
  const refresh = useRefreshSettingsSections();
  const { save, draft, read } = useCompetencyExpectationMutations();
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Record<CellKey, Proposal>>({});
  const [file, setFile] = useState<FileRead | null>(null);
  const [drafted, setDrafted] = useState(false);
  const [editing, setEditing] = useState<CellKey | null>(null);
  const [compId, setCompId] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const data = query.data;
  // Opens on the family with the most people: where expectations matter to most reviews.
  const family = data?.families.find((item) => item.id === familyId)
    ?? data?.families.reduce<JobFamilyDto | null>((most, item) => (!most || item.people > most.people ? item : most), null) ?? null;
  const competencies = data?.competencies ?? [];

  // A new family starts clean: proposals belong to the family they were made for.
  useEffect(() => {
    setProposals({});
    setFile(null);
    setDrafted(false);
    setEditing(null);
  }, [family?.id]);

  if (query.error && !data) {
    return (
      <SettingsPage title={title}>
        <PageFailure error={query.error} onRetry={() => void query.refetch()} headingLevel={2} />
      </SettingsPage>
    );
  }

  const written = new Map(
    (data?.expectations ?? []).filter((item) => item.familyId === family?.id).map((item) => [keyOf(item.competencyId, item.levelId), item.text])
  );
  const levels = family?.levels ?? [];
  const pendingDrafts = Object.entries(proposals).filter(([, item]) => item.source === "Drafted");
  const pendingFile = Object.entries(proposals).filter(([, item]) => item.source === "File");
  const emptyCount = competencies.length * levels.length - written.size;
  const intro = editable && !started && (data?.expectations.length ?? 0) === 0;

  const write = (cells: { key: CellKey; text: string | null; source: ExpectationSource }[]) => {
    if (!family) return Promise.resolve();
    setProposals((current) => {
      const next = { ...current };
      for (const cell of cells) delete next[cell.key];
      return next;
    });
    return save
      .mutateAsync({
        familyId: family.id,
        cells: cells.map(({ key, text, source }) => {
          const [competencyId, levelId] = key.split(":") as [string, string];
          return { competencyId, levelId, text, source };
        }),
      })
      .catch(() => toast.error(t("notSavedCell")));
  };

  const runDraft = async (target: JobFamilyDto | null = family) => {
    if (!target) return;
    setStarted(true);
    setFamilyId(target.id);
    try {
      const result = await draft.mutateAsync(target.id);
      setProposals(Object.fromEntries(result.cells.map((cell) => [keyOf(cell.competencyId, cell.levelId), { text: cell.text, source: "Drafted" }])));
      setDrafted(true);
      if (result.cells.length === 0) toast(t("nothingDrafted"));
    } catch {
      toast.error(t("draftFailed"));
    }
  };

  const readFile = async (chosen: File | undefined) => {
    if (!chosen || !family) return;
    setStarted(true);
    try {
      const result = await read.mutateAsync({ familyId: family.id, file: chosen });
      setProposals(Object.fromEntries(result.cells.map((cell) => [keyOf(cell.competencyId, cell.levelId), { text: cell.text, source: "File" }])));
      setFile({ name: result.fileName ?? chosen.name, read: result.cells.length, of: result.of, unread: result.unread });
    } catch (error) {
      toast.error(error instanceof ApiError && error.errors[0] && error.status === 400 ? error.errors[0] : t("fileFailed"));
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const writeFirstEmpty = () => {
    setStarted(true);
    const first = competencies.flatMap((c) => levels.map((l) => keyOf(c.id, l.id))).find((key) => !written.has(key));
    if (first) {
      setCompId(first.split(":")[0] ?? null);
      setEditing(first);
    }
  };

  const closeEditor = () => {
    setOpen(null);
    void refresh();
  };

  const hiddenFile = (
    <input
      ref={fileInput}
      type="file"
      accept=".xlsx,.csv"
      className="hidden"
      aria-hidden
      tabIndex={-1}
      onChange={(event) => void readFile(event.target.files?.[0])}
    />
  );

  const families = data?.families ?? [];
  const levelCount = new Set(families.flatMap((item) => item.levels.map((level) => level.id))).size;
  const active = data?.competencies ?? [];
  const openIndex = Math.max(0, active.findIndex((item) => item.id === compId));
  const current = active[openIndex] ?? null;
  const toneOf = (index: number) => VALUE_TONE[((index % 5) + 1) as ValueTone];

  // A rung's words: written, drafted (Apply or dismiss), read from the file (use it), being written, or the striped empty.
  const words = (competency: CompetencyDto, levelId: string, levelLabel: string) => {
    const key = keyOf(competency.id, levelId);
    const label = t("cell", { competency: competency.name, level: levelLabel });
    const text = written.get(key);
    if (editing === key)
      return (
        <CellEditor
          key={key}
          initial={text ?? proposals[key]?.text ?? ""}
          label={label}
          onCancel={() => setEditing(null)}
          onSave={(value) => {
            setEditing(null);
            void write([{ key, text: value, source: "Written" }]);
          }}
        />
      );
    if (text !== undefined)
      return (
        <div className="group flex min-h-[58px] animate-in items-center gap-3 rounded-inset bg-inlay px-[18px] py-3.5 fade-in-0">
          <span className="min-w-0 flex-1 font-editorial text-[16px] leading-[1.45] text-foreground">{text}</span>
          {editable ? (
            <button
              type="button"
              aria-label={t("rewrite", { competency: competency.name, level: levelLabel })}
              onClick={() => setEditing(key)}
              className="shrink-0 rounded-control-sm p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-card hover:text-foreground focus-visible:opacity-100"
            >
              <Pencil aria-hidden className="size-4" />
            </button>
          ) : null}
        </div>
      );
    const proposal = proposals[key];
    if (proposal?.source === "Drafted")
      return (
        <div className="flex min-h-[58px] animate-in items-center gap-3 rounded-inset bg-[color-mix(in_oklab,var(--identity-4)_10%,var(--card))] px-[18px] py-3.5 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--identity-4)_30%,transparent)] fade-in-0">
          <span className="min-w-0 flex-1 font-editorial text-[16px] leading-[1.45] text-foreground">{proposal.text}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            <Sparkles aria-label={t("drafted")} className="size-4 text-[var(--identity-4)]" />
            <button
              type="button"
              onClick={() => void write([{ key, text: proposal.text, source: "Drafted" }])}
              className="rounded-control-sm bg-card px-2.5 py-1 text-[12px] font-semibold text-foreground hover:bg-section"
            >
              {t("apply")}
            </button>
            <button
              type="button"
              aria-label={t("dismiss", { competency: competency.name, level: levelLabel })}
              onClick={() => setProposals(({ [key]: _gone, ...rest }) => rest)}
              className="rounded-control-sm p-1 text-muted-foreground hover:text-foreground"
            >
              <X aria-hidden className="size-4" />
            </button>
          </span>
        </div>
      );
    if (proposal?.source === "File")
      return (
        <button
          type="button"
          title={t("useThisOne")}
          aria-label={t("useCell", { competency: competency.name, level: levelLabel })}
          onClick={() => void write([{ key, text: proposal.text, source: "File" }])}
          className="min-h-[58px] animate-in rounded-inset bg-[color-mix(in_oklab,var(--identity-2)_9%,var(--card))] px-[18px] py-3.5 text-start font-editorial text-[16px] leading-[1.45] text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--identity-2)_30%,transparent)] fade-in-0 hover:shadow-[inset_0_0_0_1.5px_var(--identity-2)]"
        >
          {proposal.text}
        </button>
      );
    return (
      <EmptyCell
        label={label}
        onWrite={
          editable
            ? () => {
                setStarted(true);
                setEditing(key);
              }
            : undefined
        }
      />
    );
  };

  const headerAction = () => {
    if (!editable || !family) return null;
    if (file) {
      if (pendingFile.length === 0)
        return (
          <span className="inline-flex items-center gap-1.5 type-meta-strong text-success">
            <Check aria-hidden className="size-4" />
            {t("frameworkIn")}
          </span>
        );
      return (
        <>
          <span className="inline-flex items-center gap-2 rounded-control-sm bg-inlay px-3 py-1.5 type-meta-strong text-foreground">
            <FileSpreadsheet aria-hidden className="size-4 text-[var(--identity-2)]" />
            {file.name}
            <span className="font-medium text-muted-foreground">{t("readOf", { read: file.read, of: file.of })}</span>
          </span>
          <Button
            writes
            size="sm"
            disabled={save.isLoading}
            onClick={() => void write(pendingFile.map(([key, item]) => ({ key: key as CellKey, text: item.text, source: "File" as const })))}
          >
            {t("useAll", { count: pendingFile.length })}
          </Button>
        </>
      );
    }
    if (drafted)
      return pendingDrafts.length ? (
        <>
          <span className="type-meta text-muted-foreground">{t("draftsToLook", { count: pendingDrafts.length })}</span>
          <Button
            writes
            variant="outline"
            size="sm"
            disabled={save.isLoading}
            onClick={() => void write(pendingDrafts.map(([key, item]) => ({ key: key as CellKey, text: item.text, source: "Drafted" as const })))}
          >
            {t("applyAll", { count: pendingDrafts.length })}
          </Button>
        </>
      ) : emptyCount === 0 ? (
        <span className="inline-flex items-center gap-1.5 type-meta-strong text-success">
          <Check aria-hidden className="size-4" />
          {t("everyLevelSet")}
        </span>
      ) : null;
    return (
      <>
        {data?.canDraft && emptyCount > 0 && competencies.length > 0 ? (
          <Button writes variant="outline" size="sm" disabled={draft.isLoading} onClick={() => void runDraft()}>
            {draft.isLoading ? <Spinner aria-hidden className="size-4" /> : <Sparkles aria-hidden className="size-4" />}
            {t("draftEmpty")}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" disabled={read.isLoading} onClick={() => fileInput.current?.click()}>
          {read.isLoading ? <Spinner aria-hidden className="size-4" /> : <Upload aria-hidden className="size-4" />}
          {t("fromFile")}
        </Button>
      </>
    );
  };

  // The family's competencies, each with its hue, serif name and a bar per level: written in its hue, drafted in violet.
  const competencyList = (
    <nav aria-label={t("competencies")} className="grid content-start gap-1">
      {active.map((competency, index) => {
        const tone = toneOf(index);
        const isOpen = competency.id === current?.id;
        return (
          <button
            key={competency.id}
            type="button"
            aria-current={isOpen ? "true" : undefined}
            onClick={() => {
              setCompId(competency.id);
              setEditing(null);
            }}
            className={cn("grid gap-2 rounded-control px-3.5 py-3 text-start transition-colors hover:bg-inlay/60", isOpen && "bg-inlay hover:bg-inlay")}
          >
            <span className="flex items-center gap-2.5">
              <span aria-hidden className={cn("size-2.5 shrink-0 rounded-[4px]", tone.fill)} />
              <span className="font-editorial text-[15.5px] leading-snug font-medium text-foreground">{competency.name}</span>
            </span>
            <span aria-hidden className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${Math.max(levels.length, 1)}, minmax(0, 1fr))` }}>
              {levels.map((level) => {
                const key = keyOf(competency.id, level.id);
                return (
                  <i
                    key={level.id}
                    className={cn(
                      "h-[5px] rounded-full",
                      written.has(key)
                        ? tone.fill
                        : proposals[key]
                          ? "bg-[color-mix(in_oklab,var(--identity-4)_55%,transparent)]"
                          : isOpen
                            ? "bg-muted-foreground/25"
                            : "bg-inlay"
                    )}
                  />
                );
              })}
            </span>
          </button>
        );
      })}
      {editable ? (
        <button
          type="button"
          onClick={() => setOpen("new")}
          className="mt-1 inline-flex w-fit items-center gap-2 px-3.5 py-1.5 type-meta-strong text-muted-foreground hover:text-foreground"
        >
          <Plus aria-hidden className="size-4" />
          {t("add")}
        </button>
      ) : null}
    </nav>
  );

  // The open competency as a ladder: its name and meaning, then each level with who holds it and its words at full width.
  const ladder = (ghost = false) => {
    if (!current) return null;
    const tone = toneOf(openIndex);
    return (
      <div className={cn("grid min-w-0 gap-[18px]", ghost && "pointer-events-none opacity-50")} aria-hidden={ghost || undefined}>
        <div className="grid gap-1.5">
          <h3 className="flex items-center gap-3 font-editorial text-[26px] leading-tight font-medium text-foreground">
            <span aria-hidden className={cn("size-3.5 shrink-0 rounded-[5px]", tone.fill)} />
            {editable && !ghost ? (
              <button type="button" onClick={() => setOpen(current.id)} className="text-start hover:underline">
                {current.name}
              </button>
            ) : (
              current.name
            )}
          </h3>
          <p className="max-w-[65ch] type-body-secondary text-muted-foreground">{current.description}</p>
        </div>
        <ol className="grid gap-2">
          {levels.map((level) => (
            <li key={level.id} className="grid gap-x-[18px] gap-y-1.5 sm:grid-cols-[150px_minmax(0,1fr)]">
              <div className="grid content-start gap-1 sm:pt-3.5">
                <b className="type-subsection-title text-foreground">{level.label}</b>
                <span className="inline-flex items-center gap-1.5 type-meta text-muted-foreground" title={level.example?.displayName}>
                  {level.example ? (
                    <span aria-hidden className="grid size-[22px] shrink-0 place-items-center rounded-full bg-inlay text-[9.5px] font-bold text-foreground">
                      {initialsOf(level.example.displayName)}
                    </span>
                  ) : null}
                  {t("people", { count: level.people })}
                </span>
              </div>
              {ghost ? <EmptyCell label="" /> : words(current, level.id, level.label)}
            </li>
          ))}
        </ol>
      </div>
    );
  };

  let body;
  if (!data) body = null;
  else if (families.length === 0)
    body = (
      <section className="flex flex-col gap-3 rounded-surface bg-card p-6">
        <h2 className="type-section-title text-foreground">{t("byJob")}</h2>
        <p className="type-body-secondary text-muted-foreground">{t("noFamilies")}</p>
        <a href={buildShellUrl("/core/organization/jobs").toString()} className="w-fit type-meta-strong text-primary-ink hover:underline">
          {t("openJobs")}
        </a>
      </section>
    );
  else if (intro)
    body = (
      <section className="flex flex-col gap-5 rounded-surface bg-card p-6">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="type-section-title text-foreground">{t("byJob")}</h2>
          <span className="ms-auto type-meta text-muted-foreground">{t("fromCore", { families: families.length, levels: levelCount })}</span>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {active.length === 0 ? (
            <Button writes onClick={() => setOpen("new")}>
              <Plus aria-hidden className="size-4" />
              {t("add")}
            </Button>
          ) : (
            <>
              {data.canDraft ? (
                <Button writes disabled={draft.isLoading} onClick={() => void runDraft()}>
                  {draft.isLoading ? <Spinner aria-hidden className="size-4" /> : <Sparkles aria-hidden className="size-4" />}
                  {t("draftFromJobs")}
                </Button>
              ) : null}
              <Button variant="outline" disabled={read.isLoading} onClick={() => fileInput.current?.click()}>
                {read.isLoading ? <Spinner aria-hidden className="size-4" /> : <Upload aria-hidden className="size-4" />}
                {t("ownFramework")}
              </Button>
              <Button variant="outline" onClick={writeFirstEmpty}>
                <Pencil aria-hidden className="size-4" />
                {t("writeThem")}
              </Button>
            </>
          )}
        </div>
        {active.length ? ladder(true) : null}
      </section>
    );
  else
    body = (
      <section className="flex flex-col gap-5 rounded-surface bg-card p-[26px]">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="type-section-title text-foreground">{t("familyByLevel", { family: family?.label ?? "" })}</h2>
          <div className="ms-auto flex flex-wrap items-center gap-2">{headerAction()}</div>
        </div>
        {file?.unread.length && pendingFile.length ? (
          <p className="-mt-3 type-meta text-muted-foreground">{t("notRead", { names: file.unread.join(", ") })}</p>
        ) : null}
        <div className="grid items-start gap-[26px] lg:grid-cols-[200px_minmax(0,1fr)]">
          <nav aria-label={t("families")} className="grid gap-0.5">
            {families.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={item.id === family?.id ? "true" : undefined}
                onClick={() => setFamilyId(item.id)}
                className={cn(
                  "flex items-center justify-between rounded-control px-3 py-2 text-start type-body text-muted-foreground hover:text-foreground",
                  item.id === family?.id && "bg-inlay font-semibold text-foreground"
                )}
              >
                <span>{item.label}</span>
                <span className="type-meta tabular-nums text-muted-foreground">{item.people}</span>
              </button>
            ))}
          </nav>
          {active.length === 0 ? (
            <div className="grid gap-3">
              <p className="type-body-secondary text-muted-foreground">{t("empty")}</p>
              {editable ? (
                <Button writes variant="outline" size="sm" className="w-fit" onClick={() => setOpen("new")}>
                  <Plus aria-hidden className="size-4" />
                  {t("add")}
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[250px_minmax(0,1fr)]">
              {competencyList}
              {ladder()}
            </div>
          )}
        </div>
      </section>
    );

  return (
    <SettingsPage title={title} lastChange={section.lastChange} setUpAt={section.setUpAt} viewOnly={!editable} loading={query.isLoading} studio>
      {hiddenFile}
      {body}
      <Dialog open={open !== null} onOpenChange={(value) => (!value ? setOpen(null) : undefined)}>
        <DialogContent className="sm:max-w-lg">
          {open !== null ? (
            <CompetencyEditor item={active.find((item) => item.id === open) ?? null} onClose={() => setOpen(null)} onSaved={closeEditor} />
          ) : null}
        </DialogContent>
      </Dialog>
    </SettingsPage>
  );
}

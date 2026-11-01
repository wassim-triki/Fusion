"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { ChecklistKind, ChecklistOwner, ChecklistTemplateTaskInput, FusionSettingsSection } from "@repo/api";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@repo/ds";
import { PageError, SettingsBlock, SettingsPage, SettingsRows, SettingsSaveBar, useSettingsSectionName } from "@repo/ds/shell";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useRefusal } from "@/i18n/words";
import { useChecklistTemplates, useSaveChecklistTemplate } from "@/features/checklists/use-checklists";

const OWNERS: ChecklistOwner[] = ["hr", "manager", "person"];
const KINDS: ChecklistKind[] = ["joining", "leaving"];
type Drafts = Record<ChecklistKind, ChecklistTemplateTaskInput[]>;

const same = (a: ChecklistTemplateTaskInput[], b: ChecklistTemplateTaskInput[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Settings › Joining and leaving (B-184): the tasks a hire or an end of employment copies onto the person, for HR, the
 * manager and the person, each due a number of days from the first or the last day. Checklists already made keep
 * their tasks.
 */
export function ChecklistsSettings({ section }: { section: FusionSettingsSection }) {
  const t = useTranslations("checklists.settings");
  const ds = useTranslations("ds.settings");
  const refusal = useRefusal();
  const title = useSettingsSectionName()(section);
  const editable = section.access === "manage";
  const query = useChecklistTemplates();
  const save = useSaveChecklistTemplate();
  const [drafts, setDrafts] = useState<Drafts | null>(null);

  if (query.error && !query.data) {
    return <SettingsPage title={title}><PageError title={ds("didNotLoad")} onRetry={() => void query.refetch()} /></SettingsPage>;
  }
  if (!query.data) return <SettingsPage title={title} loading />;

  const saved: Drafts = {
    joining: query.data.joining.map(({ title, owner, offsetDays }) => ({ title, owner, offsetDays })),
    leaving: query.data.leaving.map(({ title, owner, offsetDays }) => ({ title, owner, offsetDays })),
  };
  const current = drafts ?? saved;
  const changed = KINDS.filter((kind) => !same(current[kind], saved[kind]));
  const edit = (kind: ChecklistKind, tasks: ChecklistTemplateTaskInput[]) => setDrafts({ ...current, [kind]: tasks });

  async function saveAll() {
    try {
      for (const kind of changed) await save.mutateAsync({ kind, tasks: current[kind] });
      setDrafts(null);
      toast.success(t("saved"));
    } catch (caught) {
      toast.error(refusal(caught, t("didNotSave")));
    }
  }

  return (
    <SettingsPage title={title} lastChange={section.lastChange} setUpAt={section.setUpAt} viewOnly={!editable} wide>
      {KINDS.map((kind) => (
        <TemplateBlock key={kind} kind={kind} tasks={current[kind]} editable={editable} onChange={(tasks) => edit(kind, tasks)} />
      ))}
      {editable ? (
        <SettingsSaveBar
          changes={changed.length}
          saving={save.isLoading}
          onDiscard={() => setDrafts(null)}
          onSave={() => void saveAll()}
          onReload={() => void query.refetch()}
        />
      ) : null}
    </SettingsPage>
  );
}

function TemplateBlock({ kind, tasks, editable, onChange }: {
  kind: ChecklistKind;
  tasks: ChecklistTemplateTaskInput[];
  editable: boolean;
  onChange: (tasks: ChecklistTemplateTaskInput[]) => void;
}) {
  const t = useTranslations("checklists.settings");
  const [title, setTitle] = useState("");
  const update = (index: number, task: ChecklistTemplateTaskInput) => onChange(tasks.map((item, at) => (at === index ? task : item)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...tasks];
    [next[index], next[index + by]] = [next[index + by]!, next[index]!];
    onChange(next);
  };

  function add(event: FormEvent) {
    event.preventDefault();
    const text = title.trim();
    if (!text) return;
    onChange([...tasks, { title: text, owner: "hr", offsetDays: kind === "joining" ? -3 : 0 }]);
    setTitle("");
  }

  return (
    <SettingsBlock title={t(`kind.${kind}`)} meta={tasks.length || undefined}>
      <SettingsRows>
        {tasks.length === 0 ? <p className="px-5 py-4 type-body text-muted-foreground">{t(`empty.${kind}`)}</p> : null}
        {tasks.map((task, index) => (
          <div key={index} className="flex min-h-[52px] items-center gap-3 px-5 py-2">
            {editable ? (
              <Input value={task.title} maxLength={200} aria-label={t("taskName")} className="h-8 min-w-0 flex-1"
                onChange={(event) => update(index, { ...task, title: event.target.value })} />
            ) : (
              <span className="min-w-0 flex-1 truncate type-body">{task.title}</span>
            )}
            <OwnerPicker value={task.owner} disabled={!editable} onChange={(owner) => update(index, { ...task, owner })} />
            <DuePicker kind={kind} value={task.offsetDays} disabled={!editable} onChange={(offsetDays) => update(index, { ...task, offsetDays })} />
            {editable ? (
              <span className="flex shrink-0 items-center gap-0.5">
                <Button variant="ghost" size="icon-sm" aria-label={t("moveUp")} disabled={index === 0} onClick={() => move(index, -1)}>
                  <ArrowUp className="size-3.5" aria-hidden />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={t("moveDown")} disabled={index === tasks.length - 1} onClick={() => move(index, 1)}>
                  <ArrowDown className="size-3.5" aria-hidden />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={t("remove")} onClick={() => onChange(tasks.filter((_, at) => at !== index))}>
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </span>
            ) : null}
          </div>
        ))}
        {editable ? (
          <form onSubmit={add} className="flex items-center gap-2.5 px-5 py-2.5">
            <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <Input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder={t("addPlaceholder")}
              aria-label={t("add")}
              className="h-8 border-transparent bg-transparent px-1 shadow-none focus-visible:border-input dark:bg-transparent" />
            {title.trim() ? <Button type="submit" size="sm">{t("addAction")}</Button> : null}
          </form>
        ) : null}
      </SettingsRows>
    </SettingsBlock>
  );
}

function OwnerPicker({ value, disabled, onChange }: { value: ChecklistOwner; disabled: boolean; onChange: (owner: ChecklistOwner) => void }) {
  const t = useTranslations("checklists");
  return (
    <Select value={value} disabled={disabled} onValueChange={(next) => onChange(next as ChecklistOwner)}>
      <SelectTrigger aria-label={t("settings.who")} className="h-8 w-32 shrink-0"><SelectValue /></SelectTrigger>
      <SelectContent>
        {OWNERS.map((owner) => <SelectItem key={owner} value={owner}>{t(`owner.${owner}`)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** "3 days before", "On the day", "2 days after": a count and a side, relative to the first or last day. */
function DuePicker({ kind, value, disabled, onChange }: { kind: ChecklistKind; value: number; disabled: boolean; onChange: (days: number) => void }) {
  const t = useTranslations("checklists.settings");
  const side = value < 0 ? "before" : value > 0 ? "after" : "on";
  const days = Math.abs(value);
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {side !== "on" ? (
        <Input type="number" min={1} max={90} value={days} disabled={disabled} aria-label={t("days")} className="h-8 w-16 tabular-nums"
          onChange={(event) => {
            const count = Math.min(90, Math.max(1, Number(event.target.value) || 1));
            onChange(side === "before" ? -count : count);
          }} />
      ) : <span className="w-16" aria-hidden />}
      <Select value={side} disabled={disabled}
        onValueChange={(next) => onChange(next === "on" ? 0 : (next === "before" ? -1 : 1) * Math.max(days, 1))}>
        <SelectTrigger aria-label={t("when")} className="h-8 w-56"><SelectValue /></SelectTrigger>
        <SelectContent>
          {(["before", "on", "after"] as const).map((option) => (
            <SelectItem key={option} value={option}>{t(`due.${kind}.${option}`, { count: days || 1 })}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
  );
}

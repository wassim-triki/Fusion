"use client";

import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import type { ChecklistDto, ChecklistTaskDto } from "@repo/api";
import { Button, Checkbox, cn } from "@repo/ds";
import { Section, StatusBadge } from "@repo/ds/shell";
import { dateFormatter } from "@repo/ds/lib/dates";
import { useRefusal } from "@/i18n/words";
import { usePersonChecklists, useSetChecklistTask } from "./use-checklists";

const DAY = { weekday: "short", day: "numeric", month: "short" } as const;
const at = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/**
 * The person's joining or leaving checklist on their page (B-184), with only the tasks the viewer may see: HR all,
 * the manager theirs and the person's, the person their own (for a joiner, their first week, D-27). Shows only when
 * there is one.
 */
export function ChecklistSection({
  employeeKey,
  isSelf,
  title,
  owner,
}: {
  employeeKey: string;
  isSelf: boolean;
  /** Replaces the kind's title (the Team page's "Yasmine's first week"). */
  title?: string;
  /** Only this owner's tasks (the Team page shows the manager's own). */
  owner?: ChecklistTaskDto["owner"];
}) {
  const t = useTranslations("checklists");
  const query = usePersonChecklists(employeeKey);

  if (query.error && !query.data) {
    return (
      <Section id="checklist" title={t("title.Joining")}>
        <p className="flex items-center gap-3 type-body text-muted-foreground">
          {t("didNotLoad")}
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>{t("retry")}</Button>
        </p>
      </Section>
    );
  }
  const current = query.data?.[0];
  if (!current) return null;
  const checklist = owner ? { ...current, tasks: current.tasks.filter((task) => task.owner === owner) } : current;
  if (checklist.tasks.length === 0) return null;
  return <ChecklistCard checklist={checklist} isSelf={isSelf} title={title} />;
}

function ChecklistCard({ checklist, isSelf, title: titled }: { checklist: ChecklistDto; isSelf: boolean; title?: string }) {
  const t = useTranslations("checklists");
  const locale = useLocale();
  const day = (iso: string) => dateFormatter(DAY, locale).format(at(iso));
  const done = checklist.tasks.filter((task) => task.doneAt).length;
  const title = titled ?? (isSelf ? t(`title.you.${checklist.kind}`) : t(`title.${checklist.kind}`));
  return (
    <Section
      id="checklist"
      title={title}
      meta={t("progress", { done, count: checklist.tasks.length })}
      action={<span className="type-meta text-muted-foreground">{t(`day.${checklist.kind}`, { date: day(checklist.day) })}</span>}
      flush
    >
      <ul className="divide-y divide-border">
        {checklist.tasks.map((task) => <TaskRow key={task.id} task={task} isSelf={isSelf} day={day} />)}
      </ul>
    </Section>
  );
}

function TaskRow({ task, isSelf, day }: { task: ChecklistTaskDto; isSelf: boolean; day: (iso: string) => string }) {
  const t = useTranslations("checklists");
  const refusal = useRefusal();
  const tick = useSetChecklistTask();
  const done = Boolean(task.doneAt);
  const late = !done && task.dueDate < todayIso();
  const id = `task-${task.id}`;

  async function toggle(next: boolean) {
    try {
      await tick.mutateAsync({ id: task.id, done: next });
    } catch (caught) {
      toast.error(refusal(caught, t("didNotSave")));
    }
  }

  return (
    <li className="flex min-h-[52px] items-center gap-3 px-5 py-2.5">
      <Checkbox id={id} checked={done} disabled={!task.canComplete || tick.isLoading} onCheckedChange={(next) => void toggle(next === true)} />
      <label htmlFor={id} className="min-w-0 flex-1">
        <span className={cn("block truncate type-body", done && "text-muted-foreground line-through")}>{task.title}</span>
        {done && task.doneBy && task.doneAt ? (
          <span className="block type-meta text-muted-foreground">{t("doneBy", { name: task.doneBy, date: day(task.doneAt) })}</span>
        ) : null}
      </label>
      {!(isSelf && task.owner === "person") ? <StatusBadge tone="muted">{t(`owner.${task.owner}`)}</StatusBadge> : null}
      <span className={cn("w-24 shrink-0 text-end type-meta tabular-nums", late ? "text-destructive" : "text-muted-foreground")}>
        {day(task.dueDate)}
      </span>
    </li>
  );
}

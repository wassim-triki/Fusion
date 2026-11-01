"use client";

import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check } from "lucide-react";
import { coreChecklistQueryKeys, createCoreChecklistsApi, createPlatformApiClient, type ChecklistTaskDto } from "@repo/api";
import { useApiQuery, useMyTeam, usePeoplePhotos } from "@repo/api/query";
import { Button, PersonAvatar, cn } from "@repo/ds";
import { ProgressSegments } from "@repo/ds/shell";

const DAY_MS = 86_400_000;

/** Your team beside the day (D-12): their faces, how many, and who joins next. Only for someone with a team. */
export function YourTeamCard() {
  const t = useTranslations("home.team");
  const format = useFormatter();
  const team = useMyTeam();
  const members = team.data?.members ?? [];
  const photos = usePeoplePhotos(members.filter((person) => person.photoUrl).map((person) => person.employeeId));
  if (!team.data || members.length === 0) return null;
  const joining = team.data.comingUp.find((event) => event.kind === "Joins" || event.kind === "MovesIn");
  const joiner = joining ? members.find((person) => person.employeeKey === joining.employeeKey) : null;
  return (
    <section aria-labelledby="team-title" className="grid gap-3.5 rounded-surface bg-card px-[22px] py-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="team-title" className="type-subsection-title">{t("title")}</h3>
        <a href="/core/team" className="inline-flex items-center gap-1 type-meta font-medium text-foreground hover:underline">
          {t("open")}
          <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
        </a>
      </div>
      <span className="flex">
        {members.slice(0, 6).map((person) => (
          <PersonAvatar
            key={person.employeeId}
            name={person.displayName}
            photo={photos.get(person.employeeId)}
            size="sm"
            className="-ms-2 ring-2 ring-card first:ms-0"
          />
        ))}
      </span>
      <p className="type-meta text-muted-foreground">
        {t("count", { count: members.length })}
        {joiner && joining
          ? ` · ${t("joins", { name: joiner.displayName, day: format.dateTime(new Date(`${joining.date}T00:00:00`), { weekday: "long" }) })}`
          : ""}
      </p>
    </section>
  );
}

/**
 * A joiner's first day is their first week (D-12): their own joining tasks, ticked here, until a week after they
 * started. Nothing for anyone else.
 */
export function FirstWeekCard() {
  const t = useTranslations("home.firstWeek");
  const format = useFormatter();
  const api = useMemo(() => createCoreChecklistsApi(createPlatformApiClient()), []);
  const queryClient = useQueryClient();
  const mine = useApiQuery(coreChecklistQueryKeys.mine(), (signal) => api.mine(signal));
  const [busy, setBusy] = useState<string | null>(null);
  const today = new Date();
  const joining = (mine.data ?? []).find((checklist) => {
    if (checklist.kind !== "Joining") return false;
    const since = (today.getTime() - new Date(`${checklist.day}T00:00:00`).getTime()) / DAY_MS;
    return since >= 0 && since < 7;
  });
  const tasks = joining?.tasks.filter((task) => task.owner === "person") ?? [];
  if (tasks.length === 0) return null;
  const done = tasks.filter((task) => task.doneAt).length;

  const tick = async (task: ChecklistTaskDto) => {
    setBusy(task.id);
    try {
      await api.setDone(task.id, !task.doneAt);
      await queryClient.invalidateQueries({ queryKey: coreChecklistQueryKeys.all() });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="first-week-title" className="grid gap-4 rounded-surface bg-card px-7 pt-6 pb-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="first-week-title" className="type-section-title">{t("title")}</h2>
        <ProgressSegments done={done} total={tasks.length} label={t("progress", { done, total: tasks.length })} />
      </div>
      <ol className="grid">
        {tasks.map((task) => (
          <li key={task.id} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-4 border-t border-border py-3.5 first:border-t-0">
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full border-[1.5px]",
                task.doneAt ? "border-primary bg-primary text-primary-foreground" : "border-border",
              )}
            >
              {task.doneAt ? <Check className="size-3.5" strokeWidth={2.4} aria-hidden /> : null}
            </span>
            <div className="min-w-0">
              <p className={cn("type-label", task.doneAt && "text-muted-foreground line-through decoration-border")}>{task.title}</p>
              <p className="type-meta text-muted-foreground">
                {task.doneAt ? t("doneOn", { day: format.dateTime(new Date(task.doneAt), { weekday: "long" }) }) : t("by", { day: format.dateTime(new Date(`${task.dueDate}T00:00:00`), { day: "numeric", month: "short" }) })}
              </p>
            </div>
            {task.canComplete ? (
              <Button type="button" size="sm" variant={task.doneAt ? "ghost" : "outline"} disabled={busy === task.id} onClick={() => void tick(task)}>
                {task.doneAt ? t("undo") : t("markDone")}
              </Button>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

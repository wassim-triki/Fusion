"use client";

import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check } from "@repo/ds/icons";
import { coreChecklistQueryKeys, createCoreChecklistsApi, createPlatformApiClient, type MyManagerDto, type ChecklistTaskDto } from "@repo/api";
import { useApiQuery, useMyTeam, usePhoto, usePhotos, type UseApiQueryResult } from "@repo/api/query";
import { canAccessCorePeople, useAuth, PageFailure } from "@repo/auth";
import { Button, PersonAvatar, Skeleton, cn } from "@repo/ds";
import { ProgressSegments } from "@repo/ds/shell";

const DAY_MS = 86_400_000;

/** Your team beside the day (D-12): their faces, how many, and who joins next. Only for someone with a team. */
export function YourTeamCard() {
  const t = useTranslations("home.team");
  const format = useFormatter();
  const team = useMyTeam();
  const members = team.data?.members ?? [];
  const photos = usePhotos(members.map((person) => person.photoUrl));
  if (!team.data || members.length === 0) return null;
  const joining = team.data.comingUp.find((event) => event.kind === "Joins" || event.kind === "MovesIn");
  const joiner = joining ? members.find((person) => person.employeeKey === joining.employeeKey) : null;
  // Who is away now, or the next leave in the 30 days (B-229).
  const starts = new Set(team.data.comingUp.filter((event) => event.kind === "LeaveStarts").map((event) => event.employeeKey));
  const away = members.find((person) => person.leave?.now) ?? members
    .filter((person) => person.leave && !person.leave.now && starts.has(person.employeeKey))
    .sort((a, b) => a.leave!.from.localeCompare(b.leave!.from))[0];
  const dayName = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00`), { weekday: "long" });
  const leaveWords = away?.leave
    ? away.leave.now
      ? away.leave.back ? t("away", { name: away.displayName.split(" ")[0]!, day: dayName(away.leave.back) }) : t("awayOpen", { name: away.displayName.split(" ")[0]! })
      : t("leaveFrom", { name: away.displayName.split(" ")[0]!, day: dayName(away.leave.from) })
    : null;
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
            photo={person.photoUrl ? photos.get(person.photoUrl) : undefined}
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
        {leaveWords ? ` · ${leaveWords}` : ""}
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
              <Button writes type="button" size="sm" variant={task.doneAt ? "ghost" : "outline"} disabled={busy === task.id} onClick={() => void tick(task)}>
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

/**
 * The joiner's manager (D-12, B-248; A+B of the 2026-11-04 canvas): a person card (photo, name, job, unit and place,
 * their page when the joiner may open People), then who else reports to them. From a self-only read.
 */
export function YourManagerCard({ query }: {
  query: Pick<UseApiQueryResult<MyManagerDto>, "data" | "isLoading" | "error" | "refetch">;
}) {
  const t = useTranslations("home.manager");
  const { user } = useAuth();
  if (query.data && !query.data.isFirstWeek) return null;
  const manager = query.data?.manager;
  const teammates = query.data?.teammates ?? [];
  const more = (query.data?.teammateCount ?? 0) - teammates.length;
  return (
    <section aria-labelledby="manager-title" className="grid gap-[18px] rounded-surface bg-card p-[22px]">
      <h3 id="manager-title" className="type-meta text-muted-foreground">{t("title")}</h3>
      {query.isLoading ? (
        <div aria-label={t("loading")} className="flex items-center gap-4">
          <Skeleton className="size-16 shrink-0 rounded-full" />
          <div className="grid flex-1 gap-2"><Skeleton className="h-5 w-36" /><Skeleton className="h-4 w-24" /></div>
        </div>
      ) : query.error ? (
        <PageFailure error={query.error} size="row" title={t("failed")} onRetry={() => query.refetch()} />
      ) : manager ? (
        <>
          <div className="flex items-center gap-4">
            <Photo name={manager.displayName} photoUrl={manager.photoUrl} size="xl" />
            <div className="min-w-0">
              <p className="break-words font-editorial text-[21px] leading-tight font-semibold">{manager.displayName}</p>
              {manager.jobTitle ? <p className="mt-1 type-body text-foreground/85">{manager.jobTitle}</p> : null}
              {manager.unit || manager.place ? (
                <p className="type-meta text-muted-foreground">{[manager.unit, manager.place].filter(Boolean).join(" · ")}</p>
              ) : null}
            </div>
          </div>
          {canAccessCorePeople(user) ? (
            <a href={`/core/people/${encodeURIComponent(manager.employeeKey)}`}
              className="flex h-10 items-center justify-center gap-2 rounded-control bg-inlay type-label text-foreground hover:bg-inlay/80">
              {t("openProfile")}
              <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
            </a>
          ) : null}
          {teammates.length ? (
            <div className="grid gap-2.5 border-t border-border pt-4">
              <p className="type-meta text-muted-foreground">{t("alsoReporting", { name: manager.displayName.split(" ")[0] ?? "" })}</p>
              <ul className="grid gap-2.5">
                {teammates.map((person) => (
                  <li key={person.employeeKey} className="flex min-w-0 items-center gap-3">
                    <Photo name={person.displayName} photoUrl={person.photoUrl} size="sm" />
                    <p className="min-w-0 truncate type-body">
                      {person.displayName}
                      {person.jobTitle ? <span className="text-muted-foreground"> · {person.jobTitle}</span> : null}
                    </p>
                  </li>
                ))}
              </ul>
              {more > 0 ? <p className="type-meta text-muted-foreground">{t("more", { count: more })}</p> : null}
            </div>
          ) : null}
        </>
      ) : (
        <p className="type-meta text-muted-foreground">{t("none")}</p>
      )}
    </section>
  );
}

function Photo({ name, photoUrl, size }: { name: string; photoUrl: string | null; size: "sm" | "xl" }) {
  const photo = usePhoto(photoUrl);
  return <PersonAvatar name={name} photo={photo} size={size} />;
}

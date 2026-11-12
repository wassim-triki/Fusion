"use client";

import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createPlatformApiClient,
  fusionAttentionQueryKeys,
  performanceQueryKeys,
  type FusionWorkItem,
  type ObjectiveStatus,
  type TeamYearBranchDto,
  type TeamYearDto,
  type TeamYearPersonDto,
  type TeamYearPersonGoalDto,
} from "@repo/api";
import { cn } from "@repo/ds";
import { Button } from "@repo/ds/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ds/components/ui/avatar";
import { dateFormatter } from "@repo/ds/lib/dates";
import { Section, StateWord, type StateTone } from "@repo/ds/shell";
import { initials, PersonInitials, STATUS_STROKE } from "@repo/performance-ui";
import { reportPerformanceFailure } from "../../api/performance-failure";
import { GoalState } from "../objective-record/goal-state";
import { firstName } from "../year/year-words";

/** The page's words, loosely typed for the helper that picks among them. */
type Say = (key: string, values?: Record<string, string | number>) => string;

const TONE: Record<ObjectiveStatus, StateTone> = { OnTrack: "ok", AtRisk: "warn", OffTrack: "bad" };
const ROW = "grid items-center gap-[22px] md:grid-cols-[250px_minmax(0,1fr)_300px]";

/** Posts a Home work item's in-place answer below Performance's API, then refreshes the team and Home. */
function useWorkAnswer(cycleId: string) {
  const cache = useQueryClient();
  return async (path: string, body: object = {}) => {
    await createPlatformApiClient().post(`/performance${path}`, body);
    await Promise.all([
      cache.invalidateQueries({ queryKey: performanceQueryKeys.teamYear(cycleId) }),
      cache.invalidateQueries({ queryKey: fusionAttentionQueryKeys.all() }),
    ]);
  };
}

/** A goal's progress as a bar: striped while nothing is done, filled in its state's colour. */
function Bar({ progress, status, height = 5 }: { progress: number; status: ObjectiveStatus | null; height?: number }) {
  return (
    <span className={cn("relative block overflow-hidden rounded-full", progress <= 0 ? "bar-stripes" : "bg-inlay")} style={{ height }}>
      <i className="absolute inset-y-0 start-0 rounded-full" style={{ width: `${Math.min(100, progress)}%`, background: STATUS_STROKE[status ?? "none"] }} />
    </span>
  );
}

/** A person's plan in one bar, each goal by its weight. */
function MiniPlan({ goals }: { goals: TeamYearPersonGoalDto[] }) {
  if (!goals.length) return <span className="bar-stripes block h-2 rounded-full" aria-hidden />;
  return (
    <span className="flex h-2 gap-[3px]" aria-hidden>
      {goals.map((goal, index) => (
        <span key={index} className={cn("relative overflow-hidden rounded-[3px] first:rounded-s-full last:rounded-e-full", goal.progress <= 0 ? "bar-stripes" : "bg-inlay")}
          style={{ flex: goal.weight }}>
          <i className="absolute inset-y-0 start-0" style={{ width: `${Math.min(100, goal.progress)}%`, background: STATUS_STROKE[goal.status ?? "none"] }} />
        </span>
      ))}
    </span>
  );
}

/**
 * The manager's goals with the team's under each (D-79): the manager's goal on top, tinted, the team's in a row under it.
 * Each opens in the goal panel.
 */
export function TeamTree({ year, onOpen }: { year: TeamYearDto; onOpen: (objectiveId: string) => void }) {
  const t = useTranslations("team.TeamYear");
  const locale = useLocale();
  if (!year.branches.length) return null;
  const list = new Intl.ListFormat(locale, { type: "conjunction" });
  return (
    <Section id="team-tree" title={year.branches.length > 1 ? t("treeMany") : t("treeOne")}>
      <div className="grid gap-8">
        {year.branches.map((branch) => <Branch key={branch.goal.objectiveId} branch={branch} onOpen={onOpen} />)}
        {year.elsewhere.length ? (
          <p className="text-center type-meta text-muted-foreground">{t("elsewhere", { names: list.format(year.elsewhere.map(firstName)) })}</p>
        ) : null}
      </div>
    </Section>
  );
}

function Branch({ branch, onOpen }: { branch: TeamYearBranchDto; onOpen: (objectiveId: string) => void }) {
  const t = useTranslations("team.TeamYear");
  const goal = branch.goal;
  return (
    <div className="grid justify-items-center">
      <button type="button" onClick={() => onOpen(goal.objectiveId)}
        className="grid w-full max-w-[420px] gap-[7px] rounded-inset px-3.5 py-3 text-start outline-none hover:ring-1 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring"
        style={{ background: "color-mix(in oklab, var(--primary) 9%, var(--inlay))" }}>
        <span className="flex items-center gap-[7px] type-meta text-muted-foreground">
          {branch.supports ? t("yourGoalUnder", { goal: branch.supports }) : t("yourGoal")}
        </span>
        <span className="type-narrative text-[17px] font-medium leading-snug text-foreground">{goal.title}</span>
        <span className="flex items-center justify-between gap-3">
          {goal.status ? <GoalState status={goal.status} /> : <span />}
          <span className="type-meta tabular-nums text-muted-foreground">
            {goal.current != null ? t("measureNow", { measure: goal.measure, current: goal.current }) : goal.measure}
          </span>
        </span>
        <Bar progress={goal.progress} status={goal.status} height={6} />
      </button>
      <div aria-hidden className="h-5 w-px bg-input" />
      <div className="relative grid w-full grid-cols-2 gap-2.5 pt-5 lg:grid-cols-4">
        {branch.team.length > 1 ? <span aria-hidden className="absolute inset-x-[12.5%] top-0 h-px bg-input max-lg:inset-x-1/4" /> : null}
        {branch.team.map((kid) => (
          <button key={kid.objectiveId} type="button" onClick={() => onOpen(kid.objectiveId)}
            className="relative grid content-start gap-[7px] rounded-inset bg-inlay px-3.5 py-3 text-start outline-none before:absolute before:-top-5 before:left-1/2 before:h-5 before:w-px before:bg-input hover:ring-1 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex items-center gap-[7px] type-meta text-foreground">
              <PersonInitials name={kid.ownerName} size="xs" />
              {firstName(kid.ownerName)}
            </span>
            <span className="type-narrative text-[15px] font-medium leading-snug text-foreground">{kid.title}</span>
            <span className="flex items-center justify-between gap-2">
              {kid.status ? <StateWord tone={TONE[kid.status]}>{t(`state.${kid.status}`)}</StateWord> : <span className="type-meta text-muted-foreground">{t("noUpdateYet")}</span>}
              <span className="type-meta tabular-nums text-foreground">{Math.round(kid.progress)}%</span>
            </span>
            <Bar progress={kid.progress} status={kid.status} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Each person's year (D-79): what's due from the viewer first, answered in the row; otherwise their plan at a glance. */
export function TeamPeople({ year, photos, cycleId }: { year: TeamYearDto; photos: Map<string, string | null>; cycleId: string }) {
  const t = useTranslations("team.TeamYear");
  const needs = year.people.filter((person) => person.due).length;
  return (
    <Section id="team-people" title={t("eachPersonsYear")} meta={needs ? t("needYou", { count: needs }) : t("nothingDue")}>
      <ul className="grid">
        {year.people.map((person) => (
          <li key={person.employeeId} className="border-t border-border first:border-t-0">
            <PersonRow person={person} photo={photos.get(person.employeeId) ?? null} cycleId={cycleId} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function PersonRow({ person, photo, cycleId }: { person: TeamYearPersonDto; photo: string | null; cycleId: string }) {
  const t = useTranslations("team.TeamYear");
  const locale = useLocale();
  const answer = useWorkAnswer(cycleId);
  const [busy, setBusy] = useState(false);
  const due = person.due;
  const day = dateFormatter({ day: "numeric", month: "short" }, locale);
  const time = dateFormatter({ weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }, locale);
  const run = async (path: string, body: object, done: string) => {
    setBusy(true);
    try {
      await answer(path, body);
      toast.success(done);
    } catch (error) {
      reportPerformanceFailure(error, t("failed"));
    } finally {
      setBusy(false);
    }
  };

  let middle: ReactNode;
  let right: ReactNode;
  if (due) {
    const { title, sub, bad } = dueWords(due, t as unknown as Say);
    middle = (
      <span className="grid gap-[3px]">
        <b className={cn("type-label", bad ? "text-destructive" : "text-foreground")}>{title}</b>
        {sub ? <span className={cn("text-muted-foreground", due.quote ? "type-narrative text-[13.5px]" : "type-meta")}>{sub}</span> : null}
      </span>
    );
    const primary = due.actions?.find((action) => action.primary) ?? due.actions?.[0];
    const slot = due.booking?.slots[0];
    right = slot && due.booking ? (
      <Button size="sm" disabled={busy} onClick={() => void run(due.booking!.path, { at: slot }, t("booked", { name: firstName(person.name), time: time.format(new Date(slot)) }))}>
        {t("book", { time: time.format(new Date(slot)) })}
      </Button>
    ) : primary ? (
      <Button size="sm" variant={primary.primary ? "default" : "outline"} disabled={busy}
        onClick={() => void run(primary.path, {}, t("asked", { name: firstName(person.name) }))}>
        {t("askForUpdate")}
      </Button>
    ) : (
      <Button size="sm" variant={due.kind === "plan-decision" ? "default" : "outline"} asChild>
        <a href={due.href}>{due.kind === "plan-decision" ? t("lookAtIt") : due.actionLabel ?? t("open")}</a>
      </Button>
    );
  } else {
    const counts = (["OnTrack", "AtRisk", "OffTrack"] as const)
      .map((status) => [status, person.goals.filter((goal) => goal.status === status).length] as const)
      .filter(([, count]) => count > 0);
    middle = (
      <span className="grid gap-2">
        <MiniPlan goals={person.goals} />
        <span className="flex flex-wrap items-center gap-3.5">
          {counts.length
            ? counts.map(([status, count]) => <StateWord key={status} tone={TONE[status]}>{t(`count.${status}`, { count })}</StateWord>)
            : <span className="type-meta text-muted-foreground">{t(`plan.${person.planStatus}`)}</span>}
        </span>
      </span>
    );
    right = (
      <span className="type-meta text-muted-foreground">
        {person.nextOneOnOneAt ? t("nextOneOnOne", { day: day.format(new Date(person.nextOneOnOneAt)) }) : null}
      </span>
    );
  }

  return (
    <div className={cn(ROW, "-mx-3.5 rounded-inset px-3.5 py-3.5")}>
      <a href={`/core/people/${encodeURIComponent(person.stableEmployeeKey)}?tab=performance`} className="flex min-w-0 items-center gap-3 rounded-inset outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
        <Avatar className="size-10 shrink-0">
          {photo ? <AvatarImage src={photo} alt="" /> : null}
          <AvatarFallback hue={person.name} className="text-sm">{initials(person.name)}</AvatarFallback>
        </Avatar>
        <span className="grid min-w-0">
          <b className="truncate type-label text-foreground">{person.name}</b>
          {person.jobTitle ? <span className="truncate type-meta text-muted-foreground">{person.jobTitle}</span> : null}
        </span>
      </a>
      {middle}
      <span className="flex items-center justify-end gap-2.5 text-end">{right}</span>
    </div>
  );
}

/** What's due, said in the row beside the person's name (the name isn't repeated). */
function dueWords(due: FusionWorkItem, t: Say) {
  const lines = due.lines ?? [];
  switch (due.kind) {
    case "goals-off-track": {
      const off = lines.filter((line) => line.tone === "bad").length;
      const risk = lines.length - off;
      return {
        title: off && risk ? t("offAndRisk", { off, risk }) : off ? t("offTrack", { count: off }) : t("atRisk", { count: risk }),
        sub: due.quote ? `“${due.quote}”` : due.context,
        bad: off > 0,
      };
    }
    case "one-on-one-book":
      return { title: t("noOneOnOnes"), sub: due.booking ? t("bothFree") : null, bad: false };
    case "plan-decision":
      return { title: t("planWaiting"), sub: due.context, bad: false };
    default:
      return { title: due.title, sub: due.context, bad: false };
  }
}

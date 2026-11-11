"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { useAuth, PageFailure } from "@repo/auth";
import type { AddPlanObjectiveRequest, CycleSummaryDto, EmployeePlanDto, ObjectiveStatus, PlanObjectiveDto, UpdateRequestDto } from "@repo/api";
import { cn } from "@repo/ds";
import { Button } from "@repo/ds/components/ui/button";
import { dateFormatter } from "@repo/ds/lib/dates";
import { ArrowUp, Clock, Plus, Send, TrendingUp } from "@repo/ds/icons";
import { AsyncButton, Said } from "@repo/ds/shell";
import { PersonInitials } from "@repo/performance-ui";
import { useAlignmentTargets, useMyPlan, useObjectiveProgress, usePlanMutations } from "../../api/use-performance";
import { useUpdateRequests } from "../../api/use-update-requests";
import { reportPerformanceFailure } from "../../api/performance-failure";
import { GoalLine, positionIn, STATUS_STROKE } from "../objective-record/goal-line";
import { valueIn } from "../objective-record/goal-panel";
import { GoalState } from "../objective-record/goal-state";
import { useObjectiveRecord } from "../objective-record/use-objective-record";
import { OwnerChangeRequest } from "../plan/change-requests";
import { DevelopmentSection } from "../plan/development-section";
import { PlanGoalComposer } from "../plan/goal-composer";
import { activeReturn } from "../plan/plan-rail";
import { openRequestsFor } from "../update-requests/update-requests";
import { dayMonth, firstName, fullDay } from "../year/year-words";

export const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/** Each goal's share of the plan: its weight, or an even share before any weight exists. */
export function planShares(goals: Pick<PlanObjectiveDto, "id" | "planWeight">[]): Map<string, number> {
  const even = goals.length ? 100 / goals.length : 0;
  return new Map(goals.map((goal) => [goal.id, goal.planWeight ?? even]));
}

/** The goal to update first from the page's one button: never updated, else updated longest ago. */
export function nextToUpdate<T extends Pick<PlanObjectiveDto, "canUpdateProgress" | "lastProgressAt">>(goals: T[]): T | null {
  const open = goals.filter((goal) => goal.canUpdateProgress);
  return [...open].sort((a, b) => (a.lastProgressAt ?? "").localeCompare(b.lastProgressAt ?? ""))[0] ?? null;
}

const LANE = "grid grid-cols-[320px_minmax(0,1fr)_150px] items-center gap-[26px]";

/**
 * Goals, You (D-83): the plan as one bar by weight, then each goal on the year against its pace. While the plan is
 * being written the bar shows the weights and the lanes the pace to come; once approved, progress in each goal's
 * state colour. A lane opens the goal's panel; the page's one action sends the plan or updates progress.
 */
export function GoalsYou({ cycle, header }: { cycle: CycleSummaryDto; header: (actions?: ReactNode) => ReactNode }) {
  const t = useTranslations("goals.You");
  const locale = useLocale();
  const { user } = useAuth();
  const state = useMyPlan(cycle.id);
  const targets = useAlignmentTargets(cycle.id, state.data?.participatesInCycle ?? false);
  const mutations = usePlanMutations(cycle.id);
  const record = useObjectiveRecord();
  const plan = state.data?.plan ?? null;
  const requests = useUpdateRequests(plan?.isLocked ? plan.cycleId : null, plan?.isLocked ? plan.id : null);
  const [composing, setComposing] = useState(false);

  if (state.isLoading) return <>{header()}<YouGhost /></>;
  if (state.error || !state.data) return <>{header()}<PageFailure error={state.error} onRetry={state.refetch} /></>;

  const preview = state.data.preview;
  const goals = plan?.objectives ?? [];
  const today = todayIso();
  const running = plan?.isLocked ?? false;
  const canAuthor = plan ? plan.canAuthor : state.data.participatesInCycle;
  const reviewer = plan?.responsibleManager?.name ?? preview?.reviewer?.name ?? null;
  const returned = activeReturn(plan);
  const shares = planShares(goals);
  // "Shared evenly" is said only when nobody chose a weight and the shares really are even.
  const even = goals.length > 0 && goals.every((goal) => !goal.planWeightIsSet)
    && Math.max(...shares.values()) - Math.min(...shares.values()) <= 1;
  const refFor = (objectiveId: string) => ({ cycleId: cycle.id, objectiveId });
  const next = running ? nextToUpdate(goals) : null;

  const send = async () => {
    if (!plan) return;
    try {
      await mutations.submit.mutateAsync(plan.version);
      toast.success(reviewer ? t("sentTo", { name: firstName(reviewer) }) : t("sent"));
    } catch (error) {
      reportPerformanceFailure(error, t("couldNotSend"));
    }
  };

  const actions = running ? (
    next ? (
      <Button onClick={() => record.open(refFor(next.id), { mode: "record" })}>
        <TrendingUp aria-hidden className="size-4" />
        {t("updateProgress")}
      </Button>
    ) : undefined
  ) : plan?.canAuthor && goals.length > 0 ? (
    <AsyncButton pending={mutations.submit.isLoading} disabled={!plan.canSubmit} title={plan.canSubmit ? undefined : plan.readiness.blockers[0]} onClick={send}>
      <Send aria-hidden className="size-4" />
      {reviewer ? t("sendTo", { name: firstName(reviewer) }) : t("send")}
    </AsyncButton>
  ) : undefined;

  const composer = composing ? (
    <PlanGoalComposer
      open
      onOpenChange={(open) => { if (!open) setComposing(false); }}
      cycle={cycle}
      targets={targets.data ?? []}
      standaloneAllowed={plan?.readiness.standaloneAllowed ?? preview?.standaloneAllowed ?? false}
      teamName={plan?.orgUnitName ?? preview?.orgUnitName}
      otherWeightTotal={plan?.readiness.weightTotal ?? 0}
      onCreate={async (request: Omit<AddPlanObjectiveRequest, "expectedVersion">) => {
        // The first goal makes the plan; the two calls run in order so the plan exists before the goal is added.
        const current = plan ?? await mutations.create.mutateAsync(cycle.version);
        await mutations.addObjective.mutateAsync({ request, expectedVersion: current.version });
        toast.success(t("goalAdded"));
      }}
      onUpdate={async () => undefined}
    />
  ) : null;

  const addLane = canAuthor && !running && plan?.state !== "Submitted" ? (
    <button type="button" onClick={() => setComposing(true)}
      className="-mx-3.5 flex items-center gap-2.5 rounded-inset px-3.5 py-4 text-start text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground">
      <Plus aria-hidden className="size-4" />
      {t("addAGoal")}
    </button>
  ) : null;

  return (
    <>
      {header(actions)}
      <section className="grid gap-1.5 rounded-surface bg-card px-6 py-[22px]">
        <PlanTop plan={plan} cycle={cycle} even={even} reviewer={reviewer} today={today} />
        {returned ? (
          <div className="mt-2 flex items-start gap-3 rounded-inset bg-inlay px-3.5 py-2.5">
            <PersonInitials name={returned.actorName} size="xs" />
            <div className="grid gap-0.5">
              <span className="text-[13px] text-muted-foreground">{t("asked", { name: firstName(returned.actorName) || t("yourReviewer"), day: dayMonth(returned.decidedAt, locale) })}</span>
              {returned.feedback ? <Said>{returned.feedback}</Said> : null}
            </div>
          </div>
        ) : null}
        <div className="h-3" />
        {goals.length ? (
          <>
            <div className="flex h-3.5 gap-[3px]">
              {goals.map((goal) => (
                <button
                  key={goal.id}
                  type="button"
                  onClick={() => record.open(refFor(goal.id))}
                  title={t("ofYourPlan", { title: goal.title, weight: Math.round(shares.get(goal.id)!) })}
                  className={cn("relative h-full min-w-2 overflow-hidden rounded-[4px] first:rounded-s-full last:rounded-e-full",
                    running && goal.derivedProgress <= 0 ? "bar-stripes" : "bg-inlay")}
                  style={{ flex: shares.get(goal.id) }}
                >
                  <i className="absolute inset-y-0 start-0 transition-[width] duration-700"
                    style={{ width: `${running ? Math.min(100, goal.derivedProgress) : 100}%`, background: running ? STATUS_STROKE[goal.status ?? "none"] : "color-mix(in oklab, var(--muted-foreground) 45%, transparent)" }} />
                </button>
              ))}
            </div>
            <div className="flex gap-[3px]">
              {goals.map((goal) => (
                <div key={goal.id} className="grid min-w-0 gap-px pt-2" style={{ flex: shares.get(goal.id) }}>
                  <b className="truncate text-[13px] font-semibold">{goal.title}</b>
                  <span className="truncate text-[13px] tabular-nums text-muted-foreground">
                    {running
                      ? t("weightDone", { weight: Math.round(shares.get(goal.id)!), progress: Math.round(goal.derivedProgress) })
                      : `${Math.round(shares.get(goal.id)!)}%`}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="bar-stripes h-3.5 rounded-full" aria-hidden />
        )}
      </section>

      <section className="grid gap-1 rounded-surface bg-card px-6 pb-[22px] pt-[18px]">
        <Axis start={cycle.startDate} end={cycle.endDate} today={today} />
        {goals.length ? (
          <div className="grid">
            {goals.map((goal, index) => {
              const asked = returned?.changeRequests.find((request) => request.objectiveId === goal.id);
              return (
                <div key={goal.id} className={cn(index > 0 && "border-t border-border")}>
                  <Lane
                    goal={goal}
                    cycleId={cycle.id}
                    share={shares.get(goal.id)!}
                    even={even}
                    running={running}
                    today={today}
                    open={record.isOpen(refFor(goal.id))}
                    requests={requests.data}
                    onOpen={() => record.open(refFor(goal.id))}
                  />
                  {returned && asked && plan ? (
                    <div className="pb-3">
                      <OwnerChangeRequest
                        request={asked}
                        reviewerName={returned.actorName ?? t("yourReviewer")}
                        decidedAt={returned.decidedAt}
                        canAddress={plan.canAuthor}
                        onAddress={async (reply) => {
                          try {
                            await mutations.addressChangeRequest.mutateAsync({ requestId: asked.id, reply, expectedVersion: plan.version });
                            return true;
                          } catch (error) {
                            reportPerformanceFailure(error, t("couldNotSave"));
                            return false;
                          }
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
            {addLane ? <div className="border-t border-border">{addLane}</div> : null}
          </div>
        ) : (
          // D-48: before a goal exists, the shape of what fills in, and the way to start.
          <div className="grid">
            {[46, 62].map((width) => (
              <div key={width} aria-hidden className={cn(LANE, "border-b border-border px-0 py-4")}>
                <div className="grid gap-2">
                  <span className="h-3.5 rounded-full bg-muted-foreground/20" style={{ width: `${width}%` }} />
                  <span className="h-2.5 w-[72%] rounded-full bg-muted-foreground/15" />
                </div>
                <GoalLine start={cycle.startDate} end={cycle.endDate} today={today} updates={[]} status={null} height={56} ghost />
                <span className="h-3 w-12 justify-self-end rounded-full bg-muted-foreground/15" />
              </div>
            ))}
            {addLane}
          </div>
        )}
      </section>

      {user?.employeeId ? (
        <div id="development" className="scroll-mt-6">
          <DevelopmentSection cycleId={cycle.id} employeeId={user.employeeId} />
        </div>
      ) : null}
      {composer}
    </>
  );
}

/** Over the bar: the plan while it's written, who has it while it waits, how far it is once it runs. */
function PlanTop({ plan, cycle, even, reviewer, today }: {
  plan: EmployeePlanDto | null;
  cycle: CycleSummaryDto;
  even: boolean;
  reviewer: string | null;
  today: string;
}) {
  const t = useTranslations("goals.You");
  const locale = useLocale();
  if (plan?.isLocked) {
    return (
      <div className="flex flex-wrap items-end gap-4">
        <span className="type-metric-lg tabular-nums text-foreground">
          {Math.round(plan.planProgress)}%
          <small className="ms-1.5 text-[15px] font-medium tracking-normal text-muted-foreground">{t("ofYourPlanDone")}</small>
        </span>
        <span className="pb-[3px] text-[13px] text-muted-foreground">{t("ofTheYearGone", { share: Math.round(positionIn(cycle.startDate, cycle.endDate, today) * 100) })}</span>
        {plan.approvedAt ? (
          <span className="ms-auto flex items-center gap-2 text-[13px] text-muted-foreground">
            <PersonInitials name={reviewer} size="xs" />
            {reviewer ? t("approvedBy", { name: firstName(reviewer), day: dayMonth(plan.approvedAt, locale) }) : t("approvedOn", { day: dayMonth(plan.approvedAt, locale) })}
          </span>
        ) : null}
      </div>
    );
  }
  const waiting = plan?.state === "Submitted";
  return (
    <div className="flex flex-wrap items-end gap-[18px]">
      <div className="grid gap-1.5">
        <span className="type-narrative text-[20px] font-medium text-foreground">{t("yourPlan", { year: cycle.name })}</span>
        {cycle.planningDeadline ? (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Clock aria-hidden className="size-[15px]" />
            {t("planningEnds", { day: fullDay(cycle.planningDeadline, locale) })}
          </span>
        ) : null}
      </div>
      {waiting ? (
        // D-49: who it's with, and since when.
        <span className="ms-auto flex items-center gap-2 text-[13px] text-muted-foreground">
          <PersonInitials name={reviewer} size="xs" />
          {plan.submittedAt
            ? t("withSince", { name: firstName(reviewer) || t("yourReviewer"), day: dayMonth(plan.submittedAt, locale) })
            : t("with", { name: firstName(reviewer) || t("yourReviewer") })}
        </span>
      ) : even ? (
        <span className="ms-auto text-xs text-muted-foreground">{t("weightsSharedEvenly")}</span>
      ) : null}
    </div>
  );
}

/** The year's months over the lanes, with today marked; `lane` is the lanes' grid so the months sit over their lines. */
export function Axis({ start, end, today, lane = LANE }: { start: string; end: string; today: string; lane?: string }) {
  const t = useTranslations("goals.You");
  const locale = useLocale();
  const name = dateFormatter({ month: "short" }, locale);
  const months: string[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  for (let i = 0; i < 14; i++) {
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    const iso = `${year}-${String(month).padStart(2, "0")}-01`;
    if (iso > end) break;
    if (i % 2 === 0) months.push(iso);
  }
  const now = positionIn(start, end, today) * 100;
  return (
    <div aria-hidden className={cn(lane, "pb-0.5")}>
      <span />
      <div className="relative h-[18px]">
        {months.map((m) => {
          const at = positionIn(start, end, m) * 100;
          return Math.abs(at - now) < 7 ? null : (
            <span key={m} className="absolute -translate-x-1/2 whitespace-nowrap text-[11.5px] text-muted-foreground" style={{ left: `${at}%` }}>
              {name.format(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1))}
            </span>
          );
        })}
        {today >= start && today <= end ? (
          <span className="absolute -top-0.5 z-[1] -translate-x-1/2 whitespace-nowrap rounded-full bg-foreground px-2 py-px text-[11.5px] font-semibold text-background" style={{ left: `${now}%` }}>
            {t("today")}
          </span>
        ) : null}
      </div>
      <span />
    </div>
  );
}

/** One goal on the year: what it is and what it supports, its line against the pace, and where it stands. */
function Lane({ goal, cycleId, share, even, running, today, open, requests, onOpen }: {
  goal: PlanObjectiveDto;
  cycleId: string;
  share: number;
  even: boolean;
  running: boolean;
  today: string;
  open: boolean;
  requests: UpdateRequestDto[] | undefined;
  onOpen: () => void;
}) {
  const t = useTranslations("goals.You");
  const locale = useLocale();
  const progress = useObjectiveProgress(running ? cycleId : null, running ? goal.id : null).data;
  const updates = [...(progress?.history ?? [])].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const milestones = goal.measurement?.method === "WeightedMilestones";
  const asked = openRequestsFor(requests, goal.id)[0];
  const parent = goal.directionPath.at(-1);

  let right: ReactNode;
  if (!running) {
    right = (
      <>
        <span className="text-[15px] font-semibold tabular-nums">{Math.round(share)}%</span>
        {!even ? null : <span className="text-xs text-muted-foreground">{t("sharedEvenly")}</span>}
      </>
    );
  } else {
    const done = goal.measurement?.milestones.filter((m) => m.isCompleted).length ?? 0;
    right = (
      <>
        {goal.status ? <GoalState status={goal.status} since={goal.statusSince} /> : null}
        <span className="text-[13px] text-muted-foreground">
          {milestones
            ? t("milestonesDone", { done, count: goal.measurement!.milestones.length })
            : goal.lastProgressAt
              ? t("valueOn", { value: goal.currentActual != null ? valueIn(goal.measurement, goal.currentActual) : `${Math.round(goal.currentPercentage ?? goal.derivedProgress)}%`, day: dayMonth(goal.lastProgressAt, locale) })
              : t("noUpdateYet")}
        </span>
        {asked ? (
          <span className="flex items-center justify-end gap-1.5 text-[13px] text-foreground">
            <PersonInitials name={asked.requestedByName} size="xs" />
            {t("askedOn", { day: dayMonth(asked.requestedAt, locale) })}
          </span>
        ) : null}
      </>
    );
  }

  return (
    <button type="button" onClick={onOpen}
      className={cn(LANE, "-mx-3.5 w-[calc(100%+1.75rem)] rounded-inset px-3.5 py-4 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring",
        open ? "bg-primary/[0.07]" : "hover:bg-foreground/[0.035]")}>
      <div className="grid min-w-0 gap-1">
        <span className="type-narrative text-[17px] font-medium leading-[1.3] text-foreground">{goal.title}</span>
        <span className="text-[13px] text-muted-foreground">{goal.measurementSummary}</span>
        {parent ? (
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <ArrowUp aria-hidden className="size-3.5 shrink-0" />
            <b className="truncate font-medium text-foreground">{parent}</b>
          </span>
        ) : null}
      </div>
      <GoalLine
        start={goal.startDate}
        end={goal.endDate}
        today={today}
        updates={updates}
        milestones={milestones ? progress?.milestones : undefined}
        status={goal.status}
        height={56}
        ghost={!running}
      />
      <div className="grid justify-items-end gap-[3px] text-end">{right}</div>
    </button>
  );
}

function YouGhost() {
  return (
    <div aria-hidden className="grid gap-[18px]">
      <div className="h-[132px] animate-pulse rounded-surface bg-card" />
      <div className="h-[280px] animate-pulse rounded-surface bg-card" />
    </div>
  );
}

"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { CyclePhase, ObjectiveStatus, PlanObjectiveDto } from "@repo/api";
import { CornerLeftUp } from "@repo/ds/icons";
import { Bar, StateWord, type BarTone, type StateTone } from "@repo/ds/shell";
import { PraiseCard } from "@repo/performance-ui";
import { useMyPlan } from "../../api/use-performance";
import { usePraisePage } from "../../api/use-conversations";
import { REACTION_ICONS } from "../conversations/reaction-icons";
import { dayMonth } from "./year-words";

const STATE: Record<ObjectiveStatus, { tone: StateTone; bar: BarTone }> = {
  OnTrack: { tone: "ok", bar: "ok" },
  AtRisk: { tone: "warn", bar: "warn" },
  OffTrack: { tone: "bad", bar: "bad" },
};

/**
 * The employee's half of the Year page (the style frame's `yearSecond` for Aicha): their goals with each one's line up
 * to the company's, read as weights while planning and as progress after, then the latest praise they received.
 */
export function YearYou({ cycleId, phase, employeeId }: { cycleId: string; phase: CyclePhase; employeeId: string }) {
  const t = useTranslations("year.YearYou");
  const plan = useMyPlan(cycleId);
  const praise = usePraisePage({ scope: "forMe", limit: 1 });
  const goals = plan.data?.plan?.objectives ?? [];
  const approved = plan.data?.plan?.state === "Approved";
  const latest = praise.data?.items[0];

  if (plan.isLoading) return null;
  return (
    <>
      <section className="grid gap-3.5 rounded-surface bg-card px-6 py-[22px]">
        <div className="flex items-center">
          <h2 className="type-section-title text-foreground">{t("yourGoals")}</h2>
          <span className="ms-auto text-sm text-muted-foreground">
            {goals.length === 0 ? null : approved ? t("done", { progress: Math.round(plan.data!.plan!.planProgress) }) : t("weights")}
          </span>
        </div>
        {goals.length ? (
          <div className="grid divide-y divide-border">
            {goals.map((goal) => (
              <div key={goal.id} className="py-1">
                <GoalRow goal={goal} cycleId={cycleId} weighting={!approved || phase === "Planning"} />
              </div>
            ))}
          </div>
        ) : (
          // D-48: before anything exists, the shape of what fills in.
          <div className="grid gap-2.5" aria-label={t("noGoalsYet")}>
            {[38, 52].map((width) => (
              <div key={width} className="grid gap-2 rounded-inset bg-inlay px-4 py-3.5">
                <div className="flex items-center">
                  <span className="h-3.5 rounded-full bg-muted-foreground/20" style={{ width: `${width}%` }} />
                  <span className="ms-auto h-3 w-12 rounded-full bg-muted-foreground/15" />
                </div>
                <span className="h-2.5 w-[62%] rounded-full bg-muted-foreground/15" />
              </div>
            ))}
          </div>
        )}
      </section>
      {latest ? (
        <section className="grid gap-3.5 rounded-surface bg-card px-6 py-[22px]">
          <h2 className="type-section-title text-foreground">{t("lately")}</h2>
          <PraiseCard praise={latest} reactionIcons={REACTION_ICONS} viewerEmployeeId={employeeId} quote />
        </section>
      ) : null}
    </>
  );
}

function GoalRow({ goal, cycleId, weighting }: { goal: PlanObjectiveDto; cycleId: string; weighting: boolean }) {
  const t = useTranslations("year.YearYou");
  const locale = useLocale();
  const status = goal.status ? STATE[goal.status] : null;
  const progress = Math.round(goal.derivedProgress);
  return (
    <Link
      href={`/cycles/${cycleId}/objectives/${goal.id}?mode=record`}
      className="-mx-3 grid grid-cols-[minmax(0,1fr)_220px] items-center gap-6 rounded-xl px-3 py-2.5 hover:bg-inlay"
    >
      <div className="grid min-w-0 gap-1">
        <span className="type-narrative truncate text-[17px] text-foreground">{goal.title}</span>
        <span className="truncate text-sm text-muted-foreground">{goal.measurementSummary}</span>
        {goal.directionPath.length ? (
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
            <CornerLeftUp aria-hidden className="size-3.5 shrink-0" />
            <b className="truncate font-medium text-foreground/80">{goal.directionPath.at(-1)}</b>
            {goal.directionPath.length > 1 ? <span className="truncate">{t("under", { goal: goal.directionPath[0]! })}</span> : null}
          </span>
        ) : null}
      </div>
      {weighting ? (
        <span className="justify-self-end text-[15px] font-semibold tabular-nums">{goal.planWeight === null ? "–" : `${Math.round(goal.planWeight)}%`}</span>
      ) : (
        <div className="grid gap-[7px]">
          <div className="flex items-center justify-between">
            {status ? (
              <StateWord tone={status.tone}>{t(`status.${goal.status!}`)}</StateWord>
            ) : (
              <span className="text-[13px] text-muted-foreground">{goal.lastProgressAt ? t("updated", { day: dayMonth(goal.lastProgressAt, locale) }) : t("noUpdateYet")}</span>
            )}
            <span className="text-sm tabular-nums">{progress}%</span>
          </div>
          <Bar value={progress} tone={status?.bar ?? "primary"} label={goal.title} />
        </div>
      )}
    </Link>
  );
}

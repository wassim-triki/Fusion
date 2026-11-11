"use client";

import { useMemo, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { AlignmentMapNodeDto, GoalNodeDto } from "@repo/api";
import { cn } from "@repo/ds";
import { ArrowUp, Plus } from "@repo/ds/icons";
import { AvatarStack, PersonInitials } from "@repo/performance-ui";
import { GoalLine, GoalMonths } from "../objective-record/goal-line";
import { GoalState } from "../objective-record/goal-state";
import { firstName } from "../year/year-words";
import { Axis, todayIso } from "./goals-you";

/** The map's nodes as the list reads them: company goals, the unit goals under each, people's goals under either. */
export interface GoalTree {
  companies: AlignmentMapNodeDto[];
  unitsUnder: Map<string, AlignmentMapNodeDto[]>;
  peopleUnder: Map<string, AlignmentMapNodeDto[]>;
  byId: Map<string, AlignmentMapNodeDto>;
}

export function goalTree(nodes: AlignmentMapNodeDto[], myUnitId: string | null): GoalTree {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const unitsUnder = new Map<string, AlignmentMapNodeDto[]>();
  const peopleUnder = new Map<string, AlignmentMapNodeDto[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const into = node.kind === "Personal" ? peopleUnder : node.kind === "OrgUnit" ? unitsUnder : null;
    if (!into) continue;
    into.set(node.parentId, [...(into.get(node.parentId) ?? []), node]);
  }
  // Your own unit's goal reads first under its company goal.
  if (myUnitId) for (const list of unitsUnder.values()) list.sort((a, b) => Number(b.orgUnitId === myUnitId) - Number(a.orgUnitId === myUnitId));
  return { companies: nodes.filter((node) => node.kind === "Company"), unitsUnder, peopleUnder, byId };
}

/** Every unit goal below a goal, however deep, flattened in reading order. */
function unitsBelow(tree: GoalTree, id: string): AlignmentMapNodeDto[] {
  return (tree.unitsUnder.get(id) ?? []).flatMap((unit) => [unit, ...unitsBelow(tree, unit.id)]);
}

/** Off track first, then at risk, on track, and those with no state yet (D-99). */
const ORDER = { OffTrack: 0, AtRisk: 1, OnTrack: 2 } as const;
export const byState = (a: AlignmentMapNodeDto, b: AlignmentMapNodeDto) => (a.status ? ORDER[a.status] : 3) - (b.status ? ORDER[b.status] : 3);

/** The grid every Company and unit lane shares, so each line sits on the same months. */
const WIDE = "grid grid-cols-[400px_minmax(0,1fr)_170px] items-center gap-[26px]";
const row = "-mx-3.5 w-[calc(100%+1.75rem)] rounded-inset px-3.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface Year { start: string; end: string; today: string }

/** A goal's line over the year, from the map's points. */
function Line({ node, year, height, small = false, dots = !small }: { node: AlignmentMapNodeDto; year: Year; height: number; small?: boolean; dots?: boolean }) {
  return (
    <GoalLine
      start={year.start}
      end={year.end}
      today={year.today}
      updates={node.line.map((point) => ({ recordedAt: point.at, resultingProgress: point.progress, status: null }))}
      status={node.status}
      height={height}
      dots={dots}
      pace={!small}
    />
  );
}

/** Where a goal stands: its figure, then its state and since when. */
function Standing({ node, big = false }: { node: AlignmentMapNodeDto; big?: boolean }) {
  const t = useTranslations("goals.Company");
  return (
    <div className="grid justify-items-end gap-[3px] text-end">
      {node.hasProgress ? (
        <span className={cn("tabular-nums", big ? "type-metric" : "text-[15px] font-semibold")}>{Math.round(node.progress)}%</span>
      ) : (
        <span className="type-control text-muted-foreground">{t("noUpdateYet")}</span>
      )}
      {node.status ? <GoalState status={node.status} since={node.statusSince} /> : null}
    </div>
  );
}

/** A goal straight under a company goal: a unit's, or a person's. Your own unit's is marked and leads to its tab. */
function SubLane({ node, mine, faces, year, onOpen }: { node: AlignmentMapNodeDto; mine: boolean; faces: (string | null)[]; year: Year; onOpen: () => void }) {
  const t = useTranslations("goals.Company");
  const total = node.personal?.total ?? 0;
  return (
    <button type="button" onClick={onOpen} className={cn(WIDE, row, "py-[9px]", mine ? "bg-primary/[0.09]" : "hover:bg-foreground/[0.035]")}>
      <div className="relative flex min-w-0 items-center gap-[11px] ps-6">
        <span aria-hidden className="absolute start-[5px] -top-3.5 bottom-1/2 w-3 rounded-es-lg border-b-[1.5px] border-s-[1.5px] border-foreground/10" />
        <PersonInitials name={node.ownerName} size="sm" />
        <div className="grid min-w-0 gap-0.5">
          <span className="type-narrative truncate text-[14.5px] font-medium leading-[1.3] text-foreground">{node.title}</span>
          <span className="flex min-w-0 items-center gap-2 type-control text-muted-foreground">
            <span className="truncate">
              {node.kind === "Personal" ? t("straightUnder", { name: node.ownerName ?? "" }) : [node.orgUnitName, firstName(node.ownerName)].filter(Boolean).join(", ")}
            </span>
            {mine ? <span className="shrink-0 whitespace-nowrap font-semibold text-primary-ink">{t("yourUnit")}</span> : null}
            {total > 0 ? (
              <span className="flex shrink-0 items-center gap-[5px] whitespace-nowrap">
                {faces.length ? <AvatarStack names={faces.slice(0, 4)} size="xs" max={4} /> : null}
                {t("goals", { count: total })}
              </span>
            ) : null}
          </span>
        </div>
      </div>
      <Line node={node} year={year} height={34} small />
      <Standing node={node} />
    </button>
  );
}

/**
 * Goals, Company (D-98): each company goal as a line over the year, its figure the mean of the goals under it, and
 * those goals indented under it on the same months: the units' (yours marked) and anyone's straight under it, people's
 * goals as faces and a count. People who set direction see what is still a draft below, and add from here.
 */
export function CompanyGoals({ tree, myUnitId, drafts, cycle, onOpen, onOpenUnit, onAddUnitGoal }: {
  tree: GoalTree;
  myUnitId: string | null;
  /** Goals not yet published, for the people who can publish them. */
  drafts: GoalNodeDto[];
  cycle: { startDate: string; endDate: string };
  onOpen: (id: string) => void;
  /** Your own unit's goal leads to its tab. */
  onOpenUnit: () => void;
  /** Offered to people who may set a unit's goals. */
  onAddUnitGoal?: (parentId: string) => void;
}) {
  const t = useTranslations("goals.Company");
  const year: Year = { start: cycle.startDate, end: cycle.endDate, today: todayIso() };
  const faces = (id: string) => (tree.peopleUnder.get(id) ?? []).map((goal) => goal.ownerName);

  return (
    <>
      {tree.companies.length === 0 ? (
        <Outline label={t("noCompanyGoals")} />
      ) : (
        <section className="grid gap-1 rounded-surface bg-card px-6 pt-[18px] pb-[22px]">
          <Axis start={year.start} end={year.end} today={year.today} lane={WIDE} />
          {tree.companies.map((company, index) => (
            <div key={company.id} className={cn("grid", index > 0 && "mt-2 border-t border-border pt-2")}>
              <button type="button" onClick={() => onOpen(company.id)} className={cn(WIDE, row, "py-4 hover:bg-foreground/[0.035]")}>
                <div className="grid min-w-0 gap-1">
                  <span className="type-narrative text-[17px] font-medium leading-[1.3] text-foreground">{company.title}</span>
                  {company.measure ? <span className="type-control text-muted-foreground">{company.measure}</span> : null}
                  <span className="flex items-center gap-[7px] type-control text-muted-foreground">
                    <PersonInitials name={company.ownerName} size="xs" />
                    {company.ownerName ?? t("company")}
                  </span>
                </div>
                {/* A roll-up moves at every update under it: the line alone, no dot per point. */}
                <Line node={company} year={year} height={56} dots={false} />
                <Standing node={company} big />
              </button>
              {unitsBelow(tree, company.id).map((unit) => {
                const mine = Boolean(myUnitId) && unit.orgUnitId === myUnitId;
                return <SubLane key={unit.id} node={unit} mine={mine} faces={faces(unit.id)} year={year} onOpen={mine ? onOpenUnit : () => onOpen(unit.id)} />;
              })}
              {(tree.peopleUnder.get(company.id) ?? []).map((goal) => (
                <SubLane key={goal.id} node={goal} mine={false} faces={[]} year={year} onOpen={() => onOpen(goal.id)} />
              ))}
              {onAddUnitGoal ? (
                <button type="button" onClick={() => onAddUnitGoal(company.id)}
                  className="ms-6 mt-1 inline-flex items-center gap-1.5 justify-self-start rounded-control px-2 py-1.5 type-control-label text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                  <Plus aria-hidden className="size-4" />
                  {t("addAUnitGoal")}
                </button>
              ) : null}
            </div>
          ))}
        </section>
      )}
      {drafts.length > 0 ? (
        <section className="grid gap-2 rounded-surface bg-card px-6 py-[22px]">
          <h2 className="type-section-title text-foreground">{t("drafts")}</h2>
          <div className="grid divide-y divide-border">
            {drafts.map((draft) => (
              <button key={draft.id} type="button" onClick={() => onOpen(draft.id)}
                className="-mx-3 flex items-center gap-3 rounded-inset px-3 py-3 text-start outline-none hover:bg-foreground/[0.035] focus-visible:ring-2 focus-visible:ring-ring">
                <div className="grid min-w-0 gap-0.5">
                  <span className="type-narrative truncate text-[15px] text-foreground">{draft.title}</span>
                  <span className="truncate type-control text-muted-foreground">
                    {[draft.ownershipScope === "Company" ? t("company") : draft.orgUnitName, draft.accountablePersonName].filter(Boolean).join(", ")}
                  </span>
                </div>
                <span className="ms-auto type-control text-muted-foreground">{t("notPublished")}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

/**
 * Goals, your unit (D-99): each of the unit's goals leads, large, with its line over the year and its path up to the
 * company's; under it each person's goal on the same months, off track first.
 */
export function UnitGoals({ tree, unitId, cycle, onOpen, onOpenCompany, add }: {
  tree: GoalTree;
  unitId: string;
  cycle: { startDate: string; endDate: string };
  onOpen: (id: string) => void;
  onOpenCompany: () => void;
  /** The way to add a unit goal, for people who may. */
  add?: ReactNode;
}) {
  const t = useTranslations("goals.Company");
  const year: Year = { start: cycle.startDate, end: cycle.endDate, today: todayIso() };
  const goals = useMemo(() => [...tree.byId.values()].filter((node) => node.kind === "OrgUnit" && node.orgUnitId === unitId), [tree, unitId]);
  if (goals.length === 0) return <Outline label={t("noUnitGoals")} action={add} />;
  return (
    <>
      {goals.map((goal) => {
        const parent = goal.parentId ? tree.byId.get(goal.parentId) : null;
        const people = [...(tree.peopleUnder.get(goal.id) ?? [])].sort(byState);
        const hidden = (goal.personal?.total ?? 0) - people.length;
        return (
          <div key={goal.id} className="grid gap-[18px]">
            <section className="grid grid-cols-[minmax(0,1fr)_440px] items-end gap-[34px] rounded-surface bg-card px-6 py-[22px]">
              <div className="grid min-w-0 gap-2.5">
                <button type="button" onClick={() => onOpen(goal.id)} className="justify-self-start rounded-xl text-start outline-none hover:underline hover:decoration-foreground/30 hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="type-display text-foreground">{goal.title}</span>
                </button>
                {goal.measure ? <span className="text-muted-foreground">{goal.measure}</span> : null}
                {parent ? (
                  <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
                    <ArrowUp aria-hidden className="size-3.5 shrink-0" />
                    <button type="button" onClick={onOpenCompany} className="truncate rounded-detail font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                      {parent.title}
                    </button>
                  </span>
                ) : null}
                <div className="mt-1.5 flex flex-wrap items-center gap-[18px]">
                  {goal.hasProgress ? <span className="type-figure">{Math.round(goal.progress)}%</span> : <span className="text-muted-foreground">{t("noUpdateYet")}</span>}
                  {goal.status ? <GoalState status={goal.status} since={goal.statusSince} /> : null}
                  <span className="ms-2 flex items-center gap-[7px] type-control text-muted-foreground">
                    <PersonInitials name={goal.ownerName} size="xs" />
                    {goal.isOwn ? t("yours", { name: goal.ownerName ?? "" }) : goal.ownerName}
                  </span>
                </div>
              </div>
              <div>
                <Line node={goal} year={year} height={92} />
                <GoalMonths start={year.start} end={year.end} />
              </div>
            </section>
            <section className="grid gap-1 rounded-surface bg-card px-6 pt-[18px] pb-[22px]">
              <div className="flex items-center pb-1.5">
                <h2 className="type-section-title text-foreground">{goal.isOwn ? t("yourTeamUnder") : t("goalsUnder")}</h2>
                <span className="ms-auto text-muted-foreground">{t("people", { count: goal.personal?.total ?? people.length })}</span>
              </div>
              {people.length > 0 ? (
                <>
                  <Axis start={year.start} end={year.end} today={year.today} lane={WIDE} />
                  {people.map((person, index) => (
                    <button key={person.id} type="button" onClick={() => onOpen(person.id)}
                      className={cn(WIDE, row, "py-4 hover:bg-foreground/[0.035]", index > 0 && "shadow-[0_-1px_0_var(--border)]")}>
                      <div className="flex min-w-0 items-center gap-3">
                        <PersonInitials name={person.ownerName} size="md" />
                        <div className="grid min-w-0 gap-px">
                          <span className="type-narrative truncate text-[15px] font-medium leading-[1.3] text-foreground">{person.title}</span>
                          <span className="truncate type-control text-muted-foreground">{person.isOwn ? t("you") : person.ownerName}</span>
                        </div>
                      </div>
                      <Line node={person} year={year} height={40} small />
                      <Standing node={person} />
                    </button>
                  ))}
                </>
              ) : null}
              {hidden > 0 || people.length === 0 ? (
                <span className="type-control text-muted-foreground">{people.length === 0 && hidden <= 0 ? t("noOnesGoalsYet") : t("othersGoals", { count: hidden })}</span>
              ) : null}
            </section>
          </div>
        );
      })}
    </>
  );
}

/** D-48: where goals will sit, before there are any. */
function Outline({ label, action }: { label: string; action?: ReactNode }) {
  return (
    <section aria-label={label} className="grid gap-4 rounded-surface px-6 py-[22px] ring-[1.5px] ring-inset ring-border">
      <div className="grid grid-cols-[minmax(0,1fr)_240px] items-center gap-[22px]">
        <div className="grid gap-2">
          <span className="text-[15px] text-muted-foreground">{label}</span>
          <span aria-hidden className="h-2.5 w-[46%] rounded-full bg-muted-foreground/15" />
        </div>
        <span aria-hidden className="bar-stripes h-2 rounded-full" />
      </div>
      {action ? <div>{action}</div> : null}
    </section>
  );
}

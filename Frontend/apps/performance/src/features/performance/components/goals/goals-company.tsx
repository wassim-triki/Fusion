"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { AlignmentMapNodeDto, GoalNodeDto } from "@repo/api";
import { cn } from "@repo/ds";
import { ArrowUp, Plus } from "@repo/ds/icons";
import { Bar, StateWord, type BarTone } from "@repo/ds/shell";
import { PersonInitials } from "@repo/performance-ui";
import { STATUS_TONE } from "../objective-record/goal-panel";
import { firstName } from "../year/year-words";

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

const BAR: Record<string, BarTone> = { ok: "ok", warn: "warn", bad: "bad" };

/** A goal's state word, percent and bar, as one column. */
function Progress({ node, className }: { node: AlignmentMapNodeDto; className?: string }) {
  const t = useTranslations("goals.Company");
  const tone = node.status ? STATUS_TONE[node.status] : null;
  const progress = Math.round(node.progress);
  return (
    <div className={cn("grid gap-[7px]", className)}>
      <div className="flex items-center justify-between">
        {tone ? <StateWord tone={tone}>{t(`status.${node.status!}`)}</StateWord> : <span className="text-[13px] text-muted-foreground">{node.hasProgress ? "" : t("noUpdateYet")}</span>}
        <span className="text-[13px] tabular-nums">{progress}%</span>
      </div>
      <Bar value={node.hasProgress ? progress : 0} tone={tone ? BAR[tone] ?? "primary" : "primary"} label={node.title} />
    </div>
  );
}

/** People's goals under a goal, as small cards. */
function People({ goals, onOpen }: { goals: AlignmentMapNodeDto[]; onOpen: (id: string) => void }) {
  const t = useTranslations("goals.Company");
  return (
    <div className="grid grid-cols-2 gap-2 py-1 ps-12 lg:grid-cols-4">
      {goals.map((goal) => (
        <button key={goal.id} type="button" onClick={() => onOpen(goal.id)}
          className="grid content-start gap-1.5 rounded-xl bg-inlay px-3 py-2.5 text-start outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex items-center gap-1.5 text-[13px]">
            <PersonInitials name={goal.ownerName} size="xs" />
            {goal.isOwn ? t("you") : firstName(goal.ownerName)}
          </span>
          <span className="type-narrative text-[13.5px] leading-[1.3] text-foreground">{goal.title}</span>
          <span className="flex items-center justify-between">
            {goal.status ? <StateWord tone={STATUS_TONE[goal.status]}>{t(`status.${goal.status}`)}</StateWord> : <span />}
            <span className="text-[13px] tabular-nums">{Math.round(goal.progress)}%</span>
          </span>
        </button>
      ))}
    </div>
  );
}

const quiet = "justify-self-start rounded-control px-0.5 text-[13px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

/** A unit's goal under a company goal; its people's goals one click deeper (D-62). */
function UnitRow({ unit, mine, people, onOpen }: { unit: AlignmentMapNodeDto; mine: boolean; people: AlignmentMapNodeDto[]; onOpen: (id: string) => void }) {
  const t = useTranslations("goals.Company");
  const [open, setOpen] = useState(false);
  const hidden = (unit.personal?.total ?? 0) - people.length;
  return (
    <>
      <button type="button" onClick={() => onOpen(unit.id)}
        className={cn("grid w-full grid-cols-[34px_minmax(0,1fr)_200px] items-center gap-3.5 rounded-inset px-3 py-[11px] text-start outline-none focus-visible:ring-2 focus-visible:ring-ring",
          mine ? "bg-primary/[0.07] ring-1 ring-inset ring-primary/30" : "hover:bg-foreground/[0.035]")}>
        <PersonInitials name={unit.ownerName} size="sm" />
        <div className="grid min-w-0 gap-0.5">
          <span className="type-narrative truncate text-[15px] text-foreground">{unit.title}</span>
          <span className="truncate text-[13px] text-muted-foreground">
            {[unit.orgUnitName, unit.ownerName, mine ? t("yourUnit") : null].filter(Boolean).join(", ")}
          </span>
        </div>
        <Progress node={unit} />
      </button>
      {people.length > 0 ? (
        <div className="grid gap-1 ps-[60px]">
          <button type="button" className={quiet} aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? t("hide") : mine ? t("fromYourTeam", { count: people.length }) : t("peoplesGoals", { count: people.length })}
          </button>
        </div>
      ) : hidden > 0 ? (
        <span className="ps-[60px] text-[13px] text-muted-foreground">{t("peoplesGoals", { count: hidden })}</span>
      ) : null}
      {open ? <People goals={people} onOpen={onOpen} /> : null}
    </>
  );
}

/**
 * Goals, Company (D-62): each company goal with its units' goals under it, your own unit's marked and its team's
 * goals one click deeper. People who set direction see what is still a draft below, and add from here.
 */
export function CompanyGoals({ tree, myUnitId, drafts, onOpen, onAddUnitGoal }: {
  tree: GoalTree;
  myUnitId: string | null;
  /** Goals not yet published, for the people who can publish them. */
  drafts: GoalNodeDto[];
  onOpen: (id: string) => void;
  /** Offered to people who may set a unit's goals. */
  onAddUnitGoal?: (parentId: string) => void;
}) {
  const t = useTranslations("goals.Company");
  const mineUnder = (id: string) => unitsBelow(tree, id).some((unit) => unit.orgUnitId === myUnitId);
  const [open, setOpen] = useState<string | null>(() => (tree.companies.find((c) => mineUnder(c.id)) ?? tree.companies[0])?.id ?? null);

  return (
    <>
      {tree.companies.length === 0 ? <Outline label={t("noCompanyGoals")} /> : null}
      {tree.companies.map((company) => {
        const units = unitsBelow(tree, company.id);
        const people = tree.peopleUnder.get(company.id) ?? [];
        const peopleCount = (company.personal?.total ?? 0) + units.reduce((sum, unit) => sum + (unit.personal?.total ?? 0), 0);
        const expanded = open === company.id;
        return (
          <section key={company.id} className="grid gap-4 rounded-surface bg-card px-6 py-[22px]">
            <div className="grid grid-cols-[minmax(0,1fr)_240px] items-center gap-[22px]">
              <button type="button" onClick={() => onOpen(company.id)} className="-m-1 grid gap-1 rounded-xl p-1 text-start outline-none hover:bg-foreground/[0.035] focus-visible:ring-2 focus-visible:ring-ring">
                <span className="type-narrative text-[20px] font-medium leading-[1.25] text-foreground">{company.title}</span>
                {company.measure ? <span className="text-[13px] text-muted-foreground">{company.measure}</span> : null}
                <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <PersonInitials name={company.ownerName} size="xs" />
                  {company.ownerName ? t("ownerCompany", { name: company.ownerName }) : t("company")}
                </span>
              </button>
              <Progress node={company} />
            </div>
            <div className="grid gap-0">
              {expanded ? (
                <>
                  {units.map((unit, index) => (
                    <div key={unit.id} className={cn("grid gap-1", index > 0 && unit.orgUnitId !== myUnitId && units[index - 1]!.orgUnitId !== myUnitId && "border-t border-border")}>
                      <UnitRow unit={unit} mine={Boolean(myUnitId) && unit.orgUnitId === myUnitId} people={tree.peopleUnder.get(unit.id) ?? []} onOpen={onOpen} />
                    </div>
                  ))}
                  {people.length > 0 ? (
                    <div className="mt-2 grid gap-1 border-t border-border pt-3">
                      <span className="ps-12 text-[13px] text-muted-foreground">{t("straightUnder", { count: people.length })}</span>
                      <People goals={people} onOpen={onOpen} />
                    </div>
                  ) : null}
                  {onAddUnitGoal ? (
                    <button type="button" onClick={() => onAddUnitGoal(company.id)} className={cn(quiet, "mt-1 inline-flex items-center gap-1.5 px-3 py-2")}>
                      <Plus aria-hidden className="size-4" />
                      {t("addAUnitGoal")}
                    </button>
                  ) : null}
                </>
              ) : null}
              {units.length + peopleCount > 0 || expanded ? (
                <button type="button" className={cn(quiet, expanded && "mt-1")} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : company.id)}>
                  {expanded ? t("fewer") : t("under", { units: units.length, people: peopleCount })}
                </button>
              ) : onAddUnitGoal ? (
                <button type="button" className={quiet} onClick={() => setOpen(company.id)}>{t("noUnitGoalsYet")}</button>
              ) : (
                <span className="text-[13px] text-muted-foreground">{t("noUnitGoalsYet")}</span>
              )}
            </div>
          </section>
        );
      })}
      {drafts.length > 0 ? (
        <section className="grid gap-2 rounded-surface bg-card px-6 py-[22px]">
          <h2 className="type-section-title text-foreground">{t("drafts")}</h2>
          <div className="grid divide-y divide-border">
            {drafts.map((draft) => (
              <button key={draft.id} type="button" onClick={() => onOpen(draft.id)}
                className="-mx-3 flex items-center gap-3 rounded-inset px-3 py-3 text-start outline-none hover:bg-foreground/[0.035] focus-visible:ring-2 focus-visible:ring-ring">
                <div className="grid min-w-0 gap-0.5">
                  <span className="type-narrative truncate text-[15px] text-foreground">{draft.title}</span>
                  <span className="truncate text-[13px] text-muted-foreground">
                    {[draft.ownershipScope === "Company" ? t("company") : draft.orgUnitName, draft.accountablePersonName].filter(Boolean).join(", ")}
                  </span>
                </div>
                <span className="ms-auto text-[13px] text-muted-foreground">{t("notPublished")}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

/**
 * Goals, your unit: the unit's goals, each with the company goal it supports above it and its people's goals under it.
 */
export function UnitGoals({ tree, unitId, onOpen, add }: {
  tree: GoalTree;
  unitId: string;
  onOpen: (id: string) => void;
  /** The way to add a unit goal, for people who may. */
  add?: ReactNode;
}) {
  const t = useTranslations("goals.Company");
  const goals = useMemo(() => [...tree.byId.values()].filter((node) => node.kind === "OrgUnit" && node.orgUnitId === unitId), [tree, unitId]);
  if (goals.length === 0) return <Outline label={t("noUnitGoals")} action={add} />;
  return (
    <>
      {goals.map((goal) => {
        const parent = goal.parentId ? tree.byId.get(goal.parentId) : null;
        const people = tree.peopleUnder.get(goal.id) ?? [];
        const hidden = (goal.personal?.total ?? 0) - people.length;
        return (
          <section key={goal.id} className="grid gap-4 rounded-surface bg-card px-6 py-[22px]">
            <div className="grid grid-cols-[minmax(0,1fr)_240px] items-center gap-[22px]">
              <button type="button" onClick={() => onOpen(goal.id)} className="-m-1 grid gap-1 rounded-xl p-1 text-start outline-none hover:bg-foreground/[0.035] focus-visible:ring-2 focus-visible:ring-ring">
                <span className="type-narrative text-[20px] font-medium leading-[1.25] text-foreground">{goal.title}</span>
                {goal.measure ? <span className="text-[13px] text-muted-foreground">{goal.measure}</span> : null}
                <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <PersonInitials name={goal.ownerName} size="xs" />
                  {goal.ownerName}
                </span>
                {parent ? (
                  <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
                    <ArrowUp aria-hidden className="size-3.5 shrink-0" />
                    <b className="truncate font-medium text-foreground">{parent.title}</b>
                  </span>
                ) : null}
              </button>
              <Progress node={goal} />
            </div>
            {people.length > 0 ? (
              <div className="-ms-12"><People goals={people} onOpen={onOpen} /></div>
            ) : (
              <span className="text-[13px] text-muted-foreground">{hidden > 0 ? t("peoplesGoals", { count: hidden }) : t("noOnesGoalsYet")}</span>
            )}
          </section>
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

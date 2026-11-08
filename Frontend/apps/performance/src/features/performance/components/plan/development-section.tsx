"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronRight, Pencil, Plus, Trash2, X } from "@/lib/icons";
import type { DevelopmentGoalDto, DevelopmentGoalInput, DevelopmentGoalStatus, DevelopmentPlanDto } from "@repo/api";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ds/components/ui/alert-dialog";
import { Segmented } from "@repo/ds/choice";
import { Button } from "@repo/ds/components/ui/button";
import { DatePicker } from "@repo/ds/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@repo/ds/components/ui/dialog";
import { Input } from "@repo/ds/components/ui/input";
import { Label } from "@repo/ds/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@repo/ds/components/ui/native-select";
import { AsyncButton, Section } from "@repo/ds/shell";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@repo/ds/components/ui/sheet";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { cn } from "@repo/ds/lib/utils";
import { usePerformanceWords } from "@repo/performance-ui";
import { reportPerformanceFailure } from "@/features/performance/api/performance-failure";
import { useDevelopmentMutations, useDevelopmentPlan } from "../../api/use-performance";

import { SectionTitle } from "./plan-layout";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";
import { PageFailure } from "@repo/auth";

const STATUSES: DevelopmentGoalStatus[] = ["NotStarted", "InProgress", "Done"];
const MAX_ACTIONS = 5;

/**
 * The plan's second section (D-34, S-08): up to five development goals the employee and their reviewer keep
 * together, with no approval. Each goal is a row in the section (B-228): its status by shape, the title, the
 * competency and aimed-for date; the row opens the goal beside the list, where its actions, status and edits live.
 * Changes save at once. Open goals from the previous cycle are offered once here.
 */
export function DevelopmentSection({ cycleId, employeeId }: { cycleId: string; employeeId: string }) {
  const t = useTranslations("plan.DevelopmentSection");
  const query = useDevelopmentPlan(cycleId, employeeId);
  const plan = query.data;
  const [composer, setComposer] = useState<{ goal?: DevelopmentGoalDto } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = plan?.goals.find((goal) => goal.id === openId) ?? null;
  const rows = Boolean(plan && plan.goals.length > 0);

  return (
    <div id="development" className="scroll-mt-6">
      <Section
        title={<SectionTitle label={t("development")} count={plan && plan.goals.length > 0 ? plan.goals.length : undefined} />}
        flush={rows}
        action={
          // The empty state carries the first Add itself; with an offer to bring goals over, Add sits here instead.
          plan?.canEdit && plan.room > 0 && (plan.goals.length > 0 || plan.carryOver) ? (
            <Button size="sm" variant="outline" onClick={() => setComposer({})}>
              <Plus className="size-4" data-icon="inline-start" /> {t("addGoal")}
            </Button>
          ) : null
        }
      >
        {query.isLoading ? (
          <Skeleton className="h-28 w-full rounded-control" aria-label={t("loadingDevelopment")} />
        ) : query.error || !plan ? (
          <PageFailure error={query.error} onRetry={query.refetch} size="card" title={t("developmentUnavailable")} />
        ) : (
          <>
            {plan.carryOver ? (
              <div className={cn(rows && "border-b border-border px-5 py-3")}>
                <CarryOverOffer plan={plan} cycleId={cycleId} employeeId={employeeId} />
              </div>
            ) : null}
            {plan.goals.length === 0 && plan.carryOver ? null : plan.goals.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-center">
                <p className="type-label text-foreground">{t("noDevelopmentGoalsYet")}</p>
                {plan.canEdit ? (
                  <Button size="sm" className="mt-4" onClick={() => setComposer({})}>
                    <Plus className="size-4" data-icon="inline-start" /> {t("addAGoal")}
                  </Button>
                ) : null}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {plan.goals.map((goal) => (
                  <GoalRow key={goal.id} goal={goal} active={openId === goal.id} onOpen={() => setOpenId(goal.id)} />
                ))}
              </ul>
            )}
          </>
        )}
      </Section>
      {plan ? (
        <GoalDrawer
          goal={open}
          plan={plan}
          cycleId={cycleId}
          employeeId={employeeId}
          onClose={() => setOpenId(null)}
          onEdit={(goal) => setComposer({ goal })}
        />
      ) : null}
      {composer && plan ? (
        <GoalComposer plan={plan} cycleId={cycleId} employeeId={employeeId} goal={composer.goal} onClose={() => setComposer(null)} />
      ) : null}
    </div>
  );
}

function toInput(goal: DevelopmentGoalDto, version: number, overrides: Partial<DevelopmentGoalInput> = {}): DevelopmentGoalInput {
  return {
    expectedVersion: version,
    title: goal.title,
    competencyId: goal.competencyId,
    actions: goal.actions,
    targetDate: goal.targetDate,
    status: goal.status,
    ...overrides,
  };
}

/** One goal as a row: its status by shape, the title over its competency and date, the status in words. */
function GoalRow({ goal, active, onOpen }: { goal: DevelopmentGoalDto; active: boolean; onOpen: () => void }) {
  const format = useFormat();
  const t = useTranslations("plan.GoalCard");
  const words = usePerformanceWords();
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        // eslint-disable-next-line no-restricted-syntax -- the row opens this goal in the side panel; pressed marks the one open
        aria-pressed={active}
        className={cn(
          "group flex w-full items-center gap-4 px-5 py-3.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          active ? "bg-inlay/50 ring-1 ring-inset ring-primary-ring" : "hover:bg-inlay/40",
          goal.carriedToCycleName && "opacity-75"
        )}
      >
        <StatusMark status={goal.status} />
        <span className="min-w-0 flex-1">
          <span className="block type-label text-foreground">{goal.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 type-meta text-muted-foreground">
            {goal.competencyName ? <CompetencyChip name={goal.competencyName} /> : null}
            {goal.targetDate && goal.status !== "Done" ? <span>{t("by", { targetDate: format.date(goal.targetDate) })}</span> : null}
            {goal.carriedFromEarlierCycle ? <span>{t("fromLastCycle")}</span> : null}
            {goal.carriedToCycleName ? <span className="font-medium text-foreground">{t("carriedTo", { carriedToCycleName: goal.carriedToCycleName })}</span> : null}
          </span>
        </span>
        <span className="shrink-0 type-meta-strong text-muted-foreground">{words.developmentStatus(goal.status)}</span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground rtl:-scale-x-100" aria-hidden />
      </button>
    </li>
  );
}

function CompetencyChip({ name }: { name: string }) {
  return <span className="rounded-full bg-primary-tint px-2 py-0.5 font-medium text-primary-ink ring-1 ring-inset ring-primary-ring">{name}</span>;
}

/** One goal beside the list: its status (changed in place by an editor), when it's aimed for, its actions, Edit and Remove. */
function GoalDrawer({ goal, plan, cycleId, employeeId, onClose, onEdit }: {
  goal: DevelopmentGoalDto | null;
  plan: DevelopmentPlanDto;
  cycleId: string;
  employeeId: string;
  onClose: () => void;
  onEdit: (goal: DevelopmentGoalDto) => void;
}) {
  const format = useFormat();
  const t = useTranslations("plan.GoalCard");
  const words = usePerformanceWords();
  const mutations = useDevelopmentMutations(cycleId, employeeId);
  const [removing, setRemoving] = useState(false);
  const editable = Boolean(goal) && plan.canEdit && !goal!.carriedToCycleName;

  const setStatus = async (status: DevelopmentGoalStatus) => {
    if (!goal) return;
    try {
      await mutations.update.mutateAsync({ goalId: goal.id, input: toInput(goal, plan.version, { status }) });
    } catch (error) {
      reportPerformanceFailure(error, t("couldNotChangeTheGoals"));
    }
  };

  return (
    <Sheet open={Boolean(goal)} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-[30rem]">
        {goal ? (
          <>
            <div className="px-6 pt-6 pe-12">
              <p className="type-meta text-muted-foreground">{t("developmentGoal")}</p>
              <SheetTitle className="mt-1 type-panel-title text-foreground">{goal.title}</SheetTitle>
              <SheetDescription className="sr-only">{t("developmentGoal")}</SheetDescription>
            </div>
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 pt-5 pb-8">
              {editable ? (
                <Segmented
                  fill
                  label={t("status")}
                  value={goal.status}
                  onChange={(value) => void setStatus(value)}
                  options={STATUSES.map((value) => ({ value, label: words.developmentStatus(value) }))}
                />
              ) : (
                <p className="flex items-center gap-2 type-label text-foreground">
                  <StatusMark status={goal.status} />
                  {words.developmentStatus(goal.status)}
                </p>
              )}
              <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-3 type-body">
                {goal.competencyName ? (
                  <>
                    <dt className="type-meta text-muted-foreground">{t("competency")}</dt>
                    <dd><CompetencyChip name={goal.competencyName} /></dd>
                  </>
                ) : null}
                <dt className="type-meta text-muted-foreground">{t("aimedFor")}</dt>
                <dd className="text-foreground">{goal.targetDate ? format.date(goal.targetDate) : "–"}</dd>
                {goal.addedBy?.name ? (
                  <>
                    <dt className="type-meta text-muted-foreground">{t("addedBy")}</dt>
                    <dd className="text-foreground">{goal.addedBy.name}</dd>
                  </>
                ) : null}
                {goal.carriedToCycleName ? (
                  <>
                    <dt className="type-meta text-muted-foreground">{t("now")}</dt>
                    <dd className="text-foreground">{t("carriedTo", { carriedToCycleName: goal.carriedToCycleName })}</dd>
                  </>
                ) : goal.carriedFromEarlierCycle ? (
                  <>
                    <dt className="type-meta text-muted-foreground">{t("from")}</dt>
                    <dd className="text-foreground">{t("fromLastCycle")}</dd>
                  </>
                ) : null}
              </dl>
              <section>
                <h3 className="type-meta text-muted-foreground">{t("actions")}</h3>
                {goal.actions.length > 0 ? (
                  <ul className="mt-2 space-y-1.5">
                    {goal.actions.map((action, index) => (
                      <li key={index} className="flex gap-2.5 type-body text-foreground/85">
                        <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />
                        {action}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 type-body-secondary text-muted-foreground">{t("noActions")}</p>
                )}
              </section>
            </div>
            {editable ? (
              <div className="flex items-center gap-3 border-t border-border bg-popover px-6 py-4">
                <Button variant="outline" size="sm" onClick={() => onEdit(goal)} disabled={mutations.update.isLoading}>
                  <Pencil className="size-4" data-icon="inline-start" /> {t("edit")}
                </Button>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setRemoving(true)}>
                  <Trash2 className="size-4" data-icon="inline-start" /> {t("remove")}
                </Button>
              </div>
            ) : null}
            <AlertDialog open={removing} onOpenChange={(next) => { if (!mutations.remove.isLoading) setRemoving(next); }}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("removeThisGoal")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    <span className="font-medium text-foreground">{goal.title}</span> {t("leavesTheDevelopmentPlan")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={mutations.remove.isLoading}>{t("keepIt")}</AlertDialogCancel>
                  <AsyncButton
                    variant="destructive"
                    pending={mutations.remove.isLoading}
                    onClick={async () => {
                      try {
                        await mutations.remove.mutateAsync({ goalId: goal.id, expectedVersion: plan.version });
                        setRemoving(false);
                        onClose();
                      } catch (error) {
                        reportPerformanceFailure(error, t("couldNotRemoveTheGoal"));
                      }
                    }}
                  >
                    {t("removeGoal")}
                  </AsyncButton>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** The goal's status by shape: an empty ring, a half-filled ring, a filled check. */
function StatusMark({ status }: { status: DevelopmentGoalStatus }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2",
        status === "Done" && "border-success bg-success text-background",
        status === "InProgress" && "border-primary bg-[linear-gradient(90deg,var(--primary)_50%,transparent_50%)]",
        status === "NotStarted" && "border-muted-foreground/40"
      )}
    >
      {status === "Done" ? (
        <svg viewBox="0 0 12 12" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2.5 6.5l2.2 2.2 4.8-5" />
        </svg>
      ) : null}
    </span>
  );
}

/** Open goals from the previous cycle, offered once: choose which to bring over, or dismiss the offer. */
function CarryOverOffer({ plan, cycleId, employeeId }: { plan: DevelopmentPlanDto; cycleId: string; employeeId: string }) {
  const t = useTranslations("plan.CarryOverOffer");
  const words = usePerformanceWords();
  const offer = plan.carryOver!;
  const mutations = useDevelopmentMutations(cycleId, employeeId);
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState<string[]>(offer.goals.slice(0, plan.room).map((g) => g.id));
  const count = offer.goals.length;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-control bg-inlay px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="type-label text-foreground">{t("openGoal", { count })}{count === 1 ? "" : t("s")} {t("from", { fromCycleName: offer.fromCycleName })}</p>
        <p className="truncate type-meta text-muted-foreground">{offer.goals.map((goal) => goal.title).join(", ")}</p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={mutations.dismiss.isLoading}
        onClick={async () => {
          try {
            await mutations.dismiss.mutateAsync(plan.version);
          } catch (error) {
            reportPerformanceFailure(error, t("couldNotDismissTheOffer"));
          }
        }}
      >
        {t("dismiss")}
      </Button>
      <Button size="sm" onClick={() => setChoosing(true)}>{t("bringOver")}</Button>

      <Dialog open={choosing} onOpenChange={(open) => { if (!mutations.carryOver.isLoading) setChoosing(open); }}>
        <DialogContent className="w-[min(32rem,calc(100vw-2rem))] max-w-none">
          <DialogHeader>
            <DialogTitle>{t("bringGoalsOverFrom", { fromCycleName: offer.fromCycleName })}</DialogTitle>
            <DialogDescription>{t("roomForMore", { room: plan.room })}</DialogDescription>
          </DialogHeader>
          <ul className="space-y-1.5">
            {offer.goals.map((goal) => {
              const on = chosen.includes(goal.id);
              const full = !on && chosen.length >= plan.room;
              return (
                <li key={goal.id}>
                  <label className={cn("flex items-center gap-3 rounded-control border px-3 py-2.5 type-body", on ? "border-primary" : "border-border", full && "opacity-50")}>
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={on}
                      disabled={full}
                      onChange={() => setChosen((ids) => (on ? ids.filter((id) => id !== goal.id) : [...ids, goal.id]))}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-foreground">{goal.title}</span>
                      <span className="block type-meta text-muted-foreground">{words.developmentStatus(goal.status)}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChoosing(false)} disabled={mutations.carryOver.isLoading}>{t("cancel")}</Button>
            <AsyncButton
              pending={mutations.carryOver.isLoading}
              disabled={chosen.length === 0}
              onClick={async () => {
                try {
                  await mutations.carryOver.mutateAsync({ goalIds: chosen, expectedVersion: plan.version });
                  toast.success(t("broughtOver", { count: chosen.length }));
                  setChoosing(false);
                } catch (error) {
                  reportPerformanceFailure(error, t("couldNotBringTheGoals"));
                }
              }}
            >
              {t("bringOver2", { length: chosen.length })}
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Add or edit one goal: title, competency, actions, aimed-for date and status. */
function GoalComposer({ plan, cycleId, employeeId, goal, onClose }: {
  plan: DevelopmentPlanDto;
  cycleId: string;
  employeeId: string;
  goal?: DevelopmentGoalDto;
  onClose: () => void;
}) {
  const t = useTranslations("plan.GoalComposer");
  const words = usePerformanceWords();
  const mutations = useDevelopmentMutations(cycleId, employeeId);
  const [title, setTitle] = useState(goal?.title ?? "");
  const [competencyId, setCompetencyId] = useState(goal?.competencyId ?? "");
  const [actions, setActions] = useState<string[]>(goal?.actions.length ? goal.actions : [""]);
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? "");
  const [status, setStatus] = useState<DevelopmentGoalStatus>(goal?.status ?? "NotStarted");
  const saving = mutations.add.isLoading || mutations.update.isLoading;

  const save = async () => {
    const input: DevelopmentGoalInput = {
      expectedVersion: plan.version,
      title: title.trim(),
      competencyId: competencyId || null,
      actions: actions.map((a) => a.trim()).filter(Boolean),
      targetDate: targetDate || null,
      status,
    };
    try {
      if (goal) await mutations.update.mutateAsync({ goalId: goal.id, input });
      else await mutations.add.mutateAsync(input);
      onClose();
    } catch (error) {
      reportPerformanceFailure(error, t("couldNotSaveTheGoal"));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="w-[min(36rem,calc(100vw-2rem))] max-w-none">
        <DialogHeader>
          <DialogTitle>{goal ? t("editGoal") : t("addADevelopmentGoal")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="dg-title">{t("goal")}</Label>
            <Input id="dg-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dg-competency">{t("competency")} <span className="font-normal text-muted-foreground">{t("optional")}</span></Label>
              <NativeSelect id="dg-competency" value={competencyId} onChange={(e) => setCompetencyId(e.target.value)} className="w-full">
                <NativeSelectOption value="">{t("none")}</NativeSelectOption>
                {plan.competencyOptions.map((option) => (
                  <NativeSelectOption key={option.id} value={option.id}>{option.name}</NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dg-target">{t("by")} <span className="font-normal text-muted-foreground">{t("optional")}</span></Label>
              <DatePicker id="dg-target" value={targetDate} onChange={setTargetDate} />
            </div>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="type-label text-foreground">{t("status")}</legend>
            <Segmented
              fill
              label={t("status")}
              value={status}
              onChange={setStatus}
              options={STATUSES.map((value) => ({ value, label: words.developmentStatus(value) }))}
            />
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="type-label text-foreground">{t("actions")} <span className="font-normal text-muted-foreground">{t("optional")}</span></legend>
            {actions.map((action, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  aria-label={t("action", { value: index + 1 })}
                  value={action}
                  maxLength={200}
                  onChange={(e) => setActions((all) => all.map((a, i) => (i === index ? e.target.value : a)))}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("removeAction", { value: index + 1 })}
                  onClick={() => setActions((all) => (all.length === 1 ? [""] : all.filter((_, i) => i !== index)))}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
            {actions.length < MAX_ACTIONS ? (
              <Button variant="ghost" size="sm" className="-ms-2" onClick={() => setActions((all) => [...all, ""])}>
                <Plus className="size-4" data-icon="inline-start" /> {t("addAnAction")}
              </Button>
            ) : null}
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>{t("cancel")}</Button>
          <AsyncButton pending={saving} disabled={title.trim() === ""} onClick={save}>
            {goal ? t("saveGoal") : t("addGoal")}
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

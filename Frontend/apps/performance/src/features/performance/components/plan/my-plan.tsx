"use client";

import { performanceFailure, reportPerformanceFailure } from "@/features/performance/api/performance-failure";

import { useMemo, useState, type ReactNode } from "react";
import {
  Check,
  BarChart3,
  Plus,
  Send,
  Share2,
  Target,
  User,
  Users,
} from "@/lib/icons";
import { toast } from "sonner";
import { useAuth } from "@repo/auth";
import type {
  AddPlanObjectiveRequest,
  AlignmentTargetDto,
  CycleSummaryDto,
  EmployeePlanDto,
  PlanObjectiveDto,
  UpdateRequestDto,
} from "@repo/api";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@repo/ds/components/ui/alert-dialog";
import { Button } from "@repo/ds/components/ui/button";
import { AsyncButton, PagePermissionNotice, PageError } from "@repo/ds/shell";
import { PlanEmptySkeleton } from "./plan-skeleton";
import {
  useAlignmentTargets,
  useMyPlan,
  usePlanMutations,
} from "../../api/use-performance";
import { directionFromTargets } from "./plan-direction";
import { PlanGoalComposer } from "./goal-composer";
import { useObjectiveRecord } from "../objective-record/use-objective-record";
import { PlanObjectiveRow } from "./plan-objective-row";
import { ObjectiveRequestMarker, RequestBand, openRequestsFor } from "../update-requests/update-requests";
import { useUpdateRequests } from "../../api/use-update-requests";
import { PlanDocument, PlanSection, PlanWeightStrip } from "./plan-layout";
import { PlanRail, activeReturn } from "./plan-rail";
import { DevelopmentSection } from "./development-section";
import { OwnerChangeRequest } from "./change-requests";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";
import { useSay } from "@repo/ds/lib/say";

/**
 * The employee's Plan as a document with a properties sidebar (see `plan-layout.tsx`). The page heading
 * is rendered here, through `heading`, because its actions depend on the plan: Submit lives in the
 * header, not in a bar under the list.
 */
export function MyPlan({
  cycle,
  heading,
}: {
  cycle: CycleSummaryDto;
  heading: (actions?: ReactNode) => ReactNode;
}) {
  const t = useTranslations("plan.MyPlan");
  const words = useSay("common.words");
  const cycleId = cycle.id;
  const state = useMyPlan(cycleId);
  const targetsQuery = useAlignmentTargets(cycleId, state.data?.participatesInCycle ?? false);
  const mutations = usePlanMutations(cycleId);
  const { user } = useAuth();
  // Update requests concern an executing plan only.
  const lockedPlan = state.data?.plan?.isLocked ? state.data.plan : null;
  const requests = useUpdateRequests(lockedPlan?.cycleId ?? null, lockedPlan?.id ?? null);

  const [composer, setComposer] = useState<{ objective?: PlanObjectiveDto } | null>(null);

  if (state.isLoading) {
    return (
      <>
        {heading()}
        <PlanEmptySkeleton />
      </>
    );
  }
  if (performanceFailure(state.error).unavailable) {
    return <PagePermissionNotice title={t("planUnavailable")} />;
  }

  if (state.error || !state.data) {
    return (
      <>
        {heading()}
        <PageError title={t("planUnavailable")} description={state.error?.message} onRetry={state.refetch} />
      </>
    );
  }

  const { participatesInCycle, plan, preview } = state.data;

  if (!participatesInCycle) {
    return (
      <>
        {heading()}
        <p className="max-w-md type-body text-muted-foreground">
          {t("youAreNotPartOf")}
        </p>
      </>
    );
  }

  const targets = targetsQuery.data ?? [];
  const hasObjectives = (plan?.objectives.length ?? 0) > 0;

  // Reviewer and supported direction come from the plan once it exists, and from the participant
  // preview before then — so the not-started and authoring surfaces name the same people.
  const reviewerName = plan?.responsibleManager?.name ?? preview?.reviewer?.name ?? null;

  // The composer is shared across the not-started and authoring surfaces. Before a plan exists it runs
  // on cycle-settings defaults, and the plan is created lazily on the first objective — so opening and
  // cancelling the composer from the not-started surface leaves no empty Draft behind.
  const composerNode = composer ? (
    <PlanGoalComposer
      open
      onOpenChange={(open) => {
        if (!open) setComposer(null);
      }}
      cycle={cycle}
      targets={targets}
      standaloneAllowed={
        plan?.readiness.standaloneAllowed ?? preview?.standaloneAllowed ?? false
      }
      teamName={plan?.orgUnitName ?? preview?.orgUnitName}
      objective={composer.objective}
      otherWeightTotal={(plan?.readiness.weightTotal ?? 0) - (composer.objective?.planWeight ?? 0)}
      onCreate={async (request: Omit<AddPlanObjectiveRequest, "expectedVersion">) => {
        // First objective materializes the plan; the two calls are sequential so the plan exists
        // server-side before the objective is added.
        const currentPlan = plan ?? await mutations.create.mutateAsync(cycle.version);
        await mutations.addObjective.mutateAsync({ request, expectedVersion: currentPlan.version });
        toast.success(t("objectiveAdded"));
      }}
      onUpdate={async (request: Omit<AddPlanObjectiveRequest, "expectedVersion">) => {
        if (!composer.objective) return;
        await mutations.updateObjective.mutateAsync({ objectiveId: composer.objective.id, request, expectedVersion: plan!.version });
        toast.success(t("objectiveUpdated"));
      }}
    />
  ) : null;

  // No objectives yet — the not-started surface. Pure conditional rendering on the objective count:
  // there is no separate empty-Draft screen. The CTA opens the composer, and adding the first
  // objective creates the plan and reveals the authoring surface in the same place.
  if (!hasObjectives) {
    const directionLevels = directionFromTargets(targets, plan?.orgUnitName ?? preview?.orgUnitName, words);
    return (
      <>
        {heading()}
        <PlanDocument
          main={
            <>
              <PlanNotStarted cycleName={cycle.name} onStart={() => setComposer({})} />
              {user?.employeeId ? (
                <div className="mt-10">
                  <DevelopmentSection cycleId={cycleId} employeeId={user.employeeId} />
                </div>
              ) : null}
            </>
          }
          sidebar={
            <PlanRail
              plan={null}
              lens="owner"
              targets={targets}
              reviewer={{ id: preview?.reviewer?.id ?? null, name: reviewerName }}
              planningDeadline={cycle.planningDeadline}
              directionLevels={directionLevels}
            />
          }
        />
        {composerNode}
      </>
    );
  }

  // From here a plan exists with at least one objective.
  if (!plan) return null;

  const returned = plan.state === "Draft" && plan.history.at(-1)?.kind === "Returned";
  const isAuthor = plan.canAuthor;

  // The side panel keeps one structure in every state (D-08); see PlanRail.
  const sidebar = (
    <PlanRail
      plan={plan}
      lens="owner"
      targets={targets}
      reviewer={{ id: plan.responsibleManager?.id ?? null, name: reviewerName }}
      planningDeadline={cycle.planningDeadline}
    />
  );

  const actions = isAuthor ? (
    <SubmitPlanAction
      canSubmit={plan.canSubmit}
      submitting={mutations.submit.isLoading}
      resubmit={returned}
      reviewerName={reviewerName}
      objectiveCount={plan.objectives.length}
      lastSavedAt={plan.lastSavedAt}
      onSubmit={async () => {
        try {
          await mutations.submit.mutateAsync(plan.version);
          toast.success(returned ? t("resubmitted") : t("submitted"));
          return true;
        } catch (error) {
          reportPerformanceFailure(error, t("couldNotSubmitYourPlan"));
          return false;
        }
      }}
    />
  ) : undefined;

  return (
    <>
      {heading(actions)}
      <PlanDocument
          main={
            <>
              {plan.isLocked && openRequestsFor(requests.data, null).length > 0 ? (
                <div className="mb-6 space-y-2">
                  {openRequestsFor(requests.data, null).map((item) => <RequestBand key={item.id} request={item} />)}
                </div>
              ) : null}
              <div id="plan-objectives" className="scroll-mt-6">
                <ObjectiveLedger
                  plan={plan}
                  cycle={cycle}
                  targets={targets}
                  requests={requests.data}
                  onAddress={async (requestId, reply) => {
                    try {
                      await mutations.addressChangeRequest.mutateAsync({ requestId, reply, expectedVersion: plan.version });
                      return true;
                    } catch (error) {
                      reportPerformanceFailure(error, t("couldNotMarkTheChange"));
                      return false;
                    }
                  }}
                  onAdd={() => setComposer({})}
                  onEdit={(objective) => setComposer({ objective })}
                  onRemove={async (id) => {
                    try {
                      await mutations.removeObjective.mutateAsync({ objectiveId: id, expectedVersion: plan.version });
                    } catch (error) {
                      reportPerformanceFailure(error, t("couldNotRemoveTheObjective"));
                    }
                  }}
                />
              </div>
              <div className="mt-10">
                <DevelopmentSection cycleId={plan.cycleId} employeeId={plan.employee.id} />
              </div>
            </>
          }
          sidebar={sidebar}
        />
      {composerNode}
    </>
  );
}

/**
 * The plan ledger: a section heading (count, weight total, the single add affordance) over the
 * objective cards, which sit on the canvas. The list is not boxed, so it simply ends after the last card. Authoring actions live per-row behind an overflow menu; a submitted or
 * locked plan renders the same rows without them.
 */
function ObjectiveLedger({
  plan,
  cycle,
  targets,
  requests,
  onAddress,
  onAdd,
  onEdit,
  onRemove,
}: {
  plan: EmployeePlanDto;
  cycle: CycleSummaryDto;
  targets: AlignmentTargetDto[];
  requests: UpdateRequestDto[] | undefined;
  /** Marks a change request addressed; resolves whether it saved. */
  onAddress: (requestId: string, reply: string | null) => Promise<boolean>;
  onAdd: () => void;
  onEdit: (objective: PlanObjectiveDto) => void;
  onRemove: (objectiveId: string) => void;
}) {
  const t = useTranslations("plan.ObjectiveLedger");
  const words = useSay("common.words");
  // The objective record: the eye opens it, Update progress opens it in its record task, and an
  // objective's alignment opens the direction it supports — all addressed in this plan's own Cycle.
  const record = useObjectiveRecord();
  const refFor = (objectiveId: string) => ({ cycleId: plan.cycleId, objectiveId });

  // Resolve each aligned objective's parent scope label (e.g. "Talent Pod") once from the targets.
  const scopeByTitle = useMemo(() => {
    const map = new Map<string, string>();
    for (const target of targets) {
      map.set(target.title, target.ownershipScope === "Company" ? words("companyStrategy") : target.orgUnitName ?? words("organizational"));
    }
    return map;
  }, [targets, words]);

  const scopeFor = (objective: PlanObjectiveDto) =>
    objective.isAligned ? scopeByTitle.get(objective.directionPath.at(-1) ?? "") : undefined;

  return (
    <PlanSection
      label={t("objectives")}
      count={plan.objectives.length}
      // Weights are settled at 100% once the plan is locked; the strip only guides drafting.
      summary={plan.isLocked ? undefined : <PlanWeightStrip segments={plan.objectives.map((o) => ({ weight: o.planWeight ?? 0, aligned: o.isAligned }))} />}
      action={
        plan.canAuthor ? (
          <Button
            size="sm"
            onClick={onAdd}
            className="bg-foreground text-background hover:bg-foreground/90"
          >
            <Plus className="size-4" data-icon="inline-start" /> {t("addObjective")}
          </Button>
        ) : null
      }
    >

      {plan.objectives.length === 0 ? (
        <div className="rounded-surface border border-dashed border-border px-5 py-10 text-center type-body text-muted-foreground">
          {t("noObjectivesYetAddThe")}
        </div>
      ) : (
        <div className="space-y-3">
          {plan.objectives.map((objective) => (
            // On a locked plan the row grows an execution band (progress ring, latest reported value,
            // Update progress) while the baseline above it stays read-only.
            <PlanObjectiveRow
              key={objective.id}
              objective={objective}
              cycle={cycle}
              alignmentScope={scopeFor(objective)}
              showProgress={plan.isLocked}
              active={record.isOpen(refFor(objective.id))}
              onEdit={plan.canAuthor ? () => onEdit(objective) : undefined}
              onRemove={plan.canAuthor ? () => onRemove(objective.id) : undefined}
              onOpenProgress={plan.isLocked ? () => record.open(refFor(objective.id), { mode: "record" }) : undefined}
              onViewDetails={() => record.open(refFor(objective.id))}
              onViewAlignment={(parentId) => record.open(refFor(parentId))}
              executionAside={openRequestsFor(requests, objective.id).map((item) => <ObjectiveRequestMarker key={item.id} request={item} />)}
              footer={(() => {
                const returned = activeReturn(plan);
                const asked = returned?.changeRequests.find((r) => r.objectiveId === objective.id);
                return returned && asked ? (
                  <OwnerChangeRequest
                    request={asked}
                    reviewerName={returned.actorName ?? t("yourReviewer")}
                    decidedAt={returned.decidedAt}
                    canAddress={plan.canAuthor}
                    onAddress={(reply) => onAddress(asked.id, reply)}
                  />
                ) : null;
              })()}
            />
          ))}
        </div>
      )}

    </PlanSection>
  );
}

/**
 * The plan-level terminal action while authoring, in the page header. Every objective edit already
 * persists to the Draft, so there is no separate save: the quiet saved time states that truth, and
 * Submit is the one dominant action, naming the reviewer it hands the agreement to.
 */
function SubmitPlanAction({
  canSubmit,
  submitting,
  resubmit,
  reviewerName,
  objectiveCount,
  lastSavedAt,
  onSubmit,
}: {
  canSubmit: boolean;
  submitting: boolean;
  resubmit: boolean;
  reviewerName: string | null;
  objectiveCount: number;
  lastSavedAt: string;
  onSubmit: () => Promise<boolean>;
}) {
  const format = useFormat();
  const t = useTranslations("plan.SubmitPlanAction");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const reviewer = reviewerName ?? t("yourReviewer");
  return (
    <>
      <span className="hidden items-center gap-1.5 type-meta text-muted-foreground sm:inline-flex">
        <Check className="size-3.5 text-success" aria-hidden />
        {t("saved", { lastSavedAt: format.dateTime(lastSavedAt) })}
      </span>
      <AlertDialog open={confirmOpen} onOpenChange={(o) => { if (!submitting) setConfirmOpen(o); }}>
        <AlertDialogTrigger asChild>
          <Button disabled={!canSubmit}>
            <Send className="size-4" data-icon="inline-start" /> {resubmit ? t("resubmitPlan") : t("submitPlan")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{resubmit ? t("resubmitYourPlan") : t("submitYourPlan")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("your")}
              <span className="font-medium text-foreground">
                {t("objective", { objectiveCount })}{objectiveCount === 1 ? "" : t("s")}
              </span>{t("goTo")} <span className="font-medium text-foreground">{reviewer}</span>{t("you")}
              <span className="font-medium text-foreground">{t("cantEditThem")}</span> {t("whileThePlanIsIn")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>{t("keepEditing")}</AlertDialogCancel>
            <AsyncButton
              pending={submitting}
              onClick={async () => {
                if (await onSubmit()) setConfirmOpen(false);
              }}
            >
              <Send className="size-4" data-icon="inline-start" /> {resubmit ? t("resubmit") : t("submit")}
            </AsyncButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}



/**
 * The not-started ledger: the objectives surface before a plan exists. A single document-and-plus mark
 * over the one dominant action, naming the Cycle and the reviewer who will hold the agreement. The
 * inspiration footer doubles as the quiet path to Organization Goals for those who can see it.
 */
function PlanNotStarted({
  cycleName,
  onStart,
}: {
  cycleName: string;
  onStart: () => void;
}) {
  const t = useTranslations("plan.PlanNotStarted");
  return (
    <PlanSection label={t("objectives")}>
      <div className="flex flex-col items-center rounded-surface bg-card px-6 py-12 text-center">
        <PlanIllustration />
        <h2 className="mt-6 type-section-title text-foreground">
          {t("createYourPlan", { cycleName })}
        </h2>
        <p className="mt-2 max-w-md type-body leading-relaxed text-muted-foreground">
          {t("defineYourObjectivesAndAlign")}
        </p>

        <ul className="mt-8 grid w-full max-w-3xl gap-5 text-start sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-border">
          {PLAN_PILLARS.map(({ icon: Icon, title }) => (
            <li key={title} className="flex items-center justify-center gap-3 sm:px-5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-inlay text-muted-foreground">
                <Icon className="size-4" aria-hidden />
              </span>
              <p className="type-subsection-title text-foreground">{t(`pillars.${title}`)}</p>
            </li>
          ))}
        </ul>

        <Button size="lg" onClick={onStart} className="mt-8">
          <Plus data-icon="inline-start" aria-hidden />
          {t("startMyPlan")}
        </Button>
      </div>
    </PlanSection>
  );
}

const PLAN_PILLARS = [
  { icon: Target, title: "set" },
  { icon: Share2, title: "align" },
  { icon: BarChart3, title: "track" },
] as const;

/** A plan document with a target, linked from you to your team by dotted amber connectors. */
function PlanIllustration() {
  return (
    <div className="relative h-36 w-72" aria-hidden>
      <span className="absolute left-1/2 top-1/2 size-36 -translate-x-1/2 -translate-y-1/2 rounded-full bg-inlay" />
      <svg className="absolute inset-0 size-full text-muted-foreground/50" viewBox="0 0 288 144" fill="none">
        <path d="M58 100 C 70 80, 80 70, 100 64" stroke="currentColor" strokeDasharray="3 4" />
        <path d="M188 88 C 205 88, 215 80, 230 72" stroke="currentColor" strokeDasharray="3 4" />
      </svg>
      <span className="absolute inset-s-[98px] top-[60px] size-2 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
      <span className="absolute inset-s-[184px] top-[84px] size-2 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
      <div className="absolute left-1/2 top-2 flex h-32 w-28 -translate-x-1/2 flex-col gap-2 rounded-surface bg-card p-3 shadow-lg">
        <span className="flex size-9 items-center justify-center rounded-full bg-primary-tint text-primary-ink">
          <Target className="size-5" />
        </span>
        <span className="mt-2 h-1.5 w-3/4 rounded-full bg-muted" />
        <span className="h-1.5 w-full rounded-full bg-muted" />
        <span className="h-1.5 w-2/3 rounded-full bg-muted" />
      </div>
      <span className="absolute inset-s-9 top-[92px] flex size-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
        <User className="size-4" />
      </span>
      <span className="absolute inset-e-9 top-[48px] flex size-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
        <Users className="size-4" />
      </span>
    </div>
  );
}



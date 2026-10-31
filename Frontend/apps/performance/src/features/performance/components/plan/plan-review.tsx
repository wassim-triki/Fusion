"use client";

import { performanceFailure, reportPerformanceFailure } from "@/features/performance/api/performance-failure";

import { useMemo, useState, type ReactNode } from "react";
import { Check, Landmark, LineChart, RotateCcw, ShieldCheck } from "@/lib/icons";
import { toast } from "sonner";
import type { AlignmentTargetDto, CycleSummaryDto, EmployeePlanDto, PlanObjectiveDto } from "@repo/api";
import { Avatar, AvatarFallback } from "@repo/ds/components/ui/avatar";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ds/components/ui/dialog";
import { Textarea } from "@repo/ds/components/ui/textarea";
import { AsyncButton, PagePermissionNotice, PageError, StatusBadge } from "@repo/ds/shell";
import {
  useAlignmentTargets,
  usePlanDetail,
  usePlanReviewMutations,
} from "../../api/use-performance";
import { useObjectiveRecord } from "../objective-record/use-objective-record";
import { PlanDocument, PlanSection, PlanWeightStrip } from "./plan-layout";
import { PlanObjectiveRow } from "./plan-objective-row";
import { RequestUpdateAction } from "../update-requests/update-requests";
import { PlanRail, latestReturn } from "./plan-rail";
import { DevelopmentSection } from "./development-section";
import { ChangeRequestDraft, ChangeRequestOutcome, useChangeRequestDrafts, useLeaveGuard } from "./change-requests";
import { PlanSurfaceSkeleton } from "./plan-skeleton";
import { initials } from "./plan-lib";
import { useTranslations } from "next-intl";
import { useSay } from "@repo/ds/lib/say";

/**
 * The reviewer's view of a submitted Plan — the same Plan resource an employee authors, opened by its
 * assigned reviewer to make one plan-level decision. It uses the employee Plan's own document + sidebar
 * layout so it reads as the same Plan, curated for a different responsibility: whose plan and the
 * decision in the header, the objectives as the document, the review context in the sidebar. The Plan
 * is read-only; the only actions are the two decisions, shown only to the legitimate assigned reviewer
 * (server-authorized via `canDecide`). Deciding transitions the real Plan and refreshes it in place.
 */
export function PlanReview({ cycle, planId }: { cycle: CycleSummaryDto; planId: string }) {
  const t = useTranslations("plan.PlanReview");
  const detail = usePlanDetail(cycle.id, planId);
  const targetsQuery = useAlignmentTargets(cycle.id);
  // Change requests are drafted on the cards and sent with Return; leaving first asks (D-09).
  const drafts = useChangeRequestDrafts();
  useLeaveGuard(drafts.list.length > 0, useTranslations("plan")("leaveGuard"));

  if (detail.isLoading) return <PlanSurfaceSkeleton />;
  if (performanceFailure(detail.error).unavailable) {
    return <PagePermissionNotice title={t("planUnavailable")} />;
  }

  if (detail.error || !detail.data) {
    return <PageError title={t("planUnavailable")} description={detail.error?.message} onRetry={detail.refetch} />;
  }

  const plan = detail.data;
  const targets = targetsQuery.data ?? [];

  const firstName = plan.employee.name?.trim().split(/\s+/)[0] ?? t("theEmployee");

  return (
    <div className="space-y-8">
      <ReviewHeading
        plan={plan}
        actions={
          plan.canRequestUpdate ? (
            <RequestUpdateAction cycleId={cycle.id} planId={planId} personName={firstName} size="default" />
          ) : plan.canDecide ? (
            <ReviewDecision plan={plan} cycleId={cycle.id} planId={planId} firstName={firstName} drafts={drafts} />
          ) : plan.canApproveExceptionally ? (
            <ExceptionalApproval cycleId={cycle.id} plan={plan} planId={planId} firstName={firstName} reviewerName={plan.responsibleManager?.name ?? null} />
          ) : null
        }
      />

      <PlanDocument
        main={
          <>
            <ObjectiveLedgerReadOnly plan={plan} targets={targets} cycleId={cycle.id} cycle={cycle} drafts={drafts} />
            <div className="mt-10">
              <DevelopmentSection cycleId={cycle.id} employeeId={plan.employee.id} />
            </div>
          </>
        }
        sidebar={
          // The same four sections the owner sees, in every state (D-08).
          <PlanRail
            plan={plan}
            lens="reviewer"
            targets={targets}
            reviewer={{ id: plan.responsibleManager?.id ?? null, name: plan.responsibleManager?.name ?? null }}
            planningDeadline={cycle.planningDeadline}
            subjectFirstName={firstName}
          />
        }
      />
    </div>
  );
}

/** The lifecycle badge as the reviewer reads it: submitted plans await, then resolve to approved/returned. */
function ReviewStateBadge({ plan }: { plan: EmployeePlanDto }) {
  const t = useTranslations("plan.ReviewStateBadge");
  if (plan.state === "Approved") {
    return (
      <StatusBadge tone="success" dot>
        {t("approved")}
      </StatusBadge>
    );
  }
  const returned = plan.state === "Draft" && plan.history.some((h) => h.kind === "Returned");
  if (returned) {
    return (
      <StatusBadge tone="warning" dot>
        {t("returned")}
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="warning" dot>
      {t("submitted")}
    </StatusBadge>
  );
}

/**
 * Whose plan and why: the employee's avatar anchors the name (with the plan's state) and, directly
 * beneath it, the org unit and the reason the reviewer is here. The decision sits opposite, as the
 * page's primary actions.
 */
function ReviewHeading({ plan, actions }: { plan: EmployeePlanDto; actions?: ReactNode }) {
  const t = useTranslations("plan.ReviewHeading");
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3.5">
        <Avatar className="size-12">
          <AvatarFallback hue={plan.employee.name}>{initials(plan.employee.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="type-page-title text-foreground">{plan.employee.name ?? t("employee")}</h1>
            <ReviewStateBadge plan={plan} />
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 type-body text-muted-foreground">
            {plan.orgUnitName ? (
              <span className="inline-flex items-center gap-1.5">
                <Landmark className="size-3.5" aria-hidden />
                {plan.orgUnitName}
              </span>
            ) : null}
            {plan.orgUnitName && plan.state === "Approved" ? (
              <span aria-hidden className="text-border">
                ·
              </span>
            ) : null}
            {plan.state === "Approved" ? (
              <span className="inline-flex items-center gap-1.5">
                <LineChart className="size-3.5" aria-hidden />
                {t("trackingExecution")}
              </span>
            ) : null}
          </p>
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}



/**
 * The complete ledger, read for the manager's responsibility — the same objective cards as My Plan, no
 * authoring or recording actions. While the plan is submitted it reads as the baseline under review; once
 * approved and locked it grows the same execution band and progress-bearing detail drawer the employee
 * sees, so the manager tracks the identical execution truth — minus the controls that are the owner's.
 */
function ObjectiveLedgerReadOnly({
  plan,
  targets,
  cycleId,
  cycle,
  drafts,
}: {
  plan: EmployeePlanDto;
  targets: AlignmentTargetDto[];
  cycleId: string;
  cycle: CycleSummaryDto;
  drafts: ReturnType<typeof useChangeRequestDrafts>;
}) {
  const t = useTranslations("plan.ObjectiveLedgerReadOnly");
  const words = useSay("common.words");
  // A resubmitted plan answers its latest return, objective by objective.
  const answered = plan.state === "Submitted" ? latestReturn(plan)?.changeRequests ?? [] : [];
  // The reviewer opens the same objective record the employee does; what it offers (progress history,
  // never recording) is decided by the server for this viewer.
  const record = useObjectiveRecord();
  const refFor = (objectiveId: string) => ({ cycleId, objectiveId });

  const scopeByTitle = useMemo(() => {
    const map = new Map<string, string>();
    for (const target of targets) {
      map.set(
        target.title,
        target.ownershipScope === "Company" ? words("companyStrategy") : target.orgUnitName ?? words("organizational")
      );
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
    >
      <div className="space-y-3">
        {plan.objectives.map((objective) => (
          // On an approved plan the row grows its execution band (current value + progress) — read-only,
          // with no Update progress: recording is the owner's, gated away here.
          <PlanObjectiveRow
            key={objective.id}
            objective={objective}
            cycle={cycle}
            alignmentScope={scopeFor(objective)}
            showProgress={plan.isLocked}
            active={record.isOpen(refFor(objective.id))}
            onViewDetails={() => record.open(refFor(objective.id))}
            onViewAlignment={(parentId) => record.open(refFor(parentId))}
            footer={(() => {
              const asked = answered.find((r) => r.objectiveId === objective.id);
              if (!plan.canDecide && !asked) return null;
              return (
                <div className="space-y-2.5">
                  {asked ? <ChangeRequestOutcome request={asked} /> : null}
                  {plan.canDecide ? (
                    <ChangeRequestDraft
                      value={drafts.drafts[objective.id]}
                      onSave={(text) => drafts.set(objective.id, text)}
                      onRemove={() => drafts.remove(objective.id)}
                    />
                  ) : null}
                </div>
              );
            })()}
            executionAside={
              plan.canRequestUpdate ? (
                <RequestUpdateAction cycleId={cycleId} planId={plan.id} personName={plan.employee.name?.split(/\s+/)[0] ?? "them"}
                  objective={{ id: objective.id, title: objective.title }} />
              ) : null
            }
          />
        ))}
      </div>

    </PlanSection>
  );
}

/**
 * The plan-level decision, as the page's primary actions. Only the assigned reviewer (server-authorized
 * `canDecide`) gets it: approve the whole plan, which locks it as the agreed baseline, or return it with
 * required feedback. Both are consequential, so each confirms in a dialog; returning asks for the
 * feedback there, and its primary stays disabled until the feedback is real.
 */
export function ReviewDecision({
  plan,
  cycleId,
  planId,
  firstName,
  drafts,
}: {
  plan: EmployeePlanDto;
  cycleId: string;
  planId: string;
  firstName: string;
  drafts: ReturnType<typeof useChangeRequestDrafts>;
}) {
  const t = useTranslations("plan.ReviewDecision");
  const mutations = usePlanReviewMutations(cycleId, planId);
  const [returnOpen, setReturnOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [approveOpen, setApproveOpen] = useState(false);
  const approving = mutations.approve.isLoading;
  const returning = mutations.returnForRevision.isLoading;
  const requests = drafts.list;
  // A return needs a note, at least one change on an objective, or both (D-09).
  const canReturn = feedback.trim().length > 0 || requests.length > 0;
  const titleOf = (objectiveId: string) => plan.objectives.find((o) => o.id === objectiveId)?.title ?? t("objective");
  const returnLabel = requests.length > 0 ? (requests.length === 1 ? t("returnWithChange", { length: requests.length }) : t("returnWithChanges", { length: requests.length })) : t("returnPlan");

  return (
    <>
      <Dialog
        open={returnOpen}
        onOpenChange={(o) => {
          if (returning) return;
          setReturnOpen(o);
          if (!o) setFeedback("");
        }}
      >
        <DialogTrigger asChild>
          <Button variant="outline">
            <RotateCcw className="size-4" data-icon="inline-start" /> {requests.length > 0 ? returnLabel : t("requestChanges")}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("requestChanges")}</DialogTitle>
            <DialogDescription>
              {t("theWholePlanReopensFor", { firstName })}
            </DialogDescription>
          </DialogHeader>
          {requests.length > 0 ? (
            <ul className="space-y-2">
              {requests.map((request) => (
                <li key={request.objectiveId} className="rounded-control bg-inlay px-3 py-2.5">
                  <p className="type-meta-strong text-muted-foreground">{titleOf(request.objectiveId)}</p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words type-body text-foreground">{request.text}</p>
                </li>
              ))}
            </ul>
          ) : null}
          <Textarea
            aria-label={requests.length > 0 ? t("aNoteForTheWhole") : t("whatShouldChange", { firstName })}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            className="min-h-20"
            placeholder={requests.length > 0 ? t("aNoteForTheWhole") : t("whatShouldChange", { firstName })}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnOpen(false)} disabled={returning}>
              {t("cancel")}
            </Button>
            <AsyncButton
              pending={returning}
              disabled={!canReturn}
              onClick={async () => {
                try {
                  await mutations.returnForRevision.mutateAsync({
                    feedback: feedback.trim() || null,
                    changeRequests: requests,
                    expectedVersion: plan.version,
                  });
                  toast.success(t("planReturnedToForChanges", { firstName }));
                  setReturnOpen(false);
                  setFeedback("");
                  drafts.clear();
                } catch (error) {
                  if (performanceFailure(error).refresh) setReturnOpen(false);
                  reportPerformanceFailure(error, t("couldNotReturnThePlan"));
                }
              }}
            >
              <RotateCcw className="size-4" data-icon="inline-start" /> {returnLabel}
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={approveOpen} onOpenChange={(o) => { if (!approving) setApproveOpen(o); }}>
        <AlertDialogTrigger asChild>
          <Button>
            <Check className="size-4" data-icon="inline-start" /> {t("approvePlan")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("approveThisPlan")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("approving")} <span className="font-medium text-foreground">{t("locksSPlan", { firstName })}</span> {t("asTheAgreedBaselineFor")}
              <span className="font-medium text-foreground">{plan.cycleName}</span>{t("it")}
              <span className="font-medium text-foreground">{t("cantBeEditedAfterward")}</span> {t("withoutAnAdministrator")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approving}>{t("cancel")}</AlertDialogCancel>
            <AsyncButton
              pending={approving}
              onClick={async () => {
                try {
                  await mutations.approve.mutateAsync(plan.version);
                  toast.success(t("planApprovedAndLocked"));
                  setApproveOpen(false);
                } catch (error) {
                  if (performanceFailure(error).refresh) setApproveOpen(false);
                  reportPerformanceFailure(error, t("couldNotApproveThePlan"));
                }
              }}
            >
              <Check className="size-4" data-icon="inline-start" /> {t("approvePlan")}
            </AsyncButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * The administrator's escape hatch for a submitted plan whose reviewer cannot decide. Quiet by design:
 * it is recorded as an administrative approval with its reason, distinct from the reviewer's decision.
 */
function ExceptionalApproval({
  plan,
  cycleId,
  planId,
  firstName,
  reviewerName,
}: {
  plan: EmployeePlanDto;
  cycleId: string;
  planId: string;
  firstName: string;
  reviewerName: string | null;
}) {
  const t = useTranslations("plan.ExceptionalApproval");
  const mutations = usePlanReviewMutations(cycleId, planId);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const pending = mutations.exceptionalApprove.isLoading;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) setReason("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost">
          <ShieldCheck className="size-4" data-icon="inline-start" /> {t("approveAsAdministrator")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("approveSPlanAsAdministrator", { firstName })}</DialogTitle>
          <DialogDescription>
            {reviewerName ? t("remainsThePlansReviewer", { reviewerName }) + " " : ""}{t("thisApprovalIsRecordedAs")}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label={t("reasonForApprovingOnThe")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="min-h-20"
          placeholder={t("whyTheReviewerCantDecide")}
          maxLength={1000}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <AsyncButton
            pending={pending}
            disabled={reason.trim().length === 0}
            onClick={async () => {
              try {
                await mutations.exceptionalApprove.mutateAsync({ reason: reason.trim(), expectedVersion: plan.version });
                toast.success(t("planApprovedByAdministration"));
                setOpen(false);
                setReason("");
              } catch (error) {
                if (performanceFailure(error).refresh) setOpen(false);
                reportPerformanceFailure(error, t("couldNotApproveThePlan"));
              }
            }}
          >
            <ShieldCheck className="size-4" data-icon="inline-start" /> {t("approvePlan")}
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

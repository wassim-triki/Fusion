"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { CycleClosureDto, CycleDetailDto } from "@repo/api";
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
import { Label } from "@repo/ds/components/ui/label";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { Textarea } from "@repo/ds/components/ui/textarea";
import { AsyncButton } from "@repo/ds/shell";
import { Lock } from "@/lib/icons";
import { useCloseCycle } from "../../api/use-performance";
import { performanceFailure, reportPerformanceFailure } from "../../api/performance-failure";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";


/**
 * Closing the Active Cycle. The dialog asks only for what closure genuinely needs: a reason when
 * the end date is still ahead, and a reason recorded against everyone without an approved plan.
 */
export function CloseCycleAction({ detail, closure }: { detail: CycleDetailDto; closure: CycleClosureDto | undefined }) {
  const format = useFormat();
  const t = useTranslations("cycle.CloseCycleAction");
  const [open, setOpen] = useState(false);
  const [earlyReason, setEarlyReason] = useState("");
  const [exceptionReason, setExceptionReason] = useState("");
  const close = useCloseCycle(detail.cycle.id);
  const pending = close.isLoading;

  if (!closure) return null;
  const unresolved = closure.unresolved.length;
  const needsEarlyReason = !closure.endReached;
  const ready = (!needsEarlyReason || earlyReason.trim().length > 0) && (unresolved === 0 || exceptionReason.trim().length > 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) {
          setEarlyReason("");
          setExceptionReason("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Lock className="size-4" data-icon="inline-start" /> {t("closeCycle")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("close", { name: detail.cycle.name })}</DialogTitle>
          <DialogDescription>
            {t("planningProgressAndEvidenceStop")}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
          <dt className="type-label text-muted-foreground">{t("approvedPlans")}</dt>
          <dd className="type-body tabular-nums text-foreground">
            {t("of", { approvedCount: closure.approvedCount, participantCount: closure.participantCount })}
          </dd>
          <dt className="type-label text-muted-foreground">{t("ends")}</dt>
          <dd className="type-body text-foreground">{format.date(closure.endDate)}</dd>
        </dl>

        {needsEarlyReason ? (
          <div className="space-y-1.5">
            <Label htmlFor="early-close-reason">{t("whyCloseBefore", { endDate: format.date(closure.endDate) })}</Label>
            <Textarea
              id="early-close-reason"
              value={earlyReason}
              onChange={(event) => setEarlyReason(event.target.value)}
              rows={2}
              maxLength={1000}
            />
          </div>
        ) : null}

        {unresolved > 0 ? (
          <div className="space-y-1.5">
            <Label htmlFor="closure-exception-reason">
              {unresolved === 1
                ? t("reasonRecordedForThe1")
                : t("reasonRecordedForTheParticipants", { unresolved })}
            </Label>
            <Textarea
              id="closure-exception-reason"
              value={exceptionReason}
              onChange={(event) => setExceptionReason(event.target.value)}
              rows={2}
              maxLength={1000}
            />
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <AsyncButton
            pending={pending}
            disabled={!ready}
            onClick={async () => {
              try {
                await close.mutateAsync({
                  request: {
                    earlyCloseReason: needsEarlyReason ? earlyReason.trim() : null,
                    exceptionReason: unresolved > 0 ? exceptionReason.trim() : null,
                  },
                  expectedVersion: detail.cycle.version,
                });
                toast.success(t("isClosed", { name: detail.cycle.name }));
                setOpen(false);
              } catch (error) {
                if (performanceFailure(error).refresh) setOpen(false);
                reportPerformanceFailure(error, t("couldNotCloseTheCycle"));
              }
            }}
          >
            <Lock className="size-4" data-icon="inline-start" /> {t("closeCycle")}
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Who stands between the Cycle and a clean close — or, once closed, who was closed as an exception. */
export function ClosureSection({ closure, loading }: { closure: CycleClosureDto | undefined; loading: boolean }) {
  const t = useTranslations("cycle.ClosureSection");
  if (loading) {
    return (
      <section className="space-y-3">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </section>
    );
  }
  if (!closure) return null;

  const closed = closure.state === "Closed";
  const rows = closed ? closure.unresolved.filter((row) => row.exceptionReason) : closure.unresolved;

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between gap-4">
        <h2 className="type-section-title text-foreground">
          {closed ? (rows.length > 0 ? t("closedWithExceptions") : t("closedWithEveryPlanApproved")) : t("withoutAnApprovedPlan")}
        </h2>
        <span className="type-body-secondary tabular-nums text-muted-foreground">
          {t("ofApproved", { approvedCount: closure.approvedCount, participantCount: closure.participantCount })}
        </span>
      </header>

      {closed && closure.earlyCloseReason ? (
        <p className="type-body text-foreground">
          <span className="text-muted-foreground">{t("closedEarly")} </span>
          {closure.earlyCloseReason}
        </p>
      ) : null}

      {rows.length === 0 ? (
        closed ? null : <p className="type-body-secondary text-muted-foreground">{t("everyParticipantHasAnApproved")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-surface bg-card">
          {rows.map((row) => (
            <li
              key={row.employeeId}
              className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0">
                <p className="type-body truncate text-foreground">{row.displayName}</p>
                {row.orgUnitName ? (
                  <p className="type-body-secondary truncate text-muted-foreground">{row.orgUnitName}</p>
                ) : null}
              </div>
              <span className="type-body-secondary text-muted-foreground sm:max-w-[60%] sm:shrink-0 sm:text-end">
                {closed ? row.exceptionReason : t(`standing.${row.standing}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

"use client";

import { useAuth } from "@repo/auth";
import { Check } from "@repo/ds/icons";
import type { EmployeePlanDto } from "@repo/api";

import { PlanBannerMark } from "./plan-banner";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";

/**
 * The approved, locked plan stated once — the same Status content whether the plan's owner or its reviewer reads
 * it, since both are looking at the same settled agreement. It leads with the outcome and keeps only the
 * facts that still matter once execution is underway: who approved it and when. The objective count
 * lives on the list heading beside it. Allocation is deliberately absent — a plan cannot be approved unless it is fully allocated, so
 * restating "100%" here would carry no information. The owner and reviewer differ only in the one sentence
 * that names the perspective; the structure is identical.
 */
export function PlanApprovedStatus({
  plan,
  perspective,
  subjectFirstName,
}: {
  plan: EmployeePlanDto;
  /** "owner" reads their own plan; "reviewer" reads the plan they approved. */
  perspective: "owner" | "reviewer";
  /** The plan owner's first name — used only in the reviewer's sentence. */
  subjectFirstName?: string;
}) {
  const format = useFormat();
  const t = useTranslations("plan.PlanApprovedStatus");
  const approval = [...plan.history]
    .reverse()
    .find((h) => h.kind === "Approved" || h.kind === "ApprovedExceptionally");
  const { user } = useAuth();
  const administrative = approval?.kind === "ApprovedExceptionally";
  // Only a normal approval can fall back to the reviewer's name: an administrative approval must never
  // read as the reviewer's (an administrator may have no employee record, so no resolved name).
  const approver = approval?.actorName ?? (administrative ? null : plan.responsibleManager?.name) ?? null;
  const approvedOn = plan.approvedAt ? format.date(plan.approvedAt.slice(0, 10)) : null;
  const approvedByViewer = Boolean(user?.employeeId && approval?.actorEmployeeId === user.employeeId);
  const whose = subjectFirstName ? `${subjectFirstName}'s` : "this";
  const by = administrative
    ? approver ? t("approvedItAsAdministrator", { approver }) : t("approvedByAdministration")
    : t("approvedBy", { approver: approver ?? "" });

  const detail =
    perspective === "reviewer"
      ? approvedByViewer
        ? (administrative ? t("youApprovedPlanAsAdministrator", { whose }) : t("youApprovedPlan", { whose }))
        : approver || administrative
          ? by
          : ""
      : approver || administrative
        ? by
        : "";

  return (
      <div className="flex items-start gap-3.5">
        <PlanBannerMark className="text-success bg-success/12 ring-success/20">
          <Check className="size-5" aria-hidden />
        </PlanBannerMark>
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2 font-semibold tracking-tight text-foreground">
            {t("approvedLocked")}
            {approvedOn && plan.approvedAt ? (
              <time dateTime={plan.approvedAt} className="type-meta tabular-nums text-muted-foreground">
                {approvedOn}
              </time>
            ) : null}
          </p>
          {detail ? <p className="mt-0.5 type-body leading-snug text-muted-foreground">{detail}</p> : null}
        </div>
      </div>
  );
}

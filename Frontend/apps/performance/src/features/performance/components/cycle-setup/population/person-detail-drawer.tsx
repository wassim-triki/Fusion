"use client";

import type { ReactNode } from "react";
import { Check, ExternalLink, X } from "@/lib/icons";
import type { PopulationCandidateDto, ReadinessIssueCode } from "@repo/api";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@repo/ds/components/ui/sheet";
import { Avatar, AvatarFallback } from "@repo/ds/components/ui/avatar";
import { Button } from "@repo/ds/components/ui/button";
import { StatusBadge } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { readinessIssueDetail } from "@/features/performance/lib";
import { candidateStatus, initials, reviewerView } from "./population-model";
import { coreProfileHref } from "./population-model";
import { useTranslations } from "next-intl";
import { useSay } from "@repo/ds/lib/say";

/**
 * A quiet inspector for one person — identity, how they entered the population, their org and
 * reviewer, and the eligibility checks Fusion ran. It reads truth; repairs happen in Core.
 */
export function PersonDetailDrawer({
  candidate,
  open,
  onOpenChange,
  eligibilityDate,
  onExclude,
  onRestore,
}: {
  candidate: PopulationCandidateDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eligibilityDate: string;
  onExclude: (candidate: PopulationCandidateDto) => void;
  onRestore: (candidate: PopulationCandidateDto) => void;
}) {
  const t = useTranslations("cycleSetup.PersonDetailDrawer");
  const words = useSay("common.words");
  const reviewer = candidate ? reviewerView(candidate) : null;
  const status = candidate ? candidateStatus(candidate) : "ready";

  const has = (code: ReadinessIssueCode) =>
    Boolean(candidate?.issues.some((issue) => issue.code === code));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        {candidate ? (
          <>
            <SheetHeader className="border-b border-border px-6 py-5">
              <div className="flex items-center gap-3">
                <Avatar className="size-11">
                  <AvatarFallback hue={candidate.displayName}>{initials(candidate.displayName)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <SheetTitle className="truncate">{candidate.displayName}</SheetTitle>
                  <p className="type-meta truncate text-muted-foreground">{candidate.jobTitle ?? "—"}</p>
                </div>
                <div className="ms-auto">
                  {status === "ready" ? (
                    <StatusBadge tone="success" dot>{t("ready")}</StatusBadge>
                  ) : status === "attention" ? (
                    <StatusBadge tone="warning" dot>{t("needsAttention")}</StatusBadge>
                  ) : (
                    <StatusBadge tone="muted">{t("excluded")}</StatusBadge>
                  )}
                </div>
              </div>
            </SheetHeader>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <Field label={t("population")}>
                {candidate.byExplicitInclusion ? t("addedIndividually") : t("includedByWorkforceScope")}
              </Field>

              <Field label={t("organization")}>{candidate.orgUnitName ?? t("noUnitOnRecord")}</Field>

              <Field label={t("reviewer")}>
                {reviewer && reviewer.kind !== "unresolved" ? (
                  <span className="flex items-center gap-2">
                    {reviewer.name}
                    {reviewer.kind === "inactive" ? (
                      <span className="type-meta text-amber-500">{t("inactive")}</span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t("notResolved")}</span>
                )}
              </Field>

              {candidate.isExcluded ? (
                <Field label={t("exclusionReason")}>
                  {candidate.exclusionReason ?? "—"}
                </Field>
              ) : null}

              <div>
                <p className="type-meta text-muted-foreground">{t("eligibility")}</p>
                <ul className="mt-2 space-y-2">
                  <Check_ ok={!has("InactiveEmployment")} label={t("activeEmployment")} />
                  <Check_ ok={!has("NoPrimaryAssignment")} label={t("primaryAssignment")} />
                  <Check_
                    ok={candidate.hasValidReviewer}
                    label={t("reviewerResolved")}
                    detail={
                      candidate.hasValidReviewer
                        ? undefined
                        : readinessIssueDetail(
                            has("InactiveManager") ? "InactiveManager" : "MissingManager",
                            eligibilityDate,
                            words
                          )
                    }
                  />
                </ul>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
              <Button variant="outline" size="sm" asChild>
                <a href={coreProfileHref(candidate.employeeId)} target="_blank" rel="noopener noreferrer">
                  {t("viewInCore")}
                  <ExternalLink className="size-3.5" data-icon="inline-end" />
                </a>
              </Button>
              {candidate.isExcluded ? (
                <Button variant="ghost" size="sm" onClick={() => onRestore(candidate)}>
                  {t("restoreToPopulation")}
                </Button>
              ) : (
                <Button variant="destructive" size="sm" onClick={() => onExclude(candidate)}>
                  {t("excludeFromCycle")}
                </Button>
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="type-meta text-muted-foreground">{label}</p>
      <p className="mt-1 type-body text-foreground">{children}</p>
    </div>
  );
}

function Check_({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
          ok ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500"
        )}
      >
        {ok ? <Check className="size-3" /> : <X className="size-3" />}
      </span>
      <span className="min-w-0">
        <span className="type-body text-foreground">{label}</span>
        {detail ? <span className="type-meta block text-muted-foreground">{detail}</span> : null}
      </span>
    </li>
  );
}

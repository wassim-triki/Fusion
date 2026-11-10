"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronDown, X } from "@repo/ds/icons";
import type { PlanReadinessDto } from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { cn } from "@repo/ds/lib/utils";
import { SidebarSection } from "./plan-layout";
import { planChecks } from "./plan-lib";
import { useTranslations } from "next-intl";
import { useSay } from "@repo/ds/lib/say";

/**
 * Why the plan can or cannot be submitted, drawn from the same readiness facts as the Submit gate.
 * When every condition is met the section stays quiet and collapsed — a single "N checks passed" line
 * over a reveal — because a wall of green ticks is noise. When conditions fail the card leads with
 * them, actionably, and the passing ones recede. It never hard-codes the valid state.
 */
export function PlanSubmissionChecks({ readiness, bare = false }: { readiness: PlanReadinessDto; bare?: boolean }) {
  const t = useTranslations("plan.PlanSubmissionChecks");
  const checkWords = useSay("plan.checks");
  const checks = planChecks(readiness, checkWords);
  const failed = checks.filter((check) => !check.passed);
  const passedCount = checks.length - failed.length;
  const allPassed = failed.length === 0;

  const [open, setOpen] = useState(false);

  const Wrapper = bare ? BareSection : SidebarSection;
  return (
    <Wrapper label={t("submissionChecks")}>

      {allPassed ? (
        <>
          <div className="mt-3 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                <Check className="size-3.5" aria-hidden />
              </span>
              <div>
                <p className="type-label text-foreground">
                  {t("check", { passedCount })}{passedCount === 1 ? "" : t("s")} {t("passed")}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="-me-1 shrink-0"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? t("hideChecks") : t("viewChecks")}
            >
              <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
            </Button>
          </div>
          {open ? (
            <ul className="mt-4 space-y-4 border-t border-border pt-4">
              {checks.map((check) => (
                <CheckRow key={check.id} passed label={check.label} />
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <>
          <p className="mt-3 type-label text-foreground">
            {t("check2", { length: failed.length })}{failed.length === 1 ? "" : t("s")} {t("need")}
            {failed.length === 1 ? t("s") : ""} {t("attention")}
          </p>
          <ul className="mt-4 space-y-4">
            {failed.map((check) => (
              <CheckRow key={check.id} passed={false} label={check.detail ?? check.label} />
            ))}
          </ul>
          {passedCount > 0 ? (
            <ul className="mt-4 space-y-4 border-t border-border pt-4">
              {checks
                .filter((check) => check.passed)
                .map((check) => (
                  <CheckRow key={check.id} passed label={check.label} muted />
                ))}
            </ul>
          ) : null}
        </>
      )}
    </Wrapper>
  );
}

/** Inside another section (the plan rail's Status), the checks are content, not a section of their own. */
function BareSection({ children }: { label?: string; children: ReactNode }) {
  return <div>{children}</div>;
}

function CheckRow({ passed, label, muted = false }: { passed: boolean; label: string; muted?: boolean }) {
  return (
    <li className="flex items-start gap-2.5 type-body">
      {passed ? (
        <Check className={cn("mt-0.5 size-4 shrink-0", muted ? "text-success/60" : "text-success")} aria-hidden />
      ) : (
        <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      )}
      <span className={cn(muted ? "text-muted-foreground" : passed ? "text-foreground" : "text-foreground")}>
        {label}
      </span>
    </li>
  );
}

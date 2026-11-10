"use client";

import { useLocale, useTranslations } from "next-intl";
import type { EmployeePlanDto, PlanGoalChangeDto } from "@repo/api";
import { Said } from "@repo/ds/shell";
import { PersonInitials } from "@repo/performance-ui";
import { dayMonth } from "../year/year-words";
import { latestReturn } from "./plan-rail";

/** A goal's weight then and now, when the change touched it. */
function weightOf(change: PlanGoalChangeDto) {
  return change.fields.find((field) => field.field === "weight") ?? null;
}

/**
 * What changed since the reviewer sent the plan back (D-66): what they asked, then each goal added, removed or
 * changed, with its weight and measure then and now. Shown beside the decision on a plan put forward again.
 */
export function PlanChanges({ plan }: { plan: EmployeePlanDto }) {
  const t = useTranslations("plan.PlanChanges");
  const locale = useLocale();
  const changes = plan.changesSinceReturn;
  if (plan.state !== "Submitted" || !changes) return null;
  const asked = latestReturn(plan);
  return (
    <section className="grid gap-3 rounded-surface bg-card px-6 py-[22px]" aria-label={t("title")}>
      <div className="flex items-center">
        <h2 className="type-section-title text-foreground">{t("title")}</h2>
        {plan.submittedAt ? <span className="ms-auto text-[13px] text-muted-foreground">{t("putForwardAgain", { day: dayMonth(plan.submittedAt, locale) })}</span> : null}
      </div>
      {asked?.feedback ? (
        <div className="flex items-start gap-3 rounded-inset bg-inlay px-3.5 py-2.5">
          <PersonInitials name={asked.actorName} size="xs" />
          <div className="grid gap-0.5">
            <span className="text-[13px] text-muted-foreground">{t("youAsked", { day: dayMonth(asked.decidedAt, locale) })}</span>
            <Said>{asked.feedback}</Said>
          </div>
        </div>
      ) : null}
      {changes.length === 0 ? (
        <span className="text-[13px] text-muted-foreground">{t("nothingChanged")}</span>
      ) : (
        <div className="grid divide-y divide-border">
          {changes.map((change) => {
            const weight = weightOf(change);
            return (
              <div key={change.objectiveId} className="flex items-start gap-4 py-2.5">
                <div className="grid min-w-0 gap-[3px]">
                  <span className="flex flex-wrap items-center gap-2.5">
                    <span className={change.kind === "removed" ? "type-narrative text-[15.5px] text-muted-foreground line-through" : "type-narrative text-[15.5px] text-foreground"}>{change.title}</span>
                    {change.kind !== "changed" ? (
                      <span className={change.kind === "added" ? "text-xs font-semibold text-success" : "text-xs font-semibold text-muted-foreground"}>{t(change.kind)}</span>
                    ) : null}
                  </span>
                  {change.fields.filter((field) => field.field !== "weight").map((field) => (
                    <span key={field.field} className="text-[13px] text-muted-foreground">
                      <s>{field.before ?? t("none")}</s> <span className="text-foreground">{field.after ?? t("none")}</span>
                    </span>
                  ))}
                </div>
                {weight ? (
                  <span className="ms-auto whitespace-nowrap text-[15px] font-semibold tabular-nums">
                    <s className="font-normal text-muted-foreground">{weight.before ?? "–"}</s> {weight.after ?? "–"}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

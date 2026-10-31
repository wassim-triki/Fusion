import Link from "next/link";
import { ChevronRight } from "@/lib/icons";
import { objectiveHref } from "@/lib/performance-routes";
import { StatusBadge } from "@repo/ds/shell";
import { STATE_TONE } from "../../goals/goals-lib";
import { PLAN_STATE_TONE } from "../../plan/plan-lib";
import { pct } from "../../plan/plan-lib";
import type { ObjectiveRef } from "../objective-ref";
import { directionScopeLabel, type ObjectiveRecord } from "../objective-record-model";
import { RecordSection } from "./record-primitives";
import { useTranslations } from "next-intl";
import { useSay } from "@repo/ds/lib/say";

/** The direction objectives aligned beneath this one — each opens in the same record. */
export function AlignedChildrenSection({
  record,
  onOpen,
}: {
  record: ObjectiveRecord;
  onOpen: (ref: ObjectiveRef) => void;
}) {
  const t = useTranslations("objective.AlignedChildrenSection");
  const words = useSay("common.words");
  const model = useSay("objective.model");
  const goalWords = useSay("goals.lib");
  const planObjectives = record.source.alignedPlanObjectives;
  if (record.children.length === 0 && planObjectives.length === 0) return null;
  return (
    <RecordSection label={t("alignedObjectives", { value: record.children.length + planObjectives.length })}>
      <div className="space-y-6">
        {record.children.length > 0 ? (
          <ul className="divide-y divide-border overflow-hidden rounded-surface bg-popover dark:bg-card">
            {record.children.map((child) => (
              <li key={child.id}>
                <button
                  type="button"
                  onClick={() => onOpen({ cycleId: record.ref.cycleId, objectiveId: child.id })}
                  className="group flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-(--type-tint) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate type-label text-foreground">{child.title}</span>
                    <span className="mt-0.5 block truncate type-meta text-muted-foreground">
                      {directionScopeLabel(child, model)} · {child.accountablePersonName ?? t("unassigned")}
                    </span>
                  </span>
                  {child.state === "Published" ? (
                    <span className="shrink-0 type-meta tabular-nums text-muted-foreground">
                      {child.hasProgress ? `${pct(Math.round(child.derivedProgress))}%` : "—"}
                    </span>
                  ) : (
                    <StatusBadge tone={STATE_TONE[child.state]}>{goalWords(`state.${child.state}`)}</StatusBadge>
                  )}
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                    aria-hidden
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {planObjectives.length > 0 ? (
          <div>
            <p className="mb-2 type-label text-foreground">{t("planObjectives")}</p>
            <ul className="divide-y divide-border overflow-hidden rounded-surface bg-popover dark:bg-card">
              {planObjectives.map((child) => (
                <li key={child.objectiveId}>
                  <Link
                    href={objectiveHref({ cycleId: record.ref.cycleId, objectiveId: child.objectiveId })}
                    className="group flex min-w-0 items-center gap-3 px-4 py-3 transition-colors hover:bg-(--type-tint) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate type-label text-foreground">{child.title}</span>
                      <span className="mt-0.5 block truncate type-meta text-muted-foreground">{child.ownerName ?? t("unassigned")}</span>
                    </span>
                    {child.planState === "Approved" ? (
                      <span className="shrink-0 type-meta tabular-nums text-muted-foreground">
                        {child.progress == null ? "—" : `${pct(Math.round(child.progress))}%`}
                      </span>
                    ) : null}
                    <StatusBadge tone={PLAN_STATE_TONE[child.planState]}>{words(`planState.${child.planState}`)}</StatusBadge>
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </RecordSection>
  );
}

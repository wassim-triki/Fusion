"use client";

import { reportPerformanceFailure } from "@/features/performance/api/performance-failure";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Lock } from "@repo/ds/icons";
import { Input } from "@repo/ds/components/ui/input";
import { AsyncButton } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { useGoalMutations } from "../../../api/use-performance";
import { directionScopeLabel, type ObjectiveRecord } from "../objective-record-model";
import { RECORD_SURFACE, RecordSection } from "./record-primitives";
import { useTranslations } from "next-intl";
import { useSay } from "@repo/ds/lib/say";

/**
 * How a calculated objective's progress is composed: the weight each aligned objective contributes,
 * set by whoever maintains it and locked once every contributor is published. Read-only for everyone
 * else, and once locked.
 */
export function ContributionSection({ record }: { record: ObjectiveRecord }) {
  const t = useTranslations("objective.ContributionSection");
  const model = useSay("objective.model");
  const mutations = useGoalMutations(record.ref.cycleId);
  const { links, locked } = record.contribution;
  const children = record.children;
  const configuredById = useMemo(() => new Map(links.map((link) => [link.childObjectiveId, link.weight])), [links]);
  const [weights, setWeights] = useState<Record<string, string>>({});

  useEffect(() => {
    const initial: Record<string, string> = {};
    for (const child of children) {
      const weight = configuredById.get(child.id);
      initial[child.id] = weight != null ? String(weight) : "";
    }
    setWeights(initial);
  }, [children, configuredById]);

  if (locked) {
    return (
      <RecordSection
        label={
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3.5" aria-hidden /> {t("contributionBaseline")}
          </span>
        }
      >
        <div className="space-y-1.5 rounded-surface border border-success/30 bg-success-subtle p-4">
          {links.map((link) => (
            <div key={link.childObjectiveId} className="flex items-center justify-between gap-3 type-body">
              <span className="truncate">{link.childTitle}</span>
              <span className="font-medium tabular-nums">{link.weight}%</span>
            </div>
          ))}
          <div className="mt-2 flex items-center justify-between border-t border-success/20 pt-2 type-subsection-title">
            <span className="inline-flex items-center gap-1.5 text-success">
              <Check className="size-4" aria-hidden /> {t("baselineLocked")}
            </span>
            <span className="tabular-nums">100%</span>
          </div>
        </div>
      </RecordSection>
    );
  }

  if (children.length === 0) {
    return (
      <RecordSection label={t("contributionBaseline")}>
        <p className="rounded-surface border border-dashed border-border p-4 type-body text-muted-foreground">
          {t("noAlignedObjectivesContributeYet")}
        </p>
      </RecordSection>
    );
  }

  const canEdit = record.can.configureContribution;
  const total = Object.values(weights).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const contributors = children.filter((child) => Number(weights[child.id]) > 0);
  const allPublished = contributors.length > 0 && contributors.every((child) => child.state === "Published");

  return (
    <RecordSection label={t("contributionBaseline")}>
      <div className={cn(RECORD_SURFACE, "space-y-3")}>
        {children.map((child) => (
          <div key={child.id} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate type-body text-foreground">{child.title}</p>
              <p className="truncate type-meta text-muted-foreground">{directionScopeLabel(child, model)}</p>
            </div>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                inputMode="numeric"
                aria-label={t("contributionOf", { title: child.title })}
                value={weights[child.id] ?? ""}
                disabled={!canEdit}
                onChange={(event) => setWeights((prev) => ({ ...prev, [child.id]: event.target.value }))}
                className="w-20 text-end"
                placeholder="0"
              />
              <span className="type-body text-muted-foreground">%</span>
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="type-body text-muted-foreground">
            {total === 100 ? t("fullyAllocated") : total < 100 ? t("toAssign", { value: 100 - total }) : t("over", { value: total - 100 })}
          </span>
          <span className={cn("type-section-title tabular-nums", total === 100 ? "text-success" : "text-warning")}>
            {total}%
          </span>
        </div>

        {canEdit ? (
          <div className="flex items-center justify-end gap-2">
            <AsyncButton
              size="sm"
              variant="outline"
              pending={mutations.configureContribution.isLoading}
              onClick={async () => {
                try {
                  await mutations.configureContribution.mutateAsync({
                    objectiveId: record.ref.objectiveId,
                    expectedVersion: record.source.node.version,
                    request: {
                      contributors: contributors.map((child) => ({
                        childObjectiveId: child.id,
                        weight: Number(weights[child.id]),
                      })),
                    },
                  });
                  toast.success(t("contributionSaved"));
                } catch (error) {
                  reportPerformanceFailure(error, t("couldNotSave"));
                }
              }}
            >
              {t("save")}
            </AsyncButton>
            <AsyncButton
              size="sm"
              pending={mutations.lockContribution.isLoading}
              disabled={total !== 100 || !allPublished}
              title={total === 100 && !allPublished ? t("everyContributingObjectiveMustBe") : undefined}
              onClick={async () => {
                try {
                  await mutations.lockContribution.mutateAsync({ objectiveId: record.ref.objectiveId, expectedVersion: record.source.node.version });
                  toast.success(t("contributionBaselineLocked"));
                } catch (error) {
                  reportPerformanceFailure(error, t("couldNotLock"));
                }
              }}
            >
              <Lock className="size-3.5" data-icon="inline-start" /> {t("lockBaseline")}
            </AsyncButton>
          </div>
        ) : null}
      </div>
    </RecordSection>
  );
}

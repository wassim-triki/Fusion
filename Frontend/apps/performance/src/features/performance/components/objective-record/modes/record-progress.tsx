"use client";

import { useState } from "react";
import { ArrowLeft } from "@repo/ds/icons";
import { Button } from "@repo/ds/components/ui/button";
import { AsyncButton, PageSkeleton } from "@repo/ds/shell";
import { useObjectiveProgress, useProgressMutations } from "../../../api/use-performance";
import { ProgressUpdateComposer } from "../../progress/progress-update-composer";
import type { ObjectiveRecord } from "../objective-record-model";
import { MeasurementSection } from "../sections/measurement-section";
import { RecordRequestBand } from "../../update-requests/update-requests";
import { useTranslations } from "next-intl";
import { PageFailure } from "@repo/auth";

/**
 * Recording progress is a task inside the same record, not another surface: the measurement it is read
 * against stays in view (read-only — the baseline is settled), the measurement-aware recorder takes the
 * update, and saving returns to the record's details so the new truth is confirmed in context.
 */
export function RecordProgressMode({ record, onDone }: { record: ObjectiveRecord; onDone: () => void }) {
  const t = useTranslations("objective.RecordProgressMode");
  const { cycleId, objectiveId } = record.ref;
  const progressQuery = useObjectiveProgress(cycleId, objectiveId);
  const mutations = useProgressMutations(cycleId, objectiveId);
  const progress = progressQuery.data;
  const [canSubmit, setCanSubmit] = useState(false);
  const formId = "objective-record-progress-form";

  return (
    <>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <button
          type="button"
          onClick={onDone}
          className="inline-flex items-center gap-1.5 type-label text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ArrowLeft className="size-3.5" aria-hidden /> {t("backToObjectiveDetails")}
        </button>

        {record.kind === "plan" && record.source.plan ? (
          <RecordRequestBand cycleId={cycleId} planId={record.source.plan.planId} objectiveId={objectiveId} />
        ) : null}

        <MeasurementSection measurement={record.measurement} showMilestones={false} />

        <div className="border-t border-border pt-5">
          <p className="type-subsection-title tracking-tight text-foreground">{t("recordProgress")}</p>
          <div className="mt-4">
            {progressQuery.isLoading ? (
              <PageSkeleton rows={2} label={t("loadingProgress")} />
            ) : progressQuery.error || !progress ? (
              <PageFailure error={progressQuery.error} onRetry={progressQuery.refetch} size="card" title={t("progressUnavailable")} />
            ) : (
              <ProgressUpdateComposer
                progress={progress}
                submitting={mutations.submit.isLoading}
                formId={formId}
                onSubmit={(request) => mutations.submit.mutateAsync({ ...request, expectedVersion: progress.version }).then(() => undefined)}
                upload={(file) => mutations.uploadEvidence.mutateAsync(file)}
                onValidityChange={setCanSubmit}
                onRecorded={onDone}
              />
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border bg-inlay p-5 dark:bg-popover">
        <Button type="button" variant="outline" onClick={onDone}>
          {t("cancel")}
        </Button>
        <AsyncButton type="submit" form={formId} pending={mutations.submit.isLoading} disabled={!canSubmit || !progress}>
          {t("recordProgress")}
        </AsyncButton>
      </div>
    </>
  );
}

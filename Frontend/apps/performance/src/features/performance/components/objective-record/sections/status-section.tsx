"use client";

import { reportPerformanceFailure } from "@/features/performance/api/performance-failure";
import { Check } from "@/lib/icons";
import { AsyncButton, Said } from "@repo/ds/shell";
import { ObjectiveStatusBadge } from "@repo/performance-ui";
import { useAcknowledgeStatus } from "../../../api/use-performance";
import type { ObjectiveRecord } from "../objective-record-model";
import { RECORD_SURFACE, RecordSection } from "./record-primitives";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";

/**
 * How the owner says the objective is going (D-05): the latest status with its reason and date. At risk or
 * off track, the plan's responsible reviewer acknowledges it here, and everyone who reads the status sees
 * who did. Absent until the first report — an unreported objective is never shown as on track.
 */
export function StatusSection({ record }: { record: ObjectiveRecord }) {
  const format = useFormat();
  const t = useTranslations("objective.StatusSection");
  const status = record.source.status;
  const acknowledge = useAcknowledgeStatus(record.ref.cycleId, record.ref.objectiveId);
  if (!status) return null;
  const risky = status.value === "AtRisk" || status.value === "OffTrack";
  const acknowledgedBy = status.acknowledgedBy?.name ?? t("theReviewer");

  return (
    <RecordSection label={t("howItsGoing")}>
      <div className={RECORD_SURFACE}>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <ObjectiveStatusBadge status={status.value} />
          <span className="type-meta text-muted-foreground">
            {t("reported")} <time dateTime={status.reportedAt}>{format.date(status.reportedAt.slice(0, 10))}</time>
          </span>
        </div>
        {status.reason ? (
          <div className="mt-3">
            {risky ? <p className="type-meta-strong text-muted-foreground">{t("whatsInTheWay")}</p> : null}
            <Said className="mt-1">{status.reason}</Said>
          </div>
        ) : null}
        {risky && status.acknowledgedAt ? (
          <p className="mt-3 flex items-center gap-1.5 border-t border-border pt-3 type-meta text-muted-foreground">
            <Check className="size-3.5 text-success" aria-hidden />
            {t("acknowledgedBy")} <span className="font-medium text-foreground">{acknowledgedBy}</span> ·{" "}
            <time dateTime={status.acknowledgedAt}>{format.date(status.acknowledgedAt.slice(0, 10))}</time>
          </p>
        ) : record.source.canAcknowledgeStatus ? (
          <div className="mt-3 flex justify-end border-t border-border pt-3">
            <AsyncButton
              size="sm"
              variant="outline"
              pending={acknowledge.isLoading}
              onClick={async () => {
                try {
                  await acknowledge.mutateAsync(record.source.node.version);
                } catch (error) {
                  reportPerformanceFailure(error, t("couldNotAcknowledgeTheStatus"));
                }
              }}
            >
              <Check className="size-3.5" data-icon="inline-start" /> {t("acknowledge")}
            </AsyncButton>
          </div>
        ) : null}
      </div>
    </RecordSection>
  );
}

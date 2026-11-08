"use client";

import { LineChart, Minus, TrendingUp } from "@/lib/icons";
import { Button } from "@repo/ds/components/ui/button";
import {
  useEvidenceOpener,
  useObjectiveProgress,
  useProgressHistoryPager,
} from "../../../api/use-performance";
import { DerivedCard } from "../../progress/progress-update-composer";
import { ProgressHistoryTimeline } from "../../progress/progress-history-timeline";
import { objectiveProgressTone, pct, PROGRESS_TONE_TEXT } from "../../plan/plan-lib";
import type { ObjectiveRecord } from "../objective-record-model";
import { RECORD_SURFACE, RecordSection } from "./record-primitives";
import { StatusSection } from "./status-section";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";

/**
 * Execution: the objective's current progress and — for those who may see named detail — who recorded
 * what, newest first. The figure itself is part of reading the objective; the history behind it is
 * fetched only when the server says this viewer may see it. Missing progress reads as missing, never a
 * fabricated 0%.
 */
export function ProgressSection({
  record,
  onRecord,
}: {
  record: ObjectiveRecord;
  /** Set when the viewer may record progress here; reveals the record action. */
  onRecord?: () => void;
}) {
  const format = useFormat();
  const t = useTranslations("objective.ProgressSection");
  const canHistory = record.can.readProgressHistory;
  const progressQuery = useObjectiveProgress(
    canHistory ? record.ref.cycleId : null,
    canHistory ? record.ref.objectiveId : null
  );
  const progress = progressQuery.data;
  const pager = useProgressHistoryPager(
    record.ref.cycleId,
    record.ref.objectiveId,
    progress?.history ?? [],
    progress?.historyNextCursor ?? null
  );
  const evidence = useEvidenceOpener(record.ref.cycleId);

  const has = progress?.hasProgress ?? record.progress.has;
  const derived = progress?.derivedProgress ?? record.progress.derived;
  const milestones = record.measurement?.method === "WeightedMilestones" ? record.measurement.milestones : null;
  const lastAt = progress?.history[0]?.recordedAt ?? null;
  const subtitle = milestones
    ? (milestones.length === 1 ? t("ofMilestoneCompletedOfTotal", { length: milestones.filter((m) => m.isCompleted).length, derived: pct(derived) }) : t("ofMilestonesCompletedOfTotal", { length: milestones.filter((m) => m.isCompleted).length, derived: pct(derived) }))
    : record.progressSource === "Calculated" && record.progress.coverage != null
      ? t("ofContributingWeightReported", { coverage: pct(record.progress.coverage) })
      : lastAt
        ? t("updated", { formatDate: format.date(lastAt.slice(0, 10)) })
        : undefined;
  const tone = objectiveProgressTone(record.isAligned, derived);

  return (
    <div className="space-y-4">
      <RecordSection
        label={t("currentProgress")}
        action={
          onRecord ? (
            <Button writes size="sm" className="shrink-0" onClick={onRecord}>
              <LineChart className="size-3.5" data-icon="inline-start" /> {t("recordProgress")}
            </Button>
          ) : null
        }
      >
        {has ? (
          <DerivedCard derived={derived} subtitle={subtitle} />
        ) : (
          <div className={`${RECORD_SURFACE} flex items-center gap-3.5`}>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground/60">
              <Minus className="size-5" aria-hidden />
            </span>
            <p className="type-label text-foreground">{t("noProgressReportedYet")}</p>
          </div>
        )}
      </RecordSection>

      <StatusSection record={record} />

      {canHistory && (has || pager.items.length > 0) ? (
        <RecordSection label={t("progressHistory")}>
          {pager.items.length === 0 ? (
            <div className={`${RECORD_SURFACE} flex items-center gap-3.5`}>
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground/60">
                <TrendingUp className="size-5" aria-hidden />
              </span>
              <p className="type-label text-foreground">{t("noUpdatesRecordedYet")}</p>
            </div>
          ) : (
            <div className={`${RECORD_SURFACE} [&>ol]:mt-0`}>
              <ProgressHistoryTimeline
                history={pager.items}
                toneClass={PROGRESS_TONE_TEXT[tone]}
                hasMore={pager.hasMore}
                loadingMore={pager.loadingMore}
                onLoadMore={pager.loadMore}
                onOpenFile={evidence.open}
                openingFileId={evidence.openingId}
              />
            </div>
          )}
        </RecordSection>
      ) : null}
    </div>
  );
}

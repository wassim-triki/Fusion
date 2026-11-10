"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { PerformanceReviewDto } from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { Textarea } from "@repo/ds/components/ui/textarea";
import { AsyncButton, Said } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { ArrowRight, Check, Eye, Lock } from "@repo/ds/icons";
import { useSummaryRevision } from "../../api/use-review-work";
import { dayLabel } from "./review-parts";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";

const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * Board 15: what calibration settled for this person, shown to their reviewer once the session is finalized (D-23, call 7).
 * When the rating changed, the summary, and only the summary, stays editable until release.
 */
export function CalibratedOutcome({ record }: { record: PerformanceReviewDto }) {
  const format = useFormat();
  const t = useTranslations("reviews.CalibratedOutcome");
  const calibration = record.calibration;
  if (!calibration?.sessionFinalized) return null;
  const subject = first(record.subjectDisplayName);
  const final = calibration.calibratedRating ?? calibration.originalRating;
  const changed = calibration.calibratedRating !== null && calibration.calibratedRating !== calibration.originalRating;
  const potentialChanged = calibration.calibratedPotential !== null && calibration.calibratedPotential !== calibration.originalPotential;
  const label = (value: number) => record.ratingScale.find((level) => level.value === value)?.label ?? String(value);
  return (
    <section aria-labelledby="calibration-outcome" className="mt-6 rounded-surface bg-card p-6">
      <p id="calibration-outcome" className="type-meta text-muted-foreground">{t("afterCalibration")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="flex items-center gap-3">
          <span className={cn("flex size-12 items-center justify-center rounded-control type-metric tabular-nums",
            changed ? "border border-primary bg-primary-tint text-primary-ink" : "bg-inlay text-foreground")}>{final}</span>
          <div>
            <p className="type-label text-foreground">{label(final)}</p>
            <p className="type-meta text-muted-foreground">{changed ? t("youGave", { originalRating: calibration.originalRating, originalRating2: label(calibration.originalRating) }) : t("asYouRated")}</p>
          </div>
        </div>
        {potentialChanged ? (
          <p className="inline-flex items-center gap-1.5 type-body text-foreground">
            {t("potential")} <span className="text-muted-foreground line-through">{calibration.originalPotential}</span>
            <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />{calibration.calibratedPotential}
          </p>
        ) : null}
      </div>
      {calibration.rationale ? (
        <figure className="mt-5 rounded-control bg-inlay px-4 py-3">
          <Said as="blockquote">{calibration.rationale}</Said>
          <figcaption className="mt-1.5 type-meta text-muted-foreground">
            {[calibration.changedBy, calibration.changedAt ? dayLabel(calibration.changedAt.slice(0, 10), format.locale) : null].filter(Boolean).join(" · ")}
          </figcaption>
        </figure>
      ) : null}
      {record.state === "ReadyToFinalize" ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <div className="rounded-control bg-inlay px-4 py-3">
            <p className="flex items-center gap-1.5 type-label text-foreground"><Eye className="size-4 text-muted-foreground" aria-hidden />{t("willSee", { subject })}</p>
            <p className="mt-1 type-body-secondary text-muted-foreground">{t("theFinalRatingAndYour")}</p>
          </div>
          <div className="rounded-control bg-inlay px-4 py-3">
            <p className="flex items-center gap-1.5 type-label text-foreground"><Lock className="size-4 text-muted-foreground" aria-hidden />{t("wontSee", { subject })}</p>
            <p className="mt-1 type-body-secondary text-muted-foreground">{t("yourRatingTheReason")}{record.potentialEnabled ? " " + t("orPotential") : ""}</p>
          </div>
        </div>
      ) : null}
      {calibration.canReviseSummary ? <SummaryRevision record={record} subject={subject} /> : null}
    </section>
  );
}

function SummaryRevision({ record, subject }: { record: PerformanceReviewDto; subject: string }) {
  const format = useFormat();
  const t = useTranslations("reviews.SummaryRevision");
  const calibration = record.calibration!;
  const commands = useSummaryRevision(record.id);
  const saved = record.managerAssessment?.summary ?? "";
  const [summary, setSummary] = useState(saved);
  const settled = calibration.summaryRevisedAt ?? calibration.summaryCheckedAt;
  const dirty = summary.trim() !== saved.trim();
  return (
    <div className="mt-6 border-t border-border pt-5">
      <label htmlFor="revised-summary" className="type-label text-foreground">{t("yourSummary")}</label>
      <p className="type-meta text-muted-foreground">
        {calibration.summaryRevisedAt ? t("revisedEditableUntilResultsAre", { dayLabel: dayLabel(calibration.summaryRevisedAt.slice(0, 10), format.locale) })
          : calibration.summaryCheckedAt ? t("keptEditableUntilResultsAre", { dayLabel: dayLabel(calibration.summaryCheckedAt.slice(0, 10), format.locale) })
          : t("readsThisBesideTheFinal", { subject })}
      </p>
      <Textarea id="revised-summary" className="mt-2 min-h-28 type-narrative" maxLength={4000} value={summary} onChange={(event) => setSummary(event.target.value)} />
      {commands.revise.error || commands.keep.error ? (
        <p className="mt-2 type-body text-destructive" role="alert">{(commands.revise.error ?? commands.keep.error)?.message}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {!settled ? (
          <AsyncButton variant="outline" pending={commands.keep.isLoading} disabled={dirty}
            onClick={async () => { try { await commands.keep.mutateAsync(undefined); toast.success(t("summaryKept")); } catch { /* shown above */ } }}>
            {t("keepAsIs")}
          </AsyncButton>
        ) : null}
        <AsyncButton pending={commands.revise.isLoading} disabled={!dirty || !summary.trim()}
          onClick={async () => {
            try { await commands.revise.mutateAsync({ summary: summary.trim(), expectedVersion: record.version }); toast.success(t("summarySaved")); }
            catch { /* shown above */ }
          }}>
          <Check className="size-4" aria-hidden />{t("saveSummary")}
        </AsyncButton>
        {dirty ? <Button variant="ghost" onClick={() => setSummary(saved)}>{t("undoChanges")}</Button> : null}
      </div>
    </div>
  );
}

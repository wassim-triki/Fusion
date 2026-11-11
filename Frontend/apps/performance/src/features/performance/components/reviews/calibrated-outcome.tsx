"use client";

import type { PerformanceReviewDto } from "@repo/api";
import { Said } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { Eye, Lock } from "@repo/ds/icons";
import { dayLabel } from "./review-parts";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";

const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * What calibration decided for this person, shown to their reviewer once a calibrator kept or changed the rating
 * (D-35): the level it goes out with, and the reason when it changed.
 */
export function CalibratedOutcome({ record }: { record: PerformanceReviewDto }) {
  const format = useFormat();
  const t = useTranslations("reviews.CalibratedOutcome");
  const calibration = record.calibration;
  if (!calibration?.decided) return null;
  const subject = first(record.subjectDisplayName);
  const final = calibration.calibratedRating ?? calibration.originalRating;
  const changed = calibration.calibratedRating !== null && calibration.calibratedRating !== calibration.originalRating;
  const label = (value: number) => record.ratingScale.find((level) => level.value === value)?.label ?? String(value);
  return (
    <section aria-labelledby="calibration-outcome" className="mt-6 rounded-surface bg-card p-6">
      <p id="calibration-outcome" className="type-meta text-muted-foreground">{t("afterCalibration")}</p>
      <div className="mt-3 flex items-center gap-3">
        <span className={cn("flex size-12 items-center justify-center rounded-control type-metric tabular-nums",
          changed ? "border border-primary bg-primary-tint text-primary-ink" : "bg-inlay text-foreground")}>{final}</span>
        <div>
          <p className="type-label text-foreground">{label(final)}</p>
          <p className="type-meta text-muted-foreground">{changed ? t("youGave", { originalRating: calibration.originalRating, originalRating2: label(calibration.originalRating) }) : t("asYouRated")}</p>
        </div>
      </div>
      {calibration.rationale ? (
        <figure className="mt-5 rounded-control bg-inlay px-4 py-3">
          <Said as="blockquote">{calibration.rationale}</Said>
          <figcaption className="mt-1.5 type-meta text-muted-foreground">
            {[calibration.changedBy, calibration.changedAt ? dayLabel(calibration.changedAt.slice(0, 10), format.locale) : null].filter(Boolean).join(" · ")}
          </figcaption>
        </figure>
      ) : null}
      {record.state !== "Finalized" ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <div className="rounded-control bg-inlay px-4 py-3">
            <p className="flex items-center gap-1.5 type-label text-foreground"><Eye className="size-4 text-muted-foreground" aria-hidden />{t("willSee", { subject })}</p>
            <p className="mt-1 type-body-secondary text-muted-foreground">{t("theFinalRatingAndYour")}</p>
          </div>
          <div className="rounded-control bg-inlay px-4 py-3">
            <p className="flex items-center gap-1.5 type-label text-foreground"><Lock className="size-4 text-muted-foreground" aria-hidden />{t("wontSee", { subject })}</p>
            <p className="mt-1 type-body-secondary text-muted-foreground">{t("yourRatingTheReason")}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

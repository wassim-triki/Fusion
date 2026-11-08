"use client";

import type { ReactNode } from "react";
import type { StatusMixDto, TeamResultsDto, YourPeoplePageDto } from "@repo/api";
import { Lock } from "@/lib/icons";
import { cn } from "@repo/ds/lib/utils";
import { day } from "../overview/overview-model";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";
import { useSay } from "@repo/ds/lib/say";
import { english, type Say } from "@/i18n/say";

/**
 * My Team's header facts for the phase, over the manager's whole responsibility (never the current page):
 * plan states while planning, the status mix while executing, the three counts of a running round. The
 * released results of a closed round are their own panel below.
 */

/** The line under the title: who this is about and the phase's one date. */
const en = english("team.summary");

export function teamSubtitle(data: YourPeoplePageDto, say: Say = en, locale?: string): string {
  const people = say("people", { count: data.totalCount });
  const summary = data.summary;
  if (data.phase === "Execution" && summary?.status) {
    const s = summary.status;
    return `${people} · ${say("objectives", { count: s.onTrack + s.atRisk + s.offTrack + s.noStatus })}`;
  }
  if (data.phase === "Review" && summary?.roundName)
    return [people, summary.roundName, summary.reviewsDue ? say("reviewsDue", { day: day(summary.reviewsDue, locale) }) : null].filter(Boolean).join(" · ");
  if (data.phase === "Closed" && summary?.roundName)
    return `${people} · ${summary.roundName}${summary.releasedAt ? ` ${say("released", { day: day(summary.releasedAt, locale) })}` : ""}`;
  return people;
}

type Segment = { count: number; label: string; bar: string; dot: string };

function Breakdown({ title, segments, trailing }: { title: string; segments: Segment[]; trailing?: ReactNode }) {
  const total = segments.reduce((sum, s) => sum + s.count, 0);
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
      <span className="type-label text-foreground">{title}</span>
      {total > 0 ? (
        <div role="img" aria-label={segments.map((s) => `${s.count} ${s.label}`).join(", ")} className="flex h-2 w-60 gap-[3px]">
          {segments
            .filter((s) => s.count > 0)
            .map((s) => (
              <span key={s.label} className={cn("min-w-1.5 rounded-full", s.bar)} style={{ flexGrow: s.count, flexBasis: 0 }} />
            ))}
        </div>
      ) : null}
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 type-body-secondary text-muted-foreground">
        {segments.map((s) => (
          <li key={s.label} className="inline-flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", s.dot)} aria-hidden />
            <b className="font-semibold tabular-nums text-foreground">{s.count}</b> {s.label}
          </li>
        ))}
      </ul>
      {trailing ? <div className="type-body-secondary text-muted-foreground lg:border-s lg:border-border lg:ps-8">{trailing}</div> : null}
    </div>
  );
}

function statusSegments(s: StatusMixDto, say: Say): Segment[] {
  return [
    { count: s.onTrack, label: say("onTrack"), bar: "bg-success", dot: "bg-success" },
    { count: s.atRisk, label: say("atRisk"), bar: "bg-warning", dot: "bg-warning" },
    { count: s.offTrack, label: say("offTrack"), bar: "bg-destructive", dot: "bg-destructive" },
    { count: s.noStatus, label: say("noStatus"), bar: "bg-inlay ring-1 ring-inset ring-border", dot: "ring-1 ring-inset ring-muted-foreground" },
  ];
}

export function TeamSummary({ data }: { data: YourPeoplePageDto }) {
  const format = useFormat();
  const t = useTranslations("team.TeamSummary");
  const words = useSay("team.summary");
  const { standing, summary } = data;
  if (data.phase === "Planning") {
    return (
      <Breakdown
        title={t("plans")}
        segments={[
          { count: standing.approved, label: "approved", bar: "bg-success", dot: "bg-success" },
          { count: standing.submitted, label: t("waitingForYou"), bar: "bg-primary", dot: "bg-primary" },
          { count: standing.draft + standing.returned, label: "drafting", bar: "bg-muted-foreground/60", dot: "bg-muted-foreground/60" },
          { count: standing.notStarted, label: t("notStarted"), bar: "bg-inlay ring-1 ring-inset ring-border", dot: "ring-1 ring-inset ring-muted-foreground" },
        ]}
      />
    );
  }
  if (data.phase === "Execution" && summary?.status) {
    return (
      <Breakdown
        title={t("objectives")}
        segments={statusSegments(summary.status, words)}
        trailing={
          <>
            <b className="font-semibold tabular-nums text-foreground">{summary.updatedIn30Days}</b> {t("ofUpdatedInTheLast", { approved: summary.approved })}
          </>
        }
      />
    );
  }
  if (data.phase === "Review" && summary) {
    // The same strip as Planning and Execution: the manager's reviews as a breakdown, the rest as facts beside it.
    const peers = summary.peerListsToApprove;
    const waiting = Math.max(0, summary.reviewsTotal - summary.reviewsSubmitted - summary.reviewsReady);
    return (
      <Breakdown
        title={t("yourReviews")}
        segments={[
          { count: summary.reviewsSubmitted, label: t("submitted"), bar: "bg-success", dot: "bg-success" },
          { count: summary.reviewsReady, label: t("readyToWrite"), bar: "bg-primary", dot: "bg-primary" },
          { count: waiting, label: t("waitingOnThem"), bar: "bg-muted-foreground/60", dot: "bg-muted-foreground/60" },
        ]}
        trailing={
          <>
            <b className="font-semibold tabular-nums text-foreground">{summary.selfSubmitted}</b> {t("ofSelfAssessmentsIn", { selfTotal: summary.selfTotal })}
            {summary.selfDue ? " " + t("due", { selfDue: day(summary.selfDue, format.locale) }) : ""}
            {peers.length > 0 ? (peers.length === 1 ? t("peerListToApprove", { length: peers.length }) : t("peerListsToApprove", { length: peers.length })) : ""}
          </>
        }
      />
    );
  }
  return null;
}

/**
 * The released results of the manager's own team: how many at each level and who, acknowledgements,
 * calibration changes and open development goals. Final ratings only, no averages, nothing before release.
 */
export function TeamResultsPanel({ results }: { results: TeamResultsDto }) {
  const t = useTranslations("team.TeamResultsPanel");
  if (results.released === 0) return null;
  const tallest = Math.max(1, ...results.levels.map((l) => l.count));
  const top = Math.max(...results.levels.map((l) => l.value));
  const notYet = results.notAcknowledged.map((n) => n.split(/\s+/)[0]);
  return (
    <section aria-labelledby="team-results" className="rounded-surface bg-card p-6 ring-1 ring-inset ring-border">
      <div className="flex items-center justify-between gap-4">
        <h2 id="team-results" className="type-section-title text-foreground">
          {t("yourTeamsResults")}
        </h2>
        <span className="inline-flex items-center gap-1.5 type-meta text-muted-foreground">
          <Lock className="size-3.5" aria-hidden />
          {t("yourTeamOnly")}
        </span>
      </div>
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <ol className="grid grid-cols-5 items-end gap-3" aria-label={t("peopleAtEachLevel")}>
          {results.levels.map((level) => (
            <li key={level.value} className="flex min-w-0 flex-col items-center">
              <span className="type-section-title tabular-nums text-foreground">{level.count}</span>
              <span className="mt-2 flex h-32 w-full items-end">
                <span
                  className={cn(
                    "w-full rounded-t-detail",
                    level.count === 0 ? "h-0.5 bg-border" : level.value === top ? "bg-primary" : level.value >= top - 1 ? "bg-primary/70" : "bg-muted-foreground/40",
                  )}
                  style={level.count === 0 ? undefined : { height: `${(level.count / tallest) * 100}%` }}
                />
              </span>
              <span className="mt-3 type-label tabular-nums text-foreground">{level.value}</span>
              <span className="truncate text-center type-meta text-muted-foreground" title={level.label}>
                {level.label}
              </span>
              {level.people.length > 0 ? (
                <span className="mt-1.5 truncate text-center type-meta text-foreground" title={level.people.map((p) => p.name).join(", ")}>
                  {level.people.map((p) => p.name.split(/\s+/)[0]).join(", ")}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        <dl className="divide-y divide-border">
          <div className="pb-4">
            <dt className="sr-only">{t("acknowledged")}</dt>
            <dd className="text-foreground">
              <span className="type-metric">{results.acknowledged}</span>{" "}
              <span className="type-body-secondary">{t("ofAcknowledged", { released: results.released })}</span>
            </dd>
            {notYet.length > 0 ? <dd className="mt-1 type-meta text-muted-foreground">{t("notYet", { join: notYet.join(", ") })}</dd> : null}
          </div>
          <div className="py-4">
            <dt className="sr-only">{t("changedInCalibration")}</dt>
            <dd className="text-foreground">
              <span className="type-metric">{results.calibrationChanges.length}</span>{" "}
              <span className="type-body-secondary">{t("changedInCalibration2")}</span>
            </dd>
            {results.calibrationChanges.map((c) => (
              <dd key={c.employeeId} className="mt-1 type-meta text-muted-foreground">
                {c.name}, {c.from} → {c.to}
              </dd>
            ))}
          </div>
          <div className="pt-4">
            <dt className="sr-only">{t("openGrowthGoals")}</dt>
            <dd className="text-foreground">
              <span className="type-metric">{results.openGrowthGoals}</span>{" "}
              <span className="type-body-secondary">{t("openGrowth")} {results.openGrowthGoals === 1 ? t("goal") : t("goals")}</span>
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

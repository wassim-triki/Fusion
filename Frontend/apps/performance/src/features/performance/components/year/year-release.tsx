"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { fusionAttentionQueryKeys, performanceQueryKeys, type YearDto, type YearPersonDto, type YearReleaseDto } from "@repo/api";
import { useApiQueryClient } from "@repo/api/query";
import { Bell, Check, Lock } from "@repo/ds/icons";
import { PreviewRow } from "@repo/ds/shell";
import { AvatarStack, PersonInitials } from "@repo/performance-ui";
import { useApis } from "../../api/use-performance";

const BATCH = 8;

/** Who releasing reaches and how (D-72): ready as rated now, looked at with their decision, the rest once ready. */
export function ReleaseRows({ release }: { release: YearReleaseDto }) {
  const t = useTranslations("year.Release");
  return (
    <>
      <div>
        <PreviewRow label={t("asRated")} count={release.asRated}>
          <Faces people={release.asRatedFaces} />{t("rows.asRated")}
        </PreviewRow>
        {release.lookedAt.length ? (
          <PreviewRow label={t("lookedAt")} count={release.lookedAt.length}>
            <AvatarStack names={release.lookedAt.map((d) => d.name)} size="md" max={3} />{t("rows.lookedAt")}
          </PreviewRow>
        ) : null}
        {release.toLookAt ? <PreviewRow label={t("toLookAt")} count={release.toLookAt}>{t("rows.toLookAt")}</PreviewRow> : null}
        {release.stillWriting ? (
          <PreviewRow label={t("stillWriting")} count={release.stillWriting}>
            <Faces people={release.stillWritingFaces} />{t("rows.stillWriting")}
          </PreviewRow>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="inline-flex items-center gap-2 font-semibold text-foreground"><Lock aria-hidden className="size-4" />{t("final")}</span>
        <span className="inline-flex items-center gap-2 text-muted-foreground"><Bell aria-hidden className="size-[15px]" />{t("oneEach")}</span>
      </div>
    </>
  );
}

/** The flagged reviews looked at, as the next step's body before release: who, and what they go out with. */
export function LookedAt({ release }: { release: YearReleaseDto }) {
  const t = useTranslations("year.Release");
  if (!release.lookedAt.length) return null;
  return (
    <div className="flex flex-wrap gap-x-[22px] gap-y-3">
      {release.lookedAt.map((d) => (
        <div key={d.employeeId} className="flex items-center gap-2.5">
          <PersonInitials name={d.name} size="md" />
          <div className="grid">
            <b className="text-[13.5px] font-semibold text-foreground">{d.name}</b>
            <span className="text-sm text-muted-foreground">{d.kept ? t("kept", { level: d.to }) : t("changed", { from: d.from, to: d.to })}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export interface ReleaseRun {
  done: number;
  total: number;
  landed: YearPersonDto[];
}

/**
 * Releases the ready reviews in batches (P5): the count climbs as each batch goes out and faces land with it. Everything
 * of Performance and Home's work refreshes at the end.
 */
export function useReleaseRun(year: YearDto) {
  const { performance } = useApis();
  const cache = useApiQueryClient();
  const [run, setRun] = useState<ReleaseRun | null>(null);
  const start = async () => {
    const move = year.nextMove;
    const release = move?.release;
    if (!move?.roundId || !release) return 0;
    const ids = release.reviewIds;
    const faces = [...release.asRatedFaces, ...release.lookedAt.map((d) => ({ employeeId: d.employeeId, name: d.name, unitName: null, standing: "reviewed" as const, since: null }))];
    let version = release.roundVersion;
    let done = 0;
    setRun({ done: 0, total: ids.length, landed: [] });
    try {
      for (let i = 0; i < ids.length; i += BATCH) {
        const result = await performance.finalizeReviewRound(move.roundId, version, ids.slice(i, i + BATCH));
        version = result.version;
        done += result.finalized.length;
        const shown = Math.round((done / Math.max(1, ids.length)) * faces.length);
        setRun({ done, total: ids.length, landed: faces.slice(0, shown) });
      }
    } finally {
      await Promise.all([
        cache.invalidateQueries({ queryKey: performanceQueryKeys.all() }),
        cache.invalidateQueries({ queryKey: fusionAttentionQueryKeys.all() }),
      ]);
      setRun(null);
    }
    return done;
  };
  return { run, start };
}

export function ReleaseProgress({ run }: { run: ReleaseRun }) {
  const share = run.total ? (run.done / run.total) * 100 : 0;
  return (
    <div className="grid gap-3.5">
      <div className="h-2.5 overflow-hidden rounded-full bg-inlay">
        <i className="block h-full rounded-full bg-success transition-[width] duration-300" style={{ width: `${share}%` }} />
      </div>
      <div className="flex min-h-[30px] flex-wrap gap-1.5">
        {run.landed.map((person) => (
          <span key={person.employeeId} className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
            <PersonInitials name={person.name} size="md" />
          </span>
        ))}
      </div>
    </div>
  );
}

/** After release: the count out today, each person and their manager told. */
export function ReleasedToday({ count }: { count: number }) {
  const t = useTranslations("year.Release");
  return (
    <div className="flex items-center gap-2.5 text-sm text-foreground">
      <Check aria-hidden className="size-4" />{t("outToday", { count })}
    </div>
  );
}

function Faces({ people }: { people: YearPersonDto[] }) {
  return people.length ? <AvatarStack names={people.map((p) => p.name)} size="md" max={3} /> : null;
}

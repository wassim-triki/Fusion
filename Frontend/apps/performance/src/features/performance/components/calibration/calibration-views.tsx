"use client";

import { useState } from "react";
import type {
  CalibrationChangesViewDto,
  CalibrationDistributionViewDto,
  CalibrationFlagDto,
  CalibrationGroupDto,
  CalibrationLevelDto,
  CalibrationManagerDto,
  CalibrationPeopleViewDto,
  CalibrationPersonDto,
  ReviewPotential,
} from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { cn } from "@repo/ds/lib/utils";
import { PersonInitials } from "@repo/performance-ui";
import { ArrowRight, ChevronDown, Flag, Users } from "@/lib/icons";
import { dayLabel } from "../reviews/review-parts";
import { average, flagText, leniencyText, signed } from "./calibration-format";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";
import { useSay } from "@repo/ds/lib/say";

// ── Marks shared by the views and the drawer ─────────────────────────────────

/** A level as a small square; the top levels take the accent, as on the distribution. */
export function LevelMark({ value, top, muted = false, className }: { value: number; top: number; muted?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-nested type-label tabular-nums",
      muted ? "border border-border text-muted-foreground" : value >= top - 1 ? "bg-primary text-primary-foreground" : "bg-inlay text-foreground", className)}>
      {value}
    </span>
  );
}

/** The manager's rating, and the calibrated one when it moved. */
export function RatingChange({ original, current, top }: { original: number; current: number; top: number }) {
  const t = useTranslations("calibration.RatingChange");
  if (original === current) return <LevelMark value={current} top={top} className="bg-inlay text-foreground" />;
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={t("to", { original, current })}>
      <LevelMark value={original} top={top} muted />
      <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
      <LevelMark value={current} top={top} className="border border-primary bg-primary-tint text-primary-ink" />
    </span>
  );
}

export function PotentialBadge({ value, was }: { value: ReviewPotential | null; was?: ReviewPotential | null }) {
  if (!value) return <span className="type-meta text-muted-foreground">—</span>;
  const badge = (potential: ReviewPotential, muted = false) => (
    <span className={cn("inline-flex rounded-control-sm px-2 py-0.5 type-meta-strong",
      muted ? "text-muted-foreground line-through" : potential === "High" ? "bg-success-subtle text-success" : "bg-inlay text-foreground")}>{potential}</span>
  );
  return was && was !== value
    ? <span className="inline-flex items-center gap-1">{badge(was, true)}<ArrowRight className="size-3 text-muted-foreground" aria-hidden />{badge(value)}</span>
    : badge(value);
}

export function FlagChip({ children, quiet = false }: { children: string; quiet?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-control-sm px-2 py-0.5 type-meta-strong",
      quiet ? "text-info" : "bg-info-subtle text-info")}>
      <Flag className="size-3" aria-hidden />{children}
    </span>
  );
}

export function PersonFlags({ flags }: { flags: CalibrationFlagDto[] }) {
  const say = useSay("calibration.format");
  if (flags.length === 0) return null;
  return <span className="flex flex-wrap gap-1.5">{flags.map((flag) => <FlagChip key={flag.kind}>{flagText(flag, say)}</FlagChip>)}</span>;
}

/** Weighted attainment as a short bar: success from half, warning below. */
export function Attainment({ value }: { value: number | null }) {
  if (value === null) return <span className="type-meta text-muted-foreground">—</span>;
  const share = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-inlay" aria-hidden>
        <span className={cn("block h-full rounded-full", share >= 50 ? "bg-success" : "bg-warning")} style={{ width: `${share}%` }} />
      </span>
      <span className="w-9 text-end type-label tabular-nums text-foreground">{share}%</span>
    </span>
  );
}

// ── Distribution ─────────────────────────────────────────────────────────────

/** Board 03: the managers' ratings outlined beside where the session stands, then each manager furthest first. */
export function DistributionView({ view, onManager }: { view: CalibrationDistributionViewDto; onManager: (managerId: string) => void }) {
  const t = useTranslations("calibration.DistributionView");
  const top = view.levels.length;
  const max = Math.max(1, ...view.levels.flatMap((level) => [level.original, level.current]));
  const [all, setAll] = useState(false);
  const notable = view.managers.filter((manager) => manager.lenient || Math.abs(manager.delta) >= 0.2);
  const shown = all || notable.length === view.managers.length ? view.managers : view.managers.slice(0, Math.max(notable.length, 6));
  const hidden = view.managers.length - shown.length;
  return (
    <div className="space-y-10">
      <section aria-labelledby="distribution-title" className="rounded-surface bg-card p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="distribution-title" className="type-section-title text-foreground">{t("ratingsAcrossTheSession")}</h2>
          <p className="flex flex-wrap items-center gap-4 type-meta text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-detail border border-dashed border-muted-foreground" aria-hidden />{t("managersRatings")}</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-detail bg-primary" aria-hidden />{t("now")}</span>
            <span>{t("average")} <b className="tabular-nums text-foreground">{average(view.currentAverage)}</b> {t("was", { sessionAverage: average(view.sessionAverage) })}</span>
          </p>
        </div>
        <div className="mt-6 grid items-end gap-4" style={{ gridTemplateColumns: `repeat(${view.levels.length}, minmax(0, 1fr))` }}>
          {view.levels.map((level) => <LevelBar key={level.value} level={level} max={max} top={top} />)}
        </div>
      </section>

      <section aria-labelledby="by-manager-title" className="overflow-hidden rounded-surface bg-card">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 id="by-manager-title" className="type-section-title text-foreground">
            {t("byManager")}<span className="ms-1.5 type-meta tabular-nums text-muted-foreground">{view.managers.length}</span>
          </h2>
          <p className="type-meta text-muted-foreground">{t("furthestFromTheSessionAverage")}</p>
        </div>
        {view.managers.length === 0 ? (
          <p className="px-6 py-10 text-center type-body text-muted-foreground">{t("noOneMatchesTheseFilters")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-start">
              <thead>
                <tr className="border-b border-border type-meta text-muted-foreground">
                  <th className="px-5 py-3 font-medium">{t("manager")}</th>
                  <th className="px-3 py-3 font-medium">{t("people")}</th>
                  <th className="px-3 py-3 font-medium">{t("theirRatingsNow")}</th>
                  <th className="px-3 py-3 font-medium">{t("average")}</th>
                  <th className="px-5 py-3 font-medium">{t("flag")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((manager) => <ManagerRow key={manager.reviewerId} manager={manager} top={top} onOpen={() => onManager(manager.reviewerId)} />)}
              </tbody>
            </table>
            {hidden > 0 ? (
              <div className="flex items-center justify-between border-t border-border px-5 py-3 type-meta text-muted-foreground">
                <span>{t("more", { hidden })} {hidden === 1 ? t("manager2") : t("managers")} {t("within02OfThe")}</span>
                <Button variant="ghost" size="sm" onClick={() => setAll(true)}>{t("showAll")}<ChevronDown className="size-3.5" aria-hidden /></Button>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

function LevelBar({ level, max, top }: { level: CalibrationLevelDto; max: number; top: number }) {
  const t = useTranslations("calibration.LevelBar");
  const height = 220;
  const delta = level.current - level.original;
  const accent = level.value >= top - 1;
  return (
    <div className="flex min-w-0 flex-col items-center">
      <span className="type-metric tabular-nums text-foreground">{level.current}</span>
      <span className={cn("mt-1 rounded-detail px-1.5 type-meta-strong tabular-nums", delta === 0 ? "text-muted-foreground" : "bg-info-subtle text-info")}>
        {signed(delta)}
      </span>
      <div className="relative mt-3 w-full max-w-36" style={{ height }} aria-label={t("nowFromManagers", { label: level.label, current: level.current, original: level.original })} role="img">
        <span className="absolute inset-x-0 bottom-0 rounded-t-control border border-dashed border-muted-foreground/50"
          style={{ height: Math.max(2, (level.original / max) * height) }} aria-hidden />
        <span className={cn("absolute inset-x-0 bottom-0 rounded-t-control", accent ? "bg-primary" : "bg-muted-foreground/45")}
          style={{ height: Math.max(level.current > 0 ? 4 : 0, (level.current / max) * height) }} aria-hidden />
      </div>
      <div className="mt-3 w-full border-t border-border pt-3 text-center">
        <p className="type-label tabular-nums text-foreground">{level.value}</p>
        <p className="truncate type-meta text-muted-foreground">{level.label}</p>
      </div>
    </div>
  );
}

function ManagerRow({ manager, top, onOpen }: { manager: CalibrationManagerDto; top: number; onOpen: () => void }) {
  const t = useTranslations("calibration.ManagerRow");
  const say = useSay("calibration.format");
  const total = Math.max(1, manager.currentMix.reduce((sum, count) => sum + count, 0));
  return (
    <tr className="cursor-pointer hover:bg-inlay/50" onClick={onOpen}>
      <td className="px-5 py-3.5">
        <button type="button" onClick={onOpen} className="flex items-center gap-3 rounded-control text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <PersonInitials name={manager.reviewerName} size="md" />
          <span className="type-label text-foreground">{manager.reviewerName}</span>
        </button>
      </td>
      <td className="px-3 py-3.5 type-body tabular-nums text-foreground">{manager.reviews}</td>
      <td className="px-3 py-3.5">
        <span className="flex h-2.5 w-full min-w-40 overflow-hidden rounded-full bg-inlay" role="img"
          aria-label={manager.currentMix.map((count, index) => t("at", { count, value: index + 1 })).join(", ")}>
          {manager.currentMix.map((count, index) => count === 0 ? null : (
            <span key={index} className={cn("h-full border-e border-card last:border-e-0", MIX[Math.min(MIX.length - 1, index + MIX.length - top)])}
              style={{ width: `${(count / total) * 100}%` }} />
          ))}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-3.5">
        <span className={cn("type-label tabular-nums", manager.lenient ? "text-info" : "text-foreground")}>{average(manager.originalAverage)}</span>
        {manager.currentAverage !== manager.originalAverage ? (
          <span className="ms-1.5 type-meta tabular-nums text-muted-foreground">→ {average(manager.currentAverage)}</span>
        ) : null}
      </td>
      <td className="px-5 py-3.5">{manager.lenient ? <FlagChip>{leniencyText(manager.delta, say)}</FlagChip> : <span className="type-meta text-muted-foreground">—</span>}</td>
    </tr>
  );
}

/** Lowest levels grey, the top two in the accent. */
const MIX = ["bg-muted-foreground/30", "bg-muted-foreground/45", "bg-muted-foreground/60", "bg-primary/70", "bg-primary"];

// ── People ───────────────────────────────────────────────────────────────────

const GROUP_PREVIEW = 4;

/** Board 04: everyone grouped by where they stand now; groups with changes or flags open first. */
export function PeopleView({ view, top, lenient, onOpen }: {
  view: CalibrationPeopleViewDto;
  top: number;
  lenient: ReadonlySet<string>;
  onOpen: (person: CalibrationPersonDto) => void;
}) {
  const t = useTranslations("calibration.PeopleView");
  if (view.total === 0) {
    return (
      <div className="rounded-surface bg-card px-6 py-12 text-center">
        <Users className="mx-auto size-8 text-muted-foreground/50" aria-hidden />
        <p className="mt-3 type-body text-foreground">{t("noOneMatchesTheseFilters")}</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-surface bg-card">
      <table className="w-full min-w-[60rem] text-start">
        <thead>
          <tr className="border-b border-border type-meta text-muted-foreground">
            <th className="px-4 py-3 font-medium">{t("person")}</th>
            <th className="px-3 py-3 font-medium">{t("manager")}</th>
            <th className="px-3 py-3 font-medium">{t("rating")}</th>
            <th className="px-3 py-3 font-medium">{t("potential")}</th>
            <th className="px-3 py-3 font-medium">{t("objectives")}</th>
            <th className="px-3 py-3 font-medium">{t("lastCycle")}</th>
            <th className="px-4 py-3 font-medium">{t("flags")}</th>
          </tr>
        </thead>
        {view.groups.map((group) => <Group key={group.value} group={group} top={top} lenient={lenient} onOpen={onOpen} />)}
      </table>
    </div>
  );
}

function Group({ group, top, lenient, onOpen }: { group: CalibrationGroupDto; top: number; lenient: ReadonlySet<string>; onOpen: (person: CalibrationPersonDto) => void }) {
  const t = useTranslations("calibration.Group");
  const notable = group.people.some((person) => person.flags.length > 0 || person.originalRating !== person.currentRating);
  const [open, setOpen] = useState(notable);
  const [all, setAll] = useState(false);
  const rows = all ? group.people : group.people.slice(0, GROUP_PREVIEW);
  return (
    <tbody className="border-b border-border last:border-b-0">
      <tr>
        <td colSpan={7} className="px-4 py-3">
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} disabled={group.count === 0}
            className="flex items-center gap-3 rounded-control text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <LevelMark value={group.value} top={top} />
            <span className="type-label text-foreground">{group.label}</span>
            <span className="type-meta tabular-nums text-muted-foreground">
              {group.count}{group.originalCount !== group.count ? " " + t("was", { originalCount: group.originalCount }) : ""}
            </span>
            {group.count > 0 ? <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden /> : null}
          </button>
        </td>
      </tr>
      {open ? rows.map((person) => <PersonRow key={person.reviewId} person={person} top={top} lenient={lenient.has(person.reviewerId)} onOpen={() => onOpen(person)} />) : null}
      {open && group.people.length > rows.length ? (
        <tr>
          <td colSpan={7} className="px-4 py-2.5 type-meta text-muted-foreground">
            {t("moreAt", { value: group.people.length - rows.length, label: group.label })}
            <Button variant="ghost" size="sm" className="ms-2" onClick={() => setAll(true)}>{t("show")}</Button>
          </td>
        </tr>
      ) : null}
    </tbody>
  );
}

function PersonRow({ person, top, lenient, onOpen }: { person: CalibrationPersonDto; top: number; lenient: boolean; onOpen: () => void }) {
  const t = useTranslations("calibration.PersonRow");
  return (
    <tr className="cursor-pointer border-t border-border hover:bg-inlay/50" onClick={onOpen}>
      <td className="px-4 py-3">
        <button type="button" onClick={(event) => { event.stopPropagation(); onOpen(); }}
          className="flex items-center gap-3 rounded-control text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <PersonInitials name={person.name} size="md" />
          <span className="min-w-0">
            <span className="block type-label text-foreground">{person.name}</span>
            <span className="block truncate type-meta text-muted-foreground">{[person.jobTitle, person.unit].filter(Boolean).join(" · ")}</span>
          </span>
        </button>
      </td>
      <td className="whitespace-nowrap px-3 py-3 type-body text-foreground">
        {person.reviewerName}
        {lenient ? <Flag className="ms-1.5 inline size-3 text-info" aria-label={t("managerFlagged")} /> : null}
      </td>
      <td className="px-3 py-3"><RatingChange original={person.originalRating} current={person.currentRating} top={top} /></td>
      <td className="px-3 py-3"><PotentialBadge value={person.currentPotential} was={person.originalPotential} /></td>
      <td className="px-3 py-3"><Attainment value={person.attainment} /></td>
      <td className="px-3 py-3 type-label tabular-nums text-foreground">{person.lastResult?.rating ?? <span className="text-muted-foreground">—</span>}</td>
      <td className="px-4 py-3"><PersonFlags flags={person.flags} /></td>
    </tr>
  );
}

// ── Finalized ────────────────────────────────────────────────────────────────

/** Board 10: where ratings landed against what managers gave, and every change with its reason. */
export function ChangesView({ view, top }: { view: CalibrationChangesViewDto; top: number }) {
  const format = useFormat();
  const t = useTranslations("calibration.ChangesView");
  const max = Math.max(1, ...view.levels.flatMap((level) => [level.original, level.current]));
  return (
    <div className="space-y-10">
      <section aria-labelledby="landed-title" className="rounded-surface bg-card p-6">
        <h2 id="landed-title" className="type-section-title text-foreground">{t("whereRatingsLanded")}</h2>
        <div className="mt-6 grid items-end gap-4" style={{ gridTemplateColumns: `repeat(${view.levels.length}, minmax(0, 1fr))` }}>
          {view.levels.map((level) => <LevelBar key={level.value} level={level} max={max} top={top} />)}
        </div>
      </section>
      <section aria-labelledby="changes-title" className="overflow-hidden rounded-surface bg-card">
        <h2 id="changes-title" className="flex min-h-14 items-center border-b border-border px-5 type-section-title text-foreground">
          {t("changes")}<span className="ms-1.5 type-meta tabular-nums text-muted-foreground">{view.changes.length}</span>
        </h2>
        {view.changes.length === 0 ? (
          <p className="px-6 py-10 text-center type-body text-muted-foreground">{t("everyRatingStayedAsManagers")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {view.changes.map((change) => (
              <li key={change.reviewId} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,14rem)_auto_minmax(0,1fr)_auto] md:items-start">
                <div className="flex items-center gap-3">
                  <PersonInitials name={change.name} size="md" />
                  <span className="min-w-0">
                    <span className="block type-label text-foreground">{change.name}</span>
                    <span className="block type-meta text-muted-foreground">{change.reviewerName}</span>
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <RatingChange original={change.originalRating} current={change.finalRating} top={top} />
                  {change.originalPotential !== change.finalPotential ? <PotentialBadge value={change.finalPotential} was={change.originalPotential} /> : null}
                </div>
                <p className="type-body-secondary text-foreground">{change.reason}</p>
                <p className="whitespace-nowrap type-meta text-muted-foreground">
                  {[change.changedBy, change.changedAt ? dayLabel(change.changedAt.slice(0, 10), format.locale) : null].filter(Boolean).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

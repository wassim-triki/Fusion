"use client";

import { Fragment, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { PersonAvatar } from "@repo/ds";
import { cn } from "@repo/ds/lib/utils";
import type { ChartJobDto, ChartPersonDto, ChartUnitDto, CompanyImportDto } from "@repo/api";

const ROW_LIMIT = 12;

function Tag({ tone, children }: { tone: "warning" | "primary" | "success"; children: string }) {
  return (
    <span
      className={cn(
        "absolute -top-2.5 end-2.5 rounded-full border bg-card px-2 type-meta-strong leading-[1.125rem]",
        tone === "warning" && "border-warning/50 text-warning",
        tone === "primary" && "border-primary-ring text-primary-ink",
        tone === "success" && "border-success/50 text-success",
      )}
    >
      {children}
    </span>
  );
}

/**
 * People as the files make them: the top of the company, then the team of whoever is picked, level by level, so a
 * chart of any size stays readable. A check or a fix focuses the person it's about.
 */
export function PeopleChart({ people, focus, onFocus }: { people: ChartPersonDto[]; focus: string | null; onFocus: (key: string) => void }) {
  const t = useTranslations("companyImport.chart");
  const { byKey, kids, roots } = useMemo(() => {
    const byKey = new Map(people.map((person) => [person.key, person]));
    const kids = new Map<string, ChartPersonDto[]>();
    const roots: ChartPersonDto[] = [];
    for (const person of people) {
      if (person.managerKey && byKey.has(person.managerKey)) kids.set(person.managerKey, [...(kids.get(person.managerKey) ?? []), person]);
      else roots.push(person);
    }
    const order = (list: ChartPersonDto[]) => list.sort((a, b) => b.totalCount - a.totalCount || a.name.localeCompare(b.name));
    for (const list of kids.values()) order(list);
    return { byKey, kids, roots: order(roots) };
  }, [people]);

  const path = useMemo(() => {
    const chain: string[] = [];
    let at = focus && byKey.has(focus) ? focus : roots[0]?.key;
    for (let guard = 0; at && guard < 64; guard++) {
      chain.unshift(at);
      at = byKey.get(at)?.managerKey ?? undefined;
      if (at && !byKey.has(at)) break;
    }
    return chain;
  }, [byKey, focus, roots]);

  if (people.length === 0) return <p className="grid min-h-[33.75rem] place-items-center type-body text-muted-foreground">{t("noPeople")}</p>;

  const rows: { lead: ChartPersonDto | null; people: ChartPersonDto[] }[] = [{ lead: null, people: roots }];
  for (const key of path) {
    const team = kids.get(key);
    if (team?.length) rows.push({ lead: byKey.get(key)!, people: team });
  }

  return (
    <div className="grid gap-2 overflow-x-auto px-4 py-6">
      {rows.map((row, i) => (
        <Fragment key={row.lead?.key ?? "top"}>
          {row.lead ? (
            <div className="grid justify-items-center gap-1.5" aria-hidden={false}>
              <span className="h-5 w-px bg-input" />
              <span className="type-meta text-muted-foreground">{t("teamOf", { name: row.lead.name, count: row.people.length })}</span>
            </div>
          ) : null}
          <ChartRow people={row.people} picked={path[i]} focus={focus} onFocus={onFocus} />
        </Fragment>
      ))}
    </div>
  );
}

function ChartRow({ people, picked, focus, onFocus }: { people: ChartPersonDto[]; picked: string | undefined; focus: string | null; onFocus: (key: string) => void }) {
  const t = useTranslations("companyImport.chart");
  const [all, setAll] = useState(false);
  const pickedAt = people.findIndex((person) => person.key === picked);
  const shown = all || people.length <= ROW_LIMIT ? people : people.slice(0, ROW_LIMIT).concat(pickedAt >= ROW_LIMIT ? [people[pickedAt]!] : []);
  return (
    <div className="flex flex-wrap justify-center gap-x-3 gap-y-4 pt-2.5">
      {shown.map((person) => (
        <PersonNode key={person.key} person={person} picked={person.key === picked} focused={person.key === focus} onClick={() => onFocus(person.key)} />
      ))}
      {shown.length < people.length ? (
        <button type="button" onClick={() => setAll(true)} className="grid w-48 place-items-center rounded-surface border border-dashed border-input type-label text-muted-foreground hover:text-foreground">
          {t("more", { count: people.length - shown.length })}
        </button>
      ) : null}
    </div>
  );
}

function PersonNode({ person, picked, focused, onClick }: { person: ChartPersonDto; picked: boolean; focused: boolean; onClick: () => void }) {
  const t = useTranslations("companyImport.chart");
  const flagged = person.checks.length > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      // eslint-disable-next-line no-restricted-syntax -- a chart node: picking it opens its team below, a one-off toggle
      aria-pressed={picked}
      className={cn(
        "relative grid w-48 grid-cols-[minmax(0,1fr)] gap-2 rounded-surface border border-transparent bg-card p-3 text-start transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        picked && "border-primary/45",
        focused && "ring-2 ring-primary/40",
        flagged && "border-warning/60 shadow-[0_0_0_4px_color-mix(in_oklab,var(--warning)_14%,transparent)]",
      )}
    >
      {flagged ? <Tag tone="warning">{t("flag")}</Tag> : person.you ? <Tag tone="primary">{t("you")}</Tag> : null}
      <span className="flex items-center gap-2.5">
        <PersonAvatar name={person.name} size="sm" />
        <span className="grid min-w-0">
          <span className="type-label truncate text-foreground">{person.name}</span>
          <span className="type-meta truncate text-muted-foreground">{person.title}</span>
        </span>
      </span>
      <span className="flex min-w-0 items-center justify-between gap-2 border-t border-border pt-2 type-meta text-muted-foreground">
        <span className="min-w-0 truncate">{[person.unit, person.place].filter(Boolean).join(" · ")}</span>
        {person.directCount > 0 ? <span className="shrink-0 tabular-nums text-foreground">{t("direct", { count: person.directCount })}</span> : null}
      </span>
      {person.changed.length > 0 ? <span className="type-meta text-primary-ink">{t("changedByYou")}</span> : null}
    </button>
  );
}

/** Units as a tree: the top, the units under it side by side, and everything below each listed under it. */
export function UnitsTree({ data }: { data: CompanyImportDto }) {
  const t = useTranslations("companyImport.chart");
  const units = data.chart.units;
  const children = useMemo(() => {
    const map = new Map<string, ChartUnitDto[]>();
    for (const unit of units) if (unit.parentKey) map.set(unit.parentKey, [...(map.get(unit.parentKey) ?? []), unit]);
    return map;
  }, [units]);
  const root = units.find((unit) => unit.key === data.chart.rootKey) ?? units.find((unit) => !unit.parentKey);
  if (!root) return <p className="grid min-h-[33.75rem] place-items-center type-body text-muted-foreground">{t("noUnits")}</p>;

  const below = (key: string, depth = 0): { unit: ChartUnitDto; depth: number }[] =>
    (children.get(key) ?? []).flatMap((unit) => [{ unit, depth }, ...below(unit.key, depth + 1)]);
  const total = (key: string): number => (children.get(key) ?? []).reduce((sum, unit) => sum + unit.count + total(unit.key), 0);
  const tops = children.get(root.key) ?? [];

  return (
    <div className="grid justify-items-center overflow-x-auto px-4 pb-16 pt-7">
      <UnitNode unit={root} total={root.count + total(root.key)} wide />
      {tops.length > 0 ? <span className="h-5 w-px bg-input" /> : null}
      <div className="flex items-start gap-5 border-t border-input pt-5">
        {tops.map((top) => (
          <div key={top.key} className="grid gap-2.5">
            <UnitNode unit={top} total={top.count + total(top.key)} wide />
            {below(top.key).map(({ unit, depth }) => (
              <div key={unit.key} style={{ paddingInlineStart: `${Math.min(depth, 4) * 0.875}rem` }}>
                <UnitNode unit={unit} total={unit.count + total(unit.key)} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function UnitNode({ unit, total, wide }: { unit: ChartUnitDto; total: number; wide?: boolean }) {
  const t = useTranslations("companyImport.chart");
  const flagged = unit.checks.length > 0;
  return (
    <div className={cn("relative grid gap-2 rounded-surface border border-transparent bg-card p-3", wide ? "w-56" : "w-[12.5rem]", flagged && "border-dashed border-warning/60", unit.added && "border-success/50")}>
      {flagged ? <Tag tone="warning">{t("flag")}</Tag> : unit.added ? <Tag tone="success">{t("new")}</Tag> : null}
      <span className="grid gap-0.5">
        <span className="type-label text-foreground">{unit.name}</span>
        <span className="type-meta text-muted-foreground">{unit.existing ? t("inFusion") : unit.type ?? t("unit")}</span>
      </span>
      <span className="flex items-center gap-2 border-t border-border pt-2 type-meta text-muted-foreground">
        {unit.headName ? <PersonAvatar name={unit.headName} size="xs" /> : null}
        <span className="min-w-0 flex-1 truncate">{unit.headName ?? ""}</span>
        <span className="tabular-nums text-foreground">{total}</span>
      </span>
    </div>
  );
}

/** Jobs grouped into their families, each with its level and how many hold it; titles merged into one job say so. */
export function JobsGrid({ data }: { data: CompanyImportDto }) {
  const t = useTranslations("companyImport.chart");
  const families = useMemo(() => {
    const map = new Map<string, ChartJobDto[]>();
    for (const job of data.chart.jobs) {
      const key = job.family ?? "";
      map.set(key, [...(map.get(key) ?? []), job]);
    }
    return [...map.entries()]
      .map(([family, jobs]) => ({ family, jobs: jobs.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title)) }))
      .sort((a, b) => (a.family === "" ? 1 : b.family === "" ? -1 : b.jobs.length - a.jobs.length));
  }, [data.chart.jobs]);

  return (
    <div className={cn("grid gap-3 p-4", families.length > 1 && "md:grid-cols-2")}>
      {families.map(({ family, jobs }) => (
        <section key={family} className="grid content-start rounded-surface bg-card px-4 pb-1.5 pt-3.5">
          <div className="flex items-baseline justify-between pb-2">
            <h3 className="type-subsection-title text-foreground">{family || (families.length > 1 ? t("noFamily") : t("allJobs"))}</h3>
            <span className="type-meta text-muted-foreground">{t("jobs", { count: jobs.length })}</span>
          </div>
          {jobs.map((job) => (
            <div key={job.key} className={cn("grid min-h-9 grid-cols-[minmax(0,1fr)_auto_2rem] items-center gap-2.5 border-t border-border type-body", job.checks.length > 0 && "text-warning")}>
              <span className="min-w-0 truncate">
                {job.title}
                {job.titles.length > 1 ? <span className="type-meta text-muted-foreground"> · {t("fromTitles", { count: job.titles.length })}</span> : null}
                {job.checks.length > 0 ? <span className="type-meta"> · {t("lookAlike")}</span> : null}
              </span>
              {job.level ? <span className="inline-grid h-[1.125rem] place-items-center rounded-detail border border-border bg-inlay px-1.5 type-meta-strong text-muted-foreground">{job.level}</span> : <span />}
              <span className="text-end tabular-nums text-muted-foreground">{job.count}</span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

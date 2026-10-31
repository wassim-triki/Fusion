"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button, Skeleton, cn } from "@repo/ds";
import { DataTableFilters, DataTableSearch, useDataTable, type DataTableFilterField } from "@repo/ds/data-table";
import type { PeopleDirectoryPersonDto } from "@repo/api";
import { Building2, Briefcase, Mail, MapPin, Workflow } from "lucide-react";
import { usePeopleDirectory } from "../api/use-people-directory";
import { Monogram } from "./workforce-ui";
import { LayoutSwitch } from "./people-layout";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const NO_COLUMNS: never[] = [];

function letterOf(name: string) {
  const first = name.trim().charAt(0).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  return LETTERS.includes(first) ? first : "#";
}

function Chip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex h-6 min-w-0 items-center gap-1 rounded-full bg-inlay px-2 type-meta text-muted-foreground [&_svg]:size-3 [&_svg]:shrink-0">
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** One person, portrait (D-28): face, name, job, unit and place, who they report to, and two quick actions. */
function PersonCard({ person, tag, mine }: { person: PeopleDirectoryPersonDto; tag?: string; mine?: boolean }) {
  const t = useTranslations("people.directory");
  return (
    <article
      className={cn(
        "relative grid grid-rows-[1fr_auto] overflow-hidden rounded-surface bg-card transition-colors hover:bg-card/80",
        mine && "ring-1 ring-inset ring-primary/40"
      )}
    >
      {tag ? (
        <span className="absolute end-3 top-3 rounded-full bg-primary-tint px-2 py-0.5 type-meta font-medium text-primary-ink">{tag}</span>
      ) : null}
      <div className="flex min-w-0 flex-col items-center px-4 pb-4 pt-6 text-center">
        <Monogram name={person.displayName} photoUrl={person.photoUrl} size="xl" className="mb-3" />
        <Link
          href={`/people/${person.employeeKey}`}
          className="max-w-full truncate type-label text-[0.9375rem] font-semibold outline-none after:absolute after:inset-0 focus-visible:underline"
        >
          {person.displayName}
        </Link>
        <p className="mt-0.5 max-w-full truncate type-meta text-muted-foreground">{person.jobTitle ?? t("noJob")}</p>
        <div className="mt-2.5 flex w-full min-w-0 justify-center gap-1.5">
          {person.unitName ? <Chip icon={<Building2 aria-hidden />}>{person.unitName}</Chip> : null}
          {person.place ? <Chip icon={<MapPin aria-hidden />}>{person.place}</Chip> : null}
        </div>
      </div>
      <div className="relative flex items-center gap-2 bg-inlay py-2 pe-2 ps-3.5">
        {person.manager ? (
          <>
            <Monogram name={person.manager.displayName} photoUrl={person.manager.photoUrl} size="xs" />
            <p className="min-w-0 flex-1 truncate type-meta text-muted-foreground">
              {t.rich("reportsTo", { name: person.manager.displayName, b: (chunks) => <b className="font-medium text-foreground">{chunks}</b> })}
            </p>
          </>
        ) : (
          <p className="min-w-0 flex-1 truncate type-meta text-muted-foreground">{t("leads")}</p>
        )}
        {person.workEmail ? (
          <Button asChild size="icon-sm" variant="ghost" className="relative z-10">
            <a href={`mailto:${person.workEmail}`} aria-label={t("write", { name: person.displayName })}>
              <Mail aria-hidden />
            </a>
          </Button>
        ) : null}
        <Button asChild size="icon-sm" variant="ghost" className="relative z-10">
          <Link href={`/org-chart?focus=${encodeURIComponent(person.employeeKey)}`} aria-label={t("onChart", { name: person.displayName })}>
            <Workflow aria-hidden />
          </Link>
        </Button>
      </div>
    </article>
  );
}

function CardGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{children}</div>;
}

function CardsSkeleton() {
  return (
    <CardGrid>
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="flex flex-col items-center gap-2 rounded-surface bg-card px-4 pb-12 pt-6">
          <Skeleton className="size-16 rounded-full" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </CardGrid>
  );
}

/** People as cards with an A–Z rail (D-28): your team first, then everyone by letter. */
export function PeopleDirectory({ canSwitch, header }: { canSwitch: boolean; header: (count: number | null) => ReactNode }) {
  const t = useTranslations("people.directory");
  const directory = usePeopleDirectory();
  const people = directory.data?.people;
  const viewerKey = directory.data?.viewerEmployeeKey ?? null;

  const options = useMemo(() => {
    const collect = (pick: (person: PeopleDirectoryPersonDto) => [string | null, string | null]) => {
      const seen = new Map<string, string>();
      for (const person of people ?? []) {
        const [value, label] = pick(person);
        if (value && label) seen.set(value, label);
      }
      return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    };
    return {
      unit: collect((person) => [person.unitId, person.unitName]),
      place: collect((person) => [person.placeId, person.place]),
      job: collect((person) => [person.jobId, person.jobTitle]),
    };
  }, [people]);

  const filters = useMemo<DataTableFilterField<PeopleDirectoryPersonDto>[]>(
    () => [
      { id: "unit", label: t("filters.team"), icon: Building2, type: "options", options: options.unit, value: (person) => person.unitId },
      { id: "place", label: t("filters.place"), icon: MapPin, type: "options", options: options.place, value: (person) => person.placeId },
      { id: "job", label: t("filters.job"), icon: Briefcase, type: "options", options: options.job, value: (person) => person.jobId },
    ],
    [t, options]
  );

  const model = useDataTable({
    data: people,
    columns: NO_COLUMNS,
    getRowId: (person) => person.employeeKey,
    search: (person) => [person.displayName, person.jobTitle, person.unitName, person.place, ...person.tags].filter(Boolean).join(" "),
    filters,
    pageSize: 100_000,
  });
  const shown = model.table.getRowModel().rows.map((row) => row.original);

  const me = people?.find((person) => person.employeeKey === viewerKey);
  const team = useMemo(() => {
    if (!me || !people) return [];
    const managerKey = me.manager?.employeeKey;
    const manager = managerKey ? people.find((person) => person.employeeKey === managerKey) : undefined;
    const peers = people.filter((person) => person !== me && managerKey && person.manager?.employeeKey === managerKey);
    const reports = people.filter((person) => person.manager?.employeeKey === me.employeeKey);
    return [...(manager ? [manager] : []), me, ...peers, ...reports];
  }, [me, people]);

  const groups = useMemo(() => {
    const byLetter = new Map<string, PeopleDirectoryPersonDto[]>();
    for (const person of shown) {
      const letter = letterOf(person.displayName);
      byLetter.set(letter, [...(byLetter.get(letter) ?? []), person]);
    }
    return [...byLetter].sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b)));
  }, [shown]);

  const [activeLetter, setActiveLetter] = useState<string | null>(null);
  useEffect(() => {
    const sections = groups.map(([letter]) => document.getElementById(`people-${letter}`)).filter((node): node is HTMLElement => Boolean(node));
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveLetter(visible.target.id.replace("people-", ""));
      },
      { rootMargin: "0px 0px -70% 0px" }
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [groups]);

  const tagFor = (person: PeopleDirectoryPersonDto) =>
    person.employeeKey === viewerKey ? t("tags.you")
      : me?.manager?.employeeKey === person.employeeKey ? t("tags.manager")
        : person.startingSoon ? t("tags.starting")
          : undefined;
  const has = new Set(groups.map(([letter]) => letter));
  const narrowed = model.isFiltered;

  return (
    <>
      {header(people?.length ?? null)}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <DataTableSearch model={model} placeholder={t("search")} className="max-w-xs" />
        <DataTableFilters model={model} />
        <span className="flex-1" />
        {canSwitch ? <LayoutSwitch value="cards" /> : null}
      </div>

      {directory.isLoading && !people ? (
        <CardsSkeleton />
      ) : directory.error && !people ? (
        <div className="flex flex-col items-center gap-3 rounded-surface bg-card py-14">
          <p className="type-body text-muted-foreground">{t("error")}</p>
          <Button variant="outline" size="sm" onClick={() => void directory.refetch()}>{t("retry")}</Button>
        </div>
      ) : (people?.length ?? 0) === 0 ? (
        <p className="rounded-surface bg-card py-14 text-center type-body text-muted-foreground">{t("empty")}</p>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-surface bg-card py-14">
          <p className="type-body text-muted-foreground">{t("noMatch")}</p>
          <Button variant="outline" size="sm" onClick={model.reset}>{t("clear")}</Button>
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_1.75rem] items-start gap-5">
          <div className="flex min-w-0 flex-col gap-8">
            {!narrowed && team.length > 1 ? (
              <section aria-labelledby="people-team">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 id="people-team" className="type-section-title">{t("yourTeam")}</h2>
                  {me?.manager ? <span className="type-meta text-muted-foreground">{t("teamOf", { name: me.manager.displayName })}</span> : null}
                </div>
                <CardGrid>
                  {team.map((person) => (
                    <PersonCard key={person.employeeKey} person={person} tag={tagFor(person)} mine={person.employeeKey === viewerKey} />
                  ))}
                </CardGrid>
              </section>
            ) : null}
            {groups.map(([letter, members]) => (
              <section key={letter} id={`people-${letter}`} aria-label={letter} className="scroll-mt-6">
                <div className="mb-3 flex items-baseline gap-3.5">
                  <span className="font-serif text-[1.625rem] font-medium leading-none">{letter}</span>
                  <span className="type-meta text-muted-foreground">{t("count", { count: members.length })}</span>
                </div>
                <CardGrid>
                  {members.map((person) => (
                    <PersonCard key={person.employeeKey} person={person} tag={person.startingSoon ? t("tags.starting") : undefined} />
                  ))}
                </CardGrid>
              </section>
            ))}
          </div>
          <nav aria-label={t("alphabet")} className="sticky top-5 grid justify-items-center gap-px">
            {LETTERS.map((letter) => (
              <a
                key={letter}
                href={has.has(letter) ? `#people-${letter}` : undefined}
                aria-disabled={!has.has(letter) || undefined}
                onClick={() => setActiveLetter(letter)}
                className={cn(
                  "grid h-[1.1875rem] w-[1.375rem] place-items-center rounded-nested text-[0.6875rem] font-semibold text-muted-foreground",
                  has.has(letter) ? "hover:text-foreground" : "pointer-events-none opacity-30",
                  activeLetter === letter && "bg-primary-tint text-primary-ink"
                )}
              >
                {letter}
              </a>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}

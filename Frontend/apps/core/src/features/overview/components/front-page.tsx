"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  createCoreReportsApi,
  createPlatformApiClient,
  type FrontPageDto,
} from "@repo/api";
import { useApiQuery, useTenantSummary } from "@repo/api/query";
import {
  canManageCoreEmployees,
  canViewCoreOrganization,
  canAccessCorePeople,
  useAuth,
  useViewAs,
} from "@repo/auth";
import { Button, Skeleton } from "@repo/ds";
import { Segmented } from "@repo/ds/choice";
import { PageContainer, Section } from "@repo/ds/shell";
import { useFormat } from "@repo/ds/lib/use-format";
import { OverviewContentSkeleton } from "@/shell/route-skeletons";
import {
  ArrowRight,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  ChevronDown,
  Plus,
  Users,
} from "lucide-react";
import { TimeBar } from "@/features/organization/components/time-bar";
import { UpcomingRow } from "@/features/people/components/worker-profile/overview-tab";
import {
  addDays,
  byLabel,
  dayNumber,
  departmentColor,
  departmentKey,
  departmentLead,
  frontEvents,
  groupPeople,
  OUTSIDE_DEPARTMENTS,
  peopleOn,
  yearBefore,
  type FrontEvent,
  type Grouping,
} from "../model/front-page";
import { GrowthView } from "./growth-view";
import { FrontFace, PeopleView } from "./people-view";

const BUILT_IN_LABELS = [
  "First name",
  "Last name",
  "Work email",
  "Phone",
  "Hire date",
  "Employment type",
  "Job",
  "Place",
  "Preferred name",
  "Personal email",
  "Date of birth",
  "Home address",
  "Emergency contact",
  "About me",
] as const;

export default function FrontPage() {
  const { user } = useAuth();
  const viewing = useViewAs();
  const t = useTranslations("overview.front");
  const company = useTenantSummary();
  const api = useMemo(
    () => createCoreReportsApi(createPlatformApiClient()),
    []
  );
  const query = useApiQuery(
    ["core-front-page", user?.tenantId, user?.userId],
    useCallback((signal) => api.frontPage(signal), [api])
  );
  return (
    <PageContainer width="wide" className="space-y-6 pb-10">
      <header className="flex items-center gap-4">
        <div
          className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-control bg-section type-panel-title"
          aria-hidden
        >
          {company.data?.logoUrl ? (
            <Image
              src={company.data.logoUrl}
              alt=""
              width={56}
              height={56}
              unoptimized
              className="size-full object-contain"
            />
          ) : (
            (company.data?.name?.charAt(0) ?? "")
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="type-page-title">
            {company.data?.name ?? t("title")}
          </h1>
          {query.data ? (
            <CompanyMeta data={query.data} />
          ) : (
            <Skeleton className="mt-2 h-4 w-64" />
          )}
        </div>
        {canManageCoreEmployees(user) && !viewing ? (
          <Button asChild>
            <Link href="/people/add">
              <Plus />
              {t("addPeople")}
            </Link>
          </Button>
        ) : null}
      </header>
      {query.isLoading && !query.data ? (
        <OverviewContentSkeleton />
      ) : query.error ? (
        <Section title={t("unavailable")}>
          <p role="alert" className="type-body text-muted-foreground">
            {t("loadFailed")}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => void query.refetch()}
          >
            {t("retry")}
          </Button>
        </Section>
      ) : query.data ? (
        <FrontPageContent data={query.data} />
      ) : null}
    </PageContainer>
  );
}

function CompanyMeta({ data }: { data: FrontPageDto }) {
  const t = useTranslations("overview.front");
  const format = useFormat();
  const people = peopleOn(data.people, data.today);
  const departments = new Set(
    people.filter((person) => person.department !== null).map(departmentKey)
  ).size;
  const places = new Set(people.map((p) => p.place).filter(Boolean)).size;
  return (
    <p className="mt-1 type-body text-muted-foreground">
      {[
        data.teamOnly ? t("yourTeam") : null,
        t(`level.${data.unitLevel}.count`, { count: departments }),
        data.fields.includes("place") ? t("places", { count: places }) : null,
        t("since", {
          date: format.parts(data.firstDate, {
            month: "long",
            year: "numeric",
          }),
        }),
      ]
        .filter(Boolean)
        .join(" · ")}
    </p>
  );
}

export function FrontPageContent({ data }: { data: FrontPageDto }) {
  const t = useTranslations("overview.front");
  const locale = useLocale();
  const format = useFormat();
  const { user } = useAuth();
  const [view, setView] = useState<"growth" | "people">("growth");
  const [by, setBy] = useState<Grouping>("department");
  const [date, setDate] = useState(data.today);
  const [replaying, setReplaying] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const stop = () => {
    cancelAnimationFrame(frame.current);
    setReplaying(false);
  };
  const selectDate = (next: string) => {
    stop();
    setDate(next);
  };
  const replay = () => {
    if (replaying) {
      stop();
      return;
    }
    const start = performance.now();
    const first = dayNumber(data.firstDate),
      today = dayNumber(data.today);
    setReplaying(true);
    setDate(data.firstDate);
    let lastFrame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / 4600);
      if (now - lastFrame >= 70 || progress === 1) {
        lastFrame = now;
        setDate(
          addDays(
            data.firstDate,
            Math.round((today - first) * (1 - Math.pow(1 - progress, 2)))
          )
        );
      }
      if (progress < 1) frame.current = requestAnimationFrame(step);
      else setReplaying(false);
    };
    frame.current = requestAnimationFrame(step);
  };
  const people = useMemo(
    () => peopleOn(data.people, date),
    [data.people, date]
  );
  const events = useMemo(() => frontEvents(data.people), [data.people]);
  const allGroups = useMemo(() => {
    const groups = new Map<string, { key: string; label: string | null }>();
    data.people.forEach((person) =>
      person.spans.forEach((span) =>
        groups.set(departmentKey(span), {
          key: departmentKey(span),
          label: span.department,
        })
      )
    );
    return [...groups.values()].sort(byLabel);
  }, [data.people]);
  const departments = groupPeople(people, "department", date);
  const before = peopleOn(data.people, yearBefore(date));
  const upcoming = events.filter(
    (event) => event.date >= data.today && event.date <= addDays(data.today, 30)
  );
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const latest = events
    .filter((event) => event.kind === "joins" && event.date <= date)
    .at(-1);
  const canOpenUnit = canViewCoreOrganization(user);
  const managers = new Map(
    peopleOn(data.people, data.today).map((p) => [p.employeeKey, p])
  );
  const canOpenPeople = canAccessCorePeople(user);
  const eventTitle = (event: FrontEvent) =>
    t(event.kind, {
      name: event.person.name,
      department:
        event.person.department ??
        event.person.parent ??
        t(`level.${data.unitLevel}.outside`),
      job: event.person.job ?? "",
      place: event.person.place ?? t("unassigned"),
    });
  const recordLabel = (label: string) => {
    const builtIn = BUILT_IN_LABELS.find((key) => key === label);
    return builtIn ? t(`recordLabels.${builtIn}`) : label;
  };
  const missing = [
    ...data.recordsToComplete.reduce((groups, person) => {
      person.missing.forEach((label) =>
        groups.set(label, [...(groups.get(label) ?? []), person])
      );
      return groups;
    }, new Map<string, FrontPageDto["recordsToComplete"]>()),
  ].sort((a, b) => b[1].length - a[1].length);

  return (
    <>
      <section
        className="grid gap-5 rounded-surface bg-section px-7 pt-6 pb-3"
        aria-label={t("history")}
      >
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="grid gap-1.5">
            <p className="flex items-baseline gap-2.5">
              <span className="type-metric-lg" data-testid="front-count">
                {number(people.length)}
              </span>
              <span className="type-panel-title text-muted-foreground">
                {t("peopleNoun")}
              </span>
            </p>
            <p className="type-meta text-muted-foreground">
              {date === data.today
                ? t("today")
                : date > data.today
                  ? t("planned", { date: format.date(date) })
                  : t("onDate", {
                      date: format.date(date, { year: "always" }),
                    })}
              {latest
                ? ` · ${t("lastJoined", { date: format.date(latest.date), name: latest.person.name })}`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {view === "people" ? (
              <Segmented
                label={t("groupBy")}
                value={by}
                onChange={setBy}
                options={[
                  { value: "department", label: t(`level.${data.unitLevel}.label`) },
                  ...(data.fields.includes("place")
                    ? [{ value: "place" as const, label: t("place") }]
                    : []),
                  ...(data.fields.includes("first-day")
                    ? [{ value: "time" as const, label: t("timeHere") }]
                    : []),
                ]}
              />
            ) : null}
            <Segmented
              label={t("view")}
              value={view}
              onChange={(next) => {
                stop();
                setView(next);
              }}
              options={[
                {
                  value: "growth",
                  label: t("growth"),
                  icon: <ChartNoAxesCombined />,
                },
                { value: "people", label: t("people"), icon: <Users /> },
              ]}
            />
          </div>
        </div>
        {view === "growth" ? (
          <GrowthView
            data={data}
            date={date}
            replaying={replaying}
            highlighted={highlighted}
            groups={allGroups}
            onDate={selectDate}
          />
        ) : (
          <PeopleView people={people} by={by} date={date} unitLevel={data.unitLevel} />
        )}
        <TimeBar
          embedded
          span={{ lo: data.firstDate, today: data.today, hi: data.lastDate }}
          date={date}
          planned={events
            .filter((event) => event.date > data.today)
            .map((event) => ({ day: event.date, title: eventTitle(event) }))}
          people={null}
          replaying={replaying}
          onDate={selectDate}
          onReplay={replay}
        />
      </section>

      {departments.length ? (
        <div
          className="grid items-start gap-3.5 md:grid-cols-2 xl:grid-cols-3"
          aria-label={t(`level.${data.unitLevel}.cards`)}
        >
          {departments.map((group) => {
            const outside = group.key === OUTSIDE_DEPARTMENTS;
            const lead = outside ? undefined : departmentLead(group.people);
            const first = group.people[0]!;
            const delta =
              group.people.length -
              before.filter((person) => departmentKey(person) === group.key)
                .length;
            const next = events.find(
              (event) =>
                event.date > date &&
                event.date <= addDays(date, 30) &&
                departmentKey(event.person) === group.key
            );
            const members = group.people.filter(
              (person) => person.employeeKey !== lead?.employeeKey
            );
            const hue = departmentColor(
              allGroups.findIndex((g) => g.key === group.key),
              group.key
            );
            const subtitle = outside
              ? [...new Set(group.people.map((p) => p.parent).filter(Boolean))]
                  .sort()
                  .join(" · ")
              : (first.parent ?? (data.teamOnly ? t("yourTeam") : ""));
            return (
              <article
                key={group.key}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 rounded-surface bg-card px-5 pt-5"
                onMouseEnter={() => setHighlighted(group.key)}
                onMouseLeave={() => setHighlighted(null)}
                onFocus={() => setHighlighted(group.key)}
                onBlur={() => setHighlighted(null)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="flex items-start gap-2 type-section-title">
                      <i
                        aria-hidden
                        className="mt-1.5 size-2.5 shrink-0 rounded-detail"
                        style={{ background: hue }}
                      />
                      {canOpenUnit && first.departmentId ? (
                        <Link
                          href={`/organization/units/${first.departmentId}?asOf=${date}`}
                          className="hover:underline"
                        >
                          {group.label ?? t(`level.${data.unitLevel}.outside`)}
                        </Link>
                      ) : (
                        (group.label ?? t(`level.${data.unitLevel}.outside`))
                      )}
                    </h2>
                    <p
                      className="mt-1 truncate type-meta text-muted-foreground"
                      title={subtitle}
                    >
                      {subtitle}
                    </p>
                  </div>
                  <div className="shrink-0 text-end">
                    <p className="type-metric-md">
                      {number(group.people.length)}
                    </p>
                    <p className="mt-1 type-meta text-muted-foreground">
                      {delta
                        ? t("yearChange", {
                            count: delta,
                            change: `${delta > 0 ? "+" : ""}${number(delta)}`,
                          })
                        : t("noChange")}
                    </p>
                  </div>
                </div>
                {lead ? (
                  <div className="flex min-w-0 items-center gap-2.5">
                    <FrontFace person={lead} size="md" />
                    <div className="min-w-0">
                      <p className="truncate type-label">{lead.name}</p>
                      <p className="truncate type-meta text-muted-foreground">
                        {data.teamOnly
                          ? t("inScope")
                          : t("leads", {
                              department: group.label ?? "",
                            })}
                      </p>
                    </div>
                  </div>
                ) : null}
                <div className="flex h-7 items-center">
                  <div className="flex -space-x-1.5 rtl:space-x-reverse">
                    {members.slice(0, 6).map((person) => (
                      <span
                        key={person.employeeKey}
                        title={person.name}
                        className="rounded-full ring-2 ring-card"
                      >
                        <FrontFace person={person} size="xs" />
                      </span>
                    ))}
                  </div>
                  {members.length > 6 ? (
                    <span className="ms-2 type-meta-strong text-muted-foreground">
                      +{number(members.length - 6)}
                    </span>
                  ) : null}
                </div>
                <div className="flex min-h-14 items-center gap-2.5 border-t border-border py-3">
                  <span className="type-body text-muted-foreground">
                    {next ? eventTitle(next) : t("nothingPlanned")}
                    {next ? (
                      <span className="mt-0.5 block type-meta">
                        {format.date(next.date)}
                      </span>
                    ) : null}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Section title={t(`level.${data.unitLevel}.cards`)}>
          <p className="type-body text-muted-foreground">{t("noPeople")}</p>
        </Section>
      )}

      <Section
        title={t("next30")}
        flush={upcoming.length > 0}
        action={
          canOpenUnit ? (
            <Link
              href="/organization"
              className="inline-flex items-center gap-1.5 type-label text-primary-ink"
            >
              {t("plannedChanges")}
              <ArrowRight className="size-3.5 rtl:rotate-180" />
            </Link>
          ) : undefined
        }
      >
        {upcoming.length ? (
          <ul className="divide-y divide-border">
            {upcoming.map((event) => (
              <UpcomingRow
                key={`${event.date}-${event.kind}-${event.person.employeeKey}`}
                item={{
                  key: `${event.date}-${event.person.employeeKey}`,
                  at: event.date,
                  when: {
                    top: format.parts(event.date, { weekday: "short" }),
                    main: format.parts(event.date, { day: "numeric" }),
                  },
                  title: eventTitle(event),
                  meta: [
                    event.person.job,
                    event.person.department ?? event.person.parent,
                  ]
                    .filter(Boolean)
                    .join(" · "),
                  source: null,
                  href: canOpenPeople
                    ? `/core/people/${event.person.employeeKey}`
                    : undefined,
                  face: <FrontFace person={event.person} size="sm" />,
                }}
              />
            ))}
          </ul>
        ) : (
          <p className="type-body text-muted-foreground">
            {t("nothingPlanned")}
          </p>
        )}
      </Section>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Section
          title={t("records")}
          meta={t("count", { count: data.recordsToComplete.length })}
          flush={missing.length > 0}
        >
          {missing.length ? (
            <ul className="divide-y divide-border">
              {missing.map(([label, records]) => (
                <li key={label}>
                  <details className="group/records">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                      <span>
                        <span className="block type-label">
                          {recordLabel(label)}
                        </span>
                        <span className="block type-meta text-muted-foreground">
                          {t("count", { count: records.length })}
                        </span>
                      </span>
                      <ChevronDown className="size-4 text-muted-foreground transition-transform group-open/records:rotate-180" />
                    </summary>
                    <ul className="mx-5 mb-4 grid gap-2 border-t border-border pt-3">
                      {records.map((person) => (
                        <li
                          key={person.employeeKey}
                          className="flex items-center justify-between gap-3 type-body"
                        >
                          <span className="truncate">{person.displayName}</span>
                          {canOpenPeople ? (
                            <Link
                              href={`/people/${person.employeeKey}?tab=personal`}
                              className="shrink-0 type-meta text-primary-ink"
                            >
                              {t("openRecord")}
                            </Link>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          ) : (
            <p className="type-body text-muted-foreground">
              {t("recordsComplete")}
            </p>
          )}
        </Section>
        <Section
          title={t("openRoles")}
          meta={t("rolesCount", { count: data.openRoles.length })}
          flush={data.openRoles.length > 0}
        >
          {data.openRoles.length ? (
            <ul className="divide-y divide-border">
              {data.openRoles.map((role) => (
                <li key={role.id} className="flex items-center gap-3 px-5 py-4">
                  {managers.get(role.managerKey ?? "") ? (
                    <FrontFace
                      person={managers.get(role.managerKey ?? "")!}
                      size="sm"
                    />
                  ) : (
                    <BriefcaseBusiness className="size-5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate type-label">
                      {role.job ?? t("openRole")}
                    </p>
                    <p className="truncate type-meta text-muted-foreground">
                      {[
                        role.unit,
                        managers.get(role.managerKey ?? "")
                          ? t("hiringFor", {
                              name: managers.get(role.managerKey ?? "")!.name,
                            })
                          : null,
                        role.place,
                        role.targetStartDate
                          ? t("from", {
                              date: format.date(role.targetStartDate),
                            })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="type-body text-muted-foreground">{t("noRoles")}</p>
          )}
        </Section>
      </div>
    </>
  );
}

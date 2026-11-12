"use client";

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton } from "@repo/ds";
import { CalendarDays } from "@repo/ds/icons";
import { useFormat } from "@repo/ds/lib/use-format";
import { Section } from "@repo/ds/shell";
import { createCoreReportsApi, createPlatformApiClient, type FrontPageDto } from "@repo/api";
import { useApiQuery } from "@repo/api/query";
import { useAuth } from "@repo/auth";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { frontEvents, groupPeople, growthMonths, peopleOn, type FrontPerson } from "../overview/model/front-page";
import { Bar, FigureRow, LineChart, PairedColumns, THIS_YEAR, niceMax } from "./charts";
import { ChartCard, InsightsFrame, PeopleSheet, type SheetPerson } from "./insights-frame";

const TENURE = ["underOne", "oneToThree", "threeToFive", "fivePlus"] as const;

/** A period on People: today, or a past year as it stood on its last day. */
export function periodEnd(data: FrontPageDto, period: string): string {
  if (period === "today") return data.today;
  const end = `${period}-12-31`;
  return end < data.today ? end : data.today;
}

/** The last twelve quarters up to a day, with who joined in each. */
export function joinersByQuarter(data: FrontPageDto, end: string) {
  const joins = frontEvents(data.people).filter((e) => e.kind === "joins" && e.date <= end);
  const last = new Date(`${end}T12:00:00Z`);
  const quarters: { key: string; year: number; quarter: number; people: FrontPerson[] }[] = [];
  for (let i = 11; i >= 0; i--) {
    const index = last.getUTCFullYear() * 4 + Math.floor(last.getUTCMonth() / 3) - i;
    const year = Math.floor(index / 4);
    const quarter = (index % 4) + 1;
    const from = `${year}-${String((quarter - 1) * 3 + 1).padStart(2, "0")}-01`;
    const toIndex = index + 1;
    const to = `${Math.floor(toIndex / 4)}-${String((toIndex % 4) * 3 + 1).padStart(2, "0")}-01`;
    quarters.push({ key: from, year, quarter, people: joins.filter((e) => e.date >= from && e.date < to).map((e) => e.person) });
  }
  return quarters;
}

export function PeopleInsights() {
  const t = useTranslations("insights.people");
  const { user } = useAuth();
  const api = useMemo(() => createCoreReportsApi(createPlatformApiClient()), []);
  const query = useApiQuery(
    ["core-front-page", user?.tenantId, user?.userId],
    useCallback((signal) => api.frontPage(signal), [api])
  );
  const [period, setPeriod] = useState("today");
  const years = useMemo(() => {
    if (!query.data) return [];
    const first = Number(query.data.firstDate.slice(0, 4));
    const last = Number(query.data.today.slice(0, 4)) - 1;
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => String(last - i));
  }, [query.data]);

  const controls = (
    <Select value={period} onValueChange={setPeriod}>
      <SelectTrigger className="h-9 w-auto min-w-36 gap-2" aria-label={t("period")}>
        <CalendarDays aria-hidden className="size-4 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="today">{t("today")}</SelectItem>
        {years.map((year) => (
          <SelectItem key={year} value={year}>
            {t("endOf", { year })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <InsightsFrame tab="people" controls={controls}>
      {query.isLoading && !query.data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-72 rounded-surface" />
          ))}
        </div>
      ) : query.error ? (
        <Section title={t("unavailable")}>
          <div className="px-5 pb-5">
            <p role="alert" className="type-body text-muted-foreground">
              {t("loadFailed")}
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => void query.refetch()}>
              {t("retry")}
            </Button>
          </div>
        </Section>
      ) : query.data ? (
        <PeopleFigures data={query.data} end={periodEnd(query.data, period)} />
      ) : null}
    </InsightsFrame>
  );
}

function PeopleFigures({ data, end }: { data: FrontPageDto; end: string }) {
  const t = useTranslations("insights.people");
  const tTime = useTranslations("overview.front.tenure");
  const format = useFormat();
  const [open, setOpen] = useState<{ title: string; people: FrontPerson[] } | null>(null);
  const show = (title: string, people: FrontPerson[]) => setOpen({ title, people });

  const here = useMemo(() => peopleOn(data.people, end), [data.people, end]);
  const months = useMemo(() => growthMonths(data).filter((m) => m.date <= end), [data, end]);
  const departments = useMemo(() => groupPeople(here, "department", end), [here, end]);
  const tenure = useMemo(() => groupPeople(here, "time", end).filter((g) => g.key !== "unknown"), [here, end]);
  const quarters = useMemo(() => joinersByQuarter(data, end), [data, end]);

  const headMax = niceMax(Math.max(...months.map((m) => m.people.length), 1));
  const firstMonth = months[0]?.date ?? end;
  const dayOf = (date: string) => (Date.parse(date) - Date.parse(firstMonth)) / 86400000;
  const span = Math.max(dayOf(end), 1);
  const startYear = Number(firstMonth.slice(0, 4));
  const endYear = Number(end.slice(0, 4));
  const step = Math.max(1, Math.ceil((endYear - startYear) / 7));
  const yearTicks = [];
  for (let year = startYear + 1; year <= endYear; year += step) yearTicks.push({ x: dayOf(`${year}-01-01`), label: String(year) });
  const deptMax = Math.max(...departments.map((d) => d.people.length), 1);
  const tenureMax = Math.max(...tenure.map((d) => d.people.length), 1);
  const joinMax = niceMax(Math.max(...quarters.map((q) => q.people.length), 1));
  const lastJoin = frontEvents(data.people).filter((e) => e.kind === "joins" && e.date <= end).at(-1)?.date;
  const quietSince = quarters.slice(-2).every((q) => q.people.length === 0) && lastJoin;

  const sheetPeople: SheetPerson[] = (open?.people ?? [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ key: p.employeeKey, name: p.name, sub: [p.job, p.department].filter(Boolean).join(" · ") || null, href: `/core/people/${encodeURIComponent(p.employeeKey)}` }));

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <ChartCard
          title={t("headcount")}
          aside={
            <button type="button" onClick={() => show(t("headcount"), here)} className="ms-auto flex items-baseline gap-2 rounded-inset outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
              <span className="type-page-title tabular-nums">{here.length}</span>
              <span className="type-caption text-muted-foreground">{end === data.today ? t("today").toLowerCase() : format.date(end)}</span>
            </button>
          }
        >
          <LineChart
            label={t("headcount")}
            current={months.map((m) => ({ x: dayOf(m.date), y: m.people.length }))}
            xMax={span}
            yMax={headMax}
            yTicks={[0, headMax / 2, headMax]}
            xTicks={yearTicks}
          />
        </ChartCard>
        <ChartCard title={t("byDepartment")}>
          <div className="flex flex-col gap-1">
            {departments.map((group) => (
              <FigureRow
                key={group.key}
                columns="minmax(120px, 170px) minmax(0, 1fr) 40px"
                name={group.label ?? t("noDepartment")}
                chart={<Bar share={(group.people.length / deptMax) * 100} />}
                figure={group.people.length}
                onOpen={() => show(group.label ?? t("noDepartment"), group.people)}
              />
            ))}
          </div>
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title={t("joined")}
          aside={quietSince ? <span className="ms-auto type-caption text-muted-foreground">{t("nobodySince", { date: format.parts(lastJoin, { month: "short", year: "numeric" }) })}</span> : null}
        >
          <PairedColumns
            label={t("joined")}
            max={joinMax}
            height={150}
            columns={quarters.map((q) => ({
              key: q.key,
              label: `Q${q.quarter} ${String(q.year).slice(2)}`,
              current: q.people.length,
              tip: t("joinedTip", { count: q.people.length }),
              onOpen: q.people.length ? () => show(t("joinedIn", { quarter: q.quarter, year: q.year }), q.people) : undefined,
            }))}
          />
        </ChartCard>
        <ChartCard title={t("timeAtCompany")}>
          <div className="flex flex-col gap-1">
            {TENURE.map((key) => {
              const group = tenure.find((g) => g.key === key);
              const count = group?.people.length ?? 0;
              return (
                <FigureRow
                  key={key}
                  columns="minmax(120px, 150px) minmax(0, 1fr) 40px"
                  name={tTime(key)}
                  chart={<Bar share={(count / tenureMax) * 100} color={THIS_YEAR} />}
                  figure={count}
                  onOpen={count ? () => show(tTime(key), group!.people) : undefined}
                />
              );
            })}
          </div>
        </ChartCard>
      </div>
      <PeopleSheet
        open={open !== null}
        onOpenChange={(next) => (next ? null : setOpen(null))}
        title={open?.title ?? ""}
        people={sheetPeople}
        total={sheetPeople.length}
      />
    </>
  );
}


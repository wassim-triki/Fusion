"use client";

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton } from "@repo/ds";
import { Building2, CalendarDays, Check, Clock } from "@repo/ds/icons";
import { useFormat } from "@repo/ds/lib/use-format";
import { cn } from "@repo/ds/lib/utils";
import { Section } from "@repo/ds/shell";
import {
  ApiError,
  createPerformanceApi,
  createPlatformApiClient,
  performanceQueryKeys,
  type InsightsDto,
  type InsightsEndDto,
  type InsightsGoalsEndDto,
  type InsightsMetric,
  type InsightsPeopleQuery,
  type InsightsTenureKey,
  type InsightsTrendDto,
  type InsightsUnitFigureDto,
} from "@repo/api";
import { useApiQuery } from "@repo/api/query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  Bar, Dumbbell, FigureRow, LAST_YEAR, LineChart, PairedColumns, ShareAxis, YearKeys, niceMax, shareRange,
} from "./charts";
import { ChartCard, InsightsFrame, PeopleSheet } from "./insights-frame";

const TENURE: InsightsTenureKey[] = ["under-1", "1-2", "2-4", "4-6", "over-6"];
const ENDINGS = ["met", "partly", "notMet", "carried"] as const;
const ENDING_COLOR: Record<(typeof ENDINGS)[number], string> = {
  met: "var(--success)",
  partly: "var(--chart-1)",
  notMet: "var(--destructive)",
  carried: "stripes",
};
const ENDING_METRIC: Record<(typeof ENDINGS)[number], InsightsMetric> = { met: "met", partly: "partly", notMet: "not-met", carried: "carried" };
const DEPT_COLUMNS = "minmax(150px, 200px) minmax(0, 1fr) 72px";

type Opened = { title: string; query: InsightsPeopleQuery };

export function PerformanceInsights() {
  const t = useTranslations("insights.performance");
  const api = useMemo(() => createPerformanceApi(createPlatformApiClient()), []);
  const [cycleId, setCycleId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const query = useApiQuery(
    performanceQueryKeys.insights(cycleId, unitId),
    (signal) => api.getInsights(cycleId, unitId, signal),
    { placeholderData: (previous) => previous }
  );
  const data = query.data;
  const noYear = query.error instanceof ApiError && query.error.status === 404;

  const controls = data ? (
    <>
      <Select value={unitId ?? "all"} onValueChange={(v) => setUnitId(v === "all" ? null : v)}>
        <SelectTrigger className="h-9 w-auto min-w-40 gap-2" aria-label={t("scope")}>
          <Building2 aria-hidden className="size-4 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("everyone")}</SelectItem>
          {data.units.map((unit) => (
            <SelectItem key={unit.unitId} value={unit.unitId}>
              <span style={{ paddingInlineStart: unit.depth * 12 }}>{unit.name}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={data.cycleId} onValueChange={(v) => setCycleId(v)}>
        <SelectTrigger className="h-9 w-auto min-w-44 gap-2" aria-label={t("year")}>
          <CalendarDays aria-hidden className="size-4 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {data.years.map((year) => (
            <SelectItem key={year.cycleId} value={year.cycleId}>
              {year.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="type-caption text-muted-foreground">
        {data.ended ? (data.lastYear ? t("against", { year: data.lastYear.name }) : t("ended")) : t("soFar")}
      </span>
    </>
  ) : null;

  return (
    <InsightsFrame tab="performance" controls={controls}>
      {query.isLoading && !data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-72 rounded-surface" />
          ))}
        </div>
      ) : noYear ? (
        <Section title={t("noYear.title")}>
          <div className="px-5 pb-5">
            <p className="type-body text-muted-foreground">{t("noYear.body")}</p>
            <Button asChild className="mt-4">
              <a href="/performance/year/setup">{t("noYear.action")}</a>
            </Button>
          </div>
        </Section>
      ) : query.error && !data ? (
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
      ) : data ? (
        <YearFigures data={data} unitId={unitId} refetch={() => void query.refetch()} />
      ) : null}
    </InsightsFrame>
  );
}

function YearFigures({ data, unitId, refetch }: { data: InsightsDto; unitId: string | null; refetch: () => void }) {
  const t = useTranslations("insights.performance");
  const [opened, setOpened] = useState<Opened | null>(null);
  const open = (title: string, query: InsightsPeopleQuery) => setOpened({ title, query: { ...query, unitId } });
  return (
    <>
      {data.end ? <Ended data={data} end={data.end} open={open} /> : <During data={data} open={open} refetch={refetch} />}
      <FigurePeople cycleId={data.cycleId} opened={opened} onClose={() => setOpened(null)} />
      {data.trends.length === 0 && !data.end ? (
        <p className="type-body text-muted-foreground">{t("notStarted")}</p>
      ) : null}
    </>
  );
}

// ── During the year (D-90) ──

function During({ data, open, refetch }: { data: InsightsDto; open: (title: string, query: InsightsPeopleQuery) => void; refetch: () => void }) {
  const t = useTranslations("insights.performance");
  const last = data.lastYear?.name ?? null;
  const range = shareRange(data.onTrackByDepartment.flatMap((d) => [d.share, ...(d.lastShare === null ? [] : [d.lastShare])]));
  return (
    <>
      {data.trends.length ? (
        <ChartCard title={t("againstLast")} aside={<YearKeys current={data.name} previous={last ? t("sameDays", { year: last }) : null} />}>
          <div className="flex flex-col divide-y divide-border">
            {data.trends.map((trend) => (
              <TrendRow key={trend.key} data={data} trend={trend} open={open} refetch={refetch} />
            ))}
          </div>
        </ChartCard>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={t("onTrackByDepartment")} aside={<YearKeys mark="dot" current={t("today")} previous={last ? t("sameDay", { year: last }) : null} />}>
          {data.onTrackByDepartment.length ? (
            <Departments rows={data.onTrackByDepartment} range={range} onOpen={(d) => open(d.name, { metric: "on-track", departmentId: d.unitId })} />
          ) : (
            <p className="type-body text-muted-foreground">{t("noGoals")}</p>
          )}
        </ChartCard>
        <ChartCard title={t("strongByTenure", { level: t("strongFallback") })} aside={<span className="ms-auto type-caption text-muted-foreground">{t("afterReviews")}</span>}>
          <div className="flex flex-col gap-1">
            {TENURE.map((key) => (
              <FigureRow key={key} columns="minmax(120px, 150px) minmax(0, 1fr) 48px" name={t(`tenure.${key}`)} chart={<Bar share={0} />} figure="" />
            ))}
          </div>
        </ChartCard>
      </div>
    </>
  );
}

function TrendRow({ data, trend, open, refetch }: {
  data: InsightsDto;
  trend: InsightsTrendDto;
  open: (title: string, query: InsightsPeopleQuery) => void;
  refetch: () => void;
}) {
  const t = useTranslations("insights.performance.trends");
  const [expanded, setExpanded] = useState(false);
  const percent = trend.key === "on-track" || trend.key === "supporting";
  const figure = percent ? `${trend.now}%` : String(trend.now);
  const diff = trend.lastNow === null ? null : trend.now - trend.lastNow;
  const goodWhenUp = percent;
  const good = diff === null || diff === 0 ? null : goodWhenUp ? diff > 0 : diff < 0;
  const count = trend.of !== null && percent ? Math.round((trend.now * trend.of) / 100) : null;
  const sub =
    trend.key === "at-risk"
      ? t("atRiskSub", { atRisk: trend.atRisk ?? 0, offTrack: trend.offTrack ?? 0 })
      : trend.key === "not-updated"
        ? t("ofPeople", { count: trend.of ?? 0 })
        : t("ofGoals", { count: count ?? 0, total: trend.of ?? 0 });
  const start = Date.parse(data.startDate);
  const x = (date: string) => (Date.parse(date) - start) / 86400000;
  const max = Math.max(...trend.this.map((p) => p.value), ...(trend.last ?? []).map((p) => p.value), 1);
  const yMax = percent ? 100 : niceMax(max);
  const metric: InsightsMetric = trend.key;
  const managers = trend.key === "not-updated" ? data.notUpdatedByManager : [];
  return (
    <div>
      <button
        type="button"
        onClick={() => (managers.length ? setExpanded((v) => !v) : open(t(trend.key), { metric }))}
        aria-expanded={managers.length ? expanded : undefined}
        className="grid w-full grid-cols-[minmax(180px,240px)_minmax(0,1fr)_minmax(120px,160px)] items-center gap-6 rounded-inset px-2 py-3 text-start outline-none hover:bg-inlay/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex flex-col gap-0.5">
          <span className="type-label font-semibold">{t(trend.key)}</span>
          <span className="type-caption text-muted-foreground">{sub}</span>
        </span>
        <span className="h-14">
          <LineChart
            label={t(trend.key)}
            height={48}
            current={trend.this.map((p) => ({ x: x(p.date), y: p.value }))}
            previous={trend.last?.map((p) => ({ x: x(p.date), y: p.value }))}
            xMax={Math.max((Date.parse(data.endDate) - start) / 86400000, 1)}
            yMax={yMax}
            yTicks={[]}
            xTicks={[]}
          />
        </span>
        <span className="flex flex-col items-end">
          <span className="type-page-title tabular-nums">{figure}</span>
          {diff !== null ? (
            <span className={cn("type-caption font-semibold", good === null ? "text-muted-foreground" : good ? "text-success" : "text-destructive")}>
              {diff === 0
                ? t("same", { year: data.lastYear?.name ?? "" })
                : percent
                  ? t(diff > 0 ? "pointsMore" : "pointsFewer", { count: Math.abs(diff) })
                  : t(diff > 0 ? "more" : "fewer", { count: Math.abs(diff) })}
            </span>
          ) : null}
        </span>
      </button>
      {expanded ? <Nudges data={data} open={open} refetch={refetch} /> : null}
    </div>
  );
}

function Nudges({ data, open, refetch }: { data: InsightsDto; open: (title: string, query: InsightsPeopleQuery) => void; refetch: () => void }) {
  const t = useTranslations("insights.performance.nudges");
  const api = useMemo(() => createPerformanceApi(createPlatformApiClient()), []);
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const nudge = async (key: string, ids: string[]) => {
    setBusy(key);
    try {
      await api.nudge(data.cycleId, { employeeIds: ids });
      setSent((s) => ({ ...s, [key]: true }));
      refetch();
    } finally {
      setBusy(null);
    }
  };
  const all = data.notUpdatedByManager.flatMap((m) => m.notUpdated.map((p) => p.employeeId));
  return (
    <div className="mb-3 ms-2 flex flex-col gap-1 rounded-inset bg-inlay p-3">
      {data.notUpdatedByManager.map((manager) => (
        <div key={manager.managerId} className="flex items-center gap-4 px-1 py-1.5">
          <button
            type="button"
            onClick={() => open(t("theirPeople", { name: manager.name }), { metric: "not-updated", managerId: manager.managerId })}
            className="flex min-w-0 flex-1 flex-col text-start outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="type-label font-semibold">{manager.name}</span>
            <span className="truncate type-caption text-muted-foreground">
              {t("names", { names: manager.notUpdated.slice(0, 3).map((p) => p.name.split(" ")[0]).join(", "), more: Math.max(0, manager.notUpdated.length - 3) })}
            </span>
          </button>
          <span className="type-caption tabular-nums text-muted-foreground">{t("ofTheirs", { count: manager.notUpdated.length, total: manager.people })}</span>
          {sent[manager.managerId] || sent.all ? (
            <span className="flex items-center gap-1 type-caption font-semibold text-success">
              <Check aria-hidden className="size-3.5" />
              {t("nudged")}
            </span>
          ) : (
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void nudge(manager.managerId, manager.notUpdated.map((p) => p.employeeId))}>
              {t("nudge")}
            </Button>
          )}
        </div>
      ))}
      {data.notUpdatedByManager.length > 1 && !sent.all ? (
        <div className="flex justify-end pt-1">
          <Button size="sm" disabled={busy !== null} onClick={() => void nudge("all", all)}>
            {t("nudgeAll", { count: all.length })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Departments({ rows, range, onOpen }: { rows: InsightsUnitFigureDto[]; range: { lo: number; hi: number }; onOpen: (row: InsightsUnitFigureDto) => void }) {
  const t = useTranslations("insights.performance");
  return (
    <div className="flex flex-col gap-1">
      <ShareAxis lo={range.lo} hi={range.hi} columns={DEPT_COLUMNS} />
      {rows.map((row) => {
        const diff = row.lastShare === null ? null : row.share - row.lastShare;
        return (
          <FigureRow
            key={row.unitId ?? "none"}
            columns={DEPT_COLUMNS}
            name={row.name}
            sub={t("people", { count: row.people })}
            chart={<Dumbbell current={row.share} previous={row.lastShare} lo={range.lo} hi={range.hi} />}
            figure={
              <span className="flex flex-col items-end leading-tight">
                <span>{row.share}%</span>
                {diff !== null && diff !== 0 ? (
                  <span className={cn("type-caption", diff > 0 ? "text-success" : "text-destructive")}>
                    {diff > 0 ? "+" : "−"}
                    {Math.abs(diff)}
                  </span>
                ) : null}
              </span>
            }
            onOpen={() => onOpen(row)}
          />
        );
      })}
    </div>
  );
}

// ── The year's end (D-89) ──

function Ended({ data, end, open }: { data: InsightsDto; end: InsightsEndDto; open: (title: string, query: InsightsPeopleQuery) => void }) {
  const t = useTranslations("insights.performance");
  const format = useFormat();
  const last = data.lastYear?.name ?? null;
  const strong = end.strongLabel ?? t("strongFallback");
  const ratingMax = niceMax(Math.max(...end.ratings.flatMap((r) => [r.count, r.lastCount ?? 0]), 1));
  const met = shareRange(end.metByDepartment.flatMap((d) => [d.share, ...(d.lastShare === null ? [] : [d.lastShare])]));
  const tenureMax = Math.max(...end.byTenure.flatMap((b) => [b.share ?? 0, b.lastShare ?? 0]), 10);
  const reviews = end.reviews;
  const reviewDays = Math.max(...(reviews?.this ?? []).map((p) => p.day), ...(reviews?.last ?? []).map((p) => p.day), 7);
  const updatesMax = niceMax(Math.max(...end.updates.flatMap((m) => [m.count, m.lastCount ?? 0]), 1));
  const nextName = data.nextYear?.name ?? null;
  return (
    <>
      {!data.nextYearLaunched ? (
        <section className="flex flex-wrap items-center gap-4 rounded-surface bg-card p-5 ring-1 ring-inset ring-primary/40">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="type-caption font-semibold uppercase tracking-wide text-muted-foreground">{t("nextStep")}</span>
            <span className="type-panel-title">{nextName ? t("launch", { year: nextName }) : t("setUp")}</span>
            <span className="flex items-center gap-1.5 type-caption text-muted-foreground">
              <Clock aria-hidden className="size-3.5" />
              {t("endedOn", { year: data.name, date: format.date(data.endDate) })}
            </span>
          </div>
          <Button asChild>
            <a href="/performance/year/setup">{nextName ? t("launch", { year: nextName }) : t("setUp")}</a>
          </Button>
        </section>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={t("ratings")} aside={<YearKeys mark="bar" current={data.name} previous={last} />}>
          <PairedColumns
            label={t("ratings")}
            max={ratingMax}
            columns={end.ratings.map((r) => ({
              key: String(r.value),
              label: r.label,
              current: r.count,
              previous: r.lastCount,
              tip: t("ratingTip", { count: r.count, label: r.label }),
              onOpen: r.count ? () => open(r.label, { metric: "level", level: r.value }) : undefined,
            }))}
          />
        </ChartCard>
        <ChartCard title={t("goalsEnded")}>
          <GoalsEnded data={data} end={end} open={open} />
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={t("metByDepartment")} aside={<YearKeys mark="dot" current={data.name} previous={last} />}>
          <Departments rows={end.metByDepartment} range={met} onOpen={(d) => open(d.name, { metric: "met", departmentId: d.unitId })} />
        </ChartCard>
        <ChartCard title={t("strongByTenure", { level: strong })} aside={<YearKeys mark="bar" current={data.name} previous={last} />}>
          <div className="flex flex-col gap-1">
            {end.byTenure.map((bucket) => (
              <FigureRow
                key={bucket.key}
                columns="minmax(120px, 150px) minmax(0, 1fr) 48px"
                name={t(`tenure.${bucket.key}`)}
                sub={t("people", { count: bucket.people })}
                chart={
                  <span className="flex flex-col gap-1">
                    <Bar share={((bucket.share ?? 0) / tenureMax) * 100} />
                    {bucket.lastShare !== null ? <Bar thin share={(bucket.lastShare / tenureMax) * 100} color={`color-mix(in oklab, ${LAST_YEAR} 55%, transparent)`} /> : null}
                  </span>
                }
                figure={bucket.share === null ? "–" : `${bucket.share}%`}
                onOpen={bucket.rated ? () => open(`${strong} · ${t(`tenure.${bucket.key}`)}`, { metric: "strong", bucket: bucket.key }) : undefined}
              />
            ))}
            <p className="px-2 pt-2 type-caption text-muted-foreground">{t("tenureSource")}</p>
          </div>
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={t("reviewsWeekly")} aside={<YearKeys current={data.name} previous={reviews?.last?.length ? last : null} />}>
          {reviews && reviews.this.length ? (
            <LineChart
              label={t("reviewsWeekly")}
              current={reviews.this.map((p) => ({ x: p.day, y: p.share }))}
              previous={reviews.last?.map((p) => ({ x: p.day, y: p.share }))}
              xMax={reviewDays}
              yMax={100}
              yTicks={[0, 50, 100]}
              suffix="%"
              xTicks={[
                { x: 0, label: t("opened", { date: format.parts(reviews.openedOn, { day: "numeric", month: "short" }) }) },
                ...[14, 28, 42].filter((d) => d < reviewDays).map((d) => ({ x: d, label: t("weeks", { count: d / 7 }) })),
              ]}
            />
          ) : (
            <p className="type-body text-muted-foreground">{t("noReviews")}</p>
          )}
        </ChartCard>
        <ChartCard title={t("updatesMonthly")} aside={<YearKeys current={data.name} previous={last} />}>
          <LineChart
            label={t("updatesMonthly")}
            current={end.updates.map((m, i) => ({ x: i, y: m.count }))}
            previous={last ? end.updates.map((m, i) => ({ x: i, y: m.lastCount ?? 0 })) : null}
            xMax={Math.max(end.updates.length - 1, 1)}
            yMax={updatesMax}
            yTicks={[0, updatesMax / 2, updatesMax]}
            xTicks={end.updates
              .map((m, i) => ({ x: i, label: format.parts(`${m.year}-${String(m.month).padStart(2, "0")}-01`, { month: "short" }) }))
              .filter((_, i) => i % 2 === 0)}
          />
        </ChartCard>
      </div>
      {end.carriedCount ? (
        <ChartCard
          title={t("carried", { year: nextName ?? t("nextYear") })}
          aside={<span className="ms-auto type-caption text-muted-foreground">{t("carriedNote", { count: end.carriedCount })}</span>}
        >
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {end.carried.map((goal) => (
              <a
                key={goal.objectiveId}
                href={`/performance/goals?cycle=${goal.cycleId}&objective=${goal.objectiveId}`}
                className="flex flex-col gap-1 rounded-inset bg-inlay p-3 outline-none hover:ring-1 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="line-clamp-2 type-label font-semibold">{goal.title}</span>
                <span className="type-caption text-muted-foreground">{t("carriedOwner", { name: goal.ownerName, progress: Math.round(goal.progress) })}</span>
              </a>
            ))}
          </div>
          {end.carriedCount > end.carried.length ? (
            <button type="button" onClick={() => open(t("carried", { year: nextName ?? t("nextYear") }), { metric: "carried" })} className="self-start type-label font-semibold text-primary-ink hover:underline">
              {t("carriedMore", { count: end.carriedCount - end.carried.length })}
            </button>
          ) : null}
        </ChartCard>
      ) : null}
    </>
  );
}

function GoalsEnded({ data, end, open }: { data: InsightsDto; end: InsightsEndDto; open: (title: string, query: InsightsPeopleQuery) => void }) {
  const t = useTranslations("insights.performance");
  const total = (g: InsightsGoalsEndDto) => g.met + g.partly + g.notMet + g.carried;
  const strip = (g: InsightsGoalsEndDto, big: boolean) => {
    const sum = total(g);
    return (
      <span className={cn("flex w-full gap-0.5 overflow-hidden rounded-detail", big ? "h-8" : "h-4", sum === 0 && "bar-stripes")}>
        {ENDINGS.map((key) =>
          g[key] ? (
            <span
              key={key}
              title={`${t(`endings.${key}`)}: ${g[key]}`}
              className={cn("flex items-center ps-2 type-caption font-semibold text-foreground", ENDING_COLOR[key] === "stripes" && "bar-stripes")}
              style={{ flex: g[key], ...(ENDING_COLOR[key] === "stripes" ? {} : { background: `color-mix(in oklab, ${ENDING_COLOR[key]} ${big ? 70 : 45}%, transparent)` }) }}
            >
              {big && g[key] / sum > 0.12 ? `${Math.round((g[key] / sum) * 100)}%` : null}
            </span>
          ) : null
        )}
      </span>
    );
  };
  const sum = total(end.goals);
  const lastSum = end.lastGoals ? total(end.lastGoals) : 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="flex items-baseline gap-2 type-label">
          <b className="font-semibold">{data.name}</b>
          <span className="type-caption text-muted-foreground">{t("goals", { count: sum })}</span>
        </span>
        {strip(end.goals, true)}
      </div>
      {end.lastGoals && data.lastYear ? (
        <div className="flex flex-col gap-2">
          <span className="flex items-baseline gap-2 type-label">
            <b className="font-semibold">{data.lastYear.name}</b>
            <span className="type-caption text-muted-foreground">{t("goals", { count: lastSum })}</span>
          </span>
          {strip(end.lastGoals, false)}
        </div>
      ) : null}
      <div className="flex flex-col">
        {ENDINGS.map((key) => (
          <button
            key={key}
            type="button"
            disabled={!end.goals[key]}
            onClick={() => open(t(`endings.${key}`), { metric: ENDING_METRIC[key] })}
            className="grid grid-cols-[14px_minmax(0,1fr)_48px_48px_minmax(0,120px)] items-center gap-3 rounded-inset px-2 py-1.5 text-start outline-none hover:bg-inlay/60 focus-visible:ring-2 focus-visible:ring-ring disabled:hover:bg-transparent"
          >
            <span
              aria-hidden
              className={cn("size-3 rounded-[3px]", ENDING_COLOR[key] === "stripes" && "bar-stripes")}
              style={ENDING_COLOR[key] === "stripes" ? {} : { background: ENDING_COLOR[key] }}
            />
            <span className="type-label">{t(`endings.${key}`)}</span>
            <b className="text-end type-label font-semibold tabular-nums">{end.goals[key]}</b>
            <span className="text-end type-caption tabular-nums text-muted-foreground">{sum ? Math.round((end.goals[key] / sum) * 100) : 0}%</span>
            <span className="text-end type-caption tabular-nums text-muted-foreground">
              {end.lastGoals && data.lastYear && lastSum
                ? t("lastShare", { share: Math.round((end.lastGoals[key] / lastSum) * 100), year: data.lastYear.name })
                : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── The people behind a figure ──

function FigurePeople({ cycleId, opened, onClose }: { cycleId: string; opened: Opened | null; onClose: () => void }) {
  const api = useMemo(() => createPerformanceApi(createPlatformApiClient()), []);
  const [pageSize, setPageSize] = useState(25);
  const query = opened ? { ...opened.query, pageSize } : null;
  const people = useApiQuery(
    performanceQueryKeys.insightsPeople(cycleId, query ?? { metric: "people" }),
    (signal) => api.getInsightsPeople(cycleId, query as InsightsPeopleQuery, signal),
    { enabled: query !== null, placeholderData: (previous) => previous }
  );
  return (
    <PeopleSheet
      open={opened !== null}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
          setPageSize(25);
        }
      }}
      title={opened?.title ?? ""}
      people={(people.data?.items ?? []).map((p) => ({
        key: p.employeeId,
        name: p.name,
        sub: [p.jobTitle, p.unitName].filter(Boolean).join(" · ") || null,
        href: p.href,
      }))}
      total={people.data?.total ?? 0}
      loading={people.isLoading || people.isFetching}
      error={Boolean(people.error)}
      onMore={pageSize < 50 ? () => setPageSize(50) : undefined}
    />
  );
}


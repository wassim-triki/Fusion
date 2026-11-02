"use client";

import type { ReportMeasure, ReportRunDto, ReportSeriesDto } from "@repo/api";
import { Button, ChartContainer, ChartTooltip, ChartTooltipContent } from "@repo/ds";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, XAxis, YAxis } from "recharts";

export const seriesColor = (index: number) => `var(--identity-${[1, 2, 4, 3, 5][index % 5]})`;

type Texts = { overall: string; joiners: string; leavers: string; compare: string; more: (count: number) => string; less: string; noData: string; empty: string; limit: string; years: string; people: string; other: string; reset: string; topGroups: string };
type Series = { label: string; values: (number | null)[]; key: string };

/** Put the most visible current groups first, retaining the full data in the report table. */
export function rankReportGroups(series: ReportSeriesDto[]): ReportSeriesDto[] {
  return [...series].sort((a, b) => (b.values.at(-1) ?? -Infinity) - (a.values.at(-1) ?? -Infinity) || a.label.localeCompare(b.label));
}

/** Counts may be stacked; rates and averages must never be added together. */
export function reportChartKind(measure: ReportMeasure, periods: number): "snapshot" | "flow" | "stacked" | "trend" {
  if (measure === "joiners-leavers") return "flow";
  if (periods === 1) return "snapshot";
  return measure === "turnover" || measure === "tenure" ? "trend" : "stacked";
}

export function chartPeriodData(periods: ReportRunDto["periods"], labels: string[], totals: ReportRunDto["totals"], series: Series[]) {
  return periods.map((period, i) => ({ label: labels[i] ?? period.to, total: totals[i], ...Object.fromEntries(series.map((s, j) => [`v${j}`, s.values[i] ?? null])) }));
}

export function countBreakdown(series: ReportSeriesDto[], periods: ReportRunDto["periods"], otherLabel: string, label: (value: string) => string): Series[] {
  const ranked = rankReportGroups(series);
  const result: Series[] = ranked.slice(0, 4).map((s) => ({ key: s.key, label: label(s.label), values: s.values }));
  if (ranked.length > 4) result.push({ key: "__other", label: otherLabel, values: periods.map((_, i) => ranked.slice(4).reduce((sum, s) => sum + (s.values[i] ?? 0), 0)) });
  return result;
}

export function ReportChart({ run, labels, title, measure, locale, selectedSeries, onSelectedSeriesChange, seriesLabel, texts, legendLimit, onLegendLimitChange }: {
  run: ReportRunDto; labels: string[]; title: string; measure: ReportMeasure; locale: string;
  selectedSeries: string[] | null; onSelectedSeriesChange: (values: string[] | null) => void;
  seriesLabel: (label: string) => string; texts: Texts; legendLimit: number; onLegendLimitChange: (limit: number) => void;
}) {
  const kind = reportChartKind(measure, run.periods.length);
  const format = (value: number | null | undefined) => value == null ? texts.noData : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)}${run.unit === "percent" ? "%" : ""}`;
  const ranked = rankReportGroups(run.series);
  const top = ranked.slice(0, 4);
  const activeKeys = selectedSeries ?? top.map((s) => s.key);
  const selected = run.series.filter((s) => activeKeys.includes(s.key)).slice(0, 4);
  const options = ranked.slice(0, legendLimit);
  const snapshot = ranked.filter((s) => s.values[0] != null);
  const stacked = countBreakdown(run.series, run.periods, texts.other, seriesLabel);
  const flow: Series[] = (["joiners", "leavers"] as const).map((event) => ({ key: event, label: texts[event], values: run.periods.map((_, i) => run.series.filter((s) => s.label.endsWith(` · ${event}`)).reduce((sum, s) => sum + (s.values[i] ?? 0), 0)) }));
  const trends: Series[] = [{ key: "__overall", label: texts.overall, values: run.totals }, ...selected.map((s) => ({ key: s.key, label: seriesLabel(s.label), values: s.values }))];
  const chartSeries = kind === "stacked" ? stacked : kind === "flow" ? flow : trends;
  const config = Object.fromEntries(chartSeries.map((s, i) => [`v${i}`, { label: s.label, color: seriesColor(i) }]));
  const data = chartPeriodData(run.periods, labels, run.totals, chartSeries);
  const unit = run.unit === "years" ? texts.years : run.unit === "percent" ? "%" : texts.people;
  const axis = { fontSize: 11, fill: "var(--muted-foreground)" };

  if (kind === "snapshot") {
    const rows = snapshot.slice(0, legendLimit).map((s) => ({ label: seriesLabel(s.label), value: s.values[0] }));
    return <div role="group" aria-label={title}>
      {rows.length ? <ChartContainer config={{ value: { label: title, color: seriesColor(0) } }} className="aspect-auto w-full" style={{ height: Math.max(160, rows.length * 38 + 28) }}>
        <BarChart data={rows} layout="vertical" margin={{ top: 2, right: 50, bottom: 2, left: 8 }} barSize={20} accessibilityLayer>
          <CartesianGrid horizontal={false} stroke="var(--border)" />
          <XAxis type="number" tick={axis} tickLine={false} axisLine={false} tickFormatter={(v: number) => format(v)} />
          <YAxis dataKey="label" type="category" width={150} tick={axis} tickLine={false} axisLine={false} />
          <ChartTooltip cursor={{ fill: "var(--inlay)" }} content={<ChartTooltipContent />} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}><LabelList dataKey="value" position="right" formatter={(v: number) => format(v)} className="fill-foreground type-meta" />{rows.map((row, i) => <Cell key={row.label} fill={i < 5 ? seriesColor(i) : "var(--muted-foreground)"} />)}</Bar>
        </BarChart>
      </ChartContainer> : <p className="py-12 text-center type-body text-muted-foreground">{run.unit === "percent" ? texts.noData : texts.empty}</p>}
      {snapshot.length > legendLimit && <Button variant="ghost" size="sm" onClick={() => onLegendLimitChange(legendLimit + 8)}>{texts.more(Math.min(8, snapshot.length - legendLimit))}</Button>}
      {legendLimit > 8 && <Button variant="ghost" size="sm" onClick={() => onLegendLimitChange(8)}>{texts.less}</Button>}
    </div>;
  }

  return <div>
    <div className="mb-3 flex flex-wrap items-center gap-x-[18px] gap-y-2" aria-label={texts.compare}>
      {chartSeries.map((s, i) => <span key={s.key} className="flex items-center gap-2 type-meta text-muted-foreground"><i aria-hidden className="size-2.5 rounded-detail" style={{ background: seriesColor(i) }} />{s.label}</span>)}
      <span className="type-meta text-muted-foreground">{unit}</span>
    </div>
    <div className="overflow-x-auto" role="img" aria-label={title}>
      <ChartContainer config={config} className="aspect-auto h-[270px] w-full min-w-[720px]" style={{ minWidth: Math.max(720, run.periods.length * 70) }}>
        {kind === "trend" ? <LineChart data={data} margin={{ top: 18, right: 18, left: 0, bottom: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} /><YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v: number) => format(v)} width={48} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {chartSeries.map((s, i) => <Line key={s.key} dataKey={`v${i}`} name={s.label} type="monotone" stroke={seriesColor(i)} strokeWidth={i === 0 ? 3 : 2} dot={{ r: 3, fill: seriesColor(i), strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} />)}
        </LineChart> : <BarChart data={data} margin={{ top: 24, right: 12, left: 0, bottom: 0 }} barCategoryGap="36%" barGap={3} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} /><YAxis tick={axis} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
          <ChartTooltip cursor={{ fill: "var(--inlay)" }} content={<ChartTooltipContent />} />
          {chartSeries.map((s, i) => <Bar key={s.key} dataKey={`v${i}`} name={s.label} fill={seriesColor(i)} stackId={kind === "stacked" ? "count" : undefined} maxBarSize={46} radius={[3, 3, 0, 0]}>{kind === "stacked" && i === chartSeries.length - 1 && <LabelList dataKey="total" position="top" className="fill-foreground type-meta-strong" />}</Bar>)}
        </BarChart>}
      </ChartContainer>
    </div>
    {kind === "trend" && run.series.length > 1 && <div className="mt-3">
      <p className="mb-2 type-meta text-muted-foreground">{texts.compare} · {selectedSeries === null ? texts.topGroups : texts.limit}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((s) => { const isSelected = activeKeys.includes(s.key); const index = selected.findIndex((item) => item.key === s.key);
          // Each toggle carries its chart series color.
          // eslint-disable-next-line no-restricted-syntax
          return <Button key={s.key} variant={isSelected ? "secondary" : "ghost"} size="sm" aria-pressed={isSelected} disabled={!isSelected && selected.length >= 4} onClick={() => onSelectedSeriesChange(isSelected ? activeKeys.filter((key) => key !== s.key) : [...activeKeys, s.key])}>
            {isSelected && <i aria-hidden className="size-2 rounded-detail" style={{ background: seriesColor(index + 1) }} />}{seriesLabel(s.label)}
          </Button>;
        })}
        {ranked.length > legendLimit && <Button variant="ghost" size="sm" onClick={() => onLegendLimitChange(legendLimit + 8)}>{texts.more(Math.min(8, ranked.length - legendLimit))}</Button>}
        {legendLimit > 8 && <Button variant="ghost" size="sm" onClick={() => onLegendLimitChange(8)}>{texts.less}</Button>}
        {selectedSeries !== null && <Button variant="ghost" size="sm" onClick={() => onSelectedSeriesChange(null)}>{texts.reset}</Button>}
      </div>
    </div>}
  </div>;
}

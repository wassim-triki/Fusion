// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { chartPeriodData, countBreakdown, rankReportGroups, reportChartKind, ReportChart } from "./report-chart";
import type { ReportMeasure, ReportRunDto } from "@repo/api";

const texts = { overall: "Overall", joiners: "Joiners", leavers: "Leavers", compare: "Compare", more: () => "More", less: "Less", noData: "Unavailable", empty: "No records", limit: "Limit", years: "years", people: "people", other: "Other", reset: "Reset", topGroups: "Latest" };
const base: ReportRunDto = { periods: [{from: "2025-01-01", to: "2025-12-31"}, {from: "2026-01-01", to: "2026-12-31"}], series: [{key:"A",label:"A",values:[1,2],change:1}], totals:[1,2], fields:[], people:[], unit:"people", filterOptions:{}, personOptions:[] };
function show(run: ReportRunDto, measure: ReportMeasure) { return render(<ReportChart run={run} labels={["2025", "2026"]} title="Chart" measure={measure} locale="en" selectedSeries={[]} onSelectedSeriesChange={vi.fn()} seriesLabel={(label) => label} texts={texts} legendLimit={8} onLegendLimitChange={vi.fn()} />); }
describe("Report charts", () => {
  it("uses a ranked comparison for a single snapshot", () => {
    cleanup(); show({...base, periods: [base.periods[0]!], totals:[3], series:[{key:"a",label:"Small",values:[1],change:0},{key:"b",label:"Large",values:[2],change:0}]}, "jobs");
    expect(reportChartKind("jobs", 1)).toBe("snapshot");
    expect(rankReportGroups([{key:"a",label:"Small",values:[1],change:0},{key:"b",label:"Large",values:[2],change:0}]).map((s) => s.label)).toEqual(["Large", "Small"]);
  });
  it("keeps all count groups in the stacked breakdown", () => {
    const groups = Array.from({ length: 6 }, (_, i) => ({ key: String(i), label: String(i), values: [i + 1, i + 1], change: 0 }));
    const result = countBreakdown(groups, base.periods, "Other", (v) => v);
    expect(result).toHaveLength(5);
    expect(result.at(-1)?.values).toEqual([3, 3]);
    expect(result.reduce((sum, row) => sum + (row.values[0] ?? 0), 0)).toBe(21);
  });
  it("shows joiners and leavers separately rather than stacking events", () => {
    cleanup(); show({...base, series:[{key:"a",label:"A · joiners",values:[2,1],change:-1},{key:"b",label:"A · leavers",values:[1,2],change:1}]}, "joiners-leavers");
    expect(screen.getByText("Joiners")).toBeInTheDocument(); expect(screen.getByText("Leavers")).toBeInTheDocument();
    expect(reportChartKind("joiners-leavers", 2)).toBe("flow");
  });
  it("leaves gaps when a rate is unavailable", () => {
    cleanup(); show({...base, unit:"percent", totals:[null,2]}, "turnover");
    expect(reportChartKind("turnover", 2)).toBe("trend");
    expect(screen.getByText("Overall")).toBeInTheDocument();
    expect(chartPeriodData(base.periods, ["2025", "2026"], [null, 2], [{ key: "all", label: "Overall", values: [null, 2] }]).map((p) => Object.getOwnPropertyDescriptor(p, "v0")?.value)).toEqual([null, 2]);
  });
});

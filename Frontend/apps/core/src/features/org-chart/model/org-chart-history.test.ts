import { describe, expect, it } from "vitest";
import type { OrgChartDto, OrgChartHistoryDto, OrgChartHistoryPersonDto, OrgChartStretchDto } from "@repo/api";
import { changesBetween, chartOn, countsOn } from "./org-chart-history";

const unit = { id: "u1", name: "Product", divisionId: null, divisionName: null };
const stretch = (from: string, until: string | null, managerKey: string | null, startDate = "2020-01-01"): OrgChartStretchDto => ({
  from, until, jobTitle: "Engineer", unit, workLocation: null, startYear: Number(startDate.slice(0, 4)), startDate, managerKey, dottedLineManagerKeys: [],
});
const person = (key: string, stretches: OrgChartStretchDto[], leaves: OrgChartHistoryPersonDto["leaves"] = []): OrgChartHistoryPersonDto => ({
  employeeKey: key, displayName: key, initials: key.slice(0, 2), workEmail: null, photoUrl: null, stretches, leaves,
});

// Sami leads; Amira reports to him; Leila moves from Amira to Sami on 1 March; Omar joins under Amira on 1 February
// and leaves after 31 March; Amira is off from 10 to 14 March.
const history: OrgChartHistoryDto = {
  from: "2026-01-01",
  to: "2026-12-31",
  people: [
    person("sami", [stretch("2026-01-01", null, null)]),
    person("amira", [stretch("2026-01-01", null, "sami")], [{ changeId: "l1", from: "2026-03-10", until: "2026-03-14", back: "2026-03-16" }]),
    person("leila", [stretch("2026-01-01", "2026-03-01", "amira"), stretch("2026-03-01", null, "sami")]),
    person("omar", [stretch("2026-02-01", "2026-04-01", "amira", "2026-02-01")]),
  ],
  units: [{ id: "u1", until: null }, { id: "u2", until: "2026-06-01" }],
};
const current: OrgChartDto = {
  asOf: "2026-01-01", unitLevel: "Unit", scope: "Tenant", viewerKey: "omar", people: [], folded: [], window: null,
  openRoles: [{ id: "r1", jobTitle: "Designer", managerKey: "amira", unit: null, targetStartDate: null, status: "Open" }],
};

describe("the chart's history", () => {
  it("builds a day's chart with its counts, new people, leave and open roles", () => {
    const chart = chartOn(history, current, "2026-02-15", "2026-02-01");
    const of = (key: string) => chart.people.find((p) => p.employeeKey === key)!;
    expect(chart.people.map((p) => p.employeeKey)).toEqual(["sami", "amira", "leila", "omar"]);
    expect([of("sami").directCount, of("sami").totalCount, of("amira").directCount]).toEqual([1, 3, 2]);
    expect([of("omar").isNew, of("leila").isNew]).toEqual([true, false]);
    expect(of("amira").leave).toEqual({ changeId: "l1", type: null, from: "2026-03-10", until: "2026-03-14", back: "2026-03-16", now: false });
    expect(chart.viewerKey).toBe("omar");
    expect(chart.openRoles).toHaveLength(1);

    const later = chartOn(history, current, "2026-03-12", "2026-02-01");
    expect(later.people.find((p) => p.employeeKey === "amira")!.leave?.now).toBe(true);
    expect(later.people.find((p) => p.employeeKey === "leila")!.managerKey).toBe("sami");

    // Before Omar joins: he isn't on it, nor is he the viewer; the past holds no open roles.
    const before = chartOn(history, current, "2026-01-15", "2026-02-01");
    expect(before.people).toHaveLength(3);
    expect([before.viewerKey, before.openRoles.length]).toEqual([null, 0]);
  });

  it("lists joins, moves and leavers between two days", () => {
    expect(changesBetween(history, "2026-01-02", "2026-12-31").map((c) => [c.kind, c.date, c.employeeKey, c.managerKey])).toEqual([
      ["Join", "2026-02-01", "omar", "amira"],
      ["Move", "2026-03-01", "leila", "sami"],
      ["Leave", "2026-03-31", "omar", null],
    ]);
    expect(changesBetween(history, "2026-03-02", "2026-03-30")).toEqual([]);
  });

  it("counts the people placed in a unit and the units that still count", () => {
    expect(countsOn(history, "2026-02-15")).toEqual({ people: 4, units: 2 });
    expect(countsOn(history, "2026-06-01")).toEqual({ people: 3, units: 1 });
  });
});

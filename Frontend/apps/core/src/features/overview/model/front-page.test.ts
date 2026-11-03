import { describe, expect, it } from "vitest";
import type { FrontPageDto, FrontPagePersonDto } from "@repo/api";
import {
  departmentLead,
  frontEvents,
  groupPeople,
  growthMonths,
  peopleOn,
  yearBefore,
} from "./front-page";

const person = (
  key: string,
  department = "Engineering"
): FrontPagePersonDto => ({
  employeeKey: key,
  name: key,
  photoUrl: null,
  job: "Engineer",
  place: "Tunis",
  firstDay: "2010-02-01",
  departmentId: department,
  department,
  parent: null,
  managerKey: null,
});
const a = person("Ada"),
  b = { ...person("Bo"), managerKey: "Ada" },
  c = person("Cy", "People");
const snapshots = [
  { date: "2010-02-01", people: [a] },
  { date: "2025-01-15", people: [a, b] },
  {
    date: "2026-01-03",
    people: [a, { ...b, departmentId: "People", department: "People" }, c],
  },
  { date: "2026-01-10", people: [a, c] },
];

describe("Front-page history", () => {
  it("scrubs exact boundaries and does not invent people before the first day", () => {
    expect(peopleOn(snapshots, "2010-01-31")).toEqual([]);
    expect(peopleOn(snapshots, "2025-01-14")).toEqual([a]);
    expect(peopleOn(snapshots, "2025-01-15")).toEqual([a, b]);
    expect(peopleOn(snapshots, "2026-01-10")).toEqual([a, c]);
    expect(yearBefore("2024-02-29")).toBe("2023-02-28");
  });
  it("derives joins, department moves and exclusive-end last days without duplicating unchanged months", () => {
    expect(
      frontEvents(snapshots).map((e) => [e.person.name, e.kind, e.date])
    ).toEqual([
      ["Ada", "joins", "2010-02-01"],
      ["Bo", "joins", "2025-01-15"],
      ["Bo", "moves", "2026-01-03"],
      ["Cy", "joins", "2026-01-03"],
      ["Bo", "leaves", "2026-01-09"],
    ]);
  });
  it("keeps people regrouping at the selected date and finds the lead by the actual manager links", () => {
    expect(
      groupPeople([a, b, c], "department", "2026-01-01").map((g) => [
        g.label,
        g.people.length,
      ])
    ).toEqual([
      ["Engineering", 2],
      ["People", 1],
    ]);
    expect(
      groupPeople([a, { ...b, place: "Sfax" }], "place", "2026-01-01")
    ).toHaveLength(2);
    expect(
      groupPeople(
        [{ ...a, firstDay: "2025-07-01" }, b],
        "time",
        "2026-01-01"
      ).map((g) => g.key)
    ).toEqual(["underOne", "fivePlus"]);
    expect(departmentLead([b, a])?.employeeKey).toBe("Ada");
  });
  it("samples every month across the whole history, preserving today and the future horizon", () => {
    const data = {
      firstDate: "2010-02-01",
      today: "2026-01-05",
      lastDate: "2026-04-05",
      snapshots,
    } as FrontPageDto;
    const months = growthMonths(data);
    expect(months.length).toBeGreaterThan(190);
    expect(months[0]?.date).toBe("2010-02-01");
    expect(months.find((m) => m.date === data.today)?.people).toHaveLength(3);
    expect(months.at(-1)?.date).toBe(data.lastDate);
  });
});

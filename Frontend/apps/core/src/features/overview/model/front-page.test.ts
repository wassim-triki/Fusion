import { describe, expect, it } from "vitest";
import type {
  FrontPageDto,
  FrontPagePersonDto,
  FrontPageSpanDto,
} from "@repo/api";
import {
  departmentColor,
  departmentLead,
  frontEvents,
  groupPeople,
  growthMonths,
  peopleOn,
  yearBefore,
  type FrontPerson,
} from "./front-page";

const person = (
  key: string,
  department = "Engineering"
): FrontPerson => ({
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
const stretch = (
  { employeeKey: _k, name: _n, photoUrl: _p, ...details }: FrontPerson,
  from: string,
  to: string | null = null
): FrontPageSpanDto => ({ from, to, ...details });
const dto = (p: FrontPerson, spans: FrontPageSpanDto[]): FrontPagePersonDto => ({
  employeeKey: p.employeeKey,
  name: p.name,
  photoUrl: p.photoUrl,
  spans,
});
const people = [
  dto(a, [stretch(a, "2010-02-01")]),
  dto(b, [
    stretch(b, "2025-01-15", "2026-01-03"),
    stretch(
      { ...b, departmentId: "People", department: "People" },
      "2026-01-03",
      "2026-01-10"
    ),
  ]),
  dto(c, [stretch(c, "2026-01-03")]),
];

describe("Front-page history", () => {
  it("scrubs exact boundaries and does not invent people before the first day", () => {
    expect(peopleOn(people, "2010-01-31")).toEqual([]);
    expect(peopleOn(people, "2025-01-14")).toEqual([a]);
    expect(peopleOn(people, "2025-01-15")).toEqual([a, b]);
    expect(peopleOn(people, "2026-01-10")).toEqual([a, c]);
    expect(yearBefore("2024-02-29")).toBe("2023-02-28");
  });
  it("derives joins, department moves and exclusive-end last days without duplicating unchanged months", () => {
    expect(
      frontEvents(people).map((e) => [e.person.name, e.kind, e.date])
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
      people,
    } as FrontPageDto;
    const months = growthMonths(data);
    expect(months.length).toBeGreaterThan(190);
    expect(months[0]?.date).toBe("2010-02-01");
    expect(months.find((m) => m.date === data.today)?.people).toHaveLength(3);
    expect(months.at(-1)?.date).toBe(data.lastDate);
  });
});

describe("people outside every department", () => {
  it("sit in their own group, after every department, in a neutral colour", () => {
    const division = {
      ...person("Dee"),
      departmentId: null,
      department: null,
      parent: "Corporate Services",
    };
    const groups = groupPeople([division, c, a], "department", "2026-01-01");
    expect(groups.map((g) => g.label)).toEqual(["Engineering", "People", null]);
    expect(departmentColor(0, groups[2]!.key)).toBe("var(--muted-foreground)");
    const hues = [0, 1, 2, 3, 4, 5].map((i) => departmentColor(i, `d${i}`));
    expect(new Set(hues).size).toBe(6);
  });
});

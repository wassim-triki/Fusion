import type {
  OrgChartChangeDto, OrgChartDto, OrgChartHistoryDto, OrgChartHistoryPersonDto, OrgChartPersonDto, OrgChartStretchDto, PersonLeaveDto,
} from "@repo/api";
import { addDays, dayIndex } from "./org-chart-model";

/** In their first 90 days, as Core HR marks new people. */
const NEW_FOR_DAYS = 90;

/**
 * The org chart's history over a window (B-419): the page builds any day of it here, as Core HR builds one date on the
 * server, so the time slider and Replay need no request per date.
 */

export const coversDay = (history: OrgChartHistoryDto, day: string) => history.from <= day && day <= history.to;

function stretchOn(person: OrgChartHistoryPersonDto, day: string): OrgChartStretchDto | null {
  for (const stretch of person.stretches) {
    if (stretch.from > day) return null;
    if (stretch.until === null || day < stretch.until) return stretch;
  }
  return null;
}

/** The leave they are on that day, or else their next one; the type is left out, as on the chart. */
function leaveOn(person: OrgChartHistoryPersonDto, day: string): PersonLeaveDto | null {
  const leave = person.leaves.find((item) => item.until === null || item.until >= day);
  return leave ? { ...leave, type: null, now: leave.from <= day } : null;
}

function card(person: OrgChartHistoryPersonDto, stretch: OrgChartStretchDto, day: string): OrgChartPersonDto {
  return {
    employeeKey: person.employeeKey,
    displayName: person.displayName,
    initials: person.initials,
    jobTitle: stretch.jobTitle,
    unit: stretch.unit,
    workLocation: stretch.workLocation,
    workEmail: person.workEmail,
    startYear: stretch.startYear,
    startDate: stretch.startDate,
    isNew: stretch.startDate !== null && dayIndex(day) - dayIndex(stretch.startDate) < NEW_FOR_DAYS,
    managerKey: stretch.managerKey,
    dottedLineManagerKeys: stretch.dottedLineManagerKeys,
    directCount: 0,
    totalCount: 0,
    photoUrl: person.photoUrl,
    leave: leaveOn(person, day),
  };
}

/** Everyone on the chart that day, with their whole-company counts. */
function peopleOn(history: OrgChartHistoryDto, day: string): OrgChartPersonDto[] {
  const people = history.people.flatMap((person) => {
    const stretch = stretchOn(person, day);
    return stretch ? [card(person, stretch, day)] : [];
  });
  const byKey = new Map(people.map((person) => [person.employeeKey, person]));
  const reports = new Map<string, string[]>();
  for (const person of people) {
    if (person.managerKey && byKey.has(person.managerKey)) reports.set(person.managerKey, [...(reports.get(person.managerKey) ?? []), person.employeeKey]);
  }
  const totals = new Map<string, number>();
  const total = (key: string, path: Set<string>): number => {
    const known = totals.get(key);
    if (known !== undefined) return known;
    if (path.has(key)) return 0; // a cycle in bad data counts once, never loops
    path.add(key);
    const sum = (reports.get(key) ?? []).reduce((count, child) => count + 1 + total(child, path), 0);
    path.delete(key);
    totals.set(key, sum);
    return sum;
  };
  for (const person of people) {
    person.directCount = reports.get(person.employeeKey)?.length ?? 0;
    person.totalCount = total(person.employeeKey, new Set());
  }
  return people;
}

/**
 * The chart on a day, from the history and today's chart (its scope, the company's unit level and today's open roles,
 * which are a plan: they show from today on, under managers on the chart that day).
 */
export function chartOn(history: OrgChartHistoryDto, current: OrgChartDto, day: string, today: string): OrgChartDto {
  const people = peopleOn(history, day);
  const keys = new Set(people.map((person) => person.employeeKey));
  return {
    ...current,
    asOf: day,
    viewerKey: current.viewerKey && keys.has(current.viewerKey) ? current.viewerKey : null,
    people,
    folded: [],
    openRoles: day >= today ? current.openRoles.filter((role) => keys.has(role.managerKey)) : [],
    window: null,
  };
}

/**
 * Joins, leavers (dated their last day) and moves to another manager between two days, both included, as Core HR lists
 * them: a joiner's first manager belongs to the join, and losing a manager who leaves isn't a move.
 */
export function changesBetween(history: OrgChartHistoryDto, from: string, to: string): OrgChartChangeDto[] {
  const changes: OrgChartChangeDto[] = [];
  const cards = new Map<string, Map<string, OrgChartPersonDto>>();
  const cardOn = (key: string, day: string) => {
    let people = cards.get(day);
    if (!people) cards.set(day, (people = new Map(peopleOn(history, day).map((person) => [person.employeeKey, person]))));
    return people.get(key) ?? null;
  };
  const within = (day: string) => from <= day && day <= to;
  for (const person of history.people) {
    person.stretches.forEach((stretch, index) => {
      const before = person.stretches[index - 1];
      const after = person.stretches[index + 1];
      const continues = before?.until === stretch.from;
      if (!continues && stretch.from > history.from && within(stretch.from)) {
        const joiner = cardOn(person.employeeKey, stretch.from);
        changes.push({ kind: "Join", date: stretch.from, employeeKey: person.employeeKey, managerKey: joiner?.managerKey ?? null, person: joiner });
      }
      if (continues && before.managerKey && stretch.managerKey && before.managerKey !== stretch.managerKey && within(stretch.from)) {
        changes.push({ kind: "Move", date: stretch.from, employeeKey: person.employeeKey, managerKey: stretch.managerKey, person: null });
      }
      if (stretch.until !== null && after?.from !== stretch.until) {
        const last = addDays(stretch.until, -1);
        if (within(last)) changes.push({ kind: "Leave", date: last, employeeKey: person.employeeKey, managerKey: null, person: null });
      }
    });
  }
  return changes.sort((a, b) => a.date.localeCompare(b.date) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)
    || (a.employeeKey < b.employeeKey ? -1 : a.employeeKey > b.employeeKey ? 1 : 0));
}

/** Organization's figures on a day: people placed in a unit, and the units that still count. */
export function countsOn(history: OrgChartHistoryDto, day: string): { people: number; units: number } {
  const people = history.people.filter((person) => stretchOn(person, day)?.unit).length;
  const units = history.units.filter((unit) => unit.until === null || day < unit.until).length;
  return { people, units };
}

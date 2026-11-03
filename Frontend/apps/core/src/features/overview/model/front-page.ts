import type { FrontPageDto, FrontPagePersonDto } from "@repo/api";

export type Snapshot = FrontPageDto["snapshots"][number];
export type Grouping = "department" | "place" | "time";
export type FrontEvent = {
  date: string;
  kind: "joins" | "leaves" | "moves" | "job" | "placeChange" | "managerChange";
  person: FrontPagePersonDto;
  before?: FrontPagePersonDto;
};
export const departmentKey = (person: FrontPagePersonDto) =>
  person.departmentId ?? person.department ?? "__none";
export const dayNumber = (date: string) =>
  Date.parse(`${date}T00:00:00Z`) / 86400000;
export const addDays = (date: string, days: number) =>
  new Date((dayNumber(date) + days) * 86400000).toISOString().slice(0, 10);

/** Every boundary is supplied by Reports; between boundaries the same people and work remain in force. */
export function peopleOn(
  snapshots: Snapshot[],
  date: string
): FrontPagePersonDto[] {
  let lo = 0,
    hi = snapshots.length - 1,
    found = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (snapshots[mid]!.date <= date) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found < 0 ? [] : snapshots[found]!.people;
}

export function frontEvents(snapshots: Snapshot[]): FrontEvent[] {
  const result: FrontEvent[] = [];
  let previous = new Map<string, FrontPagePersonDto>();
  for (const snapshot of snapshots) {
    const next = new Map(snapshot.people.map((p) => [p.employeeKey, p]));
    for (const person of snapshot.people) {
      const before = previous.get(person.employeeKey);
      if (!before) result.push({ date: snapshot.date, kind: "joins", person });
      else if (departmentKey(before) !== departmentKey(person))
        result.push({ date: snapshot.date, kind: "moves", person, before });
      else if (before.job !== person.job)
        result.push({ date: snapshot.date, kind: "job", person, before });
      else if (before.place !== person.place)
        result.push({
          date: snapshot.date,
          kind: "placeChange",
          person,
          before,
        });
      else if (before.managerKey !== person.managerKey)
        result.push({
          date: snapshot.date,
          kind: "managerChange",
          person,
          before,
        });
    }
    for (const person of previous.values())
      if (!next.has(person.employeeKey))
        result.push({
          date: addDays(snapshot.date, -1),
          kind: "leaves",
          person,
        });
    previous = next;
  }
  return result.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.person.name.localeCompare(b.person.name)
  );
}

export function yearBefore(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  const month = value.getUTCMonth();
  value.setUTCFullYear(value.getUTCFullYear() - 1);
  if (value.getUTCMonth() !== month) value.setUTCDate(0);
  return value.toISOString().slice(0, 10);
}

export function groupPeople(
  people: FrontPagePersonDto[],
  by: Grouping,
  date: string
) {
  const groups = new Map<
    string,
    { key: string; label: string | null; people: FrontPagePersonDto[] }
  >();
  for (const person of people) {
    const years = person.firstDay
      ? (dayNumber(date) - dayNumber(person.firstDay)) / 365.25
      : null;
    const key =
      by === "department"
        ? departmentKey(person)
        : by === "place"
          ? (person.place ?? "__none")
          : years === null
            ? "unknown"
            : years < 1
              ? "underOne"
              : years < 3
                ? "oneToThree"
                : years < 5
                  ? "threeToFive"
                  : "fivePlus";
    const label =
      by === "department"
        ? person.department
        : by === "place"
          ? person.place
          : key;
    if (!groups.has(key)) groups.set(key, { key, label, people: [] });
    groups.get(key)!.people.push(person);
  }
  return [...groups.values()].sort((a, b) =>
    by === "time"
      ? [
          "underOne",
          "oneToThree",
          "threeToFive",
          "fivePlus",
          "unknown",
        ].indexOf(a.key) -
        [
          "underOne",
          "oneToThree",
          "threeToFive",
          "fivePlus",
          "unknown",
        ].indexOf(b.key)
      : (a.label ?? "").localeCompare(b.label ?? "")
  );
}

/** A department head reports outside the department; ties go to the largest internal branch. */
export function departmentLead(people: FrontPagePersonDto[]) {
  const keys = new Set(people.map((p) => p.employeeKey));
  const total = (key: string) => {
    const seen = new Set<string>();
    const queue = [key];
    while (queue.length) {
      const current = queue.shift()!;
      for (const person of people)
        if (person.managerKey === current && !seen.has(person.employeeKey)) {
          seen.add(person.employeeKey);
          queue.push(person.employeeKey);
        }
    }
    return seen.size;
  };
  return people
    .filter((p) => !p.managerKey || !keys.has(p.managerKey))
    .sort(
      (a, b) =>
        total(b.employeeKey) - total(a.employeeKey) ||
        a.name.localeCompare(b.name)
    )[0];
}

export function growthMonths(data: FrontPageDto) {
  const dates = new Set([data.firstDate, data.today, data.lastDate]);
  const first = new Date(`${data.firstDate}T12:00:00Z`);
  for (
    let month = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)
    );
    month.toISOString().slice(0, 10) <= data.lastDate;
    month = new Date(
      Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 2, 0)
    )
  )
    dates.add(month.toISOString().slice(0, 10));
  return [...dates]
    .sort()
    .map((date) => ({ date, people: peopleOn(data.snapshots, date) }));
}

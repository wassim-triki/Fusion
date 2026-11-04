import type {
  FrontPageDto,
  FrontPagePersonDto,
  FrontPageSpanDto,
} from "@repo/api";

/** A person as they were on one date: their identity plus that date's details. */
export type FrontPerson = Omit<FrontPagePersonDto, "spans"> &
  Omit<FrontPageSpanDto, "from" | "to">;
export type Grouping = "department" | "place" | "time";
export type FrontEvent = {
  date: string;
  kind: "joins" | "leaves" | "moves" | "job" | "placeChange" | "managerChange";
  person: FrontPerson;
  before?: FrontPerson;
};
export const OUTSIDE_DEPARTMENTS = "__none";
export const departmentKey = (
  person: Pick<FrontPerson, "departmentId" | "department">
) =>
  person.departmentId ?? person.department ?? OUTSIDE_DEPARTMENTS;
/** Six distinct hues so no two departments share one; people outside every department stay neutral. */
export const departmentColor = (index: number, key: string) =>
  key === OUTSIDE_DEPARTMENTS
    ? "var(--muted-foreground)"
    : `var(--identity-${[1, 2, 4, 3, 5, 6][index % 6]})`;
/** Named groups alphabetically; the unnamed group (no department, no place) last. */
export const byLabel = (
  a: { label: string | null },
  b: { label: string | null }
) =>
  a.label === null
    ? b.label === null
      ? 0
      : 1
    : b.label === null
      ? -1
      : a.label.localeCompare(b.label);
export const dayNumber = (date: string) =>
  Date.parse(`${date}T00:00:00Z`) / 86400000;
export const addDays = (date: string, days: number) =>
  new Date((dayNumber(date) + days) * 86400000).toISOString().slice(0, 10);

const flat = (
  { spans: _spans, ...person }: FrontPagePersonDto,
  { from: _from, to: _to, ...details }: FrontPageSpanDto
): FrontPerson => ({ ...person, ...details });

/** Who was here on a date: each person's stretch that covers it (`to` is exclusive). */
export function peopleOn(
  people: FrontPagePersonDto[],
  date: string
): FrontPerson[] {
  const result: FrontPerson[] = [];
  for (const person of people) {
    const span = person.spans.find(
      (s) => s.from <= date && (s.to === null || date < s.to)
    );
    if (span) result.push(flat(person, span));
  }
  return result;
}

/** Joins, leaves and changes, read off where one stretch ends and the next begins. */
export function frontEvents(people: FrontPagePersonDto[]): FrontEvent[] {
  const result: FrontEvent[] = [];
  for (const person of people) {
    person.spans.forEach((span, i) => {
      const now = flat(person, span);
      const previous = person.spans[i - 1];
      const next = person.spans[i + 1];
      if (!previous || previous.to !== span.from)
        result.push({ date: span.from, kind: "joins", person: now });
      else {
        const before = flat(person, previous);
        const kind =
          departmentKey(before) !== departmentKey(now)
            ? "moves"
            : before.job !== now.job
              ? "job"
              : before.place !== now.place
                ? "placeChange"
                : before.managerKey !== now.managerKey
                  ? "managerChange"
                  : null;
        if (kind) result.push({ date: span.from, kind, person: now, before });
      }
      if (span.to && (!next || next.from !== span.to))
        result.push({ date: addDays(span.to, -1), kind: "leaves", person: now });
    });
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
  people: FrontPerson[],
  by: Grouping,
  date: string
) {
  const groups = new Map<
    string,
    { key: string; label: string | null; people: FrontPerson[] }
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
      : byLabel(a, b)
  );
}

/** A department head reports outside the department; ties go to the largest internal branch. */
export function departmentLead(people: FrontPerson[]) {
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
    .map((date) => ({ date, people: peopleOn(data.people, date) }));
}

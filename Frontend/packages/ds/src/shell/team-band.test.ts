import { describe, expect, it } from "vitest";
import { teamNext, type TeamBandPerson } from "./team-band";

const now = new Date(2026, 10, 1, 9, 0);
const person = (over: Partial<TeamBandPerson>): TeamBandPerson => ({
  employeeKey: "k", name: "Aicha", jobTitle: null, photo: null, joinsOn: null, events: [], oneOnOneAt: null, attention: null, ...over,
});

describe("what's next on the team band", () => {
  it("is a joiner's first day", () => {
    const joins = { kind: "Joins" as const, date: "2026-11-04", years: null };
    expect(teamNext(person({ joinsOn: "2026-11-04", events: [joins], oneOnOneAt: "2026-11-02T10:00:00" }), now)).toEqual(joins);
  });

  it("is the soonest dated thing this week, before an objective at risk", () => {
    expect(teamNext(person({ oneOnOneAt: new Date(2026, 10, 1, 11).toISOString(), attention: "atRisk" }), now))
      .toMatchObject({ kind: "OneOnOne", today: true });
    const anniversary = { kind: "Anniversary" as const, date: "2026-11-05", years: 4 };
    expect(teamNext(person({ events: [anniversary], oneOnOneAt: "2026-11-12T10:00:00" }), now)).toEqual(anniversary);
  });

  it("puts an objective at risk ahead of anything later in the month", () => {
    expect(teamNext(person({ attention: "atRisk", oneOnOneAt: "2026-11-20T10:00:00" }), now)).toEqual({ kind: "atRisk" });
    expect(teamNext(person({ oneOnOneAt: "2026-11-20T10:00:00" }), now)).toMatchObject({ kind: "OneOnOne", today: false });
    expect(teamNext(person({}), now)).toBeNull();
  });
});

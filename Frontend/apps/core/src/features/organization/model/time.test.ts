import { describe, expect, it } from "vitest";
import { PAST_SHARE, fromFraction, replayDays, timeSpan, timeTicks, toFraction } from "./time";

const TODAY = "2026-10-31";

describe("Organization's time slider", () => {
  it("reaches from the company's first day to a month past the last planned change", () => {
    expect(timeSpan("2019-01-01", TODAY, ["2026-11-17", "2027-01-01"])).toEqual({ lo: "2019-01-01", today: TODAY, hi: "2027-01-31" });
  });

  it("looks a quarter ahead with nothing planned, a year back without a first day, and two years ahead at most", () => {
    expect(timeSpan(null, TODAY, [])).toEqual({ lo: "2025-10-31", today: TODAY, hi: "2027-01-29" });
    expect(timeSpan("2019-01-01", TODAY, ["2031-01-01"]).hi).toBe("2028-10-30");
  });

  it("gives the past three quarters of the track and the planned months the rest, both ways", () => {
    const span = timeSpan("2019-01-01", TODAY, ["2027-01-01"]);
    expect(toFraction(span, TODAY)).toBe(PAST_SHARE);
    expect(toFraction(span, span.lo)).toBe(0);
    expect(toFraction(span, span.hi)).toBe(1);
    for (const day of ["2020-06-15", "2026-11-17", "2027-01-01"]) expect(fromFraction(span, toFraction(span, day))).toBe(day);
  });

  it("ticks years over a long past and quarters over a short one", () => {
    expect(timeTicks(timeSpan("2019-03-01", TODAY, []))).toContain("2024-01-01");
    expect(timeTicks(timeSpan("2026-01-15", TODAY, []))).toEqual(expect.arrayContaining(["2026-04-01", "2026-07-01"]));
  });

  it("replays from the first day to today, a quarter at a time, in at most 40 steps", () => {
    expect(replayDays(timeSpan("2026-02-10", TODAY, []))).toEqual(["2026-02-10", "2026-04-01", "2026-07-01", "2026-10-01", TODAY]);
    const long = replayDays(timeSpan("2001-01-01", TODAY, []));
    expect(long.length).toBeLessThanOrEqual(41);
    expect(long.at(0)).toBe("2001-01-01");
    expect(long.at(-1)).toBe(TODAY);
  });
});

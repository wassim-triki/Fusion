import { describe, expect, it } from "vitest";
import { paceOn, positionIn } from "@repo/performance-ui";
import { shareOf, statusFromPace, updatesAlone } from "./progress-dialog";

describe("updating progress (D-63)", () => {
  it("reads where a goal should be by a day from a straight pace across its window", () => {
    expect(positionIn("2026-01-01", "2026-12-31", "2026-01-01")).toBe(0);
    expect(paceOn("2026-01-01", "2026-12-31", "2026-07-02")).toBeCloseTo(50, 0);
    expect(positionIn("2026-01-01", "2026-12-31", "2027-03-01")).toBe(1);
  });

  it("prefills How it's going from the pace: close is on track, a little behind at risk, far behind off track", () => {
    expect(statusFromPace(45, 50)).toBe("OnTrack");
    expect(statusFromPace(30, 50)).toBe("AtRisk");
    expect(statusFromPace(10, 50)).toBe("OffTrack");
    expect(statusFromPace(80, 50)).toBe("OnTrack");
  });

  it("opens alone from a page's Update progress, never with the goal's panel behind it", () => {
    expect(updatesAlone({ presentation: "sheet", mode: "record", canUpdate: true, loading: false })).toBe(true);
    expect(updatesAlone({ presentation: "sheet", mode: "record", canUpdate: false, loading: true })).toBe(true);
    // A goal that turns out not to be updatable shows its panel; so does a goal opened to read, and the full page.
    expect(updatesAlone({ presentation: "sheet", mode: "record", canUpdate: false, loading: false })).toBe(false);
    expect(updatesAlone({ presentation: "sheet", mode: "details", canUpdate: true, loading: false })).toBe(false);
    expect(updatesAlone({ presentation: "page", mode: "record", canUpdate: true, loading: false })).toBe(false);
  });

  it("reads a number's share of the way whichever way the measure runs", () => {
    expect(shareOf(20, 85, 52.5)).toBe(50);
    expect(shareOf(25, 15, 20)).toBe(50);
    expect(shareOf(10, 10, 12)).toBe(0);
  });
});

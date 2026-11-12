import { describe, expect, it } from "vitest";
import type { FrontPageDto } from "@repo/api";
import { joinersByQuarter, periodEnd } from "./people-insights";

const span = (from: string, to: string | null = null) => ({
  from, to, job: null, place: null, firstDay: from, departmentId: null, department: "Engineering", parent: null, managerKey: null,
});

const data = {
  today: "2026-11-12",
  firstDate: "2024-03-01",
  lastDate: "2026-11-12",
  people: [
    { employeeKey: "A", name: "Aicha", photoUrl: null, spans: [span("2024-03-01")] },
    { employeeKey: "B", name: "Mariam", photoUrl: null, spans: [span("2026-07-15")] },
    // Moved department in October: one stretch ends where the next begins, so she joined once.
    { employeeKey: "C", name: "Omar", photoUrl: null, spans: [span("2026-08-01", "2026-10-01"), { ...span("2026-10-01"), department: "Product" }] },
  ],
} as unknown as FrontPageDto;

describe("Insights › People", () => {
  it("counts who joined in each of the last twelve quarters, a move not counted as joining", () => {
    const quarters = joinersByQuarter(data, data.today);
    expect(quarters).toHaveLength(12);
    expect(quarters.at(-1)).toMatchObject({ year: 2026, quarter: 4 });
    const q3 = quarters.find((q) => q.year === 2026 && q.quarter === 3)!;
    expect(q3.people.map((p) => p.name).sort()).toEqual(["Mariam", "Omar"]);
    expect(quarters.find((q) => q.year === 2026 && q.quarter === 4)!.people).toEqual([]);
    expect(quarters.find((q) => q.year === 2024 && q.quarter === 1)!.people.map((p) => p.name)).toEqual(["Aicha"]);
  });

  it("reads a past year as it stood on its last day, and never past today", () => {
    expect(periodEnd(data, "today")).toBe("2026-11-12");
    expect(periodEnd(data, "2025")).toBe("2025-12-31");
    expect(joinersByQuarter(data, periodEnd(data, "2025")).flatMap((q) => q.people)).toHaveLength(1);
  });
});

import { expect, it } from "vitest";
import { formatWorkWeek } from "../company-home";
it("formats contiguous, split and single-day work weeks in the viewer's language", () => {
  expect(formatWorkWeek([5, 1, 3, 2, 4], "en")).toBe("Mon–Fri");
  expect(formatWorkWeek([7, 1, 3], "en")).toBe("Mon, Wed, & Sun");
  expect(formatWorkWeek([6], "fr")).toBe("sam.");
  expect(formatWorkWeek([1, 2, 3, 4, 5], "ar")).toContain("الاثنين");
});

import "@testing-library/jest-dom/vitest";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderInArabic, sayInArabic } from "@/test/intl";
import { EmploymentStatus } from "@/features/people/components/workforce-ui";
import { formatEmploymentType } from "@/features/people/components/worker-profile/worker-profile-view";
import { leftSummary } from "@/features/company-import/components/understood";

describe("Core HR in Arabic", () => {
  it("names an employment state and a worker type in Arabic", () => {
    renderInArabic(<EmploymentStatus state="Scheduled" />);
    expect(screen.getByText("مجدول")).toBeInTheDocument();
    expect(formatEmploymentType("PartTime", { say: sayInArabic("profile") })).toBe("دوام جزئي");
  });

  it("says what the import left out in Arabic", () => {
    const say = sayInArabic("companyImport");
    const leftOut = [
      { kind: "column" as const, fileName: "people.xlsx", sheet: "Staff", what: "Salary", count: 1, names: [] },
      { kind: "left" as const, fileName: "people.xlsx", sheet: "Staff", what: null, count: 12, names: [] },
    ];
    expect(leftSummary({ leftOut }, (key, values) => say(`left.${key}`, values))).toBe("العمود Salary · 12 شخصًا غادروا");
  });
});

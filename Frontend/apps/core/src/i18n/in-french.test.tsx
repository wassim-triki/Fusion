import "@testing-library/jest-dom/vitest";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderInFrench, sayInFrench } from "@/test/intl";
import { EmploymentStatus } from "@/features/people/components/workforce-ui";
import { formatEmploymentType } from "@/features/people/components/worker-profile/worker-profile-view";
import { leftSummary } from "@/features/company-import/components/understood";

describe("Core HR in French", () => {
  it("names an employment state and a worker type in French", () => {
    renderInFrench(<EmploymentStatus state="Scheduled" />);
    expect(screen.getByText("À venir")).toBeInTheDocument();
    expect(formatEmploymentType("PartTime", { say: sayInFrench("profile") })).toBe("Temps partiel");
  });

  it("says what the import left out in French", () => {
    const say = sayInFrench("companyImport");
    const leftOut = [
      { kind: "column" as const, fileName: "people.xlsx", sheet: "Staff", what: "Salary", count: 1, names: [] },
      { kind: "left" as const, fileName: "people.xlsx", sheet: "Staff", what: null, count: 12, names: [] },
    ];
    expect(leftSummary({ leftOut }, (key, values) => say(`left.${key}`, values))).toBe("la colonne Salary · 12 personnes parties");
  });
});

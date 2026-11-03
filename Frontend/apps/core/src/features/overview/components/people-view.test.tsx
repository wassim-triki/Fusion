// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { FrontPagePersonDto } from "@repo/api";
import { PeopleView } from "./people-view";

vi.mock("@repo/api/query", () => ({ usePhoto: () => null }));
afterEach(cleanup);
const person: FrontPagePersonDto = {
  employeeKey: "ada",
  name: "Ada Lee",
  photoUrl: null,
  job: "Engineer",
  place: "Tunis",
  firstDay: "2020-01-01",
  departmentId: "eng",
  department: "Engineering",
  parent: null,
  managerKey: null,
};

describe("People's face wall", () => {
  it("provides its own tooltip context and keeps real named faces when regrouped", () => {
    const view = render(
      <PeopleView people={[person]} by="department" date="2026-01-01" />
    );
    expect(screen.getByRole("img", { name: "Ada Lee" })).toBeInTheDocument();
    expect(screen.getByText("Engineering")).toBeInTheDocument();
    view.rerender(
      <PeopleView people={[person]} by="place" date="2026-01-01" />
    );
    expect(screen.getByRole("img", { name: "Ada Lee" })).toBeInTheDocument();
    expect(screen.getByText("Tunis")).toBeInTheDocument();
  });
});

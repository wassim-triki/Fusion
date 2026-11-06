// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { FrontPageDto } from "@repo/api";
import type { FrontPerson } from "../model/front-page";
import { FrontPageContent } from "./front-page";

vi.mock("@repo/auth", () => ({
  useAuth: () => ({ user: {} }),
  canViewCoreOrganization: () => false,
  canAccessCorePeople: () => true,
}));
vi.mock("@repo/api/query", () => ({ usePhoto: () => null }));
vi.mock("./growth-view", () => ({
  GrowthView: ({ date }: { date: string }) => (
    <div aria-label="Growth chart">{date}</div>
  ),
}));
vi.mock("./people-view", () => ({
  PeopleView: ({ people }: { people: FrontPerson[] }) => (
    <div aria-label="People wall">{people.map((p) => p.name).join(", ")}</div>
  ),
  FrontFace: () => <span />,
}));

const ada: FrontPerson = {
  employeeKey: "ada",
  name: "Ada Lee",
  photoUrl: null,
  job: "Engineer",
  place: "Tunis",
  firstDay: "2020-01-01",
  departmentId: "eng",
  department: "Engineering",
  parent: "Technology",
  managerKey: null,
};
const bo: FrontPerson = {
  ...ada,
  employeeKey: "bo",
  name: "Bo Kim",
  firstDay: "2026-01-08",
  managerKey: "ada",
};
const data: FrontPageDto = {
  today: "2026-01-01",
  firstDate: "2020-01-01",
  lastDate: "2026-04-01",
  teamOnly: false,
  unitLevel: "Department",
  fields: ["name", "job", "place", "first-day"],
  people: [ada, bo].map(({ employeeKey, name, photoUrl, ...details }) => ({
    employeeKey,
    name,
    photoUrl,
    spans: [{ from: details.firstDay!, to: null, ...details }],
  })),
  openRoles: [
    {
      id: "r",
      job: "Designer",
      place: "Tunis",
      unit: "Engineering",
      targetStartDate: null,
      managerKey: null,
    },
  ],
  recordsToComplete: [
    {
      employeeKey: "ada",
      displayName: "Ada Lee",
      jobTitle: "Engineer",
      missing: ["Phone"],
    },
  ],
};
afterEach(cleanup);

describe("Core HR's front page", () => {
  it.each([
    ["Division", "Divisions"],
    ["Department", "Departments"],
    ["Unit", "Units"],
  ] as const)("calls a %s company's groups %s", (unitLevel, word) => {
    render(<FrontPageContent data={{ ...data, unitLevel }} />);
    expect(screen.getByLabelText(word)).toBeInTheDocument();
  });

  it("keeps one selected date across Growth, People and department counts", () => {
    render(<FrontPageContent data={data} />);
    expect(screen.getByTestId("front-count")).toHaveTextContent("1");
    expect(screen.getByLabelText("Growth chart")).toHaveTextContent(
      "2026-01-01"
    );
    fireEvent.change(screen.getByRole("slider"), { target: { value: "1000" } });
    expect(screen.getByTestId("front-count")).toHaveTextContent("2");
    const cards = screen.getByLabelText("Departments");
    expect(within(cards).getByText("2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "People" }));
    expect(screen.getByLabelText("People wall")).toHaveTextContent(
      "Ada Lee, Bo Kim"
    );
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByLabelText("People wall")).toHaveTextContent("Ada Lee");
    expect(screen.getByLabelText("People wall")).not.toHaveTextContent(
      "Bo Kim"
    );
  });
  it("shows real upcoming people, open roles and links to every incomplete record", () => {
    render(<FrontPageContent data={data} />);
    expect(
      screen.getAllByText("Bo Kim joins Engineering").length
    ).toBeGreaterThan(0);
    expect(screen.getByText("Designer")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Phone"));
    expect(screen.getByRole("link", { name: "Open record" })).toHaveAttribute(
      "href",
      "/people/ada?tab=personal"
    );
  });
  it("omits regrouping by fields that Reports did not make visible, and renders empty data", () => {
    render(
      <FrontPageContent
        data={{
          ...data,
          fields: ["name"],
          people: [],
          recordsToComplete: [],
          openRoles: [],
        }}
      />
    );
    fireEvent.click(screen.getByRole("radio", { name: "People" }));
    expect(
      screen.queryByRole("radio", { name: "Place" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("radio", { name: "Time here" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("No required details missing.")
    ).toBeInTheDocument();
    expect(screen.getByText("No open roles.")).toBeInTheDocument();
  });
});

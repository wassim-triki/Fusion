// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";
import type { MyManagerDto } from "@repo/api";
import { renderWithIntl } from "@/test/intl";
import { YourManagerCard } from "./home-cards";
import { CompanyCard } from "./setup-guide";

const manager = (): MyManagerDto => ({
  manager: { employeeKey: "E-MG", displayName: "Mariam Gharbi", jobTitle: "VP, Product", photoUrl: null, unit: "Product", place: "Tunis" },
  isFirstWeek: true,
  teammates: [
    { employeeKey: "E-AB", displayName: "Aicha Bouazizi", jobTitle: "QA Automation Engineer", photoUrl: null },
    { employeeKey: "E-YT", displayName: "Yasmine Trabelsi", jobTitle: "Product Manager", photoUrl: null },
  ],
  teammateCount: 3,
});
const mocks = vi.hoisted(() => ({
  manager: { data: undefined as MyManagerDto | undefined, isLoading: false, error: null as Error | null, refetch: vi.fn() },
  week: { data: { workingDays: [1, 2, 3, 4, 5] }, isLoading: false, error: null as Error | null, refetch: vi.fn() },
  people: true,
}));
vi.mock("@repo/api/query", () => ({
  useMyManager: () => mocks.manager,
  useCompanyWorkWeek: () => mocks.week,
  usePhoto: () => null,
  useTenantSummary: () => ({ data: { name: "Carthage", language: "en", timeZone: "Africa/Tunis" }, isLoading: false }),
}));
vi.mock("@repo/auth", () => ({ PageFailure: ({ title, onRetry }: { title: string; onRetry: () => void }) => <div>{title}<button onClick={onRetry}>Try again</button></div>, useAuth: () => ({ user: { employeeId: "me" } }), canAccessCorePeople: () => mocks.people }));
const guide = { people: 100, faces: [{ key: "E-AK", name: "Amira Khelifi", photoUrl: null }] };
beforeEach(() => {
  mocks.manager.data = manager(); mocks.manager.error = null; mocks.manager.isLoading = false; mocks.people = true;
  mocks.week.error = null; mocks.week.isLoading = false; mocks.manager.refetch.mockClear(); mocks.week.refetch.mockClear();
});
afterEach(cleanup);

it("shows the joiner's manager with their page and who else reports to them, then the empty state; hides after the first week", () => {
  const view = renderWithIntl(<YourManagerCard query={mocks.manager} />);
  expect(screen.getByText("Mariam Gharbi")).toBeTruthy();
  expect(screen.getByText("Product · Tunis")).toBeTruthy();
  expect(screen.getByRole("link", { name: /Open profile/ }).getAttribute("href")).toBe("/core/people/E-MG");
  expect(screen.getByText("Also reporting to Mariam")).toBeTruthy();
  expect(screen.getByText("Aicha Bouazizi")).toBeTruthy();
  expect(screen.getByText("and 1 more")).toBeTruthy();
  mocks.people = false; view.rerender(<YourManagerCard query={mocks.manager} />);
  expect(screen.queryByRole("link", { name: /Open profile/ })).toBeNull();
  mocks.manager.data!.manager = null; view.rerender(<YourManagerCard query={mocks.manager} />);
  expect(screen.getByText("No manager assigned")).toBeTruthy();
  mocks.manager.data!.isFirstWeek = false; view.rerender(<YourManagerCard query={mocks.manager} />);
  expect(screen.queryByText("Your manager")).toBeNull();
});
it("shows manager loading and a retry after failure", () => {
  mocks.manager.data = undefined; mocks.manager.isLoading = true;
  const view = renderWithIntl(<YourManagerCard query={mocks.manager} />); expect(screen.getByLabelText("Loading your manager")).toBeTruthy();
  mocks.manager.isLoading = false; mocks.manager.error = new Error("offline"); view.rerender(<YourManagerCard query={mocks.manager} />);
  expect(screen.getByText("Your manager did not load")).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "Try again" })); expect(mocks.manager.refetch).toHaveBeenCalledOnce();
});
it.each(["en", "fr", "ar"] as const)("sums the company up in one line with its people in %s", (locale) => {
  renderWithIntl(<><CompanyCard guide={guide} /><YourManagerCard query={mocks.manager} /></>, { locale });
  expect(screen.getByText("Mariam Gharbi")).toBeTruthy();
  expect(screen.getByText(/Tunis · /)).toBeTruthy();
  expect(screen.getByText(locale === "en" ? "100 people" : locale === "fr" ? "100 collaborateurs" : "100 شخص")).toBeTruthy();
});
it("shows work-week loading and retries a failed read", () => {
  mocks.week.isLoading = true; const view = renderWithIntl(<CompanyCard guide={guide} />); expect(screen.getByLabelText("Loading work week")).toBeTruthy();
  mocks.week.isLoading = false; mocks.week.error = new Error("offline"); view.rerender(<CompanyCard guide={guide} />);
  expect(screen.getByText("Work week did not load")).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "Try again" })); expect(mocks.week.refetch).toHaveBeenCalledOnce();
});

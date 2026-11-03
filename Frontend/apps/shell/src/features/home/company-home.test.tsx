// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { YourManagerCard } from "./home-cards";
import { CompanyCard } from "./setup-guide";
const mocks = vi.hoisted(() => ({
  manager: { data: { manager: { displayName: "Mariam Gharbi", jobTitle: "VP, Product" }, isFirstWeek: true } as { manager: { displayName: string; jobTitle: string } | null; isFirstWeek: boolean } | undefined, isLoading: false, error: null as Error | null, refetch: vi.fn() },
  week: { data: { workingDays: [1, 2, 3, 4, 5] }, isLoading: false, error: null as Error | null, refetch: vi.fn() },
}));
vi.mock("@repo/api/query", () => ({
  useMyManager: () => mocks.manager,
  useCompanyWorkWeek: () => mocks.week,
  useTenantSummary: () => ({ data: { name: "Carthage", language: "en", timeZone: "Africa/Tunis" } }),
}));
vi.mock("@repo/auth", () => ({ useAuth: () => ({ user: null }) }));
beforeEach(() => { mocks.manager.data = { manager: { displayName: "Mariam Gharbi", jobTitle: "VP, Product" }, isFirstWeek: true }; mocks.manager.error = null; mocks.manager.isLoading = false; mocks.week.error = null; mocks.week.isLoading = false; mocks.manager.refetch.mockClear(); mocks.week.refetch.mockClear(); });
afterEach(cleanup);
it("shows the joiner's manager, then an explicit empty state; hides the card after the first week", () => {
  const view = renderWithIntl(<YourManagerCard query={mocks.manager} />); expect(screen.getByText("Mariam Gharbi")).toBeTruthy(); expect(screen.getByText("VP, Product")).toBeTruthy();
  mocks.manager.data!.manager = null; view.rerender(<YourManagerCard query={mocks.manager} />); expect(screen.getByText("No manager assigned")).toBeTruthy();
  mocks.manager.data!.isFirstWeek = false; view.rerender(<YourManagerCard query={mocks.manager} />); expect(screen.queryByText("Your manager")).toBeNull();
});
it("shows manager loading and a retry after failure", () => {
  mocks.manager.data = undefined; mocks.manager.isLoading = true;
  const view = renderWithIntl(<YourManagerCard query={mocks.manager} />); expect(screen.getByLabelText("Loading your manager")).toBeTruthy();
  mocks.manager.isLoading = false; mocks.manager.error = new Error("offline"); view.rerender(<YourManagerCard query={mocks.manager} />);
  expect(screen.getByRole("alert").textContent).toBe("Your manager did not load"); fireEvent.click(screen.getByRole("button", { name: "Try again" })); expect(mocks.manager.refetch).toHaveBeenCalledOnce();
});
it.each(["en", "fr", "ar"] as const)("names the company work week and manager in %s", (locale) => {
  renderWithIntl(<><CompanyCard /><YourManagerCard query={mocks.manager} /></>, { locale }); expect(screen.getByText("Mariam Gharbi")).toBeTruthy(); expect(screen.getByText(locale === "en" ? "Work week" : locale === "fr" ? "Semaine de travail" : "أسبوع العمل")).toBeTruthy();
});
it("shows work-week loading and retries a failed read", () => {
  mocks.week.isLoading = true; const view = renderWithIntl(<CompanyCard />); expect(screen.getByLabelText("Loading work week")).toBeTruthy();
  mocks.week.isLoading = false; mocks.week.error = new Error("offline"); view.rerender(<CompanyCard />);
  expect(screen.getByText("Work week did not load")).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "Try again" })); expect(mocks.week.refetch).toHaveBeenCalledOnce();
});

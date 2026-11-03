import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntlTestProvider } from "@repo/ds/testing";
import type * as ApiReact from "@repo/api/react";
import dsEn from "@repo/ds/messages/en.json";
import { loadCoreMessages } from "@/i18n/messages";
import { DetailsSettings } from "./sections/details";

const mocks = vi.hoisted(() => ({ save: vi.fn(), error: null as Error | null }));
vi.mock("@repo/api/query", () => ({
  useTenantSummary: () => ({ data: { name: "Carthage", timeZone: "Africa/Tunis" }, error: null }),
  useSettingsConflictSaver: () => null,
}));
vi.mock("@repo/api/react", async (original) => ({ ...await original<typeof ApiReact>(), useFusionViewer: () => ({ viewer: null }) }));
vi.mock("./api/use-tenant-settings", () => ({
  useOrganizationSettings: () => ({ data: { version: 42, workingDays: [1, 2, 3, 4, 5] }, error: mocks.error, refetch: vi.fn() }),
  useUpdateOrganizationSettings: () => ({ mutateAsync: mocks.save }),
}));
const en = await loadCoreMessages("en");
function show(access: "view" | "manage" = "manage") {
  return render(<IntlTestProvider messages={{ ...dsEn, ...en }}><DetailsSettings section={{ id: "details", label: "Details", path: "/core/settings/details", order: 2, access, lastChange: null }} /></IntlTestProvider>);
}
beforeEach(() => { mocks.save.mockReset(); mocks.error = null; });
afterEach(cleanup);
it("stages the work week, discards it and saves with the current version", async () => {
  const user = userEvent.setup(); show();
  await user.click(screen.getByRole("button", { name: "Saturday" }));
  expect(screen.getByRole("combobox", { name: "Common work weeks" })).toHaveTextContent("Custom week");
  expect(screen.getByText("Sunday off")).toBeInTheDocument();
  expect(mocks.save).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Discard" }));
  expect(screen.getByRole("button", { name: "Saturday" })).toHaveAttribute("aria-pressed", "false");
  await user.click(screen.getByRole("button", { name: "Sunday" }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ expectedVersion: 42, workingDays: [1, 2, 3, 4, 5, 7] }));
});
it("keeps at least one day selected and retains edits when saving fails", async () => {
  mocks.save.mockRejectedValue(new Error("Offline")); const user = userEvent.setup(); show();
  for (const name of ["Tuesday", "Wednesday", "Thursday", "Friday"]) await user.click(screen.getByRole("button", { name }));
  expect(screen.getByRole("button", { name: "Monday" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(screen.getByText("The work week was not saved.")).toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Tuesday" })).toHaveAttribute("aria-pressed", "false");
});
it("sets common weeks as staged edits and saves the exact Sunday–Thursday days", async () => {
  const user = userEvent.setup(); show();
  await user.click(screen.getByRole("combobox", { name: "Common work weeks" }));
  await user.click(screen.getByRole("option", { name: "Every day" }));
  expect(screen.getByText("No days off")).toBeInTheDocument();
  expect(mocks.save).not.toHaveBeenCalled();
  await user.click(screen.getByRole("combobox", { name: "Common work weeks" }));
  await user.click(screen.getByRole("option", { name: "Sunday–Thursday" }));
  expect(screen.getByRole("button", { name: "Sunday" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Friday" })).toHaveAttribute("aria-pressed", "false");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ expectedVersion: 42, workingDays: [1, 2, 3, 4, 7] }));
});
it("renders a view-only work week without editing controls", () => {
  show("view"); expect(screen.getByText("Mon–Fri")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Monday" })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Common work weeks" })).toBeNull();
});

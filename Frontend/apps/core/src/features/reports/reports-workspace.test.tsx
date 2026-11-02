// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultDefinition, ReportsWorkspace } from "./reports-workspace";
import type { ReportFieldDto } from "@repo/api";

const state = vi.hoisted(() => ({
  build: false,
  see: true,
  unit: "people",
  manySeries: false,
  runLoading: false,
  runError: false,
  manyRun: {
    periods: [{ from: "2026-01-01", to: "2026-01-01" }],
    series: Array.from({ length: 12 }, (_, i) => ({ key: `group-${i + 1}`, label: `Group ${i + 1}`, values: [1], change: 0 })),
    totals: [12], fields: [], people: [], unit: "people", filterOptions: {}, personOptions: [],
  },
  share: vi.fn(),
  save: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@repo/auth", () => ({
  useAuth: () => ({ user: {}, isLoading: false }),
  canViewCoreReports: () => state.see,
  canBuildCoreReports: () => state.build,
}));
vi.mock("@/shell/breadcrumb-overrides", () => ({
  useBreadcrumbLabel: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}));
vi.mock("@repo/api", async (original) => ({
  ...(await original<object>()),
  createPlatformApiClient: () => ({}),
  createCoreReportsApi: () => ({ share: state.share, save: state.save }),
}));
vi.mock("@repo/api/query", () => ({
  useApiQuery: (
    key: string[],
    _fetch: unknown,
    options?: { enabled?: boolean }
  ) => ({
    data:
      options?.enabled === false || (key[1] === "run" && (state.runLoading || state.runError))
        ? undefined
        : key[1] === "fields"
          ? [
              { key: "division", label: "Division", kind: "choice" },
              { key: "name", label: "Name", kind: "person" },
              { key: "first-day", label: "First day", kind: "date" },
              { key: "tenure", label: "Time with the company", kind: "number" },
            ]
          : key[1] === "list"
            ? []
            : key[1] === "roles"
              ? [{ id: "managers", name: "Managers" }]
              : key[1] === "saved"
                ? {
                    id: "own",
                    name: "Engineering",
                    canEdit: true,
                    roleIds: [],
                    definition: {
                      measure: "headcount",
                      groupBy: "division",
                      mode: "date",
                      from: "2026-01-01",
                      to: "2026-01-01",
                      interval: "year",
                      fields: [],
                      filters: [],
                    },
                  }
                : state.manySeries ? state.manyRun : {
                    periods: [{ from: "2026-01-01", to: "2026-01-01" }],
                    series: [
                      {
                        key: "Engineering",
                        label: "Engineering",
                        values: [2],
                        change: 0,
                      },
                    ],
                    totals: [2],
                    fields: [],
                    people: [],
                    unit: state.unit,
                    filterOptions: { division: ["Engineering", "Sales"] },
                    personOptions: [{ key: "person-1", name: "Pat Lee", detail: "Engineer" }, { key: "person-2", name: "Pat Lee", detail: "Manager" }],
                  },
    isLoading: key[1] === "run" && state.runLoading,
    isFetching: key[1] === "run" && state.runLoading,
    error: key[1] === "run" && state.runError ? new Error("failed") : null,
    refetch: vi.fn(),
  }),
}));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.save.mockReset();
  state.share.mockReset();
  state.build = false;
  state.see = true;
  state.unit = "people";
  state.manySeries = false;
  state.runLoading = false;
  state.runError = false;
});

describe("Reports", () => {
  it("defaults to available people columns without requesting restricted fields", () => {
    const available: ReportFieldDto[] = [
      { key: "name", label: "Name", kind: "person" },
      { key: "division", label: "Division", kind: "choice" },
      { key: "place", label: "Place", kind: "choice" },
    ];
    expect(defaultDefinition("headcount", "2026-01-01", available).fields).toEqual(["name", "division", "place"]);
    expect(defaultDefinition("open-roles", "2026-01-01", available).fields).toEqual([]);
  });
  it("shows People loading until report data arrives and never presents an empty hint on error", () => {
    state.runLoading = true;
    const { rerender } = render(<ReportsWorkspace reportId="headcount" />);
    expect(screen.getByRole("status", { name: "Loading people" })).toBeInTheDocument();
    expect(screen.queryByText("Choose columns to show people.")).not.toBeInTheDocument();
    state.runLoading = false;
    rerender(<ReportsWorkspace reportId="headcount" />);
    expect(screen.queryByRole("status", { name: "Loading people" })).not.toBeInTheDocument();
    expect(screen.getByText("Choose columns to show people.")).toBeInTheDocument();
    state.runError = true;
    rerender(<ReportsWorkspace reportId="headcount" />);
    expect(screen.queryByText("Choose columns to show people.")).not.toBeInTheDocument();
  });

  it("shows a single unit label and omits change for one period", () => {
    state.unit = "years";
    render(<ReportsWorkspace reportId="tenure" />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByText("2")).toHaveLength(2);
    expect(within(table).queryByText("2 years")).not.toBeInTheDocument();
    expect(within(table).queryByText("Change")).not.toBeInTheDocument();
    expect(screen.getByText("years")).toBeInTheDocument();
  });

  it("limits the legend and lets people page through the summary", async () => {
    state.manySeries = true;
    const user = userEvent.setup();
    render(<ReportsWorkspace reportId="headcount" />);
    const legend = screen.getByRole("group", { name: "Headcount" });
    await user.click(within(legend).getByRole("button", { name: "Show 4 more" }));
    expect(within(legend).queryByRole("button", { name: "Show 4 more" })).not.toBeInTheDocument();
    await user.click(within(legend).getByRole("button", { name: "Show less" }));
    expect(within(legend).getByRole("button", { name: "Show 4 more" })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Everyone")).toBeInTheDocument();
    expect(within(table).queryByText("Group 12")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(within(table).getByText("Group 12")).toBeInTheDocument();
  });

  it("opens name search, a calendar for first day, and a numeric tenure range", async () => {
    const user = userEvent.setup();
    render(<ReportsWorkspace reportId="headcount" />);
    const filters = screen.getByRole("button", { name: "Filters" });
    expect(filters).toHaveAttribute("aria-expanded", "false");
    await user.click(filters);
    expect(filters).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "Filter by Name" }));
    expect(screen.getByRole("textbox", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox", { name: "Pat Lee · Engineer" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox", { name: "Pat Lee · Manager" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Pat Lee · Engineer" }));
    expect(screen.getByRole("menuitemcheckbox", { name: "Pat Lee · Engineer" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemcheckbox", { name: "Pat Lee · Manager" })).toHaveAttribute("aria-checked", "false");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await user.click(screen.getByRole("button", { name: "Filter by First day" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("grid")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Filter by Time with the company" }));
    await user.type(screen.getByLabelText("From"), "1");
    await user.type(screen.getByLabelText("To"), "3");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("button", { name: "Time with the company: 1 to 3 years" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove Time with the company filter" }));
    expect(screen.getByRole("button", { name: "Filter by Time with the company" })).toBeInTheDocument();
  });

  it("resets field search after the picker is closed", async () => {
    const user = userEvent.setup();
    render(<ReportsWorkspace reportId="headcount" />);
    await user.click(screen.getByRole("button", { name: "Choose columns" }));
    await user.type(screen.getByRole("textbox", { name: "Search fields" }), "division");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Choose columns" }));
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("restores the selected range after switching to a single date and back", async () => {
    const user = userEvent.setup();
    render(<ReportsWorkspace reportId="headcount" />);
    const original = screen.getByRole("button", { name: "Between two dates" }).textContent;
    await user.click(screen.getByRole("radio", { name: "On a date" }));
    await user.click(screen.getByRole("radio", { name: "Between two dates" }));
    expect(screen.getByRole("button", { name: "Between two dates" })).toHaveTextContent(original!);
  });

  it("keeps multiple filter choices and clears them together", async () => {
    const user = userEvent.setup();
    render(<ReportsWorkspace reportId="headcount" />);
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.click(screen.getByRole("button", { name: "Filter by Division" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Engineering" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Sales" }));
    expect(screen.getByRole("menuitemcheckbox", { name: "Engineering" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemcheckbox", { name: "Sales" })).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("button", { name: "Filter by Division" })).toBeInTheDocument();
  });

  it("lets a See viewer run reports and export, with no build or sharing actions", () => {
    render(<ReportsWorkspace reportId="headcount" />);
    expect(
      screen.getByRole("heading", { name: "Headcount" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Share" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "New report" })
    ).not.toBeInTheDocument();
  });

  it("starts from a standard report and saves a named copy", async () => {
    state.build = true;
    state.save.mockImplementation(async (name, definition) => ({ id: "copy", name, definition, canEdit: true, roleIds: [] }));
    render(<ReportsWorkspace reportId="headcount" />);
    expect(screen.queryByRole("link", { name: /New report/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Headcount" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save as" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My headcount" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(state.save).toHaveBeenCalledWith("My headcount", expect.objectContaining({ measure: "headcount" })));
  });

  it("shares an owned report with the chosen role", async () => {
    state.build = true;
    render(<ReportsWorkspace reportId="own" />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.click(screen.getByLabelText("Managers"));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Share" })
    );
    await waitFor(() =>
      expect(state.share).toHaveBeenCalledWith("own", ["managers"])
    );
  });

  it("saves and shares a standard report in one flow", async () => {
    state.build = true;
    state.save.mockImplementation(async (name, definition) => ({
      id: "copy",
      name,
      definition,
      canEdit: true,
      roleIds: [],
    }));
    render(<ReportsWorkspace reportId="headcount" />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Headcount");
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Share" })
    ).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Managers"));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Share" })
    );
    await waitFor(() =>
      expect(state.share).toHaveBeenCalledWith("copy", ["managers"])
    );
    expect(state.save).toHaveBeenCalledTimes(1);
  });

  it("defaults to Save as when an owned report has no changes", async () => {
    state.build = true;
    const user = userEvent.setup();
    render(<ReportsWorkspace reportId="own" />);
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save as" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Engineering");
  });

  it("saves changes to the existing report instead of creating a copy", async () => {
    state.build = true;
    state.save.mockImplementation(async (name, definition) => ({
      id: "own",
      name,
      definition,
      canEdit: true,
      roleIds: [],
    }));
    render(<ReportsWorkspace reportId="own" />);
    expect(screen.getByRole("button", { name: "Save as" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Choose columns" }));
    fireEvent.click(screen.getByLabelText("Name"));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.getByRole("button", { name: "More save options" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(state.save).toHaveBeenCalledWith(
        "Engineering",
        expect.objectContaining({ fields: ["name"] }),
        "own"
      )
    );
  });

  it("retries sharing after a failed share without creating another report", async () => {
    state.build = true;
    state.save.mockImplementation(async (name, definition) => ({
      id: "copy",
      name,
      definition,
      canEdit: true,
      roleIds: [],
    }));
    state.share
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValueOnce(undefined);
    render(<ReportsWorkspace reportId="headcount" />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.click(screen.getByLabelText("Managers"));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Share" })
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Sharing could not be saved"
      )
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Share" })
    );
    await waitFor(() => expect(state.share).toHaveBeenCalledTimes(2));
    expect(state.save).toHaveBeenCalledTimes(1);
  });

  it("shows no report content without Reports access", () => {
    state.see = false;
    render(<ReportsWorkspace reportId="headcount" />);
    expect(
      screen.queryByRole("button", { name: "Export" })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

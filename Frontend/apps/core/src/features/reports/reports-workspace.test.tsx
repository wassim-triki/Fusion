// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ReportsWorkspace } from "./reports-workspace";

const state = vi.hoisted(() => ({
  build: false,
  see: true,
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
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@repo/api", async (original) => ({
  ...(await original<object>()),
  createPlatformApiClient: () => ({}),
  createCoreReportsApi: () => ({ share: state.share, save: state.save }),
}));
vi.mock("@repo/api/query", () => ({
  useApiQuery: (key: string[]) => ({
    data:
      key[1] === "fields"
        ? [
            { key: "division", label: "Division" },
            { key: "name", label: "Name" },
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
              : {
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
                  unit: "people",
                },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.build = false;
  state.see = true;
});

describe("Reports", () => {
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

  it("shares an owned report with the chosen role", async () => {
    state.build = true;
    render(<ReportsWorkspace reportId="own" />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.click(screen.getByLabelText("Managers"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(state.share).toHaveBeenCalledWith("own", ["managers"])
    );
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

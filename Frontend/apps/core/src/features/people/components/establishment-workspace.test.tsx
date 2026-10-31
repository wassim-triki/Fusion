// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

// Radix Collapsible measures its content with ResizeObserver, which jsdom lacks.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const { mockPush, mockUseOrg, mockUseManagers, mockMutations } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockUseOrg: vi.fn(() => ({ data: { roots: [] }, isLoading: false, error: null })),
  mockUseManagers: vi.fn(() => ({ data: [], isLoading: false })),
  mockMutations: vi.fn(() => ({
    review: { mutateAsync: vi.fn(), isLoading: false },
    hire: { mutateAsync: vi.fn(), isLoading: false },
    addExisting: { mutateAsync: vi.fn(), isLoading: false },
  })),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === "string" ? href : String(href)} {...props}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/features/organization/api/use-organization", () => ({
  useOrganizationHierarchy: () => mockUseOrg(),
}));

vi.mock("../api/use-people", () => ({
  usePeopleEstablishmentMutations: () => mockMutations(),
}));

vi.mock("../changes/use-changes", () => ({
  useManagerOptions: () => mockUseManagers(),
}));

// The catalogue pickers read the company's jobs and places; here they only need to render.
vi.mock("@/features/catalog/components/catalog-pickers", () => ({
  JobPicker: ({ id }: { id?: string }) => <button type="button" id={id}>Pick a job</button>,
  PlacePicker: ({ id }: { id?: string }) => <button type="button" id={id}>Pick a place</button>,
}));

import EstablishmentWorkspace from "./establishment-workspace";

beforeEach(() => {
  mockPush.mockReset();
});

describe("EstablishmentWorkspace — Add existing", () => {
  it("uses product terminology and preserves the two-date model", () => {
    render(<EstablishmentWorkspace mode="add-existing" />);

    expect(screen.getByRole("heading", { level: 1, name: "Add existing employee" })).toBeInTheDocument();

    // A job picked from the company's catalogue, not a typed title.
    expect(screen.getAllByText("Job").length).toBeGreaterThan(0);

    // Manager terminology, not PrimaryManager jargon
    expect(screen.getByText("Assign a manager")).toBeInTheDocument();
    expect(screen.queryByText(/Primary manager/i)).not.toBeInTheDocument();

    // The two distinct dates stay legible and separate
    expect(screen.getByText("Employment start")).toBeInTheDocument();
    expect(screen.getByText("Work details effective from")).toBeInTheDocument();

    // Employment type is gone from the Slice 1 UI
    expect(screen.queryByText(/Employment type/i)).not.toBeInTheDocument();

    // Compact number mode choice
    expect(screen.getByText("Generate automatically")).toBeInTheDocument();
    expect(screen.getByText("Enter manually")).toBeInTheDocument();

    // The resulting summary fills in progressively as identity is entered
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Amina" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Mansour" } });
    // ...and never says "Generated on hire" for an existing employee
    expect(screen.queryByText(/Generated on hire/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("Assigned automatically").length).toBeGreaterThan(0);
  });

  it("reveals the manual Employee Number field only when chosen", () => {
    render(<EstablishmentWorkspace mode="add-existing" />);
    expect(screen.queryByLabelText("Employee Number")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Enter manually"));
    expect(screen.getByLabelText("Employee Number")).toBeInTheDocument();
  });
});

describe("EstablishmentWorkspace — Hire", () => {
  it("uses a single start date and no work-details effective date", () => {
    render(<EstablishmentWorkspace mode="hire" />);
    expect(screen.getByRole("heading", { level: 1, name: "Hire employee" })).toBeInTheDocument();
    expect(screen.getByText("Start date")).toBeInTheDocument();
    expect(screen.queryByText("Work details effective from")).not.toBeInTheDocument();
    expect(screen.queryByText(/Employment type/i)).not.toBeInTheDocument();
  });

  it("treats a future start as Scheduled, not an error", () => {
    render(<EstablishmentWorkspace mode="hire" />);
    // The DS date picker: open it, go to next month, pick its 15th.
    fireEvent.click(screen.getByLabelText("Start date"));
    fireEvent.click(screen.getByRole("button", { name: /next month/i }));
    const grid = screen.getByRole("grid");
    fireEvent.click(within(grid).getAllByRole("button").find((day) => day.textContent === "15")!);
    expect(screen.getAllByText(/Scheduled/).length).toBeGreaterThan(0);
  });
});

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkforceAccountHistoryEventDto } from "@repo/api";
import { AccessHistory } from "./access-history";

const events: WorkforceAccountHistoryEventDto[] = [];
vi.mock("@/features/workforce-access/api/use-workforce-access", () => ({
  useAccessHistory: () => ({ data: events, isLoading: false, error: null, refetch: vi.fn() }),
}));

const grant = (kind: "RoleGiven" | "RoleRemoved", roleName: string, actorName: string | null, byRule: boolean): WorkforceAccountHistoryEventDto => ({
  kind,
  occurredAt: "2026-11-02T09:30:00Z",
  actorName,
  email: null,
  validUntil: null,
  roleName,
  byRule,
});

describe("Access history role grants (B-314)", () => {
  it("says who gave or removed a role, and when a rule did", () => {
    events.splice(0, events.length,
      grant("RoleGiven", "Managers", "Amira Khelifi", false),
      grant("RoleGiven", "Team leads", null, true),
      grant("RoleRemoved", "Payroll", "Amira Khelifi", false),
      grant("RoleRemoved", "Team leads", null, true));
    render(<AccessHistory employeeId="employee-1" firstName="Nour" />);
    expect(screen.getByText("Given the Managers role by Amira Khelifi")).toBeInTheDocument();
    expect(screen.getByText("Holds the Team leads role by rule")).toBeInTheDocument();
    expect(screen.getByText("Payroll role removed by Amira Khelifi")).toBeInTheDocument();
    expect(screen.getByText("Team leads role removed")).toBeInTheDocument();
    expect(screen.getByText("No longer matches the role's rule")).toBeInTheDocument();
  });
});

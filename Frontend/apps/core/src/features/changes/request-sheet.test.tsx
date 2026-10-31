// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ChangeRequestDto } from "@repo/api";

const { decline } = vi.hoisted(() => ({ decline: vi.fn().mockResolvedValue({}) }));
vi.mock("@/features/people/changes/use-changes", () => ({
  useChangeRequest: () => ({ data: undefined }),
  useRequestDecisions: () => ({
    approve: { isLoading: false, mutateAsync: vi.fn() },
    decline: { isLoading: false, mutateAsync: decline },
    withdraw: { isLoading: false, mutateAsync: vi.fn() },
  }),
}));

import { RequestDetail } from "./request-sheet";

function request(over: Partial<ChangeRequestDto> = {}): ChangeRequestDto {
  return {
    id: "r1", kind: "JobChange", status: "Pending",
    person: { employeeId: "a", employeeKey: "AICHA", displayName: "Aicha Bouazizi", jobTitle: "QA Automation Engineer", unit: "Consulting A Core" },
    requestedBy: { employeeId: "m", displayName: "Mariam Gharbi" }, requestedAt: "2026-10-31T08:00:00Z", effectiveDate: "2027-01-01",
    types: ["job"], description: "Promote Aicha to Senior QA Automation Engineer from 1 January", note: "She runs the QA guild.",
    reasonId: "p", reason: "Promotion",
    change: {
      managerFrom: null, managerTo: null, managerChanged: false, unitFromId: null, unitFrom: null, unitToId: null, unitTo: null,
      titleFrom: "QA Automation Engineer", titleTo: "Senior QA Automation Engineer", locationFrom: null, locationTo: null,
      unitChanged: false, titleChanged: true, locationChanged: false, teamOutcome: null, teamCount: 0, teamManager: null,
      reassigned: null, dottedLinesEnded: null, lastDay: null, isHire: false, employmentType: null, isReportingOnly: false,
    },
    address: null, decidedBy: null, decidedAt: null, declineReason: null, appliedChangeId: null,
    canDecide: true, canWithdraw: false, stale: null, ...over,
  };
}

describe("a change request", () => {
  it("reads as the change, in their words, and a no needs a reason", async () => {
    render(<RequestDetail request={request()} onClose={vi.fn()} />);
    expect(screen.getByText("Aicha Bouazizi becomes Senior QA Automation Engineer")).toBeInTheDocument();
    expect(screen.getByText("Promote Aicha to Senior QA Automation Engineer from 1 January")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    const confirm = screen.getByRole("button", { name: "Decline" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Why not?"), { target: { value: "Next cycle" } });
    fireEvent.click(confirm);
    expect(decline).toHaveBeenCalledWith({ id: "r1", reason: "Next cycle" });
  });

  it("can't be approved once the person changed since it was asked", () => {
    render(<RequestDetail request={request({ stale: "Aicha's job or manager changed since this was asked." })} onClose={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("changed since");
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { PeopleProfileDto, WorkforceChangeDetails, WorkforceChangeDto } from "@repo/api";

const { rights, draft } = vi.hoisted(() => ({
  rights: { people: true, lines: true, seeComing: true, propose: false, approve: false, employeeId: "me" },
  draft: vi.fn(),
}));

vi.mock("./use-changes", () => ({
  useChangeRights: () => rights,
  useChangeMutations: () => ({
    changeJob: { isLoading: false, mutateAsync: vi.fn() },
    editChange: { isLoading: false, mutateAsync: vi.fn() },
    endEmployment: { isLoading: false, mutateAsync: vi.fn() },
    startEmployment: { isLoading: false, mutateAsync: vi.fn() },
    dottedLine: { isLoading: false, mutateAsync: vi.fn() },
  }),
  useCancelChange: () => ({ isLoading: false, mutateAsync: vi.fn() }),
  useLineEffects: () => ({ data: undefined }),
  useManagerOptions: () => ({ data: [], isLoading: false }),
  useEndEmploymentPreview: () => ({ data: undefined, isLoading: false }),
  useApprovalSettings: () => ({ data: { types: [{ type: "job", required: true }], approvers: [{ employeeId: "amira-id", displayName: "Amira Khelifi" }], canManage: false } }),
  useChangeDraft: () => ({ isLoading: false, mutateAsync: draft }),
  useProposeChange: () => ({ isLoading: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/features/catalog/api/use-catalog", () => ({
  useJobs: () => ({ data: [] }),
  usePlaces: () => ({ data: [] }),
  useCompanyLists: () => ({ data: [{ id: "change-reasons", values: [{ id: "promo", key: "promotion", label: "Promotion", sortOrder: 0, isRetired: false, usageCount: 0, inUse: false }] }] }),
}));
vi.mock("../api/use-people", () => ({ usePeopleProfile: () => ({ data: person() }) }));
vi.mock("@/features/organization/api/use-organization", () => ({ useOrganizationHierarchy: () => ({ data: { roots: [] }, isLoading: false }) }));

import { CancelChangeDialog, ComingUpCard } from "./coming-up";
import { ChangePanel } from "./change-panel";

function person(): PeopleProfileDto {
  return {
    identity: { employeeKey: "HELA", employeeNumber: "CDG-015", displayName: "Hela Ben Amor", firstName: "Hela", lastName: "Ben Amor",
      preferredName: null, workEmail: null, phone: null, employeeId: "hela-id", photoUrl: null },
    employment: { state: "Active", start: "2023-01-01", end: null, employmentType: null },
    work: { orgUnitId: "eng-a", jobTitle: "Cybersecurity Manager", organizationName: "Engineering A Platform", organizationPath: "", location: "Tunis",
      effectiveFrom: "2023-01-01", isHistorical: false },
    primaryManager: { employeeKey: "OMAR", displayName: "Omar Mansour", employeeNumber: "CDG-006" },
    directReportCount: 5,
    directReports: [{ employeeKey: "LEILA", employeeNumber: "CDG-021", displayName: "Leila Baccouche", jobTitle: "Project Manager" }],
    completeness: "Complete", version: 1, viewedDate: "2026-10-27", isAsOf: false, comingUp: [], dottedLineManagers: [],
  };
}

const details = (over: Partial<WorkforceChangeDetails>): WorkforceChangeDetails => ({
  managerFrom: null, managerTo: null, managerChanged: false, unitFromId: null, unitFrom: null, unitToId: null, unitTo: null,
  titleFrom: null, titleTo: null, locationFrom: null, locationTo: null, unitChanged: false, titleChanged: false, locationChanged: false,
  teamOutcome: null, teamCount: 0, teamManager: null, reassigned: null, dottedLinesEnded: null, lastDay: null, isHire: false,
  employmentType: null, isReportingOnly: true, ...over,
});

const move: WorkforceChangeDto = {
  id: "c1", kind: "JobChange", effectiveDate: "2099-12-01", status: "Scheduled", canCancel: true, canEdit: true,
  person: { employeeId: "hela-id", employeeKey: "HELA", displayName: "Hela Ben Amor" },
  createdBy: "Amira Khelifi", createdAt: "2026-10-26T09:00:00Z", note: null,
  details: details({
    managerChanged: true,
    managerFrom: { employeeId: "omar", employeeKey: "OMAR", displayName: "Omar Mansour" },
    managerTo: { employeeId: "amira", employeeKey: "AMIRA", displayName: "Amira Khelifi" },
    teamOutcome: "Stays", teamCount: 5, teamManager: { employeeId: "omar", employeeKey: "OMAR", displayName: "Omar Mansour" },
  }),
};

describe("people changes", () => {
  it("names a coming move and its ripple, with Edit and Cancel", () => {
    render(<ComingUpCard change={move} canChange onEdit={vi.fn()} />);
    expect(screen.getByText("Moves to Amira Khelifi's team")).toBeInTheDocument();
    expect(screen.getByText("Team of 5 stays with Omar Mansour")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel change" })).toBeInTheDocument();
  });

  it("offers no actions to someone who can't change it", () => {
    render(<ComingUpCard change={move} canChange={false} />);
    expect(screen.queryByRole("button", { name: "Cancel change" })).not.toBeInTheDocument();
  });

  it("says what stays when cancelling, never 'Are you sure?'", () => {
    render(<CancelChangeDialog change={move} onClose={vi.fn()} />);
    expect(screen.getByText(/Cancel Hela Ben Amor's move on/)).toBeInTheDocument();
    expect(screen.getByText("Hela and their 5 reports stay with Omar Mansour.")).toBeInTheDocument();
  });

  it("opens a job change with the line, the team and the job, and nothing to save yet", () => {
    rights.people = true;
    render(<ChangePanel employeeKey="HELA" kind="job" onClose={vi.fn()} />);
    expect(screen.getByText("Make a change")).toBeInTheDocument();
    expect(screen.getByLabelText("Describe it")).toBeInTheDocument();
    expect(screen.getByText("Reports to")).toBeInTheDocument();
    expect(screen.getByText("The change")).toBeInTheDocument();
    expect(screen.getByText("Reason")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save change" })).toBeDisabled();
  });

  it("drafts a manager's sentence into the change and sends it for approval when the company asks", async () => {
    Object.assign(rights, { people: false, propose: true });
    draft.mockResolvedValue({ kind: "job", date: "2027-01-01", jobId: "senior", jobTitle: "Senior Cybersecurity Manager", jobLevel: "Level 4",
      orgUnitId: null, orgUnitName: null, placeId: null, placeName: null, reasonId: "promo", reason: "Promotion", understood: true, usedAi: true });
    render(<ChangePanel employeeKey="HELA" kind="job" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Describe it"), { target: { value: "Promote Hela to Senior Cybersecurity Manager from 1 January" } });
    fireEvent.click(screen.getByRole("button", { name: "Draft it" }));
    expect(await screen.findByText("Senior Cybersecurity Manager")).toBeInTheDocument();
    expect(draft).toHaveBeenCalledWith("Promote Hela to Senior Cybersecurity Manager from 1 January");
    expect(screen.getByText("Amira Khelifi approves")).toBeInTheDocument();
    expect(screen.getByText("Level 4")).toBeInTheDocument();
    expect(screen.getByText("Promotion")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send for approval" })).toBeEnabled();
    Object.assign(rights, { people: true, propose: false });
  });

  it("shows a reporting admin only the line: job facts are absent, not greyed", () => {
    rights.people = false;
    render(<ChangePanel employeeKey="HELA" kind="job" onClose={vi.fn()} />);
    expect(screen.getByText("Change manager")).toBeInTheDocument();
    expect(screen.queryByText("Job")).not.toBeInTheDocument();
    rights.people = true;
  });
});

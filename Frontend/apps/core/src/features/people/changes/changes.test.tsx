// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PeopleProfileDto, WorkforceChangeDetails, WorkforceChangeDto } from "@repo/api";

const { rights, draft, createJob } = vi.hoisted(() => ({
  rights: { people: true, lines: true, seeComing: true, propose: false, approve: false, jobs: true, employeeId: "me" },
  draft: vi.fn(),
  createJob: vi.fn(),
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
  useApprovalSettings: () => ({ data: { types: [{ type: "job", required: true }, { type: "leave", required: true }], approvers: [{ employeeId: "amira-id", displayName: "Amira Khelifi" }], canManage: false } }),
  useChangeDraft: () => ({ isLoading: false, mutateAsync: draft }),
  useProposeChange: () => ({ isLoading: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/features/catalog/api/use-catalog", () => ({
  useJobs: () => ({ data: [] }),
  useJobMutations: () => ({ create: { isLoading: false, mutateAsync: createJob } }),
  usePlaces: () => ({ data: [] }),
  useCompanyLists: () => ({ data: [
    { id: "change-reasons", values: [{ id: "promo", key: "promotion", label: "Promotion", sortOrder: 0, isRetired: false, usageCount: 0, inUse: false }] },
    { id: "employment-types", values: [{ id: "full", key: "full-time", label: "Full-time", sortOrder: 0, isRetired: false, usageCount: 0, inUse: false }] },
    { id: "leave-types", values: [{ id: "annual", key: "annual-leave", label: "Annual leave", sortOrder: 0, isRetired: false, usageCount: 0, inUse: false }] },
  ] }),
}));
vi.mock("@repo/api/query", async (original) => ({
  ...(await original<typeof import("@repo/api/query")>()),
  useCompanyWorkWeek: () => ({ data: { workingDays: [1, 2, 3, 4, 5] } }),
}));
vi.mock("../api/use-people", () => ({ usePeopleProfile: () => ({ data: person() }) }));
vi.mock("@/features/organization/api/use-organization", () => ({ useOrganizationHierarchy: () => ({ data: { roots: [] }, isLoading: false }) }));

import { setWriteLock } from "@repo/ds";
import { CancelChangeDialog, ChangeBadge, ComingUpCard } from "./coming-up";
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

const leaveNow: WorkforceChangeDto = {
  ...move, id: "l1", kind: "Leave", effectiveDate: "2026-11-02", status: "InEffect", canCancel: false, canEdit: true,
  lastDay: "2099-11-20", back: "2099-11-23",
  details: details({ leaveTypeId: "annual", leaveType: "Annual leave", leaveUntil: "2099-11-20", isReportingOnly: false }),
};

describe("people changes", () => {
  it("keeps a change greyed while seeing Fusion as someone (B-220)", () => {
    act(() => setWriteLock("You're seeing Fusion as Hela, so nothing can be changed"));
    render(<ComingUpCard change={leaveNow} canChange onEdit={vi.fn()} />);
    expect(screen.getByRole("button", { name: "End early" })).toBeDisabled();
    act(() => setWriteLock(null));
  });

  it("names leave under way by its return, and HR ends it early rather than cancelling it", () => {
    render(<ComingUpCard change={leaveNow} canChange onEdit={vi.fn()} />);
    expect(screen.getByText("Back from annual leave")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End early" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel leave" })).not.toBeInTheDocument();
  });

  it("sends a manager's leave for their report for approval when the company approves leave", () => {
    Object.assign(rights, { people: false, propose: true });
    render(<ChangePanel employeeKey="HELA" kind="leave" onClose={vi.fn()} />);
    expect(screen.getByText("Annual leave")).toBeInTheDocument();
    expect(screen.getByText("Amira Khelifi approves")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send for approval" })).toBeEnabled();
    Object.assign(rights, { people: true, propose: false });
  });

  it("names a coming move and its ripple, with Edit and Cancel", () => {
    render(<ComingUpCard change={move} canChange onEdit={vi.fn()} />);
    expect(screen.getByText("Moves to Amira Khelifi's team")).toBeInTheDocument();
    expect(screen.getByText("Team of 5 stays with Omar Mansour")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel change" })).toBeInTheDocument();
  });

  it("words a change dated today as already in effect, still undoable today (B-399)", () => {
    const today = { ...move, effectiveDate: "2026-11-10", status: "InEffect" as const };
    render(<><ComingUpCard change={today} canChange onEdit={vi.fn()} /><ChangeBadge change={today} /></>);
    expect(screen.getByText("In effect")).toBeInTheDocument();
    expect(screen.getByText("Moved today")).toBeInTheDocument();
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
    expect(screen.getByText("Pick what changes to save")).toBeInTheDocument();
  });

  it("says when the sentence names a job the company doesn't have, and adding it fills the job (B-399)", async () => {
    draft.mockReset();
    draft.mockResolvedValue({ kind: "job", date: "2026-12-01", jobId: null, jobTitle: null, jobLevel: null, missingJob: "Senior QA Automation Engineer",
      orgUnitId: null, orgUnitName: null, placeId: null, placeName: null, reasonId: null, reason: null, understood: true, usedAi: true });
    createJob.mockResolvedValue({ id: "senior-qa", title: "Senior QA Automation Engineer", family: null, level: null, isRetired: false, peopleCount: 0, openRoleCount: 0, inUse: false });
    render(<ChangePanel employeeKey="HELA" kind="job" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Describe it"), { target: { value: "Promote Hela to Senior QA Automation Engineer on 1 December" } });
    fireEvent.keyDown(screen.getByLabelText("Describe it"), { key: "Enter" });
    expect(await screen.findByText(/There's no/)).toHaveTextContent("There's no Senior QA Automation Engineer job yet");
    expect(screen.getByText(/or pick another job to save/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Schedule for/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add it" }));
    await waitFor(() => expect(createJob).toHaveBeenCalledWith({ title: "Senior QA Automation Engineer" }));
    expect(await screen.findByText("Senior QA Automation Engineer")).toBeInTheDocument();
    expect(screen.queryByText(/There's no/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Schedule for/ })).toBeEnabled();
  });

  it("drafts a manager's sentence into the change and sends it for approval when the company asks", async () => {
    Object.assign(rights, { people: false, propose: true });
    draft.mockResolvedValue({ kind: "job", date: "2027-01-01", jobId: "senior", jobTitle: "Senior Cybersecurity Manager", jobLevel: "Level 4",
      orgUnitId: null, orgUnitName: null, placeId: null, placeName: null, reasonId: "promo", reason: "Promotion", understood: true, usedAi: true });
    render(<ChangePanel employeeKey="HELA" kind="job" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Describe it"), { target: { value: "Promote Hela to Senior Cybersecurity Manager from 1 January" } });
    expect(screen.queryByRole("button", { name: "Draft it" })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("Describe it"), { key: "Enter" });
    expect(await screen.findByText("Senior Cybersecurity Manager")).toBeInTheDocument();
    expect(draft).toHaveBeenCalledWith("Promote Hela to Senior Cybersecurity Manager from 1 January");
    expect(screen.getAllByRole("img", { name: "Filled by Fusion from your sentence" }).length).toBeGreaterThan(0);
    expect(screen.getByText("Amira Khelifi approves")).toBeInTheDocument();
    expect(screen.getByText("Level 4")).toBeInTheDocument();
    expect(screen.getByText("Promotion")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send for approval" })).toBeEnabled();
    Object.assign(rights, { people: true, propose: false });
  });

  it("drafts once typing pauses and never redrafts a part set by hand", async () => {
    vi.useFakeTimers();
    draft.mockReset();
    draft.mockResolvedValueOnce({ kind: "job", date: null, jobId: "senior", jobTitle: "Senior Cybersecurity Manager", jobLevel: null,
      orgUnitId: null, orgUnitName: null, placeId: null, placeName: null, reasonId: null, reason: null, understood: true, usedAi: true });
    render(<ChangePanel employeeKey="HELA" kind="job" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Describe it"), { target: { value: "Promote Hela to Senior" } });
    expect(draft).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(draft).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    expect(await screen.findByText("Senior Cybersecurity Manager")).toBeInTheDocument();
    // Undo marks the job as set by hand; the next draft leaves it alone.
    fireEvent.click(screen.getByRole("button", { name: /^Undo/ }));
    draft.mockResolvedValueOnce({ kind: "job", date: null, jobId: "senior", jobTitle: "Senior Cybersecurity Manager", jobLevel: null,
      orgUnitId: null, orgUnitName: null, placeId: null, placeName: null, reasonId: null, reason: null, understood: true, usedAi: true });
    fireEvent.change(screen.getByLabelText("Describe it"), { target: { value: "Promote Hela to Senior from today" } });
    fireEvent.keyDown(screen.getByLabelText("Describe it"), { key: "Enter" });
    await waitFor(() => expect(draft).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Senior Cybersecurity Manager")).not.toBeInTheDocument();
  });

  it("shows a reporting admin only the line: job facts are absent, not greyed", () => {
    rights.people = false;
    render(<ChangePanel employeeKey="HELA" kind="job" onClose={vi.fn()} />);
    expect(screen.getByText("Change manager")).toBeInTheDocument();
    expect(screen.queryByText("Job")).not.toBeInTheDocument();
    rights.people = true;
  });
});

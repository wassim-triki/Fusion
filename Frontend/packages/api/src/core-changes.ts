import type { ApiClient } from "./types";
import type {
  EndEmploymentChangeRequest,
  JobChangeRequest,
  PeopleHomeAddressDto,
  WorkforceChangeDetails,
  WorkforceChangeDto,
} from "./core-people";

// --- Changes and approvals (B-179, D-15/D-16) --------------------------------------------------------

export type ChangeRequestKind = "JobChange" | "EndEmployment" | "HomeAddress";
export type ChangeRequestStatus = "Pending" | "Approved" | "Declined" | "Withdrawn";
/** The parts of a change a company can ask approval for. */
export type ChangeApprovalType = "job" | "manager" | "place" | "leaving" | "homeAddress";

export const CHANGE_APPROVAL_TYPES: readonly ChangeApprovalType[] = ["job", "manager", "place", "leaving", "homeAddress"];

export interface ChangeRequestActorRef {
  employeeId: string | null;
  displayName: string;
}

export interface ChangeRequestDto {
  id: string;
  kind: ChangeRequestKind;
  status: ChangeRequestStatus;
  person: { employeeId: string; employeeKey: string; displayName: string; jobTitle: string | null; unit: string | null };
  requestedBy: ChangeRequestActorRef;
  requestedAt: string;
  /** First day in effect; for a last day, the last day itself is `change.lastDay`. */
  effectiveDate: string;
  types: ChangeApprovalType[];
  description: string | null;
  note: string | null;
  reasonId: string | null;
  reason: string | null;
  /** What it would do, captured when asked (job and end requests). */
  change: WorkforceChangeDetails | null;
  address: { from: PeopleHomeAddressDto; to: PeopleHomeAddressDto } | null;
  decidedBy: ChangeRequestActorRef | null;
  decidedAt: string | null;
  declineReason: string | null;
  appliedChangeId: string | null;
  canDecide: boolean;
  canWithdraw: boolean;
  /** Why a waiting request can no longer be approved as asked. */
  stale: string | null;
}

export interface ProposeChangeRequest {
  job?: JobChangeRequest | null;
  end?: EndEmploymentChangeRequest | null;
  /** The sentence it was described in. */
  description?: string | null;
}

/** The change applied (no approval needed) or the request now waiting. */
export interface ProposeChangeResultDto {
  change: WorkforceChangeDto | null;
  request: ChangeRequestDto | null;
}

/** What Fusion read in a sentence, as picks from the company's own lists; every part is a suggestion. */
export interface ChangeDraftDto {
  kind: "job" | "end";
  date: string | null;
  jobId: string | null;
  jobTitle: string | null;
  jobLevel: string | null;
  orgUnitId: string | null;
  orgUnitName: string | null;
  placeId: string | null;
  placeName: string | null;
  reasonId: string | null;
  reason: string | null;
  understood: boolean;
  usedAi: boolean;
}

export interface ChangeApprovalSettingsDto {
  types: { type: ChangeApprovalType; required: boolean }[];
  approvers: ChangeRequestActorRef[];
  canManage: boolean;
}

export const coreChangesPaths = {
  approvals: () => "/corehr/changes/approvals",
  draft: (employeeKey: string) => `/corehr/changes/people/${encodeURIComponent(employeeKey)}/draft`,
  propose: (employeeKey: string) => `/corehr/changes/people/${encodeURIComponent(employeeKey)}/propose`,
  requests: () => "/corehr/changes/requests",
  request: (id: string) => `/corehr/changes/requests/${encodeURIComponent(id)}`,
  decide: (id: string, verb: "approve" | "decline" | "withdraw") =>
    `/corehr/changes/requests/${encodeURIComponent(id)}/${verb}`,
} as const;

export const coreChangesQueryKeys = {
  all: () => ["coreChanges"] as const,
  approvals: () => [...coreChangesQueryKeys.all(), "approvals"] as const,
  requests: (status: "pending" | "decided", employeeKey?: string | null) =>
    [...coreChangesQueryKeys.all(), "requests", status, employeeKey ?? "all"] as const,
  request: (id: string) => [...coreChangesQueryKeys.all(), "request", id] as const,
} as const;

export function createCoreChangesApi(client: ApiClient) {
  return {
    approvals: (signal?: AbortSignal) => client.get<ChangeApprovalSettingsDto>(coreChangesPaths.approvals(), { signal }),
    updateApprovals: (required: ChangeApprovalType[]) =>
      client.put<ChangeApprovalSettingsDto>(coreChangesPaths.approvals(), { required }),
    draft: (employeeKey: string, text: string) => client.post<ChangeDraftDto>(coreChangesPaths.draft(employeeKey), { text }),
    /** HR's own changes, and types the company doesn't ask approval for, apply at once. */
    propose: (employeeKey: string, request: ProposeChangeRequest) =>
      client.post<ProposeChangeResultDto>(coreChangesPaths.propose(employeeKey), request),
    requests: (status: "pending" | "decided", employeeKey?: string | null, signal?: AbortSignal) =>
      client.get<ChangeRequestDto[]>(coreChangesPaths.requests(), {
        params: employeeKey ? { status, employeeKey } : { status },
        signal,
      }),
    request: (id: string, signal?: AbortSignal) => client.get<ChangeRequestDto>(coreChangesPaths.request(id), { signal }),
    approve: (id: string) => client.post<ChangeRequestDto>(coreChangesPaths.decide(id, "approve"), {}),
    decline: (id: string, reason: string) => client.post<ChangeRequestDto>(coreChangesPaths.decide(id, "decline"), { reason }),
    withdraw: (id: string) => client.post<ChangeRequestDto>(coreChangesPaths.decide(id, "withdraw"), {}),
  };
}

export type CoreChangesApi = ReturnType<typeof createCoreChangesApi>;

import type {
  WorkforceManagerSummaryDto,
  WorkforceOrgAssignmentDto,
} from "./core-workforce";

/**
 * Workforce Access boundary contract (Chunk A, task 2.9).
 *
 * These types mirror the fully server-resolved projections CoreHR returns to the
 * browser. CoreHR owns the canonical Employee facts and obtains the non-disclosing
 * account-state outcome from Identity over the signed internal contract, then joins
 * them server-side. The frontend therefore never joins untrusted Identity and CoreHR
 * facts itself, and a command never carries a forgeable Employee identity fact — only
 * an Employee reference, the reviewed baseline choice, and an optimistic-concurrency
 * token. The server re-resolves the canonical subject and rechecks state at commit; a
 * previously returned candidate is guidance, never authority.
 */

/**
 * The seven bounded, non-disclosing account-state outcomes, mirroring Identity's
 * `WorkforceAccountCandidateOutcome`. Distinct from the four-bucket roster
 * `WorkforceAccessState` in `core-workforce.ts`.
 */
export type WorkforceAccountState =
  | "NewAccount"
  | "ExistingAccountReadyToLink"
  | "Active"
  | "BindingConflict"
  | "SuspendedAccountReadyToReactivate"
  | "ExistingAccountReadyToJoinTenant"
  | "AccountUnavailable";

/** The reviewed workforce baseline slot decided per person. */
export type WorkforceBaselineChoice = "Employee" | "Manager";

/** The trusted single-person actions a candidate state may offer. */
export type WorkforceAccessAction =
  | "Activate"
  | "Link"
  | "Reactivate"
  | "Connect"
  | "Resend"
  | "Withdraw"
  | "Correct";

/** Typed per-command outcome; fail-closed results carry no other-tenant identity. */
export type WorkforceAccessCommandOutcome =
  | "Ok"
  | "Stale"
  | "Conflict"
  | "Unavailable"
  | "Blocked"
  | "Failed";

/**
 * One fully-resolved single-person workforce-access candidate. `accountEmail` is
 * populated only for same-tenant outcomes; another workspace's account identity is
 * never returned.
 */
export interface WorkforceAccessCandidateDto {
  employeeId: string;
  stableEmployeeKey: string;
  employeeNumber: string | null;
  displayName: string;
  fullName: string;
  workEmail: string | null;
  jobTitle: string | null;
  employmentStatus: string;
  isActive: boolean;
  orgUnit: WorkforceOrgAssignmentDto | null;
  manager: WorkforceManagerSummaryDto | null;
  directReportCount: number;
  accountState: WorkforceAccountState;
  accountStateLabel: string;
  accountEmail: string | null;
  recommendedBaseline: WorkforceBaselineChoice;
  availableActions: WorkforceAccessAction[];
  blockedReason: string | null;
  version: number;
  /** The account holds canonical Tenant Administrator authority — managed under Administrators. */
  isAdministrator: boolean;
  /** Additional (non-baseline, non-administrator) access profile names the account holds. */
  additionalAccess: string[] | null;
  /**
   * Access revision of the bound same-tenant membership, when one exists. The
   * optimistic-concurrency token a correction echoes back so a stale review is refused.
   * Null when there is no bound membership yet.
   */
  accountRevision: number | null;
}

export interface WorkforceAccessCandidatesRequest {
  employeeIds: string[];
}

/**
 * The explicit confirmation an existing-account mutation presents before commit. It
 * names the canonical Employee, the account email, the tenant participation outcome,
 * and the reviewed baseline. The server re-resolves at commit; this is not a lock.
 */
export interface WorkforceAccessConfirmationDto {
  employeeId: string;
  employeeDisplayName: string;
  accountEmail: string | null;
  accountState: WorkforceAccountState;
  participationOutcome: string;
  baselineChoice: WorkforceBaselineChoice;
  expectedVersion: number;
}

/**
 * Trusted browser-to-CoreHR command carrying only the Employee reference, reviewed
 * baseline, and concurrency token — never a forgeable Employee identity fact.
 */
export interface WorkforceAccessCommand {
  employeeId: string;
  baseline: WorkforceBaselineChoice;
  expectedVersion: number;
}

/**
 * Focused single-person correction command. No account deletion and no bulk
 * correction is expressible.
 */
export interface WorkforceAccessCorrectionCommand {
  employeeId: string;
  targetEmployeeId: string;
  baseline: WorkforceBaselineChoice;
  reason: string;
  expectedVersion: number;
}

export interface WorkforceAccessCommandResultDto {
  employeeId: string;
  outcome: WorkforceAccessCommandOutcome;
  accountState: WorkforceAccountState | null;
  message: string;
  version: number | null;
}

/** What happened to a person's account, as Person › Access › History tells it (B-231). */
export type WorkforceAccountHistoryKind =
  | "Invited"
  | "SentAgain"
  | "Delivered"
  | "NotDelivered"
  | "Withdrawn"
  | "Accepted"
  /** The last sign-in; Fusion keeps only the latest. */
  | "SignedIn"
  /** A role given to the person, by someone or by the role's rule (B-314). */
  | "RoleGiven"
  | "RoleRemoved";

/** One moment of the account story, newest first from the server. */
export interface WorkforceAccountHistoryEventDto {
  kind: WorkforceAccountHistoryKind;
  occurredAt: string;
  /** Who did it, when someone did. */
  actorName: string | null;
  /** Where the invitation went. */
  email: string | null;
  /** When a still-open link stops working. */
  validUntil: string | null;
  /** The role a RoleGiven or RoleRemoved tells. */
  roleName: string | null;
  /** The role's rule did it, not a person. */
  byRule: boolean;
}

/**
 * Bulk activation-plan contracts. `WorkforceBulkInviteRequest` mirrors the live CoreHR
 * `access-subjects/bulk-invite` request; the per-item result preserves each person's
 * independent outcome so partial success is always truthful.
 */
export type WorkforceBulkOutcome =
  | "Invited"
  | "Refreshed"
  | "Linked"
  | "Reactivated"
  | "AlreadyActive"
  | "Blocked"
  | "Skipped"
  | "Failed";

export interface WorkforceBulkInviteRequest {
  search?: string | null;
  access?: string | null;
  profileId?: string | null;
  employeeStatus?: string | null;
  deliveryState?: string | null;
  employeeKey?: string | null;
  specificEmployeeIds?: string[] | null;
  accessProfileId: string;
}

export interface WorkforceBulkInviteResultItemDto {
  employeeId: string;
  displayName: string;
  email: string | null;
  outcome: WorkforceBulkOutcome | string;
  message: string;
}

export interface WorkforceBulkInviteResponseDto {
  items: WorkforceBulkInviteResultItemDto[];
  totalRequested: number;
  invitedCount: number;
  refreshedCount: number;
  alreadyActiveCount: number;
  skippedCount: number;
}

/** One reviewed line in a bulk Activation Plan. */
export interface WorkforceAccessBulkItem {
  employeeId: string;
  baseline: WorkforceBaselineChoice;
}

export interface WorkforceAccessBulkRequest {
  items: WorkforceAccessBulkItem[];
}

/** Per-person independent bulk outcome, preserved whether or not others fail. */
export type WorkforceAccessBulkItemOutcome =
  | "Invited"
  | "Linked"
  | "Reactivated"
  | "AlreadyActive"
  | "AlreadyPending"
  | "Blocked"
  | "Stale"
  | "Failed";

export interface WorkforceAccessBulkResultItemDto {
  employeeId: string;
  displayName: string;
  outcome: WorkforceAccessBulkItemOutcome | string;
  accountState: WorkforceAccountState | null;
  message: string;
}

export interface WorkforceAccessBulkResultDto {
  items: WorkforceAccessBulkResultItemDto[];
  invited: number;
  linked: number;
  reactivated: number;
  alreadyActive: number;
  blocked: number;
  failed: number;
}

export const coreWorkforceAccessPaths = {
  bulkActivate: () => "/corehr/workforce/access-subjects/bulk-activate",
  candidates: () => "/corehr/workforce/access-subjects/candidates",
  candidate: (employeeId: string) =>
    `/corehr/workforce/access-subjects/${employeeId}/candidate`,
  activate: (employeeId: string) =>
    `/corehr/workforce/access-subjects/${employeeId}/activate`,
  link: (employeeId: string) =>
    `/corehr/workforce/access-subjects/${employeeId}/link`,
  reactivate: (employeeId: string) =>
    `/corehr/workforce/access-subjects/${employeeId}/reactivate`,
  connect: (employeeId: string) =>
    `/corehr/workforce/access-subjects/${employeeId}/connect`,
  correct: (employeeId: string) =>
    `/corehr/workforce/access-subjects/${employeeId}/correct`,
  suspend: (employeeId: string) =>
    `/corehr/workforce/access-subjects/${employeeId}/suspend`,
  restore: (employeeId: string) =>
    `/corehr/workforce/access-subjects/${employeeId}/restore`,
  resend: (employeeId: string) =>
    `/corehr/workforce/access-subjects/${employeeId}/resend`,
  withdraw: (employeeId: string) =>
    `/corehr/workforce/access-subjects/${employeeId}/withdraw`,
  history: (employeeId: string) =>
    `/corehr/workforce/access-subjects/${employeeId}/history`,
  bulkInvite: () => "/corehr/workforce/access-subjects/bulk-invite",
} as const;

export const coreWorkforceAccessQueryKeys = {
  all: () => ["coreWorkforceAccess"] as const,
  candidates: (employeeIds: readonly string[]) =>
    [...coreWorkforceAccessQueryKeys.all(), "candidates", [...employeeIds].sort()] as const,
  candidate: (employeeId: string) =>
    [...coreWorkforceAccessQueryKeys.all(), "candidate", employeeId] as const,
  confirmation: (employeeId: string) =>
    [...coreWorkforceAccessQueryKeys.all(), "confirmation", employeeId] as const,
  history: (employeeId: string) =>
    [...coreWorkforceAccessQueryKeys.all(), "history", employeeId] as const,
} as const;

// Tenant administration and access — the customer surface for who administers a
// tenant, who has been invited to, and what has happened to that access.

/** Business-facing membership state. Never an internal enum name. */
export type TenantAdministratorStatus = "Active" | "Suspended";

/** Business-facing invitation state. */
export type AdministratorInvitationState =
  | "Pending"
  | "Accepted"
  | "Expired"
  | "Revoked"
  | "Superseded";

/**
 * How the tenant's administrative continuity reads.
 *
 * `AtRisk` is a recommendation, not a blocker: one usable administrator is a
 * working tenant, just a fragile one.
 */
export type ContinuityState = "Healthy" | "AtRisk" | "RecoveryRequired";

export interface TenantAccessSummaryDto {
  /** The tenant as the customer knows it; the locked consequence copy names it. */
  tenantName: string;
  activeAdministrators: number;
  suspendedAdministrators: number;
  pendingInvitations: number;
  usableAdministrators: number;
  continuity: ContinuityState;
}

export interface TenantAdministratorDto {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  status: TenantAdministratorStatus;
  accessEstablishedAt: string;
  isUsable: boolean;
  /**
   * Why suspension and authority removal are unavailable for this person.
   * Present when they are the tenant's only usable administrator, so the reason
   * can be shown before anyone interacts rather than after a refusal.
   */
  blockedReason: string | null;
  /** Echoed back as If-Match so a stale screen cannot apply a surprising change. */
  version: number;
  /**
   * Who established this authority — a person's name where an account acted, or a
   * stable system phrase ("System (tenant activation)", "Platform recovery") where
   * none did. English; screens use `addedByKind` and `addedByName`.
   */
  addedBy: string;
  /** How the authority came: the company's activation, an invitation, Platform recovery, or an administrator. */
  addedByKind: AdministratorOrigin;
  /** The administrator who added them, when one did. */
  addedByName: string | null;
  employeeId: string | null;
}

export type AdministratorOrigin = "activation" | "invitation" | "recovery" | "administrator";

/** A company keeps at least this many administrators once it has them; the server refuses going below. */
export const MINIMUM_ADMINISTRATORS = 2;

/** One grant or removal of administrator authority, newest first; every one is kept. */
export interface AdministratorHistoryItemDto {
  at: string;
  kind: AdministratorOrigin | "removed" | "stepped-down";
  personName: string;
  actorName: string | null;
}

/** Someone who could be made an administrator; only people who already sign in can be (`signsIn`). */
export interface AdministratorCandidateDto {
  /** Empty for someone invited who hasn't signed in yet. */
  userId: string;
  employeeId: string | null;
  name: string;
  jobTitle: string | null;
  signsIn: boolean;
}

export interface AddAdministratorRequest {
  userId: string;
  /** The caller's own password, asked for every administrator they add. */
  password: string;
}

/** An administrator whose authority was revoked and not re-granted. */
export interface RemovedAdministratorDto {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  removedAt: string;
  /** Who removed the access, or "Removed themselves" for a self-removal. */
  removedBy: string;
  reason: string | null;
}

export interface AdministratorInvitationDto {
  invitationId: string;
  email: string;
  /** Recipient's name as captured on the invitation; empty if none was given. */
  name: string;
  state: AdministratorInvitationState;
  purpose: string;
  issuedAt: string;
  expiresAt: string;
  /** Delivery outcome is a fact about the email, not about invitation validity. */
  deliveryStatus: string | null;
}

export interface AccessActivityItemDto {
  id: string;
  occurredAt: string;
  action: string;
  actorName: string;
  actorRole: string;
  summary: string;
  resourceId: string | null;
}

export interface AccessActivityPageDto {
  items: AccessActivityItemDto[];
  nextCursorOccurredAt: string | null;
  nextCursorId: string | null;
}

export interface AdministratorActionRequest {
  reason?: string;
}

/**
 * Stable problem types. Each one is resolved differently by the person who hits
 * it, so the experience distinguishes them instead of showing one error.
 */
export type TenantAccessProblemType =
  | "validation-failed"
  | "permission-denied"
  | "tenant-context-invalid"
  | "existing-account"
  | "duplicate-pending-invitation"
  | "invitation-not-pending"
  | "too-few-administrators"
  | "password-incorrect"
  | "password-locked"
  | "not-eligible"
  | "stale-state"
  | "recovery-not-eligible"
  | "recovery-already-pending"
  | "not-found"
  | "not-applicable"
  | "unexpected";

export interface TenantAccessProblem {
  type: TenantAccessProblemType;
  title: string;
  status: number;
}

/** Public acceptance states. Exactly one opens the account-creation form. */
export type AdministratorInvitationEntryState =
  | "account_creation"
  | "invalid"
  | "expired"
  | "revoked"
  | "superseded"
  | "already_accepted"
  | "existing_account";

/** Password rules stated by the service, so the form has one source rather than a copy that drifts. */
export interface AccountPasswordRequirementsDto {
  minimumLength: number;
  /** Upper bound the service enforces; advisory on the client. */
  maximumLength?: number;
  /** At least one letter of either case. */
  requiresLetter?: boolean;
  requiresDigit: boolean;
  requiresLowercase: boolean;
  requiresUppercase: boolean;
  requiresSymbol: boolean;
}

export interface AdministratorInvitationEntryDto {
  state: AdministratorInvitationEntryState;
  purpose: string | null;
  tenantName: string | null;
  invitedEmail: string | null;
  /** Named to match what the service serializes. */
  expiresAt: string | null;
  passwordRequirements: AccountPasswordRequirementsDto | null;
}

export interface AcceptAdministratorInvitationRequest {
  credential: string;
  password?: string;
  firstName?: string;
  lastName?: string;
}

export const tenantAccessPaths = {
  summary: () => "/identity/tenant-access/summary",
  administrators: () => "/identity/tenant-access/administrators",
  removedAdministrators: () => "/identity/tenant-access/administrators/removed",
  administratorHistory: () => "/identity/tenant-access/administrators/history",
  administratorCandidates: () => "/identity/tenant-access/administrators/candidates",
  suspend: (membershipId: string) =>
    `/identity/tenant-access/administrators/${membershipId}/suspend`,
  reactivate: (membershipId: string) =>
    `/identity/tenant-access/administrators/${membershipId}/reactivate`,
  revokeAuthority: (membershipId: string) =>
    `/identity/tenant-access/administrators/${membershipId}/authority:revoke`,
  invitations: () => "/identity/tenant-access/invitations",
  activity: () => "/identity/tenant-access/activity",
  recentActivity: () => "/identity/tenant-access/activity/recent",
  inspectInvitation: () => "/identity/tenant-access/invitations/inspect",
  acceptInvitation: () => "/identity/tenant-access/invitations/accept",
} as const;

export const tenantAccessQueryKeys = {
  all: () => ["tenant-access"] as const,
  summary: () => [...tenantAccessQueryKeys.all(), "summary"] as const,
  administrators: () => [...tenantAccessQueryKeys.all(), "administrators"] as const,
  removedAdministrators: () =>
    [...tenantAccessQueryKeys.all(), "administrators", "removed"] as const,
  administratorHistory: () => [...tenantAccessQueryKeys.all(), "administrators", "history"] as const,
  administratorCandidates: (search: string) =>
    [...tenantAccessQueryKeys.all(), "administrators", "candidates", search] as const,
  invitations: (includeHistorical = false) =>
    [...tenantAccessQueryKeys.all(), "invitations", includeHistorical] as const,
  recentActivity: () => [...tenantAccessQueryKeys.all(), "activity", "recent"] as const,
  activity: () => [...tenantAccessQueryKeys.all(), "activity"] as const,
} as const;

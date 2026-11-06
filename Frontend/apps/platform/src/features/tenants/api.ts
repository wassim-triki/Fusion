import { ApiError, createPlatformApiClient } from "@repo/api";

/**
 * Platform control-plane tenant administration.
 *
 * These contracts belong to Platform and nothing else consumes them, so they
 * live in the owning microfrontend rather than in the shared API package.
 */

const BASE = "/identity/platform-admin/tenants";

const client = createPlatformApiClient();

/** Tenant statuses this feature defines. Nothing else is a tenant status. */
export type TenantActivationStatus =
  | "AwaitingAdministratorActivation"
  | "Active";

export type InvitationStateValue =
  | "Pending"
  | "Accepted"
  | "Expired"
  | "Revoked"
  | "Superseded";

export type DeliveryOutcomeValue = "Sent" | "Failed";

export type AttentionReason =
  | "None"
  | "DeliveryFailed"
  | "InvitationExpired"
  | "InvitationRevoked";

export type TenantModule = "CoreHR" | "Performance" | "Learning" | "Recruitment" | "Interview";

export type OverviewFilter =
  | "All"
  | "AwaitingActivation"
  | "Active"
  | "NeedsAttention";

/** Recovery the backend will actually accept in the current invitation state. */
export type RecoveryAction = "resend" | "revoke" | "replace" | "reissue";

export interface TenantOverviewRow {
  tenantId: string;
  name: string;
  administratorActivationStatus: TenantActivationStatus;
  initialAdministratorEmail: string | null;
  bootstrapInvitationId: string | null;
  invitationState: InvitationStateValue | null;
  /** Recoveries the service will accept, derived server-side from the state. */
  allowedActions: RecoveryAction[];
  lastDeliveryOutcome: DeliveryOutcomeValue | null;
  attentionReason: AttentionReason;
  needsAttention: boolean;
  modules: TenantModule[];
  createdAt: string;
}

/** How many tenants sit in each lifecycle position for the current query. */
export interface TenantOverviewCounts {
  all: number;
  awaitingActivation: number;
  active: number;
  needsAttention: number;
}

export interface TenantOverviewPage {
  rows: TenantOverviewRow[];
  /** Rows matching the query, not the number returned on this page. */
  totalCount: number;
  page: number;
  pageSize: number;
  counts: TenantOverviewCounts;
}

export type TenantOverviewSort =
  | "CreatedDescending"
  | "CreatedAscending"
  | "NameAscending"
  | "NameDescending";

/**
 * The complete question the workspace is asking. The list, the counts and the
 * export are all answered from this one object, so they cannot disagree.
 */
export interface TenantOverviewQuery {
  filter: OverviewFilter;
  search: string;
  /** Module identifiers, including ones this build's catalogue does not grant yet. */
  modules: string[];
  createdFrom: string | null;
  createdTo: string | null;
  sort: TenantOverviewSort;
  page: number;
  /** Rows per page; one of `TENANT_PAGE_SIZES`. */
  pageSize: number;
}

interface DeliveryAttemptSummary {
  outcome: DeliveryOutcomeValue;
  attemptedAt: string;
  failureCode: string | null;
}

export interface BootstrapInvitationSummary {
  invitationId: string;
  email: string;
  state: InvitationStateValue;
  expiresAt: string;
  createdAt: string;
  lastDelivery: DeliveryAttemptSummary | null;
  allowedActions: RecoveryAction[];
}

export interface TenantHistoryEntry {
  eventType: string;
  occurredAt: string;
  outcome: string;
  reason: string | null;
  /** Null when the platform itself acted rather than a person. */
  actorName: string | null;
}

export interface TenantDetail {
  tenantId: string;
  name: string;
  slug: string;
  /**
   * Tenant lifecycle: true while customers may access the tenant, false once
   * Platform has deactivated it. Separate from administrator activation.
   */
  isActive: boolean;
  /** Offboarded for good: inactive, out of the tenant list, no actions left. */
  isArchived: boolean;
  administratorActivationStatus: TenantActivationStatus;
  locale: string;
  timeZone: string;
  /** Optional industry captured at provisioning; null when unspecified. */
  industry: string | null;
  createdAt: string;
  modules: TenantModule[];
  bootstrapInvitation: BootstrapInvitationSummary | null;
  history: TenantHistoryEntry[];
}

export interface ProvisionTenantInput {
  name: string;
  locale: string;
  timeZone: string;
  /** Optional industry classification. Descriptive metadata only. */
  industry?: string;
  /** Optional entitlements only. Core HR is added by the platform regardless. */
  modules: TenantModule[];
  administratorEmail: string;
  /** Optional. Pre-fills the administrator's name on their activation form. */
  administratorFirstName?: string;
  administratorLastName?: string;
  /** Makes an honest retry idempotent instead of provisioning twice. */
  idempotencyKey: string;
}

export interface ProvisionTenantResult {
  tenantId: string;
  bootstrapInvitationId: string;
  completedAt: string;
}

/** The default page size and the choices the directory offers. Zero asks for every matching row. */
export const TENANT_PAGE_SIZE = 10;
export const TENANT_PAGE_SIZES = [10, 25, 50];

/**
 * The shared client serialises params as scalars, and the multi-select filters
 * are genuinely repeated keys, so the query string is built here rather than
 * widening a shared contract for one page.
 */
function overviewSearchParams(
  query: TenantOverviewQuery,
  pageSize: number
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("filter", query.filter);
  params.set("sort", query.sort);
  params.set("page", String(query.page));
  params.set("pageSize", String(pageSize));

  const search = query.search.trim();
  if (search) params.set("search", search);

  for (const moduleId of grantableModules(query.modules))
    params.append("module", moduleId);

  if (query.createdFrom) params.set("createdFrom", query.createdFrom);
  if (query.createdTo) params.set("createdTo", query.createdTo);

  return params;
}

/**
 * The directory can filter by any Fusion module, but the service only knows the ones it grants and
 * rejects the rest. No tenant can hold a module that is never granted, so those are answered here:
 * they drop out of an "any of" selection, and a selection of only those matches nothing.
 */
const GRANTABLE_MODULES = new Set<string>([
  "CoreHR",
  "Performance",
  "Learning",
  "Recruitment",
  "Interview",
] satisfies TenantModule[]);

function grantableModules(modules: string[]): string[] {
  return modules.filter((id) => GRANTABLE_MODULES.has(id));
}

function matchesNothing(query: TenantOverviewQuery): boolean {
  return (
    query.modules.length > 0 && grantableModules(query.modules).length === 0
  );
}

function emptyPage(query: TenantOverviewQuery): TenantOverviewPage {
  return {
    rows: [],
    totalCount: 0,
    page: 1,
    pageSize: query.pageSize,
    counts: { all: 0, awaitingActivation: 0, active: 0, needsAttention: 0 },
  };
}

export function listTenants(
  query: TenantOverviewQuery,
  signal?: AbortSignal
): Promise<TenantOverviewPage> {
  if (matchesNothing(query)) return Promise.resolve(emptyPage(query));
  const params = overviewSearchParams(query, query.pageSize);
  return client.get<TenantOverviewPage>(`${BASE}?${params}`, { signal });
}

/**
 * Every tenant the current query matches, which is what an export must contain.
 * It reuses the same query object as the list so the file can never describe a
 * different set from the one on screen.
 */
export function listAllMatchingTenants(
  query: TenantOverviewQuery,
  signal?: AbortSignal
): Promise<TenantOverviewPage> {
  if (matchesNothing(query)) return Promise.resolve(emptyPage(query));
  const params = overviewSearchParams({ ...query, page: 1 }, 0);
  return client.get<TenantOverviewPage>(`${BASE}?${params}`, { signal });
}

/**
 * A bootstrap event as the workspace shows it. Deliberately narrow: no
 * correlation or invitation identifiers, no stored metadata, no invited address.
 */
export interface TenantActivityEntry {
  eventType: string;
  tenantId: string;
  tenantName: string;
  occurredAt: string;
  outcome: string;
  /** Null when the platform itself acted rather than a person. */
  actorName: string | null;
}

/**
 * A module provisioning will accept. Absence from this list is the authoritative
 * signal that a module cannot be provisioned — the workspace derives
 * availability from it rather than restating the rule in its own text.
 */
export interface ProvisionableModule {
  module: TenantModule;
  /** Granted with every tenant regardless of the request. */
  mandatory: boolean;
}

export function listProvisionableModules(
  signal?: AbortSignal
): Promise<ProvisionableModule[]> {
  return client.get<ProvisionableModule[]>(`${BASE}/module-catalogue`, {
    signal,
  });
}

/** The preview shown under the directory. Bounded by the service. */
export const ACTIVITY_PREVIEW_LIMIT = 6;

export function listRecentActivity(
  limit: number = ACTIVITY_PREVIEW_LIMIT,
  signal?: AbortSignal
): Promise<TenantActivityEntry[]> {
  return client.get<TenantActivityEntry[]>(`${BASE}/activity?limit=${limit}`, {
    signal,
  });
}

export function getTenant(
  tenantId: string,
  signal?: AbortSignal
): Promise<TenantDetail> {
  return client.get<TenantDetail>(`${BASE}/${tenantId}`, { signal });
}

export function provisionTenant(
  input: ProvisionTenantInput
): Promise<ProvisionTenantResult> {
  return client.post<ProvisionTenantResult>(BASE, input);
}

function invitationPath(tenantId: string, invitationId: string): string {
  return `${BASE}/${tenantId}/bootstrap-invitation/${invitationId}`;
}

export function resendInvitation(tenantId: string, invitationId: string) {
  return client.post<string>(
    `${invitationPath(tenantId, invitationId)}/resend`
  );
}

export function revokeInvitation(tenantId: string, invitationId: string) {
  return client.post<string>(
    `${invitationPath(tenantId, invitationId)}/revoke`
  );
}

export function replaceInvitation(
  tenantId: string,
  invitationId: string,
  email: string
) {
  return client.post<string>(
    `${invitationPath(tenantId, invitationId)}/replace`,
    {
      email,
    }
  );
}

export function reissueInvitation(tenantId: string, invitationId: string) {
  return client.post<string>(
    `${invitationPath(tenantId, invitationId)}/reissue`
  );
}

/**
 * Tenant lifecycle. Deactivation removes customer access and is reversible;
 * archival ends it for good and takes the tenant out of the list. None of these
 * calls touches tenant business data.
 */
export function deactivateTenant(tenantId: string) {
  return client.post<null>(`${BASE}/${tenantId}/deactivate`);
}

export function reactivateTenant(tenantId: string) {
  return client.post<null>(`${BASE}/${tenantId}/reactivate`);
}

export function archiveTenant(tenantId: string) {
  return client.post<null>(`${BASE}/${tenantId}/archive`);
}

/**
 * Turns an optional product on or off for the tenant. Off pauses it: data, roles
 * and assignments are kept, and people lose it as their sessions renew. Core HR
 * can't be turned off.
 */
export function setTenantProduct(tenantId: string, module: TenantModule, enabled: boolean) {
  const path = `${BASE}/${tenantId}/products/${module}`;
  return enabled ? client.post<null>(path) : client.delete<null>(path);
}

/** Renames the organization display name. The tenant key is unaffected. */
export function renameTenant(tenantId: string, name: string) {
  return client.post<null>(`${BASE}/${tenantId}/rename`, { name });
}

/**
 * The stable failure code the endpoint sends alongside the message. Branching on
 * this keeps validation attached to the field that caused it; branching on
 * message text would break the moment the wording is refined.
 */
export function failureCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) {
    return null;
  }

  const details = error.details as { code?: unknown } | null;
  return typeof details?.code === "string" ? details.code : error.code;
}

/**
 * How a failure should be recovered from, which is what the interface actually
 * needs to decide. A permission denial, a stale command and an unreachable
 * dependency all fail the same request but need different responses.
 */
type FailureKind =
  | "validation"
  | "permission"
  | "conflict"
  | "not-found"
  | "unavailable"
  | "unexpected";

export function failureKind(error: unknown): FailureKind {
  if (!(error instanceof ApiError)) {
    // A TypeError from fetch means the request never reached the service.
    return error instanceof TypeError ? "unavailable" : "unexpected";
  }

  if (error.status === 400) return "validation";
  if (error.status === 401 || error.status === 403) return "permission";
  if (error.status === 404) return "not-found";
  if (error.status === 409) return "conflict";
  if (error.status === 502 || error.status === 503 || error.status === 504) {
    return "unavailable";
  }

  return "unexpected";
}

export function failureMessage(error: unknown): string | null {
  return error instanceof ApiError ? (error.errors[0] ?? null) : null;
}

// ── Administrative continuity and recovery ─────────────

export type RecoveryStatusValue =
  | "NotRequired"
  | "AwaitingAdministratorActivation"
  | "Required"
  | "Pending"
  | "Completed"
  | "Failed";

export interface RecoveryAttempt {
  invitationId: string;
  recipientEmail: string;
  initiatedAt: string;
  initiatedByUserId: string | null;
  state: InvitationStateValue;
  deliveryStatus: DeliveryOutcomeValue | null;
}

/**
 * What Platform can see about a tenant's administration.
 *
 * Counts and status only — deliberately no administrator identities beyond what
 * recovery itself requires, and no tenant business data.
 */
export interface TenantContinuityHealth {
  usableAdministrators: number;
  activeAdministrators: number;
  suspendedAdministrators: number;
  pendingAdministratorInvitations: number;
  recoveryStatus: RecoveryStatusValue;
  latestRecoveryAttempt: RecoveryAttempt | null;
}

export interface InitiateRecoveryInput {
  tenantId: string;
  recipientEmail: string;
  verificationAcknowledged: boolean;
  verificationReference?: string;
}

export function getTenantContinuityHealth(
  tenantId: string,
  signal?: AbortSignal
): Promise<TenantContinuityHealth> {
  return client.get<TenantContinuityHealth>(`${BASE}/${tenantId}/access`, {
    signal,
  });
}

export function initiateAdministratorRecovery(
  input: InitiateRecoveryInput
): Promise<{ invitationId: string; deliveryFailed: boolean }> {
  return client.post(`${BASE}/${input.tenantId}/administrator-recovery`, {
    recipientEmail: input.recipientEmail,
    verificationAcknowledged: input.verificationAcknowledged,
    verificationReference: input.verificationReference,
  });
}

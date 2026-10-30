import type { ApiClient } from "./types";

/** A person on the org chart, shaped for the viewer by Core HR (fields the tenant hides from them are null). */
export interface OrgChartPersonDto {
  employeeKey: string;
  displayName: string;
  initials: string;
  jobTitle: string | null;
  unit: OrgChartUnitDto | null;
  workLocation: string | null;
  workEmail: string | null;
  /** Year the current employment started. */
  startYear: number | null;
  /** The full start date (yyyy-mm-dd), for HR only: the Tenure lens. */
  startDate: string | null;
  /** In the first 90 days of employment. */
  isNew: boolean;
  /** Null for the top of the company, or when the manager is outside the viewer's slice. */
  managerKey: string | null;
  dottedLineManagerKeys: string[];
  /** Whole-company counts, the same for every viewer. */
  directCount: number;
  totalCount: number;
  /** API-relative photo address with a cache version (fetch it as a blob through the client); null without a photo. */
  photoUrl: string | null;
}

export interface OrgChartUnitDto {
  id: string;
  name: string;
  /** The unit's top-level ancestor under the organization root; null for the root itself. */
  divisionId: string | null;
  divisionName: string | null;
}

/** People left out of the response, counted under the person they report to. */
export interface OrgChartFoldDto {
  parentKey: string;
  count: number;
  /** The viewer may see them: the window rooted at the parent brings them. False outside a DirectReports slice. */
  loadable: boolean;
}

/** What a windowed chart leaves out, so the page still speaks for the whole chart. */
export interface OrgChartWindowDto {
  /** Levels below each window root. */
  depth: number;
  /** Everyone the viewer may see on the date, loaded or not. */
  headcount: number;
  /** Every division among them, by name. */
  divisions: { id: string; name: string }[];
  /** The earliest start among them (yyyy-mm-dd), for HR only: Replay's first day. */
  firstStartDate: string | null;
}

export type OrgChartScope = "Tenant" | "DirectReports";

/** `GET /api/corehr/org-chart`: the people org chart as of a date (another date than today is for HR). */
export interface OrgChartDto {
  asOf: string;
  scope: OrgChartScope;
  /** The viewer's own employee key; null without an employee record. */
  viewerKey: string | null;
  people: OrgChartPersonDto[];
  folded: OrgChartFoldDto[];
  /** Open roles under visible managers, from today on: Open for everyone, On hold for HR. */
  openRoles: OrgChartOpenRoleDto[];
  /** Above 3,000 people, or for a root, a window: its chains and branches, the rest folded. Null for the whole chart. */
  window: OrgChartWindowDto | null;
}

/** Filled and Closed take a role off the chart. */
export type OpenRoleStatus = "Open" | "OnHold" | "Filled" | "Closed";

/** A role planned in a manager's line before anyone holds it: a dashed Hiring card. */
export interface OrgChartOpenRoleDto {
  id: string;
  jobTitle: string;
  managerKey: string;
  unit: OrgChartUnitDto | null;
  /** yyyy-mm-dd; null when not set. */
  targetStartDate: string | null;
  status: OpenRoleStatus;
  jobId?: string | null;
  placeId?: string | null;
  placeName?: string | null;
}

/** `POST /api/corehr/org-chart/open-roles` and `PUT …/{id}` (people admins). A new role is Open or OnHold. */
export interface OpenRoleRequest {
  jobId: string;
  placeId?: string | null;
  managerKey: string;
  orgUnitId: string;
  targetStartDate?: string | null;
  status?: OpenRoleStatus;
}

export type OrgChartChangeKind = "Join" | "Leave" | "Move";

/** A dated change: someone joins, leaves (`date` is their last day) or moves to a new manager. */
export interface OrgChartChangeDto {
  kind: OrgChartChangeKind;
  date: string;
  employeeKey: string;
  /** The manager they join or move to; null for a leaver. */
  managerKey: string | null;
  /** The joiner's card as of their first day; null for leavers and moves. */
  person: OrgChartPersonDto | null;
}

export const coreOrgChartPaths = {
  chart: () => "/corehr/org-chart",
  search: () => "/corehr/org-chart/search",
  changes: () => "/corehr/org-chart/changes",
  openRoles: () => "/corehr/org-chart/open-roles",
  openRole: (id: string) => `/corehr/org-chart/open-roles/${encodeURIComponent(id)}`,
} as const;

export const coreOrgChartQueryKeys = {
  all: () => ["core-org-chart"] as const,
  chart: (asOf: string | null) => [...coreOrgChartQueryKeys.all(), asOf ?? "today"] as const,
  branch: (asOf: string | null, root: string) => [...coreOrgChartQueryKeys.all(), asOf ?? "today", "branch", root] as const,
  search: (asOf: string | null, query: string) => [...coreOrgChartQueryKeys.all(), asOf ?? "today", "search", query] as const,
  changes: (from: string, to: string) => [...coreOrgChartQueryKeys.all(), "changes", from, to] as const,
};

export function createCoreOrgChartApi(client: ApiClient) {
  return {
    chart: (asOf: string | null, signal?: AbortSignal) =>
      client.get<OrgChartDto>(coreOrgChartPaths.chart(), { params: asOf ? { asOf } : undefined, signal }),
    /** A window rooted at someone: their chain to the top and their branch, deeper levels folded. */
    branch: (asOf: string | null, root: string, signal?: AbortSignal) =>
      client.get<OrgChartDto>(coreOrgChartPaths.chart(), { params: asOf ? { asOf, root } : { root }, signal }),
    /** At most eight people whose name, or job title or unit as the viewer sees them, contains the text. */
    search: (asOf: string | null, q: string, signal?: AbortSignal) =>
      client.get<OrgChartPersonDto[]>(coreOrgChartPaths.search(), { params: asOf ? { asOf, q } : { q }, signal }),
    /** `GET /api/corehr/org-chart/changes`: HR only, both days included, two years at most. */
    changes: (from: string, to: string, signal?: AbortSignal) =>
      client.get<OrgChartChangeDto[]>(coreOrgChartPaths.changes(), { params: { from, to }, signal }),
    createOpenRole: (request: OpenRoleRequest) => client.post<OrgChartOpenRoleDto>(coreOrgChartPaths.openRoles(), request),
    updateOpenRole: (id: string, request: OpenRoleRequest) => client.put<OrgChartOpenRoleDto>(coreOrgChartPaths.openRole(id), request),
  };
}

export type CoreOrgChartApi = ReturnType<typeof createCoreOrgChartApi>;

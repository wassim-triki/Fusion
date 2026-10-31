export interface WorkforceManagerSummaryDto {
  employeeId: string;
  displayName: string;
  email: string;
  isActive: boolean;
}

export interface WorkforceOrgAssignmentDto {
  orgUnitId: string;
  stableOrgUnitKey: string;
  name: string;
  type: string;
  parentStableOrgUnitKey: string | null;
  path: string;
  level: number;
  isActive: boolean;
}

export interface WorkforceDataQualityDto {
  state: "Ready" | "NeedsAttention" | "Blocked" | string;
  hasEmployeeStateIssues: boolean;
  hasOperationalBlockers: boolean;
  issueCodes: string[];
}

export interface WorkforceEmployeeSummaryDto {
  employeeId: string;
  stableEmployeeKey: string;
  employeeNumber: string | null;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  displayName: string;
  fullName: string;
  workEmail: string;
  jobTitle: string | null;
  hireDate: string;
  employmentStatus: string;
  isActive: boolean;
  orgUnit: WorkforceOrgAssignmentDto | null;
  manager: WorkforceManagerSummaryDto | null;
  directReportCount: number;
  dataQuality: WorkforceDataQualityDto;
  version: number;
}

export type WorkforceAccessState =
  | "NotInvited"
  | "InvitePending"
  | "ActiveAccount"
  | "Suspended"
  | "NeedsReview";

export type WorkforceAccessDeliveryState = "Sent" | "Suppressed" | "Failed";

export interface WorkforceAccessProfileSummaryDto {
  id: string;
  name: string;
}

export interface WorkforceAccessSubjectSummaryDto {
  employeeId: string;
  stableEmployeeKey: string;
  employeeNumber: string | null;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  displayName: string;
  workEmail: string;
  jobTitle: string | null;
  orgUnitName: string | null;
  workLocation: string | null;
  employmentStatus: string;
  isActive: boolean;
  directReportCount: number;
  accessState: WorkforceAccessState;
  accessStateLabel: string;
  accessStateDetail: string | null;
  accessProfiles: WorkforceAccessProfileSummaryDto[];
  invitationLabel: string;
  lastActivityLabel: string;
  lastActivityAt: string | null;
  deliveryState: WorkforceAccessDeliveryState | null;
  reviewReason: string | null;
  provisioningState: string;
  userId: string | null;
}

export interface WorkforceManagerScopeDto {
  scopeType: string;
  managerEmployeeId: string;
  directReportCount: number;
  includesIndirectReports: boolean;
}

export interface WorkforceCurrentUserContextDto {
  userId: string;
  tenantId: string;
  employeeId: string | null;
  employee: WorkforceEmployeeSummaryDto | null;
  managerScope: WorkforceManagerScopeDto | null;
  isWorkforceLinked: boolean;
}

export interface WorkforceEmployeeResolveRequest {
  employeeIds: string[];
}

export interface WorkforceOrgUnitSummaryDto {
  id: string;
  stableKey: string;
  name: string;
  type: string;
  parentStableKey: string | null;
  path: string;
  level: number;
  isActive: boolean;
}

export interface WorkforceOrgUnitTreeNodeDto {
  id: string;
  stableKey: string;
  name: string;
  type: string;
  parentStableKey: string | null;
  path: string;
  level: number;
  isActive: boolean;
  /** Active employees assigned directly to this unit. */
  memberCount: number;
  /** Active employees in this unit and all descendant units. */
  totalMemberCount: number;
  children: WorkforceOrgUnitTreeNodeDto[];
}

export interface WorkforceOrgUnitTreeDto {
  roots: WorkforceOrgUnitTreeNodeDto[];
}

export interface WorkforceEmployeePageDto {
  items: WorkforceEmployeeSummaryDto[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface WorkforceAccessSubjectPageDto {
  items: WorkforceAccessSubjectSummaryDto[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface WorkforceAccessRosterSummaryDto {
  totalCount: number;
  notInvitedCount: number;
  invitePendingCount: number;
  activeAccountCount: number;
  needsReviewCount: number;
  suspendedCount: number;
}

export const coreWorkforcePaths = {
  me: () => "/corehr/workforce/me",
  employee: (employeeId: string) => `/corehr/workforce/employees/${employeeId}`,
  resolve: () => "/corehr/workforce/employees/resolve",
  search: () => "/corehr/workforce/employees/search",
  accessSubjects: () => "/corehr/workforce/access-subjects",
  accessSubjectsSummary: () => "/corehr/workforce/access-subjects/summary",
  accessSubjectsPreview: () => "/corehr/workforce/access-subjects/preview",
  bulkInvite: () => "/corehr/workforce/access-subjects/bulk-invite",
  team: (employeeId: string) =>
    `/corehr/workforce/employees/${employeeId}/team`,
  downline: (employeeId: string) =>
    `/corehr/workforce/employees/${employeeId}/downline`,
  managerChain: (employeeId: string) =>
    `/corehr/workforce/employees/${employeeId}/manager-chain`,
  orgUnits: () => "/corehr/workforce/org-units",
  orgUnitTree: () => "/corehr/workforce/org-units/tree",
} as const;

export const coreWorkforceQueryKeys = {
  all: () => ["coreWorkforce"] as const,
  me: () => [...coreWorkforceQueryKeys.all(), "me"] as const,
  employees: () => [...coreWorkforceQueryKeys.all(), "employees"] as const,
  employee: (employeeId: string) =>
    [...coreWorkforceQueryKeys.employees(), employeeId] as const,
  resolve: (employeeIds: readonly string[]) =>
    [
      ...coreWorkforceQueryKeys.employees(),
      "resolve",
      [...employeeIds].sort(),
    ] as const,
  search: (params: {
    search?: string | null;
    page: number;
    pageSize: number;
  }) =>
    [
      ...coreWorkforceQueryKeys.employees(),
      "search",
      {
        search: params.search?.trim() || null,
        page: params.page,
        pageSize: params.pageSize,
      },
    ] as const,
  accessSubjects: (params: {
    search?: string | null;
    access?: WorkforceAccessState | null;
    profileId?: string | null;
    employeeStatus?: "Active" | "Inactive" | null;
    deliveryState?: WorkforceAccessDeliveryState | null;
    employeeKey?: string | null;
    baseline?: string | null;
    cohort?: string | null;
    orgUnitId?: string | null;
    organizationScope?: string | null;
    page: number;
    pageSize: number;
  }) =>
    [
      ...coreWorkforceQueryKeys.all(),
      "access-subjects",
      {
        search: params.search?.trim() || null,
        access: params.access ?? null,
        profileId: params.profileId ?? null,
        employeeStatus: params.employeeStatus ?? null,
        deliveryState: params.deliveryState ?? null,
        employeeKey: params.employeeKey ?? null,
        baseline: params.baseline ?? null,
        cohort: params.cohort ?? null,
        orgUnitId: params.orgUnitId ?? null,
        organizationScope: params.organizationScope ?? null,
        page: params.page,
        pageSize: params.pageSize,
      },
    ] as const,
  accessSubjectsSummary: () =>
    [...coreWorkforceQueryKeys.all(), "access-subjects-summary"] as const,
  accessSubjectsPreview: (params: {
    search?: string | null;
    access?: WorkforceAccessState | null;
    profileId?: string | null;
    employeeStatus?: "Active" | "Inactive" | null;
    employeeKey?: string | null;
    baseline?: string | null;
    cohort?: string | null;
    orgUnitId?: string | null;
    organizationScope?: string | null;
  }) =>
    [
      ...coreWorkforceQueryKeys.all(),
      "access-subjects-preview",
      {
        search: params.search?.trim() || null,
        access: params.access ?? null,
        profileId: params.profileId ?? null,
        employeeStatus: params.employeeStatus ?? null,
        employeeKey: params.employeeKey ?? null,
        baseline: params.baseline ?? null,
        cohort: params.cohort ?? null,
        orgUnitId: params.orgUnitId ?? null,
        organizationScope: params.organizationScope ?? null,
      },
    ] as const,
  team: (employeeId: string) =>
    [...coreWorkforceQueryKeys.employees(), employeeId, "team"] as const,
  managerChain: (employeeId: string) =>
    [
      ...coreWorkforceQueryKeys.employees(),
      employeeId,
      "manager-chain",
    ] as const,
  orgUnits: (includeInactive: boolean) =>
    [...coreWorkforceQueryKeys.all(), "org-units", includeInactive] as const,
  orgUnitTree: (params: {
    rootId?: string | null;
    maxDepth?: number;
    includeInactive?: boolean;
  }) =>
    [
      ...coreWorkforceQueryKeys.all(),
      "org-unit-tree",
      {
        rootId: params.rootId ?? null,
        maxDepth: params.maxDepth ?? 10,
        includeInactive: params.includeInactive ?? false,
      },
    ] as const,
} as const;

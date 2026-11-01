import type { ApiClient } from "./types";
import { ApiError } from "./types";

export type OrganizationLifecycleState = "Active" | "Inactive" | number;
export type OrganizationChangeKind = "Create" | "Change" | "Move" | "Inactivate" | "Correction" | "CodeCorrection" | number;
export type OrganizationBusinessEventKind = "Created" | "Renamed" | "TypeChanged" | "Moved" | "Inactivated" | number;

export interface OrganizationUnitStateDto {
  id: string;
  code: string;
  name: string;
  typeId: string;
  typeName: string;
  parentId: string | null;
  parentName: string | null;
  path: string;
  lifecycleState: OrganizationLifecycleState;
  effectiveFrom: string;
  version: number;
}

export interface OrganizationHierarchyNodeDto {
  unit: OrganizationUnitStateDto;
  children: OrganizationHierarchyNodeDto[];
}

export interface OrganizationHierarchyDto {
  asOf: string;
  roots: OrganizationHierarchyNodeDto[];
}

export interface OrganizationChangeDto {
  id: string;
  orgUnitId: string;
  unitName: string;
  unitCode: string;
  effectiveDate: string;
  kind: OrganizationChangeKind;
  summary: string | null;
  isCancelled: boolean;
  businessEventKinds: OrganizationBusinessEventKind[];
  before: OrganizationBusinessEventContextDto | null;
  after: OrganizationBusinessEventContextDto | null;
}

export interface OrganizationUnitReferenceDto {
  id: string;
  name: string;
  code: string;
}

export interface OrganizationTypeReferenceDto {
  id: string;
  name: string;
}

export interface OrganizationBusinessEventContextDto {
  name: string;
  type: OrganizationTypeReferenceDto;
  parent: OrganizationUnitReferenceDto | null;
  lifecycleState: OrganizationLifecycleState;
}

export interface OrganizationReadinessDto {
  isReady: boolean;
  reason: string | null;
  hasPermanentRoot: boolean;
  permanentRootId: string | null;
  permanentRootFirstEffectiveDate: string | null;
  isPermanentRootEffective: boolean;
}

/** Whether CoreHR's foundation is established: a published organization and a sound active workforce. */
export interface CoreHRReadinessDto {
  isReady: boolean;
  organization: OrganizationReadinessDto;
  workforce: {
    activeEmployees: number;
    withoutCurrentAssignment: number;
    assignedToInactiveUnit: number;
    withInvalidManager: number;
    inManagerCycle: number;
    importInProgress: boolean;
  };
}

export interface OrganizationalUnitTypeDto {
  id: string;
  displayName: string;
  isBuiltIn: boolean;
}

export interface CreateOrganizationRootRequest {
  code: string;
  name: string;
  effectiveDate: string;
}

export interface CreateOrganizationUnitRequest {
  code: string;
  name: string;
  typeId: string;
  parentId: string;
  effectiveDate: string;
}

export interface ChangeOrganizationUnitRequest {
  name?: string | null;
  typeId?: string | null;
  effectiveDate: string;
  reason?: string | null;
}

export interface MoveOrganizationUnitRequest {
  targetParentId: string;
  effectiveDate: string;
  reason?: string | null;
}

export interface InactivateOrganizationUnitRequest {
  effectiveDate: string;
  reason?: string | null;
}

export interface CorrectOrganizationUnitRequest {
  name?: string | null;
  typeId?: string | null;
  parentId?: string | null;
  lifecycleState?: OrganizationLifecycleState | null;
  effectiveDate: string;
  reason: string;
}

export interface CorrectOrganizationCodeRequest {
  code: string;
  reason: string;
}

export interface CreateOrganizationalUnitTypeRequest {
  name: string;
}

export interface RenameOrganizationalUnitTypeRequest {
  name: string;
}

export type OrganizationProblemKind =
  | "access-denied"
  | "not-found"
  | "validation"
  | "conflict"
  | "concurrency"
  | "temporal"
  | "unexpected";

export interface OrganizationProblem {
  kind: OrganizationProblemKind;
  message: string;
  fieldErrors: Record<string, string[]>;
  correlationId: string | null;
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Keeps Organization dates as server-aligned calendar values, never timestamps. */
export function organizationCalendarDate(value: string): string {
  if (!CALENDAR_DATE.test(value)) {
    throw new TypeError(`Expected an Organization calendar date (YYYY-MM-DD), received "${value}".`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year!, month! - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    throw new TypeError(`Invalid Organization calendar date "${value}".`);
  }
  return value;
}

export function organizationIfMatch(version: number): string {
  if (!Number.isInteger(version) || version < 0) {
    throw new TypeError("Organization version must be a non-negative integer.");
  }
  return `"${version}"`;
}

export function translateOrganizationError(error: unknown): OrganizationProblem {
  if (!(error instanceof ApiError)) {
    return {
      kind: "unexpected",
      message: error instanceof Error ? error.message : "Organization could not be updated.",
      fieldErrors: {},
      correlationId: null,
    };
  }

  const details = error.details;
  const fieldErrors =
    details && typeof details === "object" && !Array.isArray(details)
      ? Object.fromEntries(
          Object.entries(details as Record<string, unknown>).filter(
            (entry): entry is [string, string[]] =>
              Array.isArray(entry[1]) && entry[1].every((value) => typeof value === "string")
          )
        )
      : {};
  const code = error.code?.toLowerCase() ?? "";
  const kind: OrganizationProblemKind =
    error.status === 403
      ? "access-denied"
      : error.status === 404
        ? "not-found"
        : error.status === 412
          ? "concurrency"
          : error.status === 409
            ? "conflict"
            : error.status === 400 && code.includes("date")
              ? "temporal"
              : error.status === 400 || Object.keys(fieldErrors).length > 0
                ? "validation"
                : "unexpected";
  return {
    kind,
    message: error.errors[0] ?? "Organization could not be updated.",
    fieldErrors,
    correlationId: error.correlationId,
  };
}

export const coreOrganizationPaths = {
  hierarchy: () => "/corehr/organization/hierarchy",
  export: () => "/corehr/organization/export",
  unit: (id: string) => `/corehr/organization/units/${id}`,
  search: () => "/corehr/organization/search",
  history: (id: string) => `/corehr/organization/units/${id}/history`,
  upcomingChanges: () => "/corehr/organization/changes/upcoming",
  readiness: () => "/corehr/organization/readiness",
  coreHRReadiness: () => "/corehr/setup/readiness",
  types: () => "/corehr/organization/types",
  root: () => "/corehr/organization/root",
  units: () => "/corehr/organization/units",
  change: (id: string) => `/corehr/organization/units/${id}/change`,
  move: (id: string) => `/corehr/organization/units/${id}/move`,
  inactivate: (id: string) => `/corehr/organization/units/${id}/inactivate`,
  correct: (id: string) => `/corehr/organization/units/${id}/correct`,
  correctCode: (id: string) => `/corehr/organization/units/${id}/correct-code`,
  cancelChange: (id: string) => `/corehr/organization/changes/${id}/cancel`,
  type: (id: string) => `/corehr/organization/types/${id}`,
} as const;

export const coreOrganizationQueryKeys = {
  all: () => ["coreOrganization"] as const,
  hierarchy: (asOf: string) => [...coreOrganizationQueryKeys.all(), "hierarchy", asOf] as const,
  unit: (id: string, asOf: string) => [...coreOrganizationQueryKeys.all(), "unit", id, asOf] as const,
  search: (query: string, asOf: string) =>
    [...coreOrganizationQueryKeys.all(), "search", asOf, query] as const,
  history: (id: string) => [...coreOrganizationQueryKeys.all(), "history", id] as const,
  upcomingChanges: () => [...coreOrganizationQueryKeys.all(), "upcomingChanges"] as const,
  upcomingChange: (id: string) =>
    [...coreOrganizationQueryKeys.upcomingChanges(), id] as const,
  readiness: () => [...coreOrganizationQueryKeys.all(), "readiness"] as const,
  coreHRReadiness: () => [...coreOrganizationQueryKeys.all(), "coreHRReadiness"] as const,
  types: () => [...coreOrganizationQueryKeys.all(), "types"] as const,
} as const;

function withIfMatch(version: number) {
  return { headers: { "If-Match": organizationIfMatch(version) } };
}

/** Canonical Organization transport. UI state and cache behavior remain feature-owned. */
export function createCoreOrganizationApi(client: ApiClient) {
  return {
    /** The structure on a date as a workbook the import reads back. */
    exportStructure: (asOf: string, signal?: AbortSignal) =>
      client.get<Blob>(coreOrganizationPaths.export(), {
        params: { asOf: organizationCalendarDate(asOf) },
        responseType: "blob",
        signal,
      }),
    hierarchy: (asOf: string, signal?: AbortSignal) =>
      client.get<OrganizationHierarchyDto>(coreOrganizationPaths.hierarchy(), {
        params: { asOf: organizationCalendarDate(asOf) },
        signal,
      }),
    unit: (id: string, asOf: string, signal?: AbortSignal) =>
      client.get<OrganizationUnitStateDto>(coreOrganizationPaths.unit(id), {
        params: { asOf: organizationCalendarDate(asOf) },
        signal,
      }),
    search: (query: string, asOf: string, signal?: AbortSignal) =>
      client.get<OrganizationUnitStateDto[]>(coreOrganizationPaths.search(), {
        params: { query, asOf: organizationCalendarDate(asOf) },
        signal,
      }),
    readiness: (signal?: AbortSignal) =>
      client.get<OrganizationReadinessDto>(coreOrganizationPaths.readiness(), { signal }),
    coreHRReadiness: (signal?: AbortSignal) =>
      client.get<CoreHRReadinessDto>(coreOrganizationPaths.coreHRReadiness(), { signal }),
    types: (signal?: AbortSignal) =>
      client.get<OrganizationalUnitTypeDto[]>(coreOrganizationPaths.types(), { signal }),
    history: (id: string, signal?: AbortSignal) =>
      client.get<OrganizationChangeDto[]>(coreOrganizationPaths.history(id), { signal }),
    upcomingChanges: (signal?: AbortSignal) =>
      client.get<OrganizationChangeDto[]>(coreOrganizationPaths.upcomingChanges(), { signal }),
    createRoot: (request: CreateOrganizationRootRequest) =>
      client.post<OrganizationUnitStateDto>(coreOrganizationPaths.root(), {
        ...request,
        effectiveDate: organizationCalendarDate(request.effectiveDate),
      }),
    createUnit: (request: CreateOrganizationUnitRequest) =>
      client.post<OrganizationUnitStateDto>(coreOrganizationPaths.units(), {
        ...request,
        effectiveDate: organizationCalendarDate(request.effectiveDate),
      }),
    changeUnit: (id: string, version: number, request: ChangeOrganizationUnitRequest) =>
      client.post<OrganizationUnitStateDto>(
        coreOrganizationPaths.change(id),
        { ...request, effectiveDate: organizationCalendarDate(request.effectiveDate) },
        withIfMatch(version)
      ),
    moveUnit: (id: string, version: number, request: MoveOrganizationUnitRequest) =>
      client.post<OrganizationUnitStateDto>(
        coreOrganizationPaths.move(id),
        { ...request, effectiveDate: organizationCalendarDate(request.effectiveDate) },
        withIfMatch(version)
      ),
    inactivateUnit: (id: string, version: number, request: InactivateOrganizationUnitRequest) =>
      client.post<OrganizationUnitStateDto>(
        coreOrganizationPaths.inactivate(id),
        { ...request, effectiveDate: organizationCalendarDate(request.effectiveDate) },
        withIfMatch(version)
      ),
    correctUnit: (id: string, version: number, request: CorrectOrganizationUnitRequest) =>
      client.post<OrganizationUnitStateDto>(
        coreOrganizationPaths.correct(id),
        { ...request, effectiveDate: organizationCalendarDate(request.effectiveDate) },
        withIfMatch(version)
      ),
    correctCode: (id: string, version: number, request: CorrectOrganizationCodeRequest) =>
      client.post<OrganizationUnitStateDto>(
        coreOrganizationPaths.correctCode(id),
        request,
        withIfMatch(version)
      ),
    cancelChange: (id: string, version: number) =>
      client.post<void>(coreOrganizationPaths.cancelChange(id), undefined, withIfMatch(version)),
    createType: (request: CreateOrganizationalUnitTypeRequest) =>
      client.post<OrganizationalUnitTypeDto>(coreOrganizationPaths.types(), request),
    renameType: (id: string, request: RenameOrganizationalUnitTypeRequest) =>
      client.put<OrganizationalUnitTypeDto>(coreOrganizationPaths.type(id), request),
    deleteType: (id: string) => client.delete<void>(coreOrganizationPaths.type(id)),
  };
}

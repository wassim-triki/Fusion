import type { ApiClient } from "./types";

/** A company list by its address id. */
export type CompanyListId = "employment-types" | "levels" | "job-families" | "change-reasons" | "leave-types";

export interface CatalogValueRefDto {
  id: string;
  label: string;
  isRetired: boolean;
}

/**
 * A job in the company's catalogue. `peopleCount` is who holds it today; `inUse` says anything ever pointed at it
 * (people past or scheduled, open roles), which is when it can be retired or merged but not deleted.
 */
export interface JobDto {
  id: string;
  title: string;
  family: CatalogValueRefDto | null;
  level: CatalogValueRefDto | null;
  isRetired: boolean;
  peopleCount: number;
  openRoleCount: number;
  inUse: boolean;
}

export interface PlaceDto {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  isRetired: boolean;
  peopleCount: number;
  openRoleCount: number;
  inUse: boolean;
}

/** `usageCount` counts jobs for levels and families, people employed today for employment types. */
export interface CompanyListValueDto {
  id: string;
  key: string;
  label: string;
  sortOrder: number;
  isRetired: boolean;
  usageCount: number;
  inUse: boolean;
}

export interface CompanyListDto {
  id: CompanyListId;
  values: CompanyListValueDto[];
}

export interface JobRequest {
  title: string;
  familyId?: string | null;
  levelId?: string | null;
}

export interface PlaceRequest {
  name: string;
  city?: string | null;
  country?: string | null;
}

export const coreCatalogPaths = {
  jobs: () => "/corehr/catalog/jobs",
  job: (id: string) => `/corehr/catalog/jobs/${encodeURIComponent(id)}`,
  places: () => "/corehr/catalog/places",
  place: (id: string) => `/corehr/catalog/places/${encodeURIComponent(id)}`,
  lists: () => "/corehr/catalog/lists",
  listValues: (list: CompanyListId) => `/corehr/catalog/lists/${list}/values`,
  listValue: (list: CompanyListId, id: string) => `/corehr/catalog/lists/${list}/values/${encodeURIComponent(id)}`,
  listOrder: (list: CompanyListId) => `/corehr/catalog/lists/${list}/order`,
} as const;

export const coreCatalogQueryKeys = {
  all: () => ["core-catalog"] as const,
  jobs: () => [...coreCatalogQueryKeys.all(), "jobs"] as const,
  places: () => [...coreCatalogQueryKeys.all(), "places"] as const,
  lists: () => [...coreCatalogQueryKeys.all(), "lists"] as const,
};

/** The company's jobs, places and lists (`/api/corehr/catalog`). */
export function createCoreCatalogApi(client: ApiClient) {
  return {
    jobs: (signal?: AbortSignal) => client.get<JobDto[]>(coreCatalogPaths.jobs(), { signal }),
    createJob: (request: JobRequest) => client.post<JobDto>(coreCatalogPaths.jobs(), request),
    updateJob: (id: string, request: JobRequest) => client.put<JobDto>(coreCatalogPaths.job(id), request),
    retireJob: (id: string) => client.post<JobDto>(`${coreCatalogPaths.job(id)}/retire`),
    restoreJob: (id: string) => client.post<JobDto>(`${coreCatalogPaths.job(id)}/restore`),
    /** Moves everyone and every open role on `id` to `intoId`, then removes `id`. */
    mergeJob: (id: string, intoId: string) => client.post<JobDto>(`${coreCatalogPaths.job(id)}/merge`, { intoId }),
    deleteJob: (id: string) => client.delete<void>(coreCatalogPaths.job(id)),

    places: (signal?: AbortSignal) => client.get<PlaceDto[]>(coreCatalogPaths.places(), { signal }),
    createPlace: (request: PlaceRequest) => client.post<PlaceDto>(coreCatalogPaths.places(), request),
    updatePlace: (id: string, request: PlaceRequest) => client.put<PlaceDto>(coreCatalogPaths.place(id), request),
    retirePlace: (id: string) => client.post<PlaceDto>(`${coreCatalogPaths.place(id)}/retire`),
    restorePlace: (id: string) => client.post<PlaceDto>(`${coreCatalogPaths.place(id)}/restore`),
    mergePlace: (id: string, intoId: string) => client.post<PlaceDto>(`${coreCatalogPaths.place(id)}/merge`, { intoId }),
    deletePlace: (id: string) => client.delete<void>(coreCatalogPaths.place(id)),

    lists: (signal?: AbortSignal) => client.get<CompanyListDto[]>(coreCatalogPaths.lists(), { signal }),
    addValue: (list: CompanyListId, label: string) => client.post<CompanyListValueDto>(coreCatalogPaths.listValues(list), { label }),
    renameValue: (list: CompanyListId, id: string, label: string) =>
      client.put<CompanyListValueDto>(coreCatalogPaths.listValue(list, id), { label }),
    retireValue: (list: CompanyListId, id: string) => client.post<CompanyListValueDto>(`${coreCatalogPaths.listValue(list, id)}/retire`),
    restoreValue: (list: CompanyListId, id: string) => client.post<CompanyListValueDto>(`${coreCatalogPaths.listValue(list, id)}/restore`),
    deleteValue: (list: CompanyListId, id: string) => client.delete<void>(coreCatalogPaths.listValue(list, id)),
    reorder: (list: CompanyListId, valueIds: string[]) => client.put<CompanyListDto[]>(coreCatalogPaths.listOrder(list), { valueIds }),
  };
}

export type CoreCatalogApi = ReturnType<typeof createCoreCatalogApi>;

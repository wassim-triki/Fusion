import type { ApiClient } from "./types";

// ── The top bar search (B-211): one read per module, asked in parallel ──

/** What a person is to the viewer, said beside their name. */
export type CoreSearchRelation = "Self" | "Manager" | "Report" | "Teammate";

export interface CoreSearchPersonDto {
  employeeKey: string;
  /** Performance keys people by id (praise, feedback, 1:1s). */
  employeeId: string;
  displayName: string;
  photoUrl: string | null;
  jobTitle: string | null;
  unitName: string | null;
  place: string | null;
  relation: CoreSearchRelation | null;
}

/** A team, place or job, with how many people the viewer sees in it. */
export interface CoreSearchGroupDto {
  id: string;
  name: string;
  people: number;
}

export interface CoreSearchDto {
  /** The best matches; before anything is typed, the viewer's manager then their reports or teammates. */
  people: CoreSearchPersonDto[];
  peopleTotal: number;
  units: CoreSearchGroupDto[];
  places: CoreSearchGroupDto[];
  /** HR only. */
  jobs: CoreSearchGroupDto[];
  reports: { id: string; name: string }[];
  /** The viewer may open the org chart. */
  orgChart: boolean;
}

export type PerformanceSearchObjectiveScope = "Company" | "OrgUnit" | "Employee";

export interface PerformanceSearchDto {
  objectives: { id: string; cycleId: string; title: string; scope: PerformanceSearchObjectiveScope; yours: boolean }[];
  oneOnOnes: { seriesId: string; withEmployeeId: string; withName: string }[];
  /** `administers`: the viewer runs rounds and opens the round itself. */
  reviewRounds: { id: string; name: string; administers: boolean }[];
  /** Administrators only. */
  cycles: { id: string; name: string }[];
}

export const fusionSearchKeys = {
  core: (tenantId: string, userId: string, q: string) => ["fusion-search", "core", tenantId, userId, q] as const,
  performance: (tenantId: string, userId: string, q: string) => ["fusion-search", "performance", tenantId, userId, q] as const,
};

export function createFusionSearchApi(client: ApiClient) {
  return {
    core: (q: string, signal?: AbortSignal) => client.get<CoreSearchDto>(`/corehr/search?q=${encodeURIComponent(q)}`, { signal }),
    performance: (q: string, signal?: AbortSignal) =>
      client.get<PerformanceSearchDto>(`/performance/search?q=${encodeURIComponent(q)}`, { signal }),
  };
}

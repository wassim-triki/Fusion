import type { ApiClient } from "./types";

export type ReportMeasure =
  | "headcount"
  | "joiners-leavers"
  | "turnover"
  | "tenure"
  | "places"
  | "jobs"
  | "open-roles";
export interface ReportDefinition {
  measure: ReportMeasure;
  groupBy: string;
  mode: "date" | "range";
  from: string;
  to: string;
  interval: "month" | "quarter" | "year";
  filters: { field: string; values: string[]; from?: string; to?: string }[];
  fields: string[];
}
export interface ReportFieldDto {
  key: string;
  label: string;
  kind: "person" | "choice" | "date" | "number" | "tags";
}
export interface ReportSeriesDto {
  key: string;
  label: string;
  values: (number | null)[];
  change: number | null;
}
export interface ReportRunDto {
  periods: { from: string; to: string }[];
  series: ReportSeriesDto[];
  totals: (number | null)[];
  fields: ReportFieldDto[];
  people: { employeeKey: string; values: Record<string, string | null> }[];
  unit: "people" | "years" | "percent";
  filterOptions: Record<string, string[]>;
  personOptions: { key: string; name: string; detail: string | null }[];
}
export interface SavedReportDto {
  id: string;
  name: string;
  definition: ReportDefinition;
  canEdit: boolean;
  roleIds: string[];
}
export interface ReportSummaryDto {
  id: string;
  name: string;
  canEdit: boolean;
}
export interface ReportRoleDto {
  id: string;
  name: string;
  held: boolean;
}

/** One stretch over which a person's details stay the same; `to` is exclusive, null when it runs on. */
export interface FrontPageSpanDto {
  from: string;
  to: string | null;
  job: string | null;
  place: string | null;
  firstDay: string | null;
  departmentId: string | null;
  department: string | null;
  parent: string | null;
  managerKey: string | null;
}
/** Each person once, with their dated stretches. */
export interface FrontPagePersonDto {
  employeeKey: string;
  name: string;
  photoUrl: string | null;
  spans: FrontPageSpanDto[];
}
export interface FrontPageDto {
  today: string;
  firstDate: string;
  lastDate: string;
  teamOnly: boolean;
  fields: string[];
  people: FrontPagePersonDto[];
  openRoles: { id: string; job: string | null; place: string | null; unit: string | null; targetStartDate: string | null; managerKey: string | null }[];
  recordsToComplete: { employeeKey: string; displayName: string; jobTitle: string | null; missing: string[] }[];
}

export function createCoreReportsApi(client: ApiClient) {
  const path = "/corehr/reports";
  return {
    frontPage: (signal?: AbortSignal) => client.get<FrontPageDto>(`${path}/front-page`, { signal }),
    list: (signal?: AbortSignal) =>
      client.get<ReportSummaryDto[]>(path, { signal }),
    get: (id: string, signal?: AbortSignal) =>
      client.get<SavedReportDto>(`${path}/${encodeURIComponent(id)}`, {
        signal,
      }),
    fields: (signal?: AbortSignal) =>
      client.get<ReportFieldDto[]>(`${path}/fields`, { signal }),
    roles: (signal?: AbortSignal) =>
      client.get<ReportRoleDto[]>(`${path}/roles`, { signal }),
    run: (definition: ReportDefinition, signal?: AbortSignal) =>
      client.post<ReportRunDto>(`${path}/run`, definition, { signal }),
    save: (name: string, definition: ReportDefinition, id?: string) =>
      id
        ? client.put<SavedReportDto>(`${path}/${encodeURIComponent(id)}`, {
            name,
            definition,
          })
        : client.post<SavedReportDto>(path, { name, definition }),
    share: (id: string, roleIds: string[]) =>
      client.put(`${path}/${encodeURIComponent(id)}/share`, { roleIds }),
    remove: (id: string) => client.delete(`${path}/${encodeURIComponent(id)}`),
    export: (definition: ReportDefinition, format: "csv" | "xlsx") =>
      client.post<Blob>(`${path}/export`, definition, {
        params: { format },
        responseType: "blob",
      }),
  };
}

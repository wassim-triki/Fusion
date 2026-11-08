import type { ApiClient } from "./types";

/** B-186: one import of the company from any number of files (`/api/corehr/imports`). */
export type CompanyImportStatus = "Open" | "BringingIn" | "Stopped" | "BroughtIn" | "Discarded";
export type CompanyImportKind = "People" | "Units" | "Unknown";

/** The meanings a column can have. `out` leaves it out. */
export type CompanyImportField =
  | "out"
  | "employeeNumber"
  | "personId"
  | "firstName"
  | "lastName"
  | "fullName"
  | "preferredName"
  | "workEmail"
  | "jobTitle"
  | "jobLevel"
  | "jobFamily"
  | "unit"
  | "manager"
  | "place"
  | "startDate"
  | "endDate"
  | "status"
  | "unitCode"
  | "unitName"
  | "parentUnit"
  | "unitType"
  | "unitHead";

export const PEOPLE_FIELDS: CompanyImportField[] = [
  "employeeNumber", "personId", "firstName", "lastName", "fullName", "preferredName", "workEmail", "jobTitle", "jobLevel",
  "jobFamily", "unit", "manager", "place", "startDate", "endDate", "status",
];
export const UNIT_FIELDS: CompanyImportField[] = ["unitCode", "unitName", "parentUnit", "unitType", "unitHead"];

/** How Fusion read a column: rules (sure), ai (read by Fusion's AI), person, ask (a question), out, empty. */
export type ColumnState = "rules" | "ai" | "person" | "ask" | "out" | "empty";

export interface ReadColumnDto {
  index: number;
  header: string | null;
  field: CompanyImportField | null;
  state: ColumnState;
  /** For a half-recognised header: the meaning Fusion leans to. */
  lean: CompanyImportField | null;
}

export interface SheetRowDto {
  row: number;
  cells: (string | null)[];
  /** The viewer's own row. */
  me: boolean;
}

export interface CompanyImportSheetDto {
  name: string;
  kind: CompanyImportKind;
  rows: number;
  /** People (or units) read from the sheet. */
  count: number;
  leftCount: number;
  columns: ReadColumnDto[];
  preview: SheetRowDto[];
}

export interface CompanyImportFileDto {
  id: string;
  name: string;
  format: string;
  sheets: CompanyImportSheetDto[];
  /** Why Fusion can't use the file; null when it read. */
  problem: CompanyImportFileProblem | null;
}

export type CompanyImportFileProblem = "format" | "unreadable" | "empty" | "tooBig" | "nothing" | "noNames" | "noUnitNames";

export interface ColumnQuestionDto {
  key: string;
  fileId: string;
  sheet: string;
  index: number;
  header: string;
  /** field: is this header that meaning? dates: are dates day first? */
  kind: "field" | "dates" | "noManagers";
  lean: string;
  values: string[];
  distinctCount: number;
  answer: string | null;
}

export type CompanyImportFactKind =
  | "managers"
  | "matched"
  | "units"
  | "unitsFromPeople"
  | "jobs"
  | "places"
  | "rootAdded"
  | "unitDuplicates"
  | "unitLoop";

export interface CompanyImportFactDto {
  kind: CompanyImportFactKind;
  count: number;
  of: number;
  /** managers: how references were found (number, reference, email, name, head); units: the units file; jobs: families. */
  detail: string | null;
  names: string[];
}

export interface ChartPersonDto {
  key: string;
  name: string;
  initials: string;
  title: string;
  unit: string;
  unitKey: string;
  place: string | null;
  managerKey: string | null;
  directCount: number;
  totalCount: number;
  you: boolean;
  /** Open checks about this person. */
  checks: string[];
  /** Fields changed by the person's fixes. */
  changed: string[];
  startAssumed: boolean;
  /** "people.xlsx · 3" */
  from: string;
}

export interface ChartUnitDto {
  key: string;
  name: string;
  type: string | null;
  parentKey: string | null;
  existing: boolean;
  added: boolean;
  headName: string | null;
  count: number;
  checks: string[];
}

export interface ChartJobDto {
  key: string;
  title: string;
  level: string | null;
  family: string | null;
  titles: string[];
  count: number;
  existing: boolean;
  checks: string[];
}

export interface CompanyImportChartDto {
  rootKey: string;
  people: ChartPersonDto[];
  units: ChartUnitDto[];
  jobs: ChartJobDto[];
  places: string[];
}

export type CheckKind = "unitMissing" | "unitParent" | "managerMissing" | "twice" | "sameJob" | "managerLoop" | "noStart" | "noTitle" | "notInFile" | "firstPersonStart";

export interface CheckOptionDto {
  key: string;
  label: string;
  /** "closest", "new", or the file a value came from. */
  from: string | null;
  lean: boolean;
}

export interface CheckDto {
  key: string;
  kind: CheckKind;
  subject: string | null;
  title: string | null;
  detail: string | null;
  options: CheckOptionDto[];
  answer: string | null;
  count: number;
}

export interface FixDto {
  id: string;
  personKey: string;
  personName: string;
  field: "manager" | "unit" | "jobTitle" | "place";
  from: string | null;
  to: string;
  text: string;
}

export type LeftOutKind = "column" | "sheet" | "left" | "oneName" | "noName" | "unitNoName" | "already" | "decided";

export interface LeftOutDto {
  kind: LeftOutKind;
  fileName: string | null;
  sheet: string | null;
  what: string | null;
  count: number;
  names: string[];
}

export interface CompanyImportCountsDto {
  people: number;
  units: number;
  newUnits: number;
  jobs: number;
  places: number;
  reportingLines: number;
  newPeople: number;
  changed: number;
  ending: number;
}

export interface CompanyImportProgressDto {
  phase: "waiting" | "units" | "jobs" | "people" | "lines" | "saving";
  units: number;
  jobs: number;
  people: number;
  reportingLines: number;
}

export interface CompanyImportResultDto {
  broughtInAt: string;
  broughtInBy: string;
  people: number;
  units: number;
  jobs: number;
  places: number;
  reportingLines: number;
  fileNames: string[];
  decided: number;
  decidedNames: string[];
  missingEmail: number;
  missingPlace: number;
  changed: number;
  ended: number;
}

/** One change to something in Fusion: what Fusion has and what the file says. */
export interface ImportChangeDto {
  field: string;
  from: string | null;
  to: string | null;
}

export interface AgainChangeDto {
  key: string;
  name: string;
  changes: ImportChangeDto[];
}

/** Importing again: matched against Fusion by employee number or work email, dated from applyFrom. */
export interface CompanyImportAgainDto {
  applyFrom: string;
  matchedBy: "number" | "email";
  new: { key: string; name: string; title: string; unit: string; manager: string | null; start: string }[];
  changed: AgainChangeDto[];
  notInFile: { key: string; name: string; detail: string | null; answer: "keep" | "end" | null }[];
  unchanged: number;
  units: AgainChangeDto[];
  jobs: AgainChangeDto[];
}

/** Stopped partway: what's in, what isn't, and the row Try again starts from. */
export interface CompanyImportStoppedDto {
  units: number;
  jobs: number;
  people: number;
  peopleLeft: number;
  linesLeft: boolean;
  row: number | null;
  fileName: string | null;
}

export interface CompanyImportDto {
  id: string;
  version: number;
  status: CompanyImportStatus;
  companyName: string;
  startedAt: string;
  startedBy: string;
  files: CompanyImportFileDto[];
  questions: ColumnQuestionDto[];
  facts: CompanyImportFactDto[];
  chart: CompanyImportChartDto;
  checks: CheckDto[];
  fixes: FixDto[];
  leftOut: LeftOutDto[];
  counts: CompanyImportCountsDto;
  fingerprint: string;
  canBringIn: boolean;
  openCount: number;
  /** "changed" or "failed": the last bring-in didn't happen and nothing was written. */
  lastFailure: "changed" | "failed" | null;
  progress: CompanyImportProgressDto | null;
  result: CompanyImportResultDto | null;
  /** The people by department in bring-in order (first faces of each); the bring-in frame fills them in. */
  wall: WallGroupDto[];
  again: CompanyImportAgainDto | null;
  stopped: CompanyImportStoppedDto | null;
}

export interface WallGroupDto {
  name: string;
  count: number;
  people: string[];
}

export interface CompanyImportEarlierDto {
  id: string;
  broughtInAt: string;
  by: string;
  fileNames: string[];
  people: number;
  units: number;
  changed: number;
}

/** A sentence read as a fix; null when Fusion can't place it. */
export interface CompanyImportSaidDto {
  personKey: string;
  personName: string;
  field: FixDto["field"];
  value: string;
  from: string | null;
  to: string;
}

export const coreImportPaths = {
  base: () => "/corehr/imports",
  active: () => "/corehr/imports/active",
  earlier: () => "/corehr/imports/earlier",
  template: () => "/corehr/imports/template",
  session: (id: string) => `/corehr/imports/${id}`,
  files: (id: string) => `/corehr/imports/${id}/files`,
  file: (id: string, fileId: string) => `/corehr/imports/${id}/files/${fileId}`,
  columns: (id: string) => `/corehr/imports/${id}/columns`,
  answers: (id: string) => `/corehr/imports/${id}/answers`,
  leans: (id: string) => `/corehr/imports/${id}/leans`,
  say: (id: string) => `/corehr/imports/${id}/say`,
  fixes: (id: string) => `/corehr/imports/${id}/fixes`,
  fix: (id: string, fixId: string) => `/corehr/imports/${id}/fixes/${fixId}`,
  bringIn: (id: string) => `/corehr/imports/${id}/bring-in`,
  discard: (id: string) => `/corehr/imports/${id}/discard`,
  resume: (id: string) => `/corehr/imports/${id}/resume`,
} as const;

export const coreImportQueryKeys = {
  all: ["core", "import"] as const,
  active: () => [...coreImportQueryKeys.all, "active"] as const,
  earlier: () => [...coreImportQueryKeys.all, "earlier"] as const,
  session: (id: string) => [...coreImportQueryKeys.all, "session", id] as const,
};

/** Files one import takes (CoreHR `CompanyImportService.MaxFiles`). */
export const CORE_IMPORT_MAX_FILES = 12;
const CORE_IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Files too many or too big to send; any other file goes up and says itself what's wrong with it. */
export function checkImportFiles(files: readonly File[]): { problem: "size" | "many"; name?: string } | null {
  if (files.length > CORE_IMPORT_MAX_FILES) return { problem: "many" };
  const big = files.find((file) => file.size > CORE_IMPORT_MAX_FILE_BYTES);
  return big ? { problem: "size", name: big.name } : null;
}

export function createCoreImportApi(client: ApiClient) {
  const ifMatch = (version: number) => ({ headers: { "If-Match": `"${version}"` } });
  const form = (files: File[], companyName?: string) => {
    const body = new FormData();
    for (const file of files) body.append("files", file, file.name);
    if (companyName) body.append("companyName", companyName);
    return body;
  };
  return {
    active: (signal?: AbortSignal) => client.get<{ id: string | null }>(coreImportPaths.active(), { signal }),
    earlier: (signal?: AbortSignal) => client.get<CompanyImportEarlierDto[]>(coreImportPaths.earlier(), { signal }),
    template: () => client.get<Blob>(coreImportPaths.template(), { responseType: "blob" }),
    session: (id: string, signal?: AbortSignal) => client.get<CompanyImportDto>(coreImportPaths.session(id), { signal }),
    start: (files: File[], companyName?: string) => client.post<CompanyImportDto>(coreImportPaths.base(), form(files, companyName)),
    addFiles: (id: string, version: number, files: File[]) => client.post<CompanyImportDto>(coreImportPaths.files(id), form(files), ifMatch(version)),
    removeFile: (id: string, version: number, fileId: string) => client.delete<CompanyImportDto>(coreImportPaths.file(id, fileId), ifMatch(version)),
    setColumn: (id: string, version: number, change: { fileId: string; sheet: string; index: number; field: CompanyImportField | null }) =>
      client.put<CompanyImportDto>(coreImportPaths.columns(id), change, ifMatch(version)),
    answer: (id: string, version: number, key: string, value: string | null) =>
      client.put<CompanyImportDto>(coreImportPaths.answers(id), { key, value }, ifMatch(version)),
    takeLeans: (id: string, version: number) => client.post<CompanyImportDto>(coreImportPaths.leans(id), undefined, ifMatch(version)),
    say: (id: string, text: string) => client.post<CompanyImportSaidDto | null>(coreImportPaths.say(id), { text }),
    addFix: (id: string, version: number, fix: { personKey: string; field: string; value: string; text: string }) =>
      client.post<CompanyImportDto>(coreImportPaths.fixes(id), fix, ifMatch(version)),
    removeFix: (id: string, version: number, fixId: string) => client.delete<CompanyImportDto>(coreImportPaths.fix(id, fixId), ifMatch(version)),
    bringIn: (id: string, version: number, fingerprint: string) =>
      client.post<CompanyImportDto>(coreImportPaths.bringIn(id), { fingerprint }, ifMatch(version)),
    resume: (id: string, version: number) => client.post<CompanyImportDto>(coreImportPaths.resume(id), undefined, ifMatch(version)),
    discard: (id: string, version: number) => client.post<CompanyImportDto>(coreImportPaths.discard(id), undefined, ifMatch(version)),
  };
}

export type CoreImportApi = ReturnType<typeof createCoreImportApi>;

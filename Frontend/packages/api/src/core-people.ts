import type { ApiClient } from "./types";

export type PeopleEmploymentState =
  | "Active"
  | "Scheduled"
  | "Former"
  | "Incomplete";
export type PeopleOrganizationScope = "Direct" | "Subtree";
export type PeopleSortField = "Name" | "EmployeeNumber" | "EmploymentDate";
export type PeopleSortDirection = "Asc" | "Desc";
export type EmployeeNumberMode = "Generated" | "Manual";

export interface PeopleManagerDto {
  employeeKey: string;
  displayName: string;
  employeeNumber: string;
  /** API-relative photo address with a cache version, or null without a photo. */
  photoUrl?: string | null;
  /** Set on a profile's primary manager (B-179). */
  employeeId?: string | null;
}

/** A dotted-line manager on the profile; the id is what ending the dotted line takes. */
export interface PeopleDottedLineManagerDto extends PeopleManagerDto {
  employeeId: string;
  since: string;
}

export interface PeopleWorkDto {
  orgUnitId: string | null;
  jobTitle: string;
  organizationName: string;
  organizationPath: string;
  location: string | null;
  effectiveFrom: string;
  isHistorical: boolean;
  /** The job and place from the company's catalogue; family and level on the profile only. */
  jobId?: string | null;
  placeId?: string | null;
  jobFamily?: string | null;
  jobLevel?: string | null;
}

export interface PeopleRowDto {
  employeeKey: string;
  employeeNumber: string;
  displayName: string;
  firstName: string;
  lastName: string;
  workEmail: string | null;
  employmentState: PeopleEmploymentState;
  employmentStart: string | null;
  employmentEnd: string | null;
  work: PeopleWorkDto | null;
  primaryManager: PeopleManagerDto | null;
  completeness: "Complete" | "WorkDetailsUnavailable" | string;
  /** API-relative photo address with a cache version; null without a photo. */
  photoUrl: string | null;
}

export interface PeoplePageDto {
  items: PeopleRowDto[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PeopleQueryParams {
  q?: string | null;
  state?: PeopleEmploymentState | null;
  orgUnitId?: string | null;
  organizationScope?: PeopleOrganizationScope;
  sort?: PeopleSortField;
  direction?: PeopleSortDirection;
  page?: number;
  pageSize?: number;
  /** Transient handoff filter: show only the cohort added by a completed Workforce Import. */
  importBatch?: string | null;
}

export interface PeopleProfileIdentityDto {
  employeeKey: string;
  employeeNumber: string;
  displayName: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  workEmail: string | null;
  /** Null for a colleague: the mobile shows to the person, HR and their branch manager. */
  phone: string | null;
  /** The worker's id, which other modules (Performance) key their records by. */
  employeeId: string;
  /** API-relative photo address with a cache version; null without a photo. */
  photoUrl: string | null;
}

/** How much of the Personal tab the viewer may read: Directory = preferred name, Contact = + mobile, Full = all. */
export type PersonalAccess = "Directory" | "Contact" | "Full";

export interface PeopleHomeAddressDto {
  street: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
}

export interface PeopleEmergencyContactDto {
  name: string;
  relationship: string | null;
  phone: string;
}

/** Fields above `access` come back null: tell "hidden" from "empty" by `access`, not by the values. */
export interface PeoplePersonalDto {
  employeeKey: string;
  access: PersonalAccess;
  canEdit: boolean;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  mobile: string | null;
  personalEmail: string | null;
  homeAddress: PeopleHomeAddressDto | null;
  /** yyyy-mm-dd */
  dateOfBirth: string | null;
  /** At most three. */
  emergencyContacts: PeopleEmergencyContactDto[] | null;
  version: number;
  /** A new home address waiting for HR (B-179); shown to the person and HR. */
  pendingHomeAddress?: PeoplePendingAddressDto | null;
}

export interface PeoplePendingAddressDto {
  requestId: string;
  address: PeopleHomeAddressDto;
  requestedAt: string;
  requestedBy: string;
}

/** Replaces the whole Personal tab: send back what you read with your change applied. */
export interface UpdatePersonalRequest {
  preferredName: string | null;
  mobile: string | null;
  personalEmail: string | null;
  homeAddress: PeopleHomeAddressDto | null;
  dateOfBirth: string | null;
  emergencyContacts: PeopleEmergencyContactDto[];
}

/** One Job information row: the job from `effectiveDate` until the next row. */
export interface PeopleJobHistoryRowDto {
  effectiveDate: string;
  jobTitle: string;
  orgUnitId: string;
  unitName: string;
  location: string | null;
  manager: PeopleManagerDto | null;
  isCurrent: boolean;
}

/** Newest first, up to today; scheduled changes are under Coming up. HR and the branch manager only. */
export interface PeopleJobHistoryDto {
  rows: PeopleJobHistoryRowDto[];
}

export interface EmployeePhotoDto {
  photoUrl: string | null;
}

export interface PeopleProfileEmploymentDto {
  state: PeopleEmploymentState;
  start: string | null;
  end: string | null;
  employmentType: string | null;
  employmentTypeId?: string | null;
}

export interface PeopleProfileReportDto {
  employeeKey: string;
  employeeNumber: string;
  displayName: string;
  jobTitle: string | null;
  /** API-relative photo address with a cache version, or null without a photo. */
  photoUrl?: string | null;
}

export type PeopleChangeKind =
  | "Work"
  | "Manager"
  | "EmploymentStarted"
  | "EmploymentEnded"
  | "WorkEstablished"
  /** The person or HR changed the Personal tab: `fields` name the sections, never the values. */
  | "PersonalDetails";

export interface PeopleChangeFieldDto {
  label: string;
  from: string | null;
  to: string | null;
}

export interface PeopleUpcomingChangeDto {
  effectiveDate: string;
  kind: PeopleChangeKind;
  employeeKey: string;
  fields: PeopleChangeFieldDto[];
}

export interface PeopleTimelineEventDto {
  effectiveDate: string;
  kind: PeopleChangeKind;
  title: string;
  isFuture: boolean;
  fields: PeopleChangeFieldDto[];
}

export interface PeopleTimelineDto {
  upcoming: PeopleUpcomingChangeDto[];
  timeline: PeopleTimelineEventDto[];
}

export interface PeopleProfileDto {
  identity: PeopleProfileIdentityDto;
  employment: PeopleProfileEmploymentDto;
  work: PeopleWorkDto | null;
  primaryManager: PeopleManagerDto | null;
  directReportCount: number;
  directReports: PeopleProfileReportDto[];
  completeness:
    | "Complete"
    | "EmploymentUnavailable"
    | "WorkDetailsUnavailable"
    | string;
  version: number;
  /** The effective date this snapshot was resolved for (Today by default). */
  viewedDate: string;
  /** True when viewing a non-Today date; the snapshot is read-only. */
  isAsOf: boolean;
  /** Change records from today on (scheduled, or today's while it can be undone); Today view only. */
  comingUp: WorkforceChangeDto[];
  /** Dotted-line (secondary) managers on the viewed date, beside the primary chain. */
  dottedLineManagers: PeopleDottedLineManagerDto[];
}

export interface MaintenanceResultDto {
  employeeKey: string;
  effectiveDate: string;
  isScheduled: boolean;
}

export interface DottedLineRequestBody {
  effectiveDate: string;
  managerEmployeeId: string;
}

// --- People changes: one record per decision (join, job change, end of employment) ----------------

export type WorkforceChangeKind = "Join" | "JobChange" | "EndEmployment";
export type WorkforceChangeStatus = "Scheduled" | "InEffect" | "Cancelled";

export interface ChangePersonRef {
  employeeId: string;
  employeeKey: string;
  displayName: string;
}

export interface ReassignedReport {
  person: ChangePersonRef;
  manager: ChangePersonRef | null;
}

export interface EndedDottedLine {
  person: ChangePersonRef;
  manager: ChangePersonRef;
}

/** What a change did, captured when it was made; "to" values are set only for the parts that change. */
export interface WorkforceChangeDetails {
  managerFrom: ChangePersonRef | null;
  managerTo: ChangePersonRef | null;
  managerChanged: boolean;
  unitFromId: string | null;
  unitFrom: string | null;
  unitToId: string | null;
  unitTo: string | null;
  titleFrom: string | null;
  titleTo: string | null;
  locationFrom: string | null;
  locationTo: string | null;
  unitChanged: boolean;
  titleChanged: boolean;
  locationChanged: boolean;
  /** "Along" or "Stays" when the person had reports. */
  teamOutcome: "Along" | "Stays" | null;
  teamCount: number;
  teamManager: ChangePersonRef | null;
  reassigned: ReassignedReport[] | null;
  dottedLinesEnded: EndedDottedLine[] | null;
  lastDay: string | null;
  isHire: boolean;
  employmentType: string | null;
  /** The picks behind the names, so an edit starts from the same job and place (absent on older records). */
  jobFromId?: string | null;
  jobToId?: string | null;
  placeFromId?: string | null;
  placeToId?: string | null;
  employmentTypeId?: string | null;
  /** Why, from the company's change reasons; the label as it was then. */
  reasonId?: string | null;
  reason?: string | null;
  isReportingOnly: boolean;
}

export interface WorkforceChangeDto {
  id: string;
  kind: WorkforceChangeKind;
  /** First day in effect; for an end of employment, the day after the last day. */
  effectiveDate: string;
  status: WorkforceChangeStatus;
  canCancel: boolean;
  canEdit: boolean;
  person: ChangePersonRef;
  createdBy: string | null;
  createdAt: string;
  note: string | null;
  details: WorkforceChangeDetails;
}

export interface TeamOutcomeRequest {
  stays: boolean;
  managerEmployeeId?: string | null;
}

/** A null part stays as it is; `removePlace` leaves the person without a place. */
export interface JobChangeRequest {
  effectiveDate: string;
  managerEmployeeId?: string | null;
  removeManager?: boolean;
  team?: TeamOutcomeRequest | null;
  orgUnitId?: string | null;
  jobId?: string | null;
  placeId?: string | null;
  removePlace?: boolean;
  note?: string | null;
  /** A value of the company's change reasons. */
  reasonId?: string | null;
}

export interface ReportReassignmentRequest {
  employeeId: string;
  /** Null leaves the report without a manager, by choice. */
  managerEmployeeId: string | null;
}

export interface EndEmploymentChangeRequest {
  lastDay: string;
  reports?: ReportReassignmentRequest[];
  note?: string | null;
  reasonId?: string | null;
}

export interface JoinChangeRequest {
  startDate: string;
  orgUnitId: string;
  jobId: string;
  placeId?: string | null;
  managerEmployeeId?: string | null;
  employmentTypeId?: string | null;
  note?: string | null;
}

export interface EditChangeRequest {
  job?: JobChangeRequest;
  end?: EndEmploymentChangeRequest;
  join?: JoinChangeRequest;
}

export interface EndEmploymentReportDto {
  person: ChangePersonRef;
  jobTitle: string | null;
  directReportCount: number;
  outcome: "Reassign" | "LeavesFirst" | "MovesFirst";
  outcomeDate: string | null;
}

export interface EndEmploymentChangePreviewDto {
  lastDay: string;
  defaultManager: ChangePersonRef | null;
  reports: EndEmploymentReportDto[];
  dottedLinesEnding: EndedDottedLine[];
}

/** What a new reporting line does in Performance (read from Performance for the change panel). */
export interface LineEffectsDto {
  reviewersStay: { cycleId: string; cycleName: string; reviewerEmployeeId: string; reviewerName: string }[];
  oneOnOnesEnd: { seriesId: string; managerEmployeeId: string; managerName: string }[];
}

export interface UpdateWorkEmailRequestBody {
  workEmail: string;
}

export interface PeopleAccessStatusDto {
  state:
    | "NoAccess"
    | "InvitationPending"
    | "Active"
    | "Suspended"
    | "NeedsReview"
    | string;
  label: string;
  detail: string | null;
}

export interface ManagerOptionDto {
  employeeId: string;
  employeeKey: string;
  employeeNumber: string;
  displayName: string;
  jobTitle: string;
  organizationName: string;
  organizationPath: string;
  availability: "Available" | "Scheduled" | string;
}

export interface EstablishmentRequestBase {
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  workEmail?: string | null;
  phone?: string | null;
  employeeNumberMode: EmployeeNumberMode;
  employeeNumber?: string | null;
  employmentTypeId?: string | null;
  orgUnitId: string;
  jobId: string;
  placeId?: string | null;
  primaryManagerEmployeeId?: string | null;
}

export interface HireEmployeeRequest extends EstablishmentRequestBase {
  startDate: string;
}

export interface AddExistingEmployeeRequest extends EstablishmentRequestBase {
  employmentStart: string;
  workDetailsEffectiveFrom: string;
}

export interface EstablishmentSuggestionDto {
  employeeKey: string;
  employeeNumber: string;
  displayName: string;
  reason: string;
}

export interface EstablishmentReviewRequest {
  firstName: string;
  lastName: string;
  workEmail?: string | null;
  employeeNumberMode: EmployeeNumberMode;
  employeeNumber?: string | null;
}

export interface EstablishmentConflictDto {
  kind: "EmployeeNumber" | "WorkEmail" | string;
  employeeKey: string;
  employeeNumber: string;
  displayName: string;
  message: string;
}

export interface EstablishmentReviewDto {
  conflict: EstablishmentConflictDto | null;
  suggestions: EstablishmentSuggestionDto[];
}

export interface EstablishmentResultDto {
  employeeKey: string;
  employeeNumber: string;
  displayName: string;
  workEmail: string | null;
  employmentState: PeopleEmploymentState;
  employmentStart: string;
  workDetailsEffectiveFrom: string;
  jobTitle: string;
  organizationName: string;
  organizationPath: string;
  location: string | null;
  primaryManagerName: string | null;
  reviewSuggestions: EstablishmentSuggestionDto[];
}

export const corePeoplePaths = {
  people: () => "/corehr/employees/people",
  profile: (employeeKey: string) =>
    `/corehr/employees/people/${encodeURIComponent(employeeKey)}`,
  timeline: (employeeKey: string) =>
    `/corehr/employees/people/${encodeURIComponent(employeeKey)}/timeline`,
  accessStatus: (employeeKey: string) =>
    `/corehr/employees/people/${encodeURIComponent(employeeKey)}/access-status`,
  managerOptions: () => "/corehr/employees/people/manager-options",
  establishmentReview: () => "/corehr/employees/people/establishment-review",
  jobChange: (employeeKey: string) =>
    `/corehr/employees/people/${encodeURIComponent(employeeKey)}/changes/job`,
  endEmploymentChange: (employeeKey: string) =>
    `/corehr/employees/people/${encodeURIComponent(employeeKey)}/changes/end-employment`,
  endEmploymentPreview: (employeeKey: string) =>
    `/corehr/employees/people/${encodeURIComponent(employeeKey)}/changes/end-employment/preview`,
  joinChange: (employeeKey: string) =>
    `/corehr/employees/people/${encodeURIComponent(employeeKey)}/changes/join`,
  change: (changeId: string) => `/corehr/employees/people/changes/${encodeURIComponent(changeId)}`,
  cancelChange: (changeId: string) =>
    `/corehr/employees/people/changes/${encodeURIComponent(changeId)}/cancel`,
  upcomingChanges: () => "/corehr/employees/people/changes/upcoming",
  lineEffects: (employeeId: string) =>
    `/performance/people/${encodeURIComponent(employeeId)}/line-effects`,
  dottedLines: (employeeKey: string) =>
    `/corehr/employees/people/${encodeURIComponent(employeeKey)}/dotted-lines`,
  endDottedLine: (employeeKey: string) =>
    `/corehr/employees/people/${encodeURIComponent(employeeKey)}/dotted-lines/end`,
  updateWorkEmail: (employeeKey: string) =>
    `/corehr/employees/people/${encodeURIComponent(employeeKey)}/work-email`,
  personal: (employeeKey: string) =>
    `/corehr/employees/people/${encodeURIComponent(employeeKey)}/personal`,
  jobHistory: (employeeKey: string) =>
    `/corehr/employees/people/${encodeURIComponent(employeeKey)}/job-history`,
  photo: (employeeKey: string) =>
    `/corehr/employees/people/${encodeURIComponent(employeeKey)}/photo`,
  hire: () => "/corehr/employees/hire",
  addExisting: () => "/corehr/employees/add-existing",
} as const;

export const corePeopleQueryKeys = {
  all: () => ["corePeople"] as const,
  lists: () => [...corePeopleQueryKeys.all(), "list"] as const,
  list: (params: PeopleQueryParams) =>
    [...corePeopleQueryKeys.lists(), params] as const,
  profiles: () => [...corePeopleQueryKeys.all(), "profile"] as const,
  profile: (employeeKey: string, asOf?: string | null) =>
    [...corePeopleQueryKeys.profiles(), employeeKey, asOf ?? "today"] as const,
  timeline: (employeeKey: string) =>
    [...corePeopleQueryKeys.profiles(), employeeKey, "timeline"] as const,
  endEmploymentPreview: (employeeKey: string, lastDay: string) =>
    [...corePeopleQueryKeys.profiles(), employeeKey, "end-preview", lastDay] as const,
  upcomingChanges: () => [...corePeopleQueryKeys.all(), "upcomingChanges"] as const,
  lineEffects: (employeeId: string, managerId: string | null) =>
    [...corePeopleQueryKeys.all(), "lineEffects", employeeId, managerId ?? "none"] as const,
  accessStatus: (employeeKey: string) =>
    [...corePeopleQueryKeys.profiles(), employeeKey, "access"] as const,
  personal: (employeeKey: string) =>
    [...corePeopleQueryKeys.profiles(), employeeKey, "personal"] as const,
  jobHistory: (employeeKey: string) =>
    [...corePeopleQueryKeys.profiles(), employeeKey, "job-history"] as const,
  /** Keyed by the versioned address, so a new upload is a new entry and an old one never goes stale. */
  photo: (photoUrl: string) => [...corePeopleQueryKeys.all(), "photo", photoUrl] as const,
  managerOptions: (effectiveDate: string, q: string, forEmployee?: string | null) =>
    [...corePeopleQueryKeys.all(), "managerOptions", effectiveDate, q, forEmployee ?? "any"] as const,
} as const;

/** Canonical typed transport for the Workforce Slice 1 People surface. */
export function createCorePeopleApi(client: ApiClient) {
  return {
    people: (params: PeopleQueryParams, signal?: AbortSignal) =>
      client.get<PeoplePageDto>(corePeoplePaths.people(), {
        params: { ...params },
        signal,
      }),
    profile: (
      employeeKey: string,
      asOf?: string | null,
      signal?: AbortSignal
    ) =>
      client.get<PeopleProfileDto>(corePeoplePaths.profile(employeeKey), {
        params: asOf ? { asOf } : undefined,
        signal,
      }),
    timeline: (employeeKey: string, signal?: AbortSignal) =>
      client.get<PeopleTimelineDto>(corePeoplePaths.timeline(employeeKey), {
        signal,
      }),
    endEmploymentPreview: (employeeKey: string, lastDay: string, signal?: AbortSignal) =>
      client.get<EndEmploymentChangePreviewDto>(corePeoplePaths.endEmploymentPreview(employeeKey), {
        params: { lastDay },
        signal,
      }),
    changeJob: (employeeKey: string, request: JobChangeRequest) =>
      client.post<WorkforceChangeDto>(corePeoplePaths.jobChange(employeeKey), request),
    endEmployment: (employeeKey: string, request: EndEmploymentChangeRequest) =>
      client.post<WorkforceChangeDto>(corePeoplePaths.endEmploymentChange(employeeKey), request),
    startEmployment: (employeeKey: string, request: JoinChangeRequest) =>
      client.post<WorkforceChangeDto>(corePeoplePaths.joinChange(employeeKey), request),
    /** Replaces a scheduled change with a new one of the same kind, in one step. */
    editChange: (changeId: string, request: EditChangeRequest) =>
      client.put<WorkforceChangeDto>(corePeoplePaths.change(changeId), request),
    cancelChange: (changeId: string) => client.post<void>(corePeoplePaths.cancelChange(changeId), {}),
    /** Coming changes: the tenant for People viewers, the caller's branch for managers. */
    upcomingChanges: (signal?: AbortSignal) =>
      client.get<WorkforceChangeDto[]>(corePeoplePaths.upcomingChanges(), { signal }),
    lineEffects: (employeeId: string, managerId: string | null, signal?: AbortSignal) =>
      client.get<LineEffectsDto>(corePeoplePaths.lineEffects(employeeId), {
        params: managerId ? { manager: managerId } : undefined,
        signal,
      }),
    /** Adds a dotted-line manager from the date, or with `end` ends one on the date. */
    dottedLine: (employeeKey: string, request: DottedLineRequestBody, end = false) =>
      client.post<MaintenanceResultDto>(
        end ? corePeoplePaths.endDottedLine(employeeKey) : corePeoplePaths.dottedLines(employeeKey),
        request
      ),
    updateWorkEmail: (
      employeeKey: string,
      request: UpdateWorkEmailRequestBody,
      expectedVersion: number
    ) =>
      client.put<void>(corePeoplePaths.updateWorkEmail(employeeKey), request, {
        headers: { "If-Match": `"${expectedVersion}"` },
      }),
    personal: (employeeKey: string, signal?: AbortSignal) =>
      client.get<PeoplePersonalDto>(corePeoplePaths.personal(employeeKey), { signal }),
    /** Applies at once and lands in history; `expectedVersion` is the `version` you read. */
    updatePersonal: (employeeKey: string, request: UpdatePersonalRequest, expectedVersion: number) =>
      client.put<PeoplePersonalDto>(corePeoplePaths.personal(employeeKey), request, {
        headers: { "If-Match": `"${expectedVersion}"` },
      }),
    jobHistory: (employeeKey: string, signal?: AbortSignal) =>
      client.get<PeopleJobHistoryDto>(corePeoplePaths.jobHistory(employeeKey), { signal }),
    /** Reads a `photoUrl` from any DTO; the API needs the bearer token, so an `<img src>` can't load it directly. */
    photo: (photoUrl: string, signal?: AbortSignal) =>
      client.get<Blob>(photoUrl, { responseType: "blob", signal }),
    /** A JPEG, PNG or WebP up to 5 MB. */
    uploadPhoto: (employeeKey: string, file: Blob, fileName = "photo.webp") => {
      const form = new FormData();
      form.append("file", file, fileName);
      return client.post<EmployeePhotoDto>(corePeoplePaths.photo(employeeKey), form);
    },
    removePhoto: (employeeKey: string) =>
      client.delete<EmployeePhotoDto>(corePeoplePaths.photo(employeeKey)),
    accessStatus: (employeeKey: string, signal?: AbortSignal) =>
      client.get<PeopleAccessStatusDto>(
        corePeoplePaths.accessStatus(employeeKey),
        { signal }
      ),
    /** With `forEmployee`, leaves out that person, their own branch and their current manager. */
    managerOptions: (effectiveDate: string, q = "", signal?: AbortSignal, forEmployee?: string | null) =>
      client.get<ManagerOptionDto[]>(corePeoplePaths.managerOptions(), {
        params: { effectiveDate, q, limit: 30, ...(forEmployee ? { forEmployee } : {}) },
        signal,
      }),
    establishmentReview: (request: EstablishmentReviewRequest) =>
      client.post<EstablishmentReviewDto>(
        corePeoplePaths.establishmentReview(),
        request
      ),
    hire: (request: HireEmployeeRequest) =>
      client.post<EstablishmentResultDto>(corePeoplePaths.hire(), request),
    addExisting: (request: AddExistingEmployeeRequest) =>
      client.post<EstablishmentResultDto>(
        corePeoplePaths.addExisting(),
        request
      ),
  };
}

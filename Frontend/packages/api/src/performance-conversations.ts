// Performance conversations: 1:1s (D-12), feedback and requests (D-13), praise (D-14) and the colleague directory.
// Transport only; UI state and cache behaviour stay with the feature that uses them.
import type { ObjectiveStatus, PersonRefDto } from "./performance";
import type { ApiClient } from "./types";

// ── 1:1s ───────────────────────────────────────────────────────────────────────

export type OneOnOneCadence = "Weekly" | "EveryTwoWeeks" | "Monthly";
export type OneOnOneEndReason = "ReportingLineEnded" | "PersonInactive";
export type OneOnOneMeetingState = "Upcoming" | "Completed" | "NotHeld";
/** Where an agenda item came from. A starter's text is its key, worded by the client. */
export type AgendaSourceKind = "Objective" | "UpdateRequest" | "Feedback" | "Praise" | "Action" | "Starter";

export interface OneOnOnePersonDto {
  employeeId: string;
  displayName: string;
  jobTitle: string | null;
}

/** A meeting on a series' rhythm: when it was or will be, and whether it was held. */
export interface OneOnOneBeatDto {
  at: string;
  state: OneOnOneMeetingState;
}

export interface OneOnOneRowDto {
  seriesId: string;
  with: OneOnOnePersonDto;
  cadence: OneOnOneCadence;
  nextMeetingAt: string | null;
  openActions: number;
  overdueActions: number;
  ended: boolean;
  endedAt: string | null;
  nextMeetingId: string | null;
  /** Talking points already on the next meeting. */
  agendaCount: number;
  /** When the last held meeting was completed. */
  lastMetAt: string | null;
  /** Meetings in the last six weeks and the next one, oldest first. */
  recent: OneOnOneBeatDto[];
}

export interface OneOnOneStartOptionDto {
  with: OneOnOnePersonDto;
}

/** An open action the caller owns in one of their active series. */
export interface OneOnOneOwedActionDto {
  seriesId: string;
  actionId: string;
  text: string;
  with: OneOnOnePersonDto;
  dueDate: string | null;
  overdue: boolean;
}

export interface OneOnOnesDto {
  withManager: OneOnOneRowDto | null;
  startWithManager: OneOnOneStartOptionDto | null;
  /** Ordered by next meeting. */
  reports: OneOnOneRowDto[];
  startWithReports: OneOnOneStartOptionDto[];
  ended: OneOnOneRowDto[];
  defaultCadence: OneOnOneCadence;
  /** False while Core HR can't be reached: rows from stored state, nothing to start. */
  lineAvailable: boolean;
  /** Open actions the caller owns across active series, the earliest due first. */
  myActions: OneOnOneOwedActionDto[];
}

export interface OneOnOneAgendaItemDto {
  id: string;
  text: string;
  authorEmployeeId: string;
  discussed: boolean;
  sourceKind: AgendaSourceKind | null;
  sourceId: string | null;
  href: string | null;
  /** What both people wrote about it; a note marks it talked about. */
  note: string;
  noteRevision: number;
  addedAt: string;
  /** The earlier meeting it carried over from, having no note there. */
  carriedFromAt: string | null;
}

export interface OneOnOneActionDto {
  id: string;
  text: string;
  ownerEmployeeId: string;
  dueDate: string | null;
  done: boolean;
  doneAt: string | null;
  createdInMeetingId: string;
  createdInMeetingAt: string;
  createdByEmployeeId: string;
  /** Created in an earlier meeting and still open. */
  carriedOver: boolean;
  overdue: boolean;
}

/**
 * A talking point computed for the viewer, shown on the agenda until a note adds it there. Labels never carry feedback
 * or praise text. `percent` is a goal's progress, `by` who it's from (requester, author, an action's owner), `dueDate`
 * a late action's due date.
 */
export interface OneOnOneSuggestionDto {
  kind: AgendaSourceKind;
  sourceId: string;
  cycleId: string | null;
  label: string;
  status: ObjectiveStatus | null;
  href: string;
  at: string | null;
  percent: number | null;
  by: string | null;
  dueDate: string | null;
}

export interface OneOnOneMeetingDto {
  id: string;
  version: number;
  scheduledAt: string;
  state: OneOnOneMeetingState;
  completedAt: string | null;
  agenda: OneOnOneAgendaItemDto[];
  /** The caller's own private note; nobody else's is ever returned. */
  privateNote: { text: string; revision: number };
  notesWritable: boolean;
  actions: OneOnOneActionDto[];
  suggestions: OneOnOneSuggestionDto[];
}

export interface OneOnOneSeriesDto {
  id: string;
  version: number;
  manager: OneOnOnePersonDto;
  report: OneOnOnePersonDto;
  viewerRole: "Manager" | "Report";
  cadence: OneOnOneCadence;
  startedAt: string;
  startedByEmployeeId: string;
  ended: boolean;
  endedAt: string | null;
  endReason: OneOnOneEndReason | null;
  upcoming: OneOnOneMeetingDto | null;
  /** Completed and not-held meetings, newest first. */
  past: OneOnOneMeetingDto[];
  openActions: number;
  overdueActions: number;
  can: { write: boolean };
  /** No meeting held yet: the upcoming one is the first. */
  first: boolean;
  /** When what isn't noted on the upcoming meeting carries to. */
  carriesTo: string | null;
  context: OneOnOneContextDto | null;
}

export interface OneOnOneGoalDto {
  id: string;
  cycleId: string;
  title: string;
  status: ObjectiveStatus | null;
  percent: number | null;
}

/** What sits beside the meeting about the report. */
export interface OneOnOneContextDto {
  goals: OneOnOneGoalDto[];
  planApproved: boolean;
  /** When a plan is due, while none is approved. */
  planDue: string | null;
  latestPraise: { id: string; authorEmployeeId: string; authorName: string; message: string; at: string } | null;
  joinedOn: string | null;
  unit: string | null;
}

/** The caller's calendar feed; `url` only comes back once, when the link is made. */
export interface CalendarFeedDto {
  on: boolean;
  since: string | null;
  url: string | null;
}

/** What starting 1:1s with someone looks like: the default rhythm and talking points ready for the first agenda. */
export interface OneOnOneStartDto {
  with: OneOnOnePersonDto;
  defaultCadence: OneOnOneCadence;
  suggestions: OneOnOneSuggestionDto[];
}

export interface StartOneOnOneRequest {
  withEmployeeId: string;
  cadence: OneOnOneCadence | null;
  firstMeetingAt: string;
  /** Talking points for the first meeting: written text, or offered suggestions by source. */
  agenda?: AddAgendaItemRequest[];
}

export interface AddAgendaItemRequest {
  id: string;
  text?: string | null;
  sourceKind?: AgendaSourceKind | null;
  sourceId?: string | null;
  /** Adds it already talked about: writing on a suggestion is how it joins the agenda. */
  note?: string | null;
}

export interface AddActionRequest {
  id: string;
  text: string;
  ownerEmployeeId: string;
  dueDate: string | null;
}

/** The current note on a conflicting save, carried in the failure's `details.extra`. */
export interface OneOnOneNotesConflict {
  text: string;
  revision: number;
}

// ── Feedback and requests ──────────────────────────────────────────────────────

export type FeedbackVisibility = "Shared" | "ManagerOnly";
export type FeedbackSubjectKind = "None" | "Objective" | "Competency";
export type FeedbackView = "received" | "team" | "given";
export type FeedbackRequestState = "Open" | "Closed";
export type FeedbackRequestCloseReason = "AllResponded" | "ClosedByRequester";
export type FeedbackInviteeStatus = "Waiting" | "Answered" | "Declined";

export interface FeedbackSubjectDto {
  kind: FeedbackSubjectKind;
  cycleId: string | null;
  objectiveId: string | null;
  competencyId: string | null;
  label: string;
  href: string | null;
}

export interface FeedbackDto {
  id: string;
  author: PersonRefDto;
  receiver: PersonRefDto;
  visibility: FeedbackVisibility;
  /** Only on manager-only feedback, for its author and its addressee. */
  addressedManager: PersonRefDto | null;
  subject: FeedbackSubjectDto | null;
  message: string;
  requestId: string | null;
  requestQuestion: string | null;
  sentAt: string;
}

export interface FeedbackPageDto {
  items: FeedbackDto[];
  next: string | null;
}

export interface GiveFeedbackRequest {
  id: string;
  receiverEmployeeId: string;
  visibility: FeedbackVisibility;
  message: string;
  competencyId?: string | null;
  cycleId?: string | null;
  objectiveId?: string | null;
}

export interface FeedbackListQuery {
  view?: FeedbackView;
  cycleId?: string | null;
  objectiveId?: string | null;
  before?: string | null;
  limit?: number;
}

export interface FeedbackInviteeDto {
  person: PersonRefDto;
  status: FeedbackInviteeStatus;
  respondedAt: string | null;
  declineReason: string | null;
}

/** The full view for the requester, their manager and HR; an invitee gets only their own part. */
export interface FeedbackRequestDto {
  id: string;
  version: number;
  requester: PersonRefDto;
  question: string;
  subject: FeedbackSubjectDto | null;
  dueDate: string;
  state: FeedbackRequestState;
  requestedAt: string;
  closedAt: string | null;
  closeReason: FeedbackRequestCloseReason | null;
  overdue: boolean;
  viewerRole: "Requester" | "Invitee" | "Viewer";
  invitees: FeedbackInviteeDto[] | null;
  answers: FeedbackDto[] | null;
  mine: FeedbackInviteeDto | null;
  myAnswer: FeedbackDto | null;
  can: { answer: boolean; decline: boolean; close: boolean };
}

export interface FeedbackRequestRowDto {
  id: string;
  question: string;
  requester: PersonRefDto;
  dueDate: string;
  state: FeedbackRequestState;
  overdue: boolean;
  /** Counts are for the requester; an invitee's rows carry zeros. */
  answered: number;
  declined: number;
  invited: number;
  myStatus: FeedbackInviteeStatus | null;
  requestedAt: string;
  subject: FeedbackSubjectDto | null;
  /** Who was asked; only on the caller's own requests. */
  invitees: FeedbackInviteeDto[] | null;
  /** The most recent answer; only on the caller's own requests. */
  latestAnswer: FeedbackDto | null;
}

export interface FeedbackRequestsDto {
  toAnswer: FeedbackRequestRowDto[];
  mine: FeedbackRequestRowDto[];
}

/** Received feedback counted by what it was about; `label` is null when it was about nothing specific. */
export interface FeedbackSubjectCountDto {
  kind: FeedbackSubjectKind;
  objectiveId: string | null;
  competencyId: string | null;
  label: string | null;
  count: number;
}

/** One of the caller's objectives in the active cycle, with how much feedback it has drawn. */
export interface FeedbackAskAboutDto {
  cycleId: string;
  objectiveId: string;
  title: string;
  status: ObjectiveStatus | null;
  feedback: number;
}

/** The caller's feedback at a glance: received, given, waiting on them, and objectives to ask about next. */
export interface FeedbackSummaryDto {
  received: number;
  fromCount: number;
  /** The most recent colleagues who gave feedback, up to five. */
  from: PersonRefDto[];
  subjects: FeedbackSubjectCountDto[];
  given: number;
  toAnswer: number;
  askAbout: FeedbackAskAboutDto[];
}

export interface AskForFeedbackRequest {
  id: string;
  question: string;
  inviteeEmployeeIds: string[];
  dueDate: string;
  competencyId?: string | null;
  cycleId?: string | null;
  objectiveId?: string | null;
}

// ── Praise ─────────────────────────────────────────────────────────────────────

export type PraiseReactionKind = "Applause" | "Celebrate" | "Insightful" | "ThankYou";
export const PRAISE_REACTIONS: readonly PraiseReactionKind[] = ["Applause", "Celebrate", "Insightful", "ThankYou"];
export const PRAISE_REACTION_LABEL: Record<PraiseReactionKind, string> = {
  Applause: "Applause",
  Celebrate: "Celebrate",
  Insightful: "Insightful",
  ThankYou: "Thank you",
};

export type PraiseScope = "all" | "forMe" | "byMe";

export interface PraiseReactionDto {
  kind: PraiseReactionKind;
  count: number;
  mine: boolean;
}

export interface PraiseDto {
  id: string;
  author: PersonRefDto;
  recipients: PersonRefDto[];
  value: { id: string; name: string };
  message: string;
  givenAt: string;
  reactions: PraiseReactionDto[];
  canDelete: boolean;
}

export interface PraiseDetailDto {
  removed: boolean;
  praise: PraiseDto | null;
}

export interface PraisePageDto {
  items: PraiseDto[];
  next: string | null;
}

export interface CompanyValueDto {
  id: string;
  name: string;
}

export interface PraiseValueCountDto {
  id: string;
  name: string;
  count: number;
}

/**
 * The wall's week (from Monday, `weekStart` as a date) and how much praise it holds; each of the company's values
 * with how often it was named this month; how much praise the caller received and gave.
 */
export interface PraiseSummaryDto {
  weekStart: string;
  thisWeek: number;
  values: PraiseValueCountDto[];
  received: number;
  given: number;
}

export interface PraiseListQuery {
  scope?: PraiseScope;
  employeeId?: string | null;
  before?: string | null;
  limit?: number;
}

export interface GivePraiseRequest {
  id: string;
  recipientEmployeeIds: string[];
  valueId: string;
  message: string;
}

// ── Directory ──────────────────────────────────────────────────────────────────

export interface DirectoryPersonDto {
  employeeId: string;
  displayName: string;
  jobTitle: string | null;
  orgUnitName: string | null;
}

// ── Paths, keys and transport ──────────────────────────────────────────────────

export const conversationPaths = {
  oneOnOnes: () => "/performance/one-on-ones",
  oneOnOne: (seriesId: string) => `/performance/one-on-ones/${seriesId}`,
  oneOnOneStart: () => "/performance/one-on-ones/start",
  oneOnOneMeeting: (meetingId: string) => `/performance/one-on-ones/meetings/${meetingId}`,
  feedback: () => "/performance/feedback",
  feedbackItem: (id: string) => `/performance/feedback/${id}`,
  feedbackSummary: () => "/performance/feedback/summary",
  feedbackRequests: () => "/performance/feedback/requests",
  feedbackRequest: (id: string) => `/performance/feedback/requests/${id}`,
  praise: () => "/performance/praise",
  praiseItem: (id: string) => `/performance/praise/${id}`,
  praiseSummary: () => "/performance/praise/summary",
  directory: () => "/performance/people/directory",
  directoryNear: () => "/performance/people/directory/near",
  values: () => "/performance/values",
  settingsValues: () => "/performance/settings/values",
} as const;

export const conversationQueryKeys = {
  all: () => ["performance", "conversations"] as const,
  oneOnOnes: () => [...conversationQueryKeys.all(), "one-on-ones"] as const,
  oneOnOne: (seriesId: string) => [...conversationQueryKeys.oneOnOnes(), seriesId] as const,
  oneOnOneStart: (withEmployeeId: string) => [...conversationQueryKeys.oneOnOnes(), "start", withEmployeeId] as const,
  calendarFeed: () => [...conversationQueryKeys.oneOnOnes(), "calendar-feed"] as const,
  feedback: () => [...conversationQueryKeys.all(), "feedback"] as const,
  feedbackList: (query: FeedbackListQuery) => [...conversationQueryKeys.feedback(), "list", query] as const,
  feedbackItem: (id: string) => [...conversationQueryKeys.feedback(), "item", id] as const,
  feedbackSummary: () => [...conversationQueryKeys.feedback(), "summary"] as const,
  feedbackRequests: () => [...conversationQueryKeys.all(), "feedback-requests"] as const,
  feedbackRequest: (id: string) => [...conversationQueryKeys.feedbackRequests(), id] as const,
  praise: () => [...conversationQueryKeys.all(), "praise"] as const,
  praiseList: (query: PraiseListQuery) => [...conversationQueryKeys.praise(), "list", query] as const,
  praiseItem: (id: string) => [...conversationQueryKeys.praise(), "item", id] as const,
  praiseSummary: () => [...conversationQueryKeys.praise(), "summary"] as const,
  directory: (term: string) => [...conversationQueryKeys.all(), "directory", term] as const,
  directoryNear: () => [...conversationQueryKeys.all(), "directory", "near"] as const,
  values: () => [...conversationQueryKeys.all(), "values"] as const,
} as const;

export function createConversationsApi(client: ApiClient) {
  const meeting = conversationPaths.oneOnOneMeeting;
  const series = conversationPaths.oneOnOne;
  return {
    // 1:1s
    listOneOnOnes: (signal?: AbortSignal) => client.get<OneOnOnesDto>(conversationPaths.oneOnOnes(), { signal }),
    getOneOnOne: (seriesId: string, signal?: AbortSignal) => client.get<OneOnOneSeriesDto>(series(seriesId), { signal }),
    getOneOnOneStart: (withEmployeeId: string, signal?: AbortSignal) =>
      client.get<OneOnOneStartDto>(conversationPaths.oneOnOneStart(), { params: { with: withEmployeeId }, signal }),
    startOneOnOne: (request: StartOneOnOneRequest) => client.post<OneOnOneSeriesDto>(conversationPaths.oneOnOnes(), request),
    changeCadence: (seriesId: string, cadence: OneOnOneCadence, expectedVersion: number) =>
      client.put<OneOnOneSeriesDto>(`${series(seriesId)}/cadence`, { cadence, expectedVersion }),
    reschedule: (meetingId: string, scheduledAt: string, expectedVersion: number) =>
      client.put<OneOnOneSeriesDto>(`${meeting(meetingId)}/schedule`, { scheduledAt, expectedVersion }),
    addAgendaItem: (meetingId: string, request: AddAgendaItemRequest) =>
      client.post<OneOnOneSeriesDto>(`${meeting(meetingId)}/agenda`, request),
    setAgendaNote: (meetingId: string, itemId: string, text: string, expectedRevision: number) =>
      client.put<OneOnOneSeriesDto>(`${meeting(meetingId)}/agenda/${itemId}/note`, { text, expectedRevision }),
    removeAgendaItem: (meetingId: string, itemId: string) =>
      client.delete<OneOnOneSeriesDto>(`${meeting(meetingId)}/agenda/${itemId}`),
    setPrivateNotes: (meetingId: string, text: string, expectedRevision: number) =>
      client.put<OneOnOneSeriesDto>(`${meeting(meetingId)}/notes/private`, { text, expectedRevision }),
    addAction: (seriesId: string, request: AddActionRequest) =>
      client.post<OneOnOneSeriesDto>(`${series(seriesId)}/actions`, request),
    editAction: (seriesId: string, actionId: string, request: Omit<AddActionRequest, "id">) =>
      client.put<OneOnOneSeriesDto>(`${series(seriesId)}/actions/${actionId}`, request),
    setActionDone: (seriesId: string, actionId: string, done: boolean) =>
      client.put<OneOnOneSeriesDto>(`${series(seriesId)}/actions/${actionId}/done`, { done }),
    getCalendarFeed: (signal?: AbortSignal) =>
      client.get<CalendarFeedDto>(`${conversationPaths.oneOnOnes()}/calendar-feed`, { signal }),
    createCalendarFeed: () => client.post<CalendarFeedDto>(`${conversationPaths.oneOnOnes()}/calendar-feed`, {}),
    revokeCalendarFeed: () => client.delete<CalendarFeedDto>(`${conversationPaths.oneOnOnes()}/calendar-feed`),

    // Feedback
    listFeedback: (query: FeedbackListQuery, signal?: AbortSignal) =>
      client.get<FeedbackPageDto>(conversationPaths.feedback(), {
        params: { view: query.view, cycleId: query.cycleId, objectiveId: query.objectiveId, before: query.before, limit: query.limit },
        signal,
      }),
    getFeedback: (id: string, signal?: AbortSignal) => client.get<FeedbackDto>(conversationPaths.feedbackItem(id), { signal }),
    getFeedbackSummary: (signal?: AbortSignal) => client.get<FeedbackSummaryDto>(conversationPaths.feedbackSummary(), { signal }),
    giveFeedback: (request: GiveFeedbackRequest) => client.post<FeedbackDto>(conversationPaths.feedback(), request),
    listFeedbackRequests: (signal?: AbortSignal) => client.get<FeedbackRequestsDto>(conversationPaths.feedbackRequests(), { signal }),
    getFeedbackRequest: (id: string, signal?: AbortSignal) =>
      client.get<FeedbackRequestDto>(conversationPaths.feedbackRequest(id), { signal }),
    askForFeedback: (request: AskForFeedbackRequest) => client.post<FeedbackRequestDto>(conversationPaths.feedbackRequests(), request),
    answerFeedbackRequest: (id: string, feedbackId: string, message: string) =>
      client.post<FeedbackRequestDto>(`${conversationPaths.feedbackRequest(id)}/answer`, { feedbackId, message }),
    declineFeedbackRequest: (id: string, reason: string | null) =>
      client.post<FeedbackRequestDto>(`${conversationPaths.feedbackRequest(id)}/decline`, { reason }),
    closeFeedbackRequest: (id: string) => client.post<FeedbackRequestDto>(`${conversationPaths.feedbackRequest(id)}/close`, {}),

    // Praise
    listPraise: (query: PraiseListQuery, signal?: AbortSignal) =>
      client.get<PraisePageDto>(conversationPaths.praise(), {
        params: { scope: query.scope, employeeId: query.employeeId, before: query.before, limit: query.limit },
        signal,
      }),
    getPraise: (id: string, signal?: AbortSignal) => client.get<PraiseDetailDto>(conversationPaths.praiseItem(id), { signal }),
    getPraiseSummary: (signal?: AbortSignal) => client.get<PraiseSummaryDto>(conversationPaths.praiseSummary(), { signal }),
    givePraise: (request: GivePraiseRequest) => client.post<PraiseDto>(conversationPaths.praise(), request),
    react: (id: string, kind: PraiseReactionKind, add: boolean) =>
      add
        ? client.put<PraiseDto>(`${conversationPaths.praiseItem(id)}/reactions/${kind}`, {})
        : client.delete<PraiseDto>(`${conversationPaths.praiseItem(id)}/reactions/${kind}`),
    deletePraise: (id: string) => client.delete<unknown>(conversationPaths.praiseItem(id)),

    /** The company's values, the short list praise names (D-36); a new company starts with the starters. */
    listValues: (signal?: AbortSignal) => client.get<CompanyValueDto[]>(conversationPaths.values(), { signal }),
    /** Settings: each change answers with the list as it now stands. */
    addValue: (name: string) => client.post<CompanyValueDto[]>(conversationPaths.settingsValues(), { name }),
    renameValue: (id: string, name: string) => client.put<CompanyValueDto[]>(`${conversationPaths.settingsValues()}/${id}`, { name }),
    removeValue: (id: string) => client.delete<CompanyValueDto[]>(`${conversationPaths.settingsValues()}/${id}`),

    // Directory
    /** The caller's teammates, then their reports, then their manager: six at most, for praise's quick picks. */
    nearPeople: (signal?: AbortSignal) => client.get<DirectoryPersonDto[]>(conversationPaths.directoryNear(), { signal }),
    searchDirectory: (search: string, signal?: AbortSignal) =>
      client.get<DirectoryPersonDto[]>(conversationPaths.directory(), { params: { search }, signal }),
  };
}

export type ConversationsApi = ReturnType<typeof createConversationsApi>;

/** A client-generated id for a create, so a retried send returns the original instead of a copy. */
export function newClientId(): string {
  return globalThis.crypto.randomUUID();
}

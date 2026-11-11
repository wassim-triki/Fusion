// Performance reviews, slice 4: round setup and monitoring, the per-viewer workspace, peer input (D-18), questions (D-19),
// due-date moves (D-02), acknowledgement (D-20) and the PDF (D-21). Transport only; mirrors the Performance contracts.
import type { ObjectiveStatus, PerformanceReviewState, ReviewRoundState } from "./performance";
import type { ApiClient } from "./types";

export type ReviewQuestionAudience = "Person" | "Manager" | "Peer";
export type ReviewQuestionState = "Active" | "Archived";
export type ReviewStage = "SelfAssessment" | "PeerInput" | "ManagerAssessment";
export type ReviewPotential = "Developing" | "Growing" | "High";
export type PeerRequestState = "Open" | "Answered" | "Declined" | "Closed";
export type ReviewLens = "Subject" | "Reviewer" | "Administrator" | "Facilitator";

export const REVIEW_POTENTIALS: readonly ReviewPotential[] = ["Developing", "Growing", "High"];

// ── Question library (Settings › Reviews) ────────────────────────────────────────

export interface ReviewQuestionDto {
  id: string;
  text: string;
  audience: ReviewQuestionAudience;
  sortOrder: number;
  state: ReviewQuestionState;
  firstUsedAt: string | null;
  version: number;
  /** How many launched review rounds asked it. */
  roundCount: number;
}

// ── Rounds ───────────────────────────────────────────────────────────────────────

export type ReviewRoundIssueCode =
  | "NoSubjects"
  | "NoQuestions"
  | "NoPeerQuestions"
  | "NoCompetencies"
  | "DueDateBeforeLaunch"
  | "DueDateAfterCycleEnd"
  | "ManagerBeforeSelf"
  | "RoundRunning";

/** One task's due date; `followsDefault` while a Draft date is computed from its day offset. */
export interface ReviewDueDateDto {
  date: string;
  followsDefault: boolean;
  offsetDays: number;
}
export interface ReviewRoundScheduleDto {
  launchDay: string;
  selfAssessment: ReviewDueDateDto;
  peerInput: ReviewDueDateDto;
  managerAssessment: ReviewDueDateDto;
  acknowledgementReminderDays: number;
}
export interface ReviewRoundQuestionDto {
  id: string;
  questionId: string;
  audience: ReviewQuestionAudience;
  sortOrder: number;
  text: string;
}
/** The round that blocks a launch (B-060), with its progress. */
export interface RunningReviewRoundDto {
  id: string;
  name: string;
  launchedAt: string | null;
  reviewCount: number;
  selfSubmitted: number;
  selfRequired: number;
  managerSubmitted: number;
  managerRequired: number;
}
export interface ReviewRoundReadinessDto {
  ready: boolean;
  launchCount: number;
  subjectIssueCount: number;
  issues: ReviewRoundIssueCode[];
  runningRound: RunningReviewRoundDto | null;
}
export type ReviewProgressStage = "SelfAssessment" | "PeerInput" | "ManagerAssessment" | "Released";
export interface ReviewStageProgressDto {
  stage: ReviewProgressStage;
  done: number;
  total: number;
  dueDate: string | null;
  open: number;
  late: number;
  declined: number;
  readyToWrite: number;
}
export interface ReviewRatioDto {
  done: number;
  total: number;
}
export interface ReviewTeamProgressDto {
  reviewerEmployeeId: string;
  reviewerDisplayName: string;
  orgUnitName: string | null;
  people: number;
  self: ReviewRatioDto;
  peers: ReviewRatioDto;
  manager: ReviewRatioDto;
}
export interface ReviewReminderForecastDto {
  date: string;
  selfAssessments: number;
  peerInputs: number;
  managerAssessments: number;
}
export interface ReviewRoundProgressDto {
  stages: ReviewStageProgressDto[];
  teams: ReviewTeamProgressDto[];
  nextReminder: ReviewReminderForecastDto | null;
  readyToFinalize: number;
  finalized: number;
  closed: number;
}
export interface ReviewRoundFrozenConfigurationDto {
  selfAssessment: boolean;
  peerInput: boolean;
  objectiveRatings: boolean;
  questions: boolean;
  potential: boolean;
  calibration: boolean;
  competencies: string[];
  ratingScaleVersion: number;
}
export type ReviewRoundActivityKind = "Launched" | "DueDateMoved" | "ReviewClosed" | "Released" | "Closed";
export interface ReviewRoundActivityDto {
  kind: ReviewRoundActivityKind;
  at: string;
  actorName: string | null;
  text: string;
  detail: string | null;
}
export interface ReviewPersonRefDto {
  reviewId: string;
  displayName: string;
}
export interface ReviewRoundOutcomeDto {
  released: number;
  total: number;
  acknowledged: number;
  calibratedChanged: number;
  calibratedDown: number;
  calibratedUp: number;
  closedWithoutResult: { reviewId: string; subjectDisplayName: string; reason: string; closedAt: string | null }[];
  distribution: { value: number; label: string; count: number }[];
  notAcknowledged: ReviewPersonRefDto[];
  nextAcknowledgementReminder: string | null;
  releasedAt: string | null;
}

/** The failure `extra` of a refused launch: subject issues, round issues and the running round (B-060). */
export interface ReviewRoundLaunchBlockedDto {
  issues: { code: string; subjectEmployeeId: string; reviewerEmployeeId: string | null }[];
  roundIssues: ReviewRoundIssueCode[];
  runningRound: RunningReviewRoundDto | null;
}

export interface MoveRoundDueDateRequest {
  expectedVersion: number;
  stage: ReviewStage;
  dueDate: string;
  reason: string;
}
export interface MoveReviewDueDateRequest {
  expectedVersion: number;
  dueDate: string;
  reason: string;
}
export interface ReviewDueDateMoveDto {
  id: string;
  stage: ReviewStage;
  from: string | null;
  to: string;
  reason: string;
  actorName: string;
  movedAt: string;
  affected: number;
  reviewId: string | null;
  subjectDisplayName: string | null;
}

// ── The review record (per lens) ─────────────────────────────────────────────────

export interface ReviewObjectiveFeedbackDto {
  authorName: string;
  message: string;
  sentAt: string;
}
/** One drafted sentence and the key (`kind:id`) of its source in the review's year (H3). */
export interface ReviewCitation {
  text: string;
  key: string;
}
export interface ReviewQuestionAnswerDto {
  questionId: string;
  audience: ReviewQuestionAudience;
  sortOrder: number;
  text: string;
  selfAnswer: string | null;
  managerAnswer: string | null;
  /** Present while the answer is the draft as written; an edit drops them. */
  selfCitations: ReviewCitation[];
  managerCitations: ReviewCitation[];
}
export interface ReviewPeerAnswerDto {
  questionId: string;
  question: string;
  text: string;
}
/** A colleague asked. Before results the person sees only who; after, each answer with the name (D-69). */
export interface ReviewPeerDto {
  employeeId: string;
  displayName: string;
  source: "Fusion" | "Reviewer" | null;
  requestId: string | null;
  state: PeerRequestState | null;
  declineNote: string | null;
  respondedAt: string | null;
  answers: ReviewPeerAnswerDto[] | null;
}
export interface ReviewPeersDto {
  nominatedAt: string | null;
  people: ReviewPeerDto[];
  questions: string[];
}
export interface ReviewAcknowledgementDto {
  at: string;
  comment: string | null;
}
export interface ReviewScheduleStateDto {
  selfAssessmentDue: string | null;
  peerInputDue: string | null;
  managerAssessmentDue: string | null;
  daysLate: number;
  selfOverridden: boolean;
  managerOverridden: boolean;
  nextReminder: string | null;
  remindersSent: string[];
}
export interface ReviewYearContextDto {
  subjectEmployeeId: string;
  feedback: number;
  praise: number;
  oneOnOnesHeld: number;
  actionsDone: number;
  developmentGoals: number;
  lastResult: { reviewId: string; roundName: string; rating: number | null; label: string | null; finalizedAt: string | null } | null;
}
export interface ReviewActivityDto {
  kind: string;
  at: string;
  text: string;
  detail: string | null;
}
/** Fields slice 4 adds to the review record (merged into `PerformanceReviewDto`). */
export interface PerformanceReviewRecordFields {
  lens: ReviewLens;
  subjectEmployeeId: string;
  reviewerEmployeeId: string;
  subjectJobTitle: string | null;
  subjectOrgUnitName: string | null;
  roundState: ReviewRoundState;
  peerInputEnabled: boolean;
  questionsEnabled: boolean;
  /** Never true for the person. */
  potentialEnabled: boolean;
  questions: ReviewQuestionAnswerDto[];
  /** Never present for the person (D-24). */
  potential: ReviewPotential | null;
  peers: ReviewPeersDto | null;
  acknowledgement: ReviewAcknowledgementDto | null;
  schedule: ReviewScheduleStateDto | null;
  year: ReviewYearContextDto | null;
  activity: ReviewActivityDto[];
  closeReason: string | null;
  canAcknowledge: boolean;
  canDownloadPdf: boolean;
  /** The manager may change who is asked until their review is in (D-40). */
  canChangePeers: boolean;
  /** The person may take their sent self-review back while the manager hasn't sent theirs. */
  canTakeBack: boolean;
  /** When the released review is on the agenda of the next 1:1 with the manager. */
  talkItOverAt: string | null;
  canMoveDueDate: boolean;
  canClose: boolean;
}
export interface ReviewItemRecordFields {
  status?: ObjectiveStatus | null;
  feedback?: ReviewObjectiveFeedbackDto[];
  /** A goal's grade from its measure (D-38), 0 to 1, and its plan weight. */
  grade?: number | null;
  weight?: number | null;
  measurementSummary?: string | null;
  currentActual?: number | null;
  /** A grade changed by hand, with why; null keeps the measure's. */
  selfGrade?: number | null;
  selfGradeReason?: string | null;
  managerGrade?: number | null;
  managerGradeReason?: string | null;
}
export interface ReviewAnswerInput {
  questionId: string;
  text: string | null;
  citations?: ReviewCitation[] | null;
}

/** One thing from the person's year, numbered as drafts cite it (H3). `private`: the person never sees it. */
export interface ReviewYearItemDto {
  number: number;
  key: string;
  kind: "objective" | "evidence" | "feedback" | "praise" | "one-on-one" | "private-note" | "peer" | string;
  at: string;
  who: string | null;
  title: string | null;
  body: string | null;
  path: string | null;
  private: boolean;
}
export interface ReviewTalkDto { meetingId: string; at: string }
/** What a submit lacks: the failure `extra` of a rejected self or manager submit. */
export interface ReviewMissingDto {
  items: { kind: "Objective" | "Competency"; itemId: string }[];
  questions: string[];
  summary: boolean;
  overallRating: boolean;
  potential: boolean;
}

// ── Peer input ───────────────────────────────────────────────────────────────────

export interface PeerSuggestionDto {
  employeeId: string;
  displayName: string;
  jobTitle: string | null;
  orgUnitName: string | null;
  sharedObjective: boolean;
  feedbackExchanged: number;
  praiseExchanged: number;
}
/** Why a colleague was asked, as they read it ("Why you", D-74). */
export interface PeerReasonDto {
  kind: "goal" | "feedbackGiven" | "feedbackReceived" | "praiseGiven" | "praiseReceived" | "teammate";
  title: string | null;
  at: string | null;
  excerpt: string | null;
}
/** What a peer sees (board 11): whose review, who asked and why them, the peer questions with their own answers. */
export interface PeerRequestDto {
  id: string;
  subjectEmployeeId: string;
  subjectDisplayName: string;
  reviewRoundName: string;
  dueDate: string | null;
  daysLate: number;
  state: PeerRequestState;
  questions: { questionId: string; sortOrder: number; text: string; answer: string | null }[];
  declineNote: string | null;
  respondedAt: string | null;
  canAnswer: boolean;
  version: number;
  reviewerEmployeeId: string;
  reviewerDisplayName: string;
  requestedAt: string;
  reasons: PeerReasonDto[];
}

// ── Workspace (boards 01–03, 18) ─────────────────────────────────────────────────

export type ReviewPeerStep = "Off" | "Asked";
export type ReviewSelfStep = "Off" | "NotStarted" | "Writing" | "Submitted";
export type ReviewWriteStep = "Waiting" | "ReadyToWrite" | "Writing" | "Submitted" | "Released" | "Closed";
export type ReviewNextAction = "WriteReview" | "Wait" | "Done";

export interface ReviewsWorkspaceOwnDto {
  reviewId: string;
  roundId: string;
  roundName: string;
  state: PerformanceReviewState;
  reviewerName: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string | null;
  daysLate: number;
  selfAssessmentDue: string | null;
  managerAssessmentDue: string | null;
  selfAssessmentEnabled: boolean;
  calibrationEnabled: boolean;
  selfSubmittedAt: string | null;
  sections: { objectivesDone: number; objectives: number; competenciesDone: number; competencies: number; questionsDone: number; questions: number };
  peers: { asked: string[] } | null;
  finalRating: number | null;
  finalRatingLabel: string | null;
  finalizedAt: string | null;
  acknowledgedAt: string | null;
}
export interface ReviewsWorkspaceTeamRowDto {
  reviewId: string;
  subjectEmployeeId: string;
  subjectDisplayName: string;
  jobTitle: string | null;
  roundName: string;
  state: PerformanceReviewState;
  peerStep: ReviewPeerStep;
  peerCount: number;
  selfStep: ReviewSelfStep;
  selfSubmittedAt: string | null;
  peerAnswered: number;
  peerTotal: number;
  peerDeclined: number;
  reviewStep: ReviewWriteStep;
  dueDate: string | null;
  daysLate: number;
  nextAction: ReviewNextAction;
  selfOverallRating: number | null;
  selfOverallLabel: string | null;
  peerNames: string[];
  /** The person's year as the reviewer may see it, in the round period. */
  planProgress: number | null;
  atRisk: number;
  feedback: number;
  praise: number;
  /** The reviewer's own submitted rating and potential; after calibration, the outcome and whether the rating changed. */
  managerRating: number | null;
  managerPotential: ReviewPotential | null;
  finalRating: number | null;
  finalPotential: ReviewPotential | null;
  calibrationChanged: boolean;
  summaryToCheck: boolean;
}
export interface ReviewsWorkspaceRoundDto {
  roundId: string;
  name: string;
  state: ReviewRoundState;
  launchedAt: string | null;
  periodStart: string;
  periodEnd: string;
  people: number;
  components: number;
  calibrationEnabled: boolean;
  selfAssessmentDue: string | null;
  peerInputDue: string | null;
  managerAssessmentDue: string | null;
  stages: ReviewStageProgressDto[];
  released: number;
  acknowledged: number;
  closedAt: string | null;
}
export interface ReviewsWorkspaceDto {
  cycleId: string | null;
  cycleName: string | null;
  cycleEnd: string | null;
  canAdminister: boolean;
  own: ReviewsWorkspaceOwnDto | null;
  notIncluded: { roundId: string; roundName: string; reason: string | null } | null;
  year: { planProgress: number | null; objectives: number; feedback: number; praise: number; oneOnOnes: number } | null;
  toWrite: ReviewsWorkspaceTeamRowDto[];
  askedOfYou: {
    requestId: string;
    subjectDisplayName: string;
    roundName: string;
    questions: number;
    dueDate: string | null;
    daysLate: number;
    state: PeerRequestState;
    respondedAt: string | null;
  }[];
  rounds: ReviewsWorkspaceRoundDto[];
  cycleFacts: { participants: number; approvedPlans: number } | null;
  pastResults: {
    reviewId: string;
    cycleName: string;
    roundName: string;
    finalRating: number | null;
    label: string | null;
    finalizedAt: string | null;
    acknowledgedAt: string | null;
  }[];
  /** Open calibration sessions the viewer facilitates, counted without their own review. */
  sessions: ReviewsWorkspaceSessionDto[];
}
export interface ReviewsWorkspaceSessionDto { roundId: string; roundName: string; people: number; discussed: number; flags: number; outstanding: number }

/** After a calibrated rating change: the reviewer's summary and whether they revised it or kept it. */
export interface ReviewSummaryStateDto { reviewId: string; summary: string; summaryRevisedAt: string | null; summaryCheckedAt: string | null; version: number }

export type ReviewDraftKind = "Summary" | "Question";
export interface ReviewDraftSourceDto { kind: string; key: string; label: string; path: string | null; subjectVisible: boolean; excerpt: string }
export interface ReviewDraftSentenceDto { text: string; sources: ReviewDraftSourceDto[] }
/** An AI draft (W4, W5). Abstained means too little to draft from. Nothing is stored. */
export interface ReviewDraftDto {
  outcome: "Drafted" | "Abstained";
  sentences: ReviewDraftSentenceDto[];
  sourceCount: number;
  privateSentenceCount: number;
  sourceKinds: string[];
}

/** One person's step in an active review round, keyed by Core HR's employee key (the org chart lens). Never a rating. */
export interface ReviewProgressPersonDto {
  employeeKey: string;
  state: PerformanceReviewState;
  dueDate: string | null;
  isOverdue: boolean;
}
/** The reviews the caller may read in active rounds, under Performance's review read rule. */
export interface ReviewProgressDto { people: ReviewProgressPersonDto[] }

// ── Paths, keys and transport ────────────────────────────────────────────────────

export const reviewPaths = {
  workspace: () => "/performance/reviews/workspace",
  progress: () => "/performance/reviews/progress",
  reviewQuestions: () => "/performance/settings/review-questions",
  reviewQuestion: (id: string) => `/performance/settings/review-questions/${id}`,
  reviewQuestionOrder: () => "/performance/settings/review-questions/order",
  roundDueDates: (roundId: string) => `/performance/review-rounds/${roundId}/due-dates`,
  reviewDueDate: (reviewId: string) => `/performance/reviews/${reviewId}/due-date`,
  acknowledge: (reviewId: string) => `/performance/reviews/${reviewId}/acknowledge`,
  pdf: (reviewId: string) => `/performance/reviews/${reviewId}/pdf`,
  peers: (reviewId: string) => `/performance/reviews/${reviewId}/peers`,
  year: (reviewId: string) => `/performance/reviews/${reviewId}/year`,
  takeBack: (reviewId: string) => `/performance/reviews/${reviewId}/self-assessment/take-back`,
  nudge: (reviewId: string) => `/performance/reviews/${reviewId}/nudge`,
  talkItOver: (reviewId: string) => `/performance/reviews/${reviewId}/talk-it-over`,
  acknowledgementComment: (reviewId: string) => `/performance/reviews/${reviewId}/acknowledgement-comment`,
  peerSuggestions: (reviewId: string) => `/performance/reviews/${reviewId}/peer-suggestions`,
  peerRequest: (requestId: string) => `/performance/peer-requests/${requestId}`,
  managerSummary: (reviewId: string) => `/performance/reviews/${reviewId}/manager-summary`,
  summaryChecked: (reviewId: string) => `/performance/reviews/${reviewId}/summary-checked`,
  draft: (reviewId: string) => `/performance/reviews/${reviewId}/draft`,
} as const;

export const reviewQueryKeys = {
  all: () => ["performance", "reviews"] as const,
  workspace: (cycleId: string | null) => [...reviewQueryKeys.all(), "workspace", cycleId] as const,
  progress: () => [...reviewQueryKeys.all(), "progress"] as const,
  questions: () => ["performance", "settings", "review-questions"] as const,
  peerSuggestions: (reviewId: string) => [...reviewQueryKeys.all(), "peer-suggestions", reviewId] as const,
  peerRequest: (requestId: string) => [...reviewQueryKeys.all(), "peer-request", requestId] as const,
  year: (reviewId: string) => [...reviewQueryKeys.all(), "year", reviewId] as const,
} as const;

export function createReviewsApi(client: ApiClient) {
  return {
    getWorkspace: (cycleId?: string | null, signal?: AbortSignal) =>
      client.get<ReviewsWorkspaceDto>(reviewPaths.workspace(), { params: cycleId ? { cycle: cycleId } : undefined, signal }),
    getProgress: (signal?: AbortSignal) => client.get<ReviewProgressDto>(reviewPaths.progress(), { signal }),

    // Question library
    listQuestions: (signal?: AbortSignal) => client.get<ReviewQuestionDto[]>(reviewPaths.reviewQuestions(), { signal }),
    createQuestion: (text: string, audience: ReviewQuestionAudience) =>
      client.post<ReviewQuestionDto>(reviewPaths.reviewQuestions(), { text, audience }),
    updateQuestion: (id: string, text: string, expectedVersion: number) =>
      client.put<ReviewQuestionDto>(reviewPaths.reviewQuestion(id), { text, expectedVersion }),
    archiveQuestion: (id: string, expectedVersion: number) =>
      client.post<ReviewQuestionDto>(`${reviewPaths.reviewQuestion(id)}/archive`, { expectedVersion }),
    deleteQuestion: (id: string, expectedVersion: number) =>
      client.delete<boolean>(reviewPaths.reviewQuestion(id), { body: { expectedVersion } }),
    reorderQuestions: (audience: ReviewQuestionAudience, questionIds: string[]) =>
      client.put<ReviewQuestionDto[]>(reviewPaths.reviewQuestionOrder(), { audience, questionIds }),

    // Schedule
    moveRoundDueDate: (roundId: string, request: MoveRoundDueDateRequest) =>
      client.post<ReviewDueDateMoveDto>(reviewPaths.roundDueDates(roundId), request),
    moveReviewDueDate: (reviewId: string, request: MoveReviewDueDateRequest) =>
      client.post<ReviewDueDateMoveDto>(reviewPaths.reviewDueDate(reviewId), request),

    // Release
    acknowledge: (reviewId: string, comment: string | null) =>
      client.post<ReviewAcknowledgementDto>(reviewPaths.acknowledge(reviewId), { comment }),
    downloadPdf: (reviewId: string) => client.get<Blob>(reviewPaths.pdf(reviewId), { responseType: "blob" }),

    // The review beside the year
    getYear: (reviewId: string, signal?: AbortSignal) => client.get<ReviewYearItemDto[]>(reviewPaths.year(reviewId), { signal }),
    takeBack: (reviewId: string) => client.post<{ id: string; state: PerformanceReviewState; dueDate: string | null; version: number }>(reviewPaths.takeBack(reviewId), {}),
    nudge: (reviewId: string, who: "self" | "peers") => client.post<{ nudged: number }>(reviewPaths.nudge(reviewId), { who }),
    talkItOver: (reviewId: string) => client.post<ReviewTalkDto>(reviewPaths.talkItOver(reviewId), {}),
    commentOnAcknowledgement: (reviewId: string, comment: string) =>
      client.post<ReviewAcknowledgementDto>(reviewPaths.acknowledgementComment(reviewId), { comment }),

    // Peer input: the manager changes who is asked (Fusion picks first, D-40)
    changePeers: (reviewId: string, employeeIds: string[], expectedVersion: number) =>
      client.put<ReviewPeersDto>(reviewPaths.peers(reviewId), { employeeIds, expectedVersion }),
    getPeerSuggestions: (reviewId: string, signal?: AbortSignal) =>
      client.get<PeerSuggestionDto[]>(reviewPaths.peerSuggestions(reviewId), { signal }),
    getPeerRequest: (requestId: string, signal?: AbortSignal) =>
      client.get<PeerRequestDto>(reviewPaths.peerRequest(requestId), { signal }),
    savePeerAnswers: (requestId: string, answers: ReviewAnswerInput[]) =>
      client.put<PeerRequestDto>(reviewPaths.peerRequest(requestId), { answers }),
    sendPeerAnswers: (requestId: string, answers: ReviewAnswerInput[]) =>
      client.post<PeerRequestDto>(`${reviewPaths.peerRequest(requestId)}/send`, { answers }),
    declinePeerRequest: (requestId: string, note: string | null) =>
      client.post<PeerRequestDto>(`${reviewPaths.peerRequest(requestId)}/decline`, { note }),

    // After calibration
    reviseSummary: (reviewId: string, summary: string, expectedVersion: number) =>
      client.put<ReviewSummaryStateDto>(reviewPaths.managerSummary(reviewId), { summary, expectedVersion }),
    markSummaryChecked: (reviewId: string) => client.post<ReviewSummaryStateDto>(reviewPaths.summaryChecked(reviewId), {}),

    // AI draft: the summary, or one of the writer's questions
    draft: (reviewId: string, kind: ReviewDraftKind, questionId?: string | null) =>
      client.post<ReviewDraftDto>(reviewPaths.draft(reviewId), { kind, questionId: questionId ?? null }),
  };
}

export type ReviewsApi = ReturnType<typeof createReviewsApi>;

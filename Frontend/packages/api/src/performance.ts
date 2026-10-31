import type { FusionWorkStep } from "./fusion-attention";
import type { FeedbackDto, OneOnOneCadence, PraiseDto } from "./performance-conversations";
import type {
  PerformanceReviewRecordFields,
  ReviewAnswerInput,
  ReviewItemRecordFields,
  ReviewPotential,
  ReviewRoundActivityDto,
  ReviewRoundFrozenConfigurationDto,
  ReviewRoundOutcomeDto,
  ReviewRoundProgressDto,
  ReviewRoundQuestionDto,
  ReviewRoundReadinessDto,
  ReviewRoundScheduleDto,
} from "./performance-reviews";
import type { ApiClient } from "./types";

// ── Enumerations (mirror the Performance service contracts) ──────────────────

export type MeasurementMethod =
  | "ManualPercentage"
  | "NumericTarget"
  | "WeightedMilestones";
export type ImprovementDirection = "Increase" | "Decrease";
export type CycleLifecycleState = "Draft" | "Active" | "Closed";
export type ObjectiveLifecycleState = "Draft" | "Published" | "Archived";
export type PopulationMode = "AllActive" | "ByScope";
export type ObjectiveOwnershipScope = "Company" | "OrgUnit" | "Employee";
export type ObjectiveProgressSource = "Direct" | "Calculated";
export type PlanLifecycleState = "Draft" | "Submitted" | "Approved";
export type ReviewRoundState = "Draft" | "Active" | "Closed";
export type PerformanceReviewState = "SelfAssessment" | "ManagerAssessment" | "Calibration" | "ReadyToFinalize" | "Finalized" | "Closed";
export type PlanApprovalKind = "Normal" | "Exceptional";
export type PlanDecisionKind =
  | "Submitted"
  | "Returned"
  | "Approved"
  | "ApprovedExceptionally";
export type RosterPlanStatus =
  | "NotStarted"
  | "Draft"
  | "ReturnedForChanges"
  | "Submitted"
  | "Approved";
export type RosterActivityKind =
  | "None"
  | "DraftUpdated"
  | "Returned"
  | "Submitted"
  | "ProgressUpdated"
  | "Approved"
  | "Resubmitted";
export type ProgressEventKind =
  | "PercentageSet"
  | "NumericActual"
  | "MilestonesChanged"
  | "StatusOnly";
/** How the owner says an objective is going (D-05). Reported with each check-in, never inferred. */
export type ObjectiveStatus = "OnTrack" | "AtRisk" | "OffTrack";
export type PlanChangeRequestState = "Open" | "Addressed" | "ObjectiveRemoved";
export type DevelopmentGoalStatus = "NotStarted" | "InProgress" | "Done";
export type EvidenceKind = "File" | "Link" | "Reference";
export type ReadinessIssueCode =
  | "InactiveEmployment"
  | "NoPrimaryAssignment"
  | "MissingManager"
  | "InactiveManager";
export type OperationalMilestone =
  | "StrategicDirectionPublished"
  | "PopulationConfirmed"
  | "PlanningOpened"
  | "PlanningCompleted"
  | "PerformanceEndReached"
  | "ClosureReady";

// ── DTOs ─────────────────────────────────────────────────────────────────────

export type PlanAlignmentPolicy = "EveryObjectiveConnected" | "AtLeastOneConnected" | "Optional";

export interface CycleSettingsDto {
  version: number;
  defaultMeasurementMethod: MeasurementMethod;
  suggestedObjectiveCountMin: number;
  suggestedObjectiveCountMax: number;
  planningDeadlineOffsetDays: number;
  planAlignmentPolicy: PlanAlignmentPolicy;
  defaultSelfAssessmentEnabled: boolean;
  defaultObjectiveRatingsEnabled: boolean;
  defaultCalibrationEnabled: boolean;
  evidenceRetentionMonths: number;
  /** Performance AI for the tenant (D-26). Live policy, on by default; omitted on update keeps it. */
  aiAssistanceEnabled: boolean;
  /** The cadence new 1:1 series start with (D-35). Omitted on update keeps it. */
  defaultOneOnOneCadence: OneOnOneCadence;
  /** Review due-date defaults in days (D-02); only rounds created afterwards use them. */
  selfAssessmentDueDays: number;
  peerInputDueDays: number;
  managerAssessmentDueDays: number;
  acknowledgementReminderDays: number;
  /** Nine-box bands in force for the current scale (D-24); custom is false while the default split applies. */
  nineBoxBands: NineBoxBandsDto;
}

export interface NineBoxBandsDto { lowTop: number; midTop: number; custom: boolean }
/** Both cut points, or both null to return to the default. Bands equal to those in force change nothing. */
export interface NineBoxBandsRequest { lowTop: number | null; midTop: number | null }

export interface RatingScaleLevelDto { value: number; label: string; description: string | null }
/** One saved version of the scale and the launched rounds ("FY2026 · Year-end review") that rated on it. */
export interface RatingScaleVersionDto { number: number; createdAt: string; usedBy: string[] }
export interface RatingScaleDto { version: number; scaleVersion: number; levels: RatingScaleLevelDto[]; versions: RatingScaleVersionDto[] }
export interface UpdateRatingScaleRequest { expectedVersion: number; levels: RatingScaleLevelDto[] }
export interface CompetencyDto {
  id: string; name: string; description: string; behaviors: string[]; state: "Active" | "Archived"; firstUsedAt: string | null; version: number;
  /** The cycles whose launched review rounds rated it, oldest first. */
  usedIn: string[];
}
export interface CreateCompetencyRequest { name: string; description: string; behaviors: string[] }
export interface UpdateCompetencyRequest extends CreateCompetencyRequest { expectedVersion: number }
export interface CompetencyVersionRequest { expectedVersion: number }

export interface CycleSummaryDto {
  version: number;
  id: string;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string;
  planningDeadline: string;
  state: CycleLifecycleState;
  activatedAt: string | null;
}

export interface MilestoneStateDto {
  milestone: OperationalMilestone;
  reached: boolean;
}

export interface LaunchReadinessAreaDto {
  key: string;
  label: string;
  complete: boolean;
  detail: string | null;
}

export interface LaunchReadinessDto {
  canActivate: boolean;
  areas: LaunchReadinessAreaDto[];
  blockers: string[];
}

export interface CycleDetailDto {
  cycle: CycleSummaryDto;
  launchReadiness: LaunchReadinessDto;
  milestones: MilestoneStateDto[];
  publishedStrategyCount: number;
  draftStrategyCount: number;
  populationConfirmed: boolean;
  confirmedParticipantCount: number;
  otherActiveCycleExists: boolean;
  /** The Active Cycle's derived operational phase; null unless Active. */
  phase?: CyclePhase | null;
}

/** Where an Active Cycle is operationally — derived, never a lifecycle state. */
export type CyclePhase = "Planning" | "Execution" | "Review";

/** A participant without an approved plan, as closing the Cycle would record them. */
export interface ClosureParticipantDto {
  employeeId: string;
  displayName: string;
  orgUnitName: string | null;
  standing: RosterPlanStatus;
  exceptionReason: string | null;
}

/** What closing a Cycle involves. */
export interface CycleClosureDto {
  cycleId: string;
  version: number;
  state: CycleLifecycleState;
  endDate: string;
  endReached: boolean;
  participantCount: number;
  approvedCount: number;
  unresolved: ClosureParticipantDto[];
  earlyCloseReason: string | null;
  recordedExceptionCount: number;
}

/** What the caller can do in the selected Cycle, from capabilities plus recorded responsibility. */
export interface WorkspaceCapabilitiesDto {
  participates: boolean;
  isResponsibleReviewer: boolean;
  hasReviewWork: boolean;
  administers: boolean;
  publishesStrategy: boolean;
  managesOrgObjectives: boolean;
  canCalibrate: boolean;
  canViewOrgDirection: boolean;
  canChooseOrganizationScope: boolean;
  /** Performance AI may run now: the tenant switch is on and the provider is up. Render AI only when true. */
  aiAssistance: boolean;
}

/** Which primary destinations the workspace offers in the selected Cycle. */
export interface WorkspaceDestinationsDto {
  overview: boolean;
  myPlan: boolean;
  team: boolean;
  reviews: boolean;
  cycleAdmin: boolean;
  settings: boolean;
  /** A current manager or direct reports in Core HR, or any series. Not cycle-bound. */
  oneOnOnes: boolean;
  /** Everyone with Performance access. Not cycle-bound. */
  feedback: boolean;
}

// ── Overview (performance-overview): the year, then rows in a fixed order ──

export type YearPhaseState = "Done" | "Current" | "Upcoming";

/** One phase sized by its dates; `estimated` when no review round dates it yet. */
export interface YearPhaseDto {
  name: "Planning" | "Execution" | "Review";
  start: string;
  end: string;
  state: YearPhaseState;
  estimated: boolean;
}

export type YearDateKind = "plans-due" | "self-due" | "peers-due" | "reviews-due" | "managers-due" | "cycle-end" | "cycle-start";

/** A date that concerns the viewer; `count` is how many it covers when it covers several (reviews due, late). */
export interface YearDateDto {
  kind: YearDateKind;
  date: string;
  count?: number | null;
}

/** The selected Cycle's year. Days left count to `next`; a closed cycle has no today marker. */
export interface OverviewYearDto {
  state: CycleLifecycleState;
  start: string;
  end: string;
  today: string;
  phases: YearPhaseDto[];
  currentPhase: "Planning" | "Execution" | "Review" | "Draft" | null;
  dates: YearDateDto[];
  next: YearDateDto | null;
  daysLeft: number | null;
  closedAt: string | null;
}

/** A person shown as a chip; `state` is a key the client words. */
export interface OverviewChipDto {
  employeeId: string;
  name: string;
  state: string;
  since: string | null;
  needsYou: boolean;
  href: string | null;
}

/** Objectives by the status their owners last set (D-05); never inferred. */
export interface StatusMixDto {
  onTrack: number;
  atRisk: number;
  offTrack: number;
  noStatus: number;
}

export interface PlanStatesDto {
  approved: number;
  submitted: number;
  drafting: number;
  notStarted: number;
}

export interface UnitShareDto {
  unitId: string | null;
  name: string;
  count: number;
  total: number;
  missing: number;
}

export interface LateManagerDto {
  employeeId: string;
  name: string;
  unitName: string | null;
  late: number;
  submitted: number;
  total: number;
}

export interface FlaggedObjectiveDto {
  objectiveId: string;
  employeeId: string;
  personName: string;
  title: string;
  status: ObjectiveStatus;
  reason: string | null;
  since: string | null;
  progress: number;
  href: string;
}

export interface OwnResultDto {
  level: number;
  label: string;
  releasedAt: string;
  acknowledgedAt: string | null;
}

export interface PeerAskDto {
  requestId: string;
  subjectName: string;
  questions: number;
  dueDate: string | null;
  href: string;
}

export interface DevelopmentGoalFactDto {
  id: string;
  title: string;
  status: DevelopmentGoalStatus;
  targetDate: string | null;
}

export interface NextMeetingDto {
  seriesId: string;
  with: string;
  at: string;
  agenda: number;
  openActions: number;
  href: string;
}

/** What a first cycle would start from (administrators, board 16); workforce facts are empty when Core HR was down. */
export interface NoCycleReadinessDto {
  workforceAvailable: boolean;
  people: number;
  withManager: number;
  withoutManager: string[];
  units: number;
  ratingLevels: number;
  competencies: number;
}

export interface OwedConversationDto {
  kind: "feedback-request" | "overdue-action";
  title: string;
  context: string | null;
  due: string | null;
  count: number;
  href: string;
}

/** The rows of one Overview projection, discriminated by `kind`. Facts only — never averages. */
export type OverviewRowDto =
  | { kind: "nextCycle"; cycleId: string | null; name: string | null; plannedStart: string | null; setup: CycleDetailDto | null }
  | {
      kind: "cycle";
      cycleId: string;
      cycleName: string;
      state: CycleLifecycleState;
      participants: number;
      approvedPlans: number;
      setup: CycleDetailDto | null;
      planning: { plans: PlanStatesDto; furthestBehind: UnitShareDto[] } | null;
      execution: {
        approvedPlans: number;
        updatedIn30Days: number;
        objectives: number;
        status: StatusMixDto;
        neverApproved: number;
        furthestBehind: UnitShareDto[];
      } | null;
      review: {
        roundId: string;
        roundName: string;
        subjects: number;
        selfSubmitted: number;
        selfTotal: number;
        selfDue: string | null;
        managerSubmitted: number;
        managerTotal: number;
        managerLate: number;
        managerDue: string | null;
        calibrationEnabled: boolean;
        calibrationState: "Open" | "Finalized" | null;
        calibrationDiscussed: number;
        calibrationSubjects: number;
        readyToFinalize: number;
        lateManagers: LateManagerDto[];
        otherLateManagers: number;
        otherLate: number;
      } | null;
      closed: { released: number; acknowledged: number; calibrationChanged: number; openGrowthGoals: number; releasedAt: string | null } | null;
    }
  | {
      kind: "team";
      people: number;
      objectives: number;
      plans: PlanStatesDto;
      awaitingDecision: number;
      firstAwaitingName: string | null;
      firstAwaitingHref: string | null;
      chips: OverviewChipDto[];
      flagged: FlaggedObjectiveDto[];
      flaggedTotal: number;
      approvedPlans: number;
      updatedIn30Days: number;
      withoutRecentUpdate: string[];
      withoutRecentUpdateTotal: number;
      openRequests: number;
      cycleEnd: string;
      results: { released: number; acknowledged: number; notAcknowledged: string[]; calibrationChanged: number; withOpenGrowthGoals: number } | null;
    }
  | {
      kind: "reviewsYouWrite";
      roundId: string;
      roundName: string;
      dueDate: string | null;
      total: number;
      ready: number;
      submitted: number;
      peerListsToApprove: number;
      peerListsDue: string | null;
      firstReadyName: string | null;
      firstReadyHref: string | null;
      chips: OverviewChipDto[];
      inCalibration: boolean;
    }
  | {
      kind: "ownReview";
      reviewId: string;
      roundName: string;
      state: PerformanceReviewState;
      reviewerName: string;
      dueDate: string | null;
      steps: FusionWorkStep[] | null;
      peersAnswered: number;
      peersAsked: number;
      draftSavedAt: string | null;
      selfSubmittedAt: string | null;
      result: OwnResultDto | null;
      href: string;
    }
  | { kind: "inputOwed"; requests: PeerAskDto[] }
  | {
      kind: "ownPlan";
      standing: RosterPlanStatus;
      objectives: number;
      alignedObjectives: number;
      weightTotal: number;
      minObjectives: number | null;
      maxObjectives: number | null;
      reviewerName: string | null;
      submittedAt: string | null;
      returnFeedback: string | null;
      returnedBy: string | null;
      planningDeadline: string;
      planningOpen: boolean;
      /** Present only once the plan is Approved: before that no progress figure exists. */
      progress: number | null;
      status: StatusMixDto | null;
      lastUpdateAt: string | null;
      staleObjectives: number;
      stalestDays: number | null;
      openRequests: number;
      firstRequestBy: string | null;
      firstRequestObjective: string | null;
      firstRequestHref: string | null;
      href: string;
    }
  | { kind: "development"; total: number; open: number; goals: DevelopmentGoalFactDto[]; href: string }
  | { kind: "conversations"; meetings: NextMeetingDto[]; owed: OwedConversationDto | null }
  | { kind: "direction"; count: number; objectives: GoalNodeDto[]; final: boolean }
  | { kind: "notParticipant"; cycleName: string; joined: string | null; populationSetAt: string | null }
  | { kind: "noCycle"; canCreate: boolean; readiness: NoCycleReadinessDto | null };

export type OverviewRowKind = OverviewRowDto["kind"];
export type OverviewRow<K extends OverviewRowKind> = Extract<OverviewRowDto, { kind: K }>;

/** Overview as one server projection for the selected Cycle. */
export interface OverviewDto {
  cycle: CycleSummaryDto | null;
  phase: CyclePhase | null;
  year: OverviewYearDto | null;
  rows: OverviewRowDto[];
  destinations: WorkspaceDestinationsDto;
}

/** The selected Cycle, the Cycles the caller may switch to, and the workspace composition for them. */
export interface WorkspaceContextDto {
  cycles: CycleSummaryDto[];
  selected: CycleSummaryDto | null;
  phase: CyclePhase | null;
  capabilities: WorkspaceCapabilitiesDto;
  destinations: WorkspaceDestinationsDto;
}

export interface ReviewRoundSummaryDto {
  id: string;
  cycleId: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  state: ReviewRoundState;
  subjectCount: number;
  excludedCount: number;
  version: number;
}

export type ReviewReadinessIssueCode = "InactiveSubject" | "MissingReviewer" | "InactiveReviewer" | "SelfReview";

export interface ReviewReadinessIssueDto {
  code: ReviewReadinessIssueCode;
  subjectEmployeeId: string;
  reviewerEmployeeId: string | null;
}

export interface ReviewRoundSubjectDto {
  participantId: string;
  subjectEmployeeId: string;
  subjectDisplayName: string;
  reviewerEmployeeId: string | null;
  reviewerDisplayName: string | null;
  reviewerBasis: string;
  isExcluded: boolean;
  exclusionReason: string | null;
  readinessIssues: ReviewReadinessIssueDto[];
}

export interface ReviewRoundDto {
  id: string;
  cycleId: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  selfAssessmentEnabled: boolean;
  objectiveRatingsEnabled: boolean;
  calibrationEnabled: boolean;
  selfAssessmentDueDate: string | null;
  managerAssessmentDueDate: string | null;
  competencyIds: string[];
  state: ReviewRoundState;
  version: number;
  subjects: ReviewRoundSubjectDto[];
  peerInputEnabled: boolean;
  questionsEnabled: boolean;
  potentialEnabled: boolean;
  peerInputDueDate: string | null;
  cycleName: string;
  cycleStart: string;
  cycleEnd: string;
  launchedAt: string | null;
  /** Computed from today while Draft; fixed at launch. */
  schedule: ReviewRoundScheduleDto;
  /** Draft: the library picks. Launched: the frozen snapshot. */
  questions: ReviewRoundQuestionDto[];
  /** Draft only. */
  readiness: ReviewRoundReadinessDto | null;
  /** Active only. */
  progress: ReviewRoundProgressDto | null;
  /** Closed only. */
  outcome: ReviewRoundOutcomeDto | null;
  /** Active and Closed. */
  configuration: ReviewRoundFrozenConfigurationDto | null;
  activity: ReviewRoundActivityDto[];
}
export interface EligibleReviewerDto { employeeId: string; displayName: string; jobTitle: string | null; orgUnitName: string | null }

export interface CreateReviewRoundRequest { name: string; periodStart: string; periodEnd: string }
export interface UpdateReviewRoundRequest {
  expectedVersion: number;
  name: string;
  periodStart: string;
  periodEnd: string;
  selfAssessmentEnabled: boolean;
  objectiveRatingsEnabled: boolean;
  calibrationEnabled: boolean;
  selfAssessmentDueDate: string | null;
  managerAssessmentDueDate: string | null;
  competencyIds: string[];
  peerInputEnabled?: boolean;
  questionsEnabled?: boolean;
  potentialEnabled?: boolean;
  peerInputDueDate?: string | null;
  /** True with a null `peerInputDueDate` returns the peer date to its default offset. */
  peerInputDueDateSet?: boolean;
  /** Library question ids, in order within each audience; omitted keeps the picks. */
  questionIds?: string[];
}
export interface UpdateReviewRoundPopulationRequest {
  expectedVersion: number;
  subjects: { participantId: string; isExcluded: boolean; exclusionReason: string | null; reviewerEmployeeId: string | null }[];
}
export interface ReviewRoundLaunchDto { reviewRoundId: string; state: ReviewRoundState; reviewCount: number; reviewIds: string[] }
export interface ReviewRoundStatusDto {
  reviewRoundId: string;
  state: ReviewRoundState;
  stageCounts: { state: PerformanceReviewState; count: number }[];
  overdueSelfAssessments: number;
  overdueManagerAssessments: number;
  readyToFinalizeCount: number;
  selfAssessments: ReviewCompletionDto;
  managerAssessments: ReviewCompletionDto;
  /** Round administrators only. The final rating where set, otherwise the submitted manager rating. */
  ratingDistribution: ReviewRatingCountDto[];
}

/** Submitted out of the reviews that need this assessment. */
export interface ReviewCompletionDto {
  submitted: number;
  required: number;
}

export interface ReviewRatingCountDto {
  value: number;
  label: string;
  count: number;
  /** The drill-through: reviews at this level, each one the administrator may open. */
  reviews: { reviewId: string; subjectDisplayName: string }[];
}

export interface ReviewWorkItemDto {
  reviewId: string;
  reviewRoundId: string;
  cycleId: string;
  reviewRoundName: string;
  subjectDisplayName: string;
  reviewerDisplayName: string;
  state: PerformanceReviewState;
  dueDate: string | null;
  isSubject: boolean;
  isReviewer: boolean;
  isAssignedToCaller: boolean;
}

export interface ReviewHistoryItemDto {
  reviewId: string;
  reviewRoundId: string;
  cycleId: string;
  cycleName: string;
  reviewRoundName: string;
  subjectDisplayName: string;
  reviewerDisplayName: string;
  finalRating: number | null;
  finalRatingLabel: string | null;
  finalizedAt: string | null;
}

export interface ReviewAssessmentDto {
  summary: string;
  overallRating: number | null;
  savedAt: string | null;
  submittedAt: string | null;
}

export interface ReviewFinalizationDto {
  reviewId: string;
  state: PerformanceReviewState;
  finalRating: number;
  /** Null when the caller finalized their own review: the source is calibration detail. */
  finalRatingSource: string | null;
  finalizedAt: string;
}
export interface ReviewRoundFinalizationDto {
  reviewRoundId: string;
  finalized: ReviewFinalizationDto[];
  skipped: { reviewId: string; reason: string }[];
  state: ReviewRoundState;
}
export interface FinalizeReviewRoundRequest { expectedVersion: number; reviewIds?: string[] | null }
export interface ExpectedVersionRequest { expectedVersion: number }

export type ReviewItemKind = "Objective" | "Competency";
export interface ReviewEvidenceRefDto {
  evidenceId: string | null;
  kind: EvidenceKind | null;
  label: string;
  recordedAt: string | null;
}

export interface ReviewItemAssessmentDto extends ReviewItemRecordFields {
  kind: ReviewItemKind;
  itemId: string;
  title: string;
  description: string | null;
  behaviors: string[];
  measurement: MeasurementDto | null;
  hasProgress: boolean;
  progress: number | null;
  evidenceCount: number;
  evidenceSummary: ReviewEvidenceRefDto[];
  selfReflection: string | null;
  selfRating: number | null;
  selfComment: string | null;
  managerAssessment: string | null;
  managerRating: number | null;
  /** Present only when reading a finalized snapshot written before structured measurements. */
  legacyMeasurementSummary?: string | null;
}

export interface PerformanceReviewDto extends PerformanceReviewRecordFields {
  id: string;
  reviewRoundId: string;
  cycleId: string;
  reviewRoundName: string;
  periodStart: string;
  periodEnd: string;
  subjectDisplayName: string;
  reviewerDisplayName: string;
  state: PerformanceReviewState;
  dueDate: string | null;
  selfAssessmentEnabled: boolean;
  calibrationEnabled: boolean;
  canEditSelfAssessment: boolean;
  canEditManagerAssessment: boolean;
  version: number;
  ratingScaleVersionId: string;
  ratingScaleVersion: number;
  ratingScale: RatingScaleLevelDto[];
  selfAssessment: ReviewAssessmentDto | null;
  managerAssessment: ReviewAssessmentDto | null;
  hasApprovedPlan: boolean;
  objectiveRatingsEnabled: boolean;
  items: ReviewItemAssessmentDto[];
  finalRating: number | null;
  finalRatingSource: string | null;
  finalizedAt: string | null;
  /** Present only for facilitators during calibration and for the reviewer and round administrators after it; never for the subject. */
  calibration: ReviewCalibrationDto | null;
}

export interface ReviewCalibrationDto {
  sessionFinalized: boolean;
  originalRating: number;
  calibratedRating: number | null;
  rationale: string | null;
  originalPotential: ReviewPotential | null;
  calibratedPotential: ReviewPotential | null;
  changedBy: string | null;
  changedAt: string | null;
  /** The reviewer may rewrite the summary until release because calibration changed the rating. */
  canReviseSummary: boolean;
  summaryRevisedAt: string | null;
  summaryCheckedAt: string | null;
}

export type CalibrationSessionState = "Open" | "Finalized";
export type CalibrationDiscussionState = "NotDiscussed" | "Discussed";

export interface CalibrationFacilitatorDto {
  userId: string;
  displayName: string;
  namedAt: string;
}

export interface FacilitatorCandidateDto {
  userId: string;
  displayName: string;
}

export interface CalibrationCountsDto {
  subjects: number;
  discussed: number;
  adjusted: number;
  remaining: number;
  outstanding: number;
}

export interface CalibrationDistributionDto {
  value: number;
  label: string;
  original: number;
  current: number;
}

export interface CalibrationAdjustmentDto {
  id: string;
  actorDisplayName: string;
  at: string;
  previousRating: number;
  newRating: number;
  rationale: string | null;
  previousPotential: ReviewPotential | null;
  newPotential: ReviewPotential | null;
}

export interface CalibrationSubjectDto {
  reviewId: string;
  subjectDisplayName: string;
  reviewerDisplayName: string;
  orgUnitName: string | null;
  jobTitle: string | null;
  reviewState: PerformanceReviewState;
  originalRating: number;
  calibratedRating: number | null;
  currentRating: number;
  adjusted: boolean;
  rationale: string | null;
  discussionState: CalibrationDiscussionState;
  version: number;
  history: CalibrationAdjustmentDto[];
  originalPotential: ReviewPotential | null;
  currentPotential: ReviewPotential | null;
  potentialAdjusted: boolean;
}

/** A stale change: the subject as it stands and who changed it last (409 `Calibration.Conflict`). */
export interface CalibrationConflictDto {
  current: CalibrationSubjectDto;
  changedBy: string | null;
  changedAt: string | null;
}

export interface CalibrationOutstandingReviewDto {
  reviewId: string;
  subjectDisplayName: string;
  reviewerDisplayName: string;
  state: PerformanceReviewState;
}

export interface CalibrationSessionDto {
  id: string;
  reviewRoundId: string;
  cycleId: string;
  reviewRoundName: string;
  state: CalibrationSessionState;
  version: number;
  openedAt: string;
  finalizedAt: string | null;
  facilitators: CalibrationFacilitatorDto[];
  counts: CalibrationCountsDto;
  ratingScale: RatingScaleLevelDto[];
  distribution: CalibrationDistributionDto[];
  outstanding: CalibrationOutstandingReviewDto[];
  /** Present on reads of the session: the header of the three views. */
  header: CalibrationHeaderDto | null;
}

/** A filter option; for a manager, flagged when their ratings sit far from the session's. */
export interface CalibrationOptionDto { id: string; name: string; count: number; flagged: boolean }
export interface CalibrationOutstandingGroupDto { reviewerId: string; reviewerName: string; count: number; people: string[] }
export interface CalibrationHeaderDto {
  people: number;
  discussed: number;
  ratingChanged: number;
  potentialChanged: number;
  flags: number;
  flaggedNotDiscussed: number;
  outstanding: number;
  potentialEnabled: boolean;
  bandLowTop: number;
  bandMidTop: number;
  outstandingByReviewer: CalibrationOutstandingGroupDto[];
  units: CalibrationOptionDto[];
  managers: CalibrationOptionDto[];
}

/** Filters shared by every view; all optional. */
export interface CalibrationFilter {
  unit?: string | null;
  manager?: string | null;
  flagged?: boolean;
  notDiscussed?: boolean;
  q?: string | null;
}

export type CalibrationFlagKind = "RatingVsObjectives" | "MovedSinceLastCycle";
/** Facts behind a person flag; the client words it. */
export interface CalibrationFlagDto { kind: CalibrationFlagKind; attainment: number | null; moved: number | null; cycle: string | null }
export interface CalibrationPersonDto {
  reviewId: string;
  name: string;
  jobTitle: string | null;
  unit: string | null;
  reviewerId: string;
  reviewerName: string;
  originalRating: number;
  currentRating: number;
  originalPotential: ReviewPotential | null;
  currentPotential: ReviewPotential | null;
  attainment: number | null;
  lastResult: { rating: number; cycleName: string } | null;
  flags: CalibrationFlagDto[];
  discussed: boolean;
  version: number;
}
export interface CalibrationLevelDto { value: number; label: string; original: number; current: number }
export interface CalibrationManagerDto {
  reviewerId: string;
  reviewerName: string;
  reviews: number;
  originalMix: number[];
  currentMix: number[];
  originalAverage: number;
  currentAverage: number;
  delta: number;
  lenient: boolean;
}
export interface CalibrationDistributionViewDto {
  levels: CalibrationLevelDto[];
  sessionAverage: number;
  currentAverage: number;
  managers: CalibrationManagerDto[];
}
export interface CalibrationGroupDto { value: number; label: string; count: number; originalCount: number; people: CalibrationPersonDto[] }
export interface CalibrationPeopleViewDto { groups: CalibrationGroupDto[]; total: number }
export interface CalibrationCellPersonDto { reviewId: string; name: string; currentRating: number; moved: boolean; version: number }
/** Band 0 is the low band, 2 the top. */
export interface CalibrationCellDto { band: 0 | 1 | 2; potential: ReviewPotential; people: CalibrationCellPersonDto[] }
export interface CalibrationNineBoxViewDto { bandLowTop: number; bandMidTop: number; cells: CalibrationCellDto[] }
export interface CalibrationObjectiveDto { id: string; title: string; weight: number | null; progress: number | null; status: ObjectiveStatus | null }
export interface CalibrationSubjectDetailDto {
  person: CalibrationPersonDto;
  objectives: CalibrationObjectiveDto[];
  managerSummary: string | null;
  rationale: string | null;
  history: CalibrationAdjustmentDto[];
  reviewer: CalibrationManagerDto | null;
  scale: RatingScaleLevelDto[];
}
export interface CalibrationFinalizePreviewDto {
  people: number;
  ratingsUp: number;
  ratingsDown: number;
  potentialUp: number;
  potentialDown: number;
  notDiscussed: number;
  flaggedNotDiscussed: { reviewId: string; name: string; flags: CalibrationFlagDto[] }[];
  outstanding: number;
  reviewers: number;
}
export interface CalibrationChangeDto {
  reviewId: string;
  name: string;
  reviewerName: string;
  originalRating: number;
  finalRating: number;
  originalPotential: ReviewPotential | null;
  finalPotential: ReviewPotential | null;
  reason: string | null;
  changedBy: string | null;
  changedAt: string | null;
}
export interface CalibrationChangesViewDto { levels: CalibrationLevelDto[]; changes: CalibrationChangeDto[]; finalizedAt: string | null }

export interface CalibrationRoundDto {
  reviewRoundId: string;
  cycleId: string;
  reviewRoundName: string;
  roundState: ReviewRoundState;
  sessionState: CalibrationSessionState | null;
  isFacilitator: boolean;
  subjects: number | null;
  discussed: number | null;
}

export interface AdjustCalibrationSubjectRequest {
  rating: number;
  rationale: string | null;
  discussionState: CalibrationDiscussionState;
  expectedVersion: number;
  /** Omitted leaves potential as it is. */
  potential?: ReviewPotential | null;
}

export interface PerformanceReviewMutationDto {
  id: string;
  state: PerformanceReviewState;
  dueDate: string | null;
  version: number;
}

export interface ReviewItemResponseInput {
  kind: ReviewItemKind;
  itemId: string;
  reflection?: string | null;
  rating?: number | null;
  comment?: string | null;
  assessment?: string | null;
}
export interface SaveSelfAssessmentRequest {
  expectedVersion: number;
  summary: string;
  /** The person's own overall view (D-16); required on submit. */
  overallRating?: number | null;
  items?: ReviewItemResponseInput[];
  answers?: ReviewAnswerInput[];
}
export interface SaveManagerAssessmentRequest {
  expectedVersion: number;
  summary: string;
  overallRating: number | null;
  items?: ReviewItemResponseInput[];
  answers?: ReviewAnswerInput[];
  /** Required on submit when the round asks for it; never shown to the person. */
  potential?: ReviewPotential | null;
}

export interface CloseCycleRequest {
  earlyCloseReason?: string | null;
  exceptionReason?: string | null;
}

export interface MilestoneDto {
  id: string;
  title: string;
  weight: number;
  dueDate: string | null;
  isCompleted: boolean;
}

export interface MeasurementDto {
  method: MeasurementMethod;
  baseline: number | null;
  target: number | null;
  unit: string | null;
  direction: ImprovementDirection | null;
  milestones: MilestoneDto[];
}

export interface StrategicObjectiveDto {
  version: number;
  id: string;
  title: string;
  description: string | null;
  accountablePersonId: string;
  accountablePersonName: string | null;
  startDate: string;
  endDate: string;
  state: ObjectiveLifecycleState;
  publishedAt: string | null;
  measurement: MeasurementDto;
}

export interface ReadinessIssueDto {
  code: ReadinessIssueCode;
  label: string;
  isHard: boolean;
}

export interface PopulationCandidateDto {
  employeeId: string;
  displayName: string;
  jobTitle: string | null;
  orgUnitId: string | null;
  orgUnitName: string | null;
  managerEmployeeId: string | null;
  managerDisplayName: string | null;
  managerIsActive: boolean;
  isActive: boolean;
  byExplicitInclusion: boolean;
  isExcluded: boolean;
  exclusionReason: string | null;
  isEligible: boolean;
  countsToRoster: boolean;
  hasValidReviewer: boolean;
  issues: ReadinessIssueDto[];
}

export interface OrgUnitSelectionInput {
  orgUnitId: string;
  includeDescendants: boolean;
}

export interface ExclusionInput {
  employeeId: string;
  reason: string;
}

export interface PopulationSelectionDto {
  version: number;
  mode: PopulationMode;
  eligibilityDate: string;
  isConfirmed: boolean;
  orgUnitSelections: OrgUnitSelectionInput[];
  inclusions: string[];
  exclusions: ExclusionInput[];
}

export interface PopulationDto {
  selection: PopulationSelectionDto;
  readyCount: number;
  needsAttentionCount: number;
  excludedCount: number;
  reviewerReadyCount: number;
  reviewerRequiredCount: number;
  candidates: PopulationCandidateDto[];
}

// ── Organizational goals (Chunk B) ─────────────────────────────────────────────

export interface PersonRefDto {
  id: string;
  name: string | null;
}

export interface GoalNodeDto {
  version: number;
  id: string;
  ownershipScope: ObjectiveOwnershipScope;
  title: string;
  state: ObjectiveLifecycleState;
  parentObjectiveId: string | null;
  orgUnitId: string | null;
  orgUnitName: string | null;
  accountablePersonId: string;
  accountablePersonName: string | null;
  startDate: string;
  endDate: string;
  progressSource: ObjectiveProgressSource;
  measurementSummary: string;
  isAlignmentBaseline: boolean;
  isContributionBaselineLocked: boolean;
  contributionWeightTotal: number;
  childCount: number;
  contributorCount: number;
  contributionToParent: number | null;
  /** Canonical execution result. Calculated objectives include configured contributors only, never all aligned children. */
  hasProgress: boolean;
  derivedProgress: number;
  /** Reported contributor weight for calculated objectives; null for direct measurement. */
  progressCoverage: number | null;
  /** When this objective was published as direction; null while it is still a Draft. */
  publishedAt: string | null;
  /** When the objective was created. */
  createdAt: string;
  /** When the objective was last edited; null if never edited since creation. */
  updatedAt: string | null;
}

export interface GoalsOverviewDto {
  cycleId: string;
  cycleName: string;
  cycleState: CycleLifecycleState;
  cycleStart: string;
  cycleEnd: string;
  strategicCount: number;
  organizationalCount: number;
  publishedCount: number;
  draftCount: number;
  nodes: GoalNodeDto[];
}

export interface ContributionLinkDto {
  childObjectiveId: string;
  childTitle: string;
  childState: ObjectiveLifecycleState;
  weight: number;
}

export interface AlignedPlanObjectiveDto {
  objectiveId: string;
  title: string;
  ownerName: string | null;
  planState: PlanLifecycleState;
  progress: number | null;
}

export interface GoalDetailDto {
  node: GoalNodeDto;
  description: string | null;
  accountable: PersonRefDto;
  parent: GoalNodeDto | null;
  children: GoalNodeDto[];
  alignedPlanObjectives: AlignedPlanObjectiveDto[];
  measurement: MeasurementDto | null;
  contribution: ContributionLinkDto[];
  canEdit: boolean;
  canPublish: boolean;
  canConfigureContribution: boolean;
  /** The Cycle this objective belongs to: an objective is addressed by (cycle, objective), never by the current Cycle. */
  cycleId: string;
  /** Set for an Employee objective: the plan it belongs to and its weight within it. */
  plan: GoalPlanFacetDto | null;
  canDelete: boolean;
  canUpdateProgress: boolean;
  /** Named progress detail (history, evidence): stricter than reading the objective itself. */
  canReadProgressHistory: boolean;
  canArchive: boolean;
  archivedAt: string | null;
  /** The owner's latest status and its reason; present only with named progress detail. */
  status: ObjectiveStatusDto | null;
  /** The plan's responsible reviewer may acknowledge an unacknowledged risky status. */
  canAcknowledgeStatus: boolean;
  /** The viewer can give the objective's owner feedback about it. */
  canGiveFeedback: boolean;
  /** The viewer owns the objective and can ask colleagues for feedback on it. */
  canAskForFeedback: boolean;
}

/** The plan an Employee objective belongs to, as seen from the objective. */
export interface ObjectiveStatusDto {
  value: ObjectiveStatus;
  /** The note of the check-in that reported it: "What's in the way" when at risk or off track. */
  reason: string | null;
  reportedAt: string;
  /** When the current status value began; repeats keep it. */
  since: string;
  acknowledgedAt: string | null;
  acknowledgedBy: PersonRefDto | null;
}

export interface GoalPlanFacetDto {
  planId: string;
  planState: PlanLifecycleState;
  planWeight: number | null;
  owner: PersonRefDto;
  /** The viewer is the Approved plan's responsible reviewer in an open Cycle. */
  canRequestUpdate: boolean;
}

export interface CreateOrganizationalObjectiveRequest {
  expectedVersion: number;
  /** Omitted by managers; administrators provide the team they are acting for. */
  orgUnitId?: string | null;
  orgUnitName?: string | null;
  title: string;
  description?: string | null;
  accountablePersonId: string;
  parentObjectiveId: string | null;
  startDate?: string | null;
  endDate?: string | null;
  progressSource: ObjectiveProgressSource;
  measurement?: MeasurementInput | null;
}

export interface UpdateOrganizationalObjectiveRequest {
  expectedVersion: number;
  title: string;
  description?: string | null;
  accountablePersonId: string;
  parentObjectiveId: string | null;
  startDate: string;
  endDate: string;
  progressSource: ObjectiveProgressSource;
  measurement?: MeasurementInput | null;
}

export interface AlignObjectiveRequest {
  expectedVersion: number;
  parentObjectiveId: string | null;
}

export interface TeamObjectiveWorkspaceItemDto {
  node: GoalNodeDto;
  description: string | null;
  parent: AlignmentTargetDto | null;
}

export interface TeamObjectiveWorkspaceDto {
  orgUnitId: string;
  orgUnitName: string;
  objectives: TeamObjectiveWorkspaceItemDto[];
  alignmentTargets: AlignmentTargetDto[];
  eligibleOwners: PersonRefDto[];
  canCreate: boolean;
  canChooseTeam: boolean;
}

export interface ContributionInput {
  childObjectiveId: string;
  weight: number;
}

export interface ConfigureContributionRequest {
  expectedVersion: number;
  contributors: ContributionInput[];
}

// ── Employee plans (Chunk C) ────────────────────────────────────────────────────

export interface PlanObjectiveDto {
  version: number;
  id: string;
  title: string;
  description: string | null;
  parentObjectiveId: string | null;
  /** Readable upstream direction, top-down (e.g. ["Grow the customer base", "Lift NPS to 60"]). Empty for standalone. */
  directionPath: string[];
  isAligned: boolean;
  startDate: string;
  endDate: string;
  progressSource: ObjectiveProgressSource;
  measurementSummary: string;
  measurement: MeasurementDto | null;
  planWeight: number | null;
  hasProgress: boolean;
  derivedProgress: number;
  /** Latest reported raw values — the current value the employee reads, distinct from derivedProgress. Null until progress exists. */
  currentPercentage: number | null;
  currentActual: number | null;
  lastProgressAt: string | null;
  canUpdateProgress: boolean;
  /** The owner's latest reported status; null until the first check-in that carries one. */
  status: ObjectiveStatus | null;
  statusReportedAt: string | null;
}

export interface PlanReadinessDto {
  alignmentPolicy: PlanAlignmentPolicy;
  everyObjectiveConnectsToStrategicDirection: boolean;
  objectiveCount: number;
  weightTotal: number;
  /** Positive = still to assign, negative = over by that much, 0 = exactly 100%. */
  weightRemaining: number;
  everyObjectiveHasWeight: boolean;
  connectsToStrategicDirection: boolean;
  hasStandaloneObjective: boolean;
  standaloneAllowed: boolean;
  canSubmit: boolean;
  blockers: string[];
  /** Change requests from the latest return still to address before resubmitting. */
  openChangeRequests: number;
}

/** A change requested on one objective when the plan was returned (D-09). */
export interface PlanChangeRequestDto {
  id: string;
  objectiveId: string;
  objectiveTitle: string;
  text: string;
  state: PlanChangeRequestState;
  reply: string | null;
  addressedAt: string | null;
  /** Whether the objective was edited after the return; null once it was removed. */
  objectiveChanged: boolean | null;
}

export interface PlanDecisionDto {
  kind: PlanDecisionKind;
  actorEmployeeId: string;
  actorName: string | null;
  feedback: string | null;
  decidedAt: string;
  /** Change requests a return carried; empty for other decisions. */
  changeRequests: PlanChangeRequestDto[];
}

/** Why a participant's responsible reviewer holds that responsibility. */
export type ReviewerBasis = "CoreManagerAtCycleStart" | "AdministrativeAssignment";

export interface EmployeePlanDto {
  version: number;
  id: string;
  cycleId: string;
  cycleName: string;
  cycleState: CycleLifecycleState;
  employee: PersonRefDto;
  isOwner: boolean;
  orgUnitName: string | null;
  responsibleManager: PersonRefDto | null;
  /** Why the responsible reviewer holds that responsibility, captured by Performance (not live Core). */
  responsibleReviewerBasis?: ReviewerBasis | null;
  responsibleReviewerAsOf?: string | null;
  state: PlanLifecycleState;
  submittedAt: string | null;
  lastSavedAt: string;
  approvedAt: string | null;
  approvalKind: PlanApprovalKind | null;
  isLocked: boolean;
  planProgress: number;
  objectives: PlanObjectiveDto[];
  readiness: PlanReadinessDto;
  history: PlanDecisionDto[];
  canAuthor: boolean;
  canSubmit: boolean;
  canDecide: boolean;
  canApproveExceptionally: boolean;
  /** The caller is the approved plan's responsible reviewer and may ask for updates. */
  canRequestUpdate: boolean;
}

export interface PlanPreviewDto {
  reviewer: PersonRefDto | null;
  orgUnitName: string | null;
  standaloneAllowed: boolean;
  reviewerBasis?: ReviewerBasis | null;
  reviewerAsOf?: string | null;
}

export interface MyPlanStateDto {
  participatesInCycle: boolean;
  hasPlan: boolean;
  plan: EmployeePlanDto | null;
  preview: PlanPreviewDto | null;
}

// ── Objective coach (AI, D-07) ───────────────────────────────────────────────

/** Which composer the coach serves: it decides the authority and the allowed parents. */
export type ObjectiveCoachSurface = "Plan" | "Team";

/** The draft as the composer holds it right now. Nothing is saved. */
export interface ObjectiveCoachRequest {
  surface: ObjectiveCoachSurface;
  /** Team only: the composer's owning unit. */
  orgUnitId?: string | null;
  title: string;
  description?: string | null;
  measurement?: MeasurementInput | null;
  parentObjectiveId?: string | null;
}

/** A suggested measure. A numeric baseline is present only when the draft stated one. */
export interface CoachMeasureDto {
  method: MeasurementMethod;
  baseline: number | null;
  target: number | null;
  unit: string | null;
  direction: ImprovementDirection | null;
  milestones: Array<{ title: string; weight: number }> | null;
}

/** At most one suggestion of each kind; a missing one means AI abstained. */
export interface ObjectiveCoachResultDto {
  outcome: "Suggested" | "NothingToSuggest";
  title: string | null;
  measure: CoachMeasureDto | null;
  parentObjectiveId: string | null;
}

// ── Alignment map (D-06) ─────────────────────────────────────────────────────

export type AlignmentMapNodeKind = "Company" | "OrgUnit" | "Personal";

/**
 * Personal objectives aligned directly to one direction objective, from plans that were put
 * forward, by owner-reported status. Counts only. `readable` is how many arrive as nodes.
 */
export interface PersonalAlignmentDto {
  total: number;
  onTrack: number;
  atRisk: number;
  offTrack: number;
  noStatus: number;
  readable: number;
}

export interface AlignmentMapNodeDto {
  id: string;
  kind: AlignmentMapNodeKind;
  parentId: string | null;
  title: string;
  orgUnitName: string | null;
  ownerName: string | null;
  isOwn: boolean;
  status: ObjectiveStatus | null;
  statusSince: string | null;
  hasProgress: boolean;
  progress: number;
  /** Company and unit nodes only. */
  personal: PersonalAlignmentDto | null;
}

export interface AlignmentMapDto {
  cycleId: string;
  nodes: AlignmentMapNodeDto[];
}

export interface AlignmentTargetDto {
  id: string;
  ownershipScope: ObjectiveOwnershipScope;
  title: string;
  orgUnitName: string | null;
  accountablePersonId: string;
  accountablePersonName: string | null;
  startDate: string;
  endDate: string;
  directionPath: string[];
}

/** One objective's slice of an approved plan: its plan weight and reported progress (capped at 100). */
export interface RosterObjectiveProgressDto {
  weight: number;
  progress: number;
  hasProgress: boolean;
  /** Aligned to upstream direction (accent) rather than standalone (info) — the objective's colour identity. */
  isAligned: boolean;
  /** A milestone objective's milestones, in order; empty for other measurement methods. */
  milestones: RosterMilestoneSliceDto[];
}

/** One milestone inside a roster objective slice: its share of the objective and whether it is done. */
export interface RosterMilestoneSliceDto {
  weight: number;
  isCompleted: boolean;
  /** Open and past its due date. */
  isOverdue: boolean;
}

export interface TeamRosterMemberDto {
  employeeId: string;
  employeeName: string | null;
  jobTitle: string | null;
  orgUnitName: string | null;
  planId: string | null;
  status: RosterPlanStatus;
  hasProgress: boolean;
  planProgress: number;
  /** Each objective's slice of an Approved plan, in plan order; empty before approval. */
  objectiveProgress: RosterObjectiveProgressDto[];
  /** Objectives on an Approved plan that are incomplete past their end date or an open milestone's due date, counted once each — a fact, never a rating. */
  overdueObjectiveCount: number;
  activityKind: RosterActivityKind;
  activityAt: string | null;
  /** The strong "Review plan" action: a Submitted plan the caller may actually decide. */
  canReview: boolean;
  /** The quiet inspection action: an existing plan the caller may open. */
  canView: boolean;
  /** Planning only (Draft, Returned, Submitted): share of plan weight allocated so far; null once Approved. */
  allocatedWeight?: number | null;
  /** Approved only: incomplete objectives with no update in the last 30 days. */
  objectivesWithoutRecentUpdate?: number;
  /** The caller's latest update request on this plan, open or resolved. */
  updateRequest?: RosterUpdateRequestDto | null;
  /** The caller is this Approved plan's responsible reviewer in an Active Cycle. */
  canRequestUpdate?: boolean;
  /** The review assigned to the caller during this Cycle's Active round, if any. */
  review?: RosterReviewDto | null;
  /** What needs the manager in this phase: one of the page's `groups`. */
  group?: string | null;
  facts?: RosterPhaseFactsDto | null;
}

export type RosterAttentionKind = "planWaiting" | "offTrack" | "atRisk" | "noUpdate" | "openRequest" | "notApproved";

export interface RosterAttentionDto {
  kind: RosterAttentionKind;
  objectiveId: string | null;
  objectiveTitle: string | null;
  reason: string | null;
  since: string | null;
  days: number | null;
}

export interface RosterPeersDto {
  enabled: boolean;
  asked: number;
  answered: number;
  proposed: number;
  waitingForYou: boolean;
}

/** One person's facts for the phase; only the phase's member is set. */
export interface RosterPhaseFactsDto {
  planning: { objectives: number; alignedToTeam: number } | null;
  execution: { status: StatusMixDto; attention: RosterAttentionDto | null; lastUpdateAt: string | null } | null;
  review: {
    selfState: "submitted" | "writing" | "notStarted" | "off";
    selfSubmittedAt: string | null;
    selfDue: string | null;
    peers: RosterPeersDto;
    yourReview: "submitted" | "draftSaved" | "notStarted";
    yourDraftSavedAt: string | null;
  } | null;
  closed: {
    reviewId: string;
    level: number;
    label: string;
    yourLevel: number | null;
    acknowledgedAt: string | null;
    acknowledgedWithComment: boolean;
    openGrowthGoals: number;
  } | null;
}

export type TeamPhase = "Planning" | "Execution" | "Review" | "Closed";

export interface RosterGroupCountDto {
  key: string;
  count: number;
}

/** My Team's header facts for the phase, over the whole responsibility. */
export interface TeamPhaseSummaryDto {
  status: StatusMixDto | null;
  updatedIn30Days: number;
  approved: number;
  roundName: string | null;
  selfSubmitted: number;
  selfTotal: number;
  selfDue: string | null;
  peerListsToApprove: string[];
  reviewsSubmitted: number;
  reviewsReady: number;
  reviewsTotal: number;
  reviewsDue: string | null;
  firstReadyName: string | null;
  firstReadyReviewId: string | null;
  releasedAt: string | null;
}

export interface TeamResultLevelDto {
  value: number;
  label: string;
  count: number;
  people: { employeeId: string; name: string }[];
}

/** The released results of the caller's own recorded team (D-R2). Empty before release; no averages. */
export interface TeamResultsDto {
  cycleId: string;
  released: number;
  releasedAt: string | null;
  levels: TeamResultLevelDto[];
  acknowledged: number;
  notAcknowledged: string[];
  calibrationChanges: { employeeId: string; name: string; from: number; to: number }[];
  openGrowthGoals: number;
}

export interface RosterReviewDto {
  reviewId: string;
  state: PerformanceReviewState;
  dueDate: string | null;
}

export type UpdateRequestState = "Open" | "Satisfied" | "Withdrawn" | "Unresolved";

export interface RosterUpdateRequestDto {
  id: string;
  state: UpdateRequestState;
  objectiveTitle: string | null;
  requestedAt: string;
  satisfiedAt: string | null;
  version: number;
}

export interface UpdateRequestDto {
  id: string;
  cycleId: string;
  planId: string;
  objectiveId: string | null;
  objectiveTitle: string | null;
  requestedByName: string;
  requestedAt: string;
  note: string | null;
  state: UpdateRequestState;
  satisfiedAt: string | null;
  closedAt: string | null;
  version: number;
}

/** The server-owned views of Your People. */
export type YourPeopleFilter = "All" | "NeedsReview" | "Planning" | "Approved" | "NoProgress";

export interface YourPeopleQuery {
  filter: YourPeopleFilter;
  search: string;
  page: number;
  pageSize: number;
}

export interface YourPeopleCountsDto {
  needsReview: number;
  planning: number;
  approved: number;
  noProgress: number;
}

/** One server page of Your People, action required first. */
export interface YourPeoplePageDto {
  cycleId: string;
  hasActiveReviewRound: boolean;
  items: TeamRosterMemberDto[];
  page: number;
  pageSize: number;
  /** What the current view and search match. */
  matchCount: number;
  /** Everyone before search and view: what "empty" means. */
  totalCount: number;
  counts: YourPeopleCountsDto;
  /** The caller's whole responsibility, unaffected by search or view. */
  standing: TeamStandingDto;
  phase: TeamPhase;
  /** The phase's groups in page order, with how many people each holds. */
  groups: RosterGroupCountDto[];
  summary: TeamPhaseSummaryDto | null;
}

// ── Cycle › Insights (performance-hr-insights): cycle administrators only ──

export interface LevelCountDto {
  value: number;
  label: string;
  count: number;
}

/** One unit's figures (or the total): counts and shares only; execution and review figures arrive with the phase. */
export interface InsightsRowDto {
  unitId: string | null;
  name: string;
  people: number;
  plansApproved: number;
  approvedPlans: number | null;
  updatedIn30Days: number | null;
  status: StatusMixDto | null;
  objectives: number | null;
  aligned: number | null;
  reviews: number | null;
  onTime: number | null;
  late: number | null;
  released: number | null;
  acknowledged: number | null;
  levels: LevelCountDto[] | null;
  raised: number | null;
  lowered: number | null;
}

export interface InsightsManagerDto {
  employeeId: string;
  name: string;
  unitName: string | null;
  people: number;
  late: number;
  released: number;
  acknowledged: number;
}

export interface InsightsDirectionDto {
  objectiveId: string;
  title: string;
  owner: string | null;
  alignedObjectives: number;
  unitsContributing: number;
  units: number;
  progress: number;
  hasProgress: boolean;
}

export interface InsightsDto {
  cycleId: string;
  cycleName: string;
  state: CycleLifecycleState;
  asOf: string;
  final: boolean;
  participants: number;
  unitId: string | null;
  scopeName: string;
  units: { unitId: string; name: string; depth: number }[];
  showsExecution: boolean;
  showsReviews: boolean;
  roundId: string | null;
  roundName: string | null;
  managerDue: string | null;
  releasedAt: string | null;
  neverApproved: number;
  withoutRecentUpdate: number;
  byUnit: InsightsRowDto[];
  total: InsightsRowDto;
  direction: InsightsDirectionDto[];
  notAligned: number;
  byManager: InsightsManagerDto[];
}

/** The figures Insights can open into people. */
export type InsightsMetric =
  | "people"
  | "plans-approved"
  | "plans-not-approved"
  | "updated"
  | "not-updated"
  | "at-risk-or-off-track"
  | "reviews"
  | "on-time"
  | "late"
  | "released"
  | "acknowledged"
  | "not-acknowledged"
  | "level"
  | "raised"
  | "lowered";

export interface InsightsPeopleQuery {
  metric: InsightsMetric;
  unitId?: string | null;
  managerId?: string | null;
  level?: number | null;
  page?: number;
  pageSize?: number;
}

export interface InsightsPersonDto {
  employeeId: string;
  name: string;
  jobTitle: string | null;
  unitName: string | null;
  managerName: string | null;
  planState: RosterPlanStatus | null;
  lastUpdateAt: string | null;
  managerDue: string | null;
  managerSubmittedAt: string | null;
  releasedAt: string | null;
  acknowledgedAt: string | null;
  level: number | null;
  managerLevel: number | null;
  href: string | null;
}

export interface InsightsPeoplePageDto {
  metric: InsightsMetric;
  total: number;
  page: number;
  pageSize: number;
  items: InsightsPersonDto[];
}

/** Plan states as a distribution, then execution attention as counts of people. No averages. */
export interface TeamStandingDto {
  people: number;
  notStarted: number;
  draft: number;
  returned: number;
  submitted: number;
  approved: number;
  approvedReporting: number;
  peopleWithOverdue: number;
  peopleWithoutRecentUpdate: number;
  activeLastSevenDays: number;
}


/**
 * Cycle-wide planning and execution standing for administration: operational counts only. There is
 * deliberately no averaged progress figure.
 */
export interface CyclePlanSummaryDto {
  cycleId: string;
  participantCount: number;
  notStartedCount: number;
  draftCount: number;
  returnedForChangesCount: number;
  submittedCount: number;
  approvedCount: number;
  /** Approved plans with at least one progress update. */
  approvedReportingCount: number;
  /** Approved plans still without any progress update. */
  approvedNotReportingCount: number;
  /** Approved plans with an open milestone past its due date. */
  participantsWithOverdueObjectives: number;
}

export interface AddPlanObjectiveRequest {
  expectedVersion: number;
  title: string;
  description?: string | null;
  parentObjectiveId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  measurement: MeasurementInput;
  planWeight: number;
}

export type UpdatePlanObjectiveRequest = AddPlanObjectiveRequest;

export interface SetPlanWeightsRequest {
  expectedVersion: number;
  weights: Array<{ objectiveId: string; weight: number }>;
}

export interface ChangeRequestInput {
  objectiveId: string;
  text: string;
}

/** A return needs a general note, at least one change request, or both. */
export interface ReturnPlanRequest {
  expectedVersion: number;
  feedback: string | null;
  changeRequests?: ChangeRequestInput[];
}

export interface AddressChangeRequestRequest {
  expectedVersion: number;
  reply: string | null;
}

export interface ExceptionalApprovePlanRequest {
  expectedVersion: number;
  reason: string;
}

// ── Progress & contribution (Chunk D) ───────────────────────────────────────────

export interface EvidenceDto {
  id: string;
  kind: EvidenceKind;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  url: string | null;
  referenceText: string | null;
  /** Present only for a File the caller may open; null hides the action when unauthorized. */
  downloadPath: string | null;
  isRemovedUnderRetention: boolean;
}

export interface ProgressUpdateDto {
  id: string;
  kind: ProgressEventKind;
  value: number | null;
  /** Milestones completed or reopened in this check-in. */
  milestoneChanges: ProgressMilestoneChangeDto[];
  /** The owner's status with this check-in; null on check-ins from before status existed. */
  status: ObjectiveStatus | null;
  contextNote: string | null;
  isCorrection: boolean;
  author: PersonRefDto;
  recordedAt: string;
  evidence: EvidenceDto[];
  /** Objective's derived progress immediately after this update. */
  resultingProgress: number;
  /** Signed change from the previous update (first update measured from an unstarted 0). */
  deltaProgress: number;
}

export interface ProgressMilestoneChangeDto {
  milestoneId: string;
  title: string | null;
  completed: boolean;
}

export interface ProgressHistoryPageDto {
  items: ProgressUpdateDto[];
  nextCursor: string | null;
}

export interface ProgressMilestoneDto {
  id: string;
  title: string;
  weight: number;
  dueDate: string | null;
  isCompleted: boolean;
}

export interface ObjectiveProgressDto {
  version: number;
  objectiveId: string;
  title: string;
  ownershipScope: ObjectiveOwnershipScope;
  method: MeasurementMethod;
  hasProgress: boolean;
  derivedProgress: number;
  currentPercentage: number | null;
  currentActual: number | null;
  baseline: number | null;
  target: number | null;
  unit: string | null;
  direction: ImprovementDirection | null;
  milestones: ProgressMilestoneDto[];
  canUpdate: boolean;
  history: ProgressUpdateDto[];
  /** Cursor for the next older page of history; null when the first page holds all of it. */
  historyNextCursor: string | null;
  /** The owner's latest status, preselected for the next check-in. */
  currentStatus: ObjectiveStatus | null;
}

export interface EvidenceDescriptorDto {
  uploadId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export interface EvidenceInput {
  kind: EvidenceKind;
  uploadId?: string | null;
  fileName?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
  url?: string | null;
  label?: string | null;
  referenceText?: string | null;
}

export interface MilestoneChangeInput {
  milestoneId: string;
  completed: boolean;
}

/**
 * One check-in: the status, at most one measurement change matching the method (or none, to report status
 * alone), the note (the reason when at risk or off track) and evidence.
 */
export interface SubmitProgressRequest {
  expectedVersion: number;
  percentage?: number | null;
  numericActual?: number | null;
  milestones?: MilestoneChangeInput[] | null;
  status: ObjectiveStatus;
  contextNote?: string | null;
  isCorrection: boolean;
  evidence?: EvidenceInput[] | null;
}

// ── Request bodies ────────────────────────────────────────────────────────────

export interface CreateCycleRequest {
  name: string;
  startDate: string;
  endDate: string;
  planningDeadline?: string | null;
  description?: string | null;
}

export interface UpdateCycleRequest {
  expectedVersion: number;
  name: string;
  startDate: string;
  endDate: string;
  planningDeadline: string;
  description?: string | null;
}

export interface MeasurementInput {
  method: MeasurementMethod;
  baseline?: number | null;
  target?: number | null;
  unit?: string | null;
  direction?: ImprovementDirection | null;
  milestones?: Array<{
    title: string;
    weight: number;
    dueDate?: string | null;
  }> | null;
}

export interface CreateStrategicObjectiveRequest {
  expectedVersion: number;
  title: string;
  description?: string | null;
  accountablePersonId: string;
  startDate?: string | null;
  endDate?: string | null;
  measurement: MeasurementInput;
  publish?: boolean;
}

export interface UpdateStrategicObjectiveRequest {
  expectedVersion: number;
  title: string;
  description?: string | null;
  accountablePersonId: string;
  startDate: string;
  endDate: string;
  measurement: MeasurementInput;
  publish?: boolean;
}

export interface SetPopulationRequest {
  expectedVersion: number;
  mode: PopulationMode;
  orgUnitSelections?: OrgUnitSelectionInput[];
  inclusions?: string[];
  exclusions?: ExclusionInput[];
}

// ── Person summary (D-32): one person's performance as the viewer may see it ──

/** The caller's relation to the person, from the most permissive that applies. */
export type PersonPerformanceRelation = "Self" | "Manager" | "Reviewer" | "Administrator" | "Other";

export interface PersonSummaryObjectiveDto {
  objectiveId: string;
  /** 1-based position in the plan. */
  number: number;
  title: string;
  /** Title of the objective it's aligned to; null when standalone. */
  alignedTo: string | null;
  weight: number | null;
  /** 0–100, or null before any progress is recorded. */
  progress: number | null;
  href: string;
  /** The owner's latest status; null until reported, never assumed on track. */
  status: ObjectiveStatus | null;
  /** An update asked for and not yet given (the person page's Coming up). */
  openRequest?: { requestedByName: string; requestedAt: string } | null;
}

export interface PersonSummaryCycleDto {
  cycleId: string;
  cycleName: string;
  cycleState: CycleLifecycleState;
  phase: CyclePhase | null;
  /** False when the person isn't part of the cycle; no plan facts follow. */
  isParticipant: boolean;
  planId: string | null;
  planStatus: RosterPlanStatus | null;
  /** Weighted plan progress, 0–100. */
  overallProgress: number | null;
  planHref: string | null;
  objectives: PersonSummaryObjectiveDto[];
  /** Who decides the plan: its recorded reviewer, else the participant's manager. */
  reviewerName?: string | null;
  /** The plan's allocated weight; null for a private Draft. */
  weightTotal?: number | null;
  /** The latest check-in on an approved objective. */
  lastUpdateAt?: string | null;
}

export interface PersonSummaryCurrentReviewDto {
  reviewId: string;
  reviewRoundName: string;
  state: PerformanceReviewState;
  /** Due date of the current step, when it has one. */
  dueDate: string | null;
  /** Which optional steps this review has. */
  selfAssessmentEnabled: boolean;
  calibrationEnabled: boolean;
  href: string;
  /** Who writes the manager assessment: who holds the review once the self-assessment is in. */
  reviewerName?: string | null;
}

export interface PersonSummaryReviewResultDto {
  reviewId: string;
  cycleName: string;
  reviewRoundName: string;
  finalRatingLabel: string | null;
  finalizedAt: string | null;
  href: string;
}

export interface PersonSummaryReviewsDto {
  current: PersonSummaryCurrentReviewDto | null;
  /** Released results, newest first. */
  history: PersonSummaryReviewResultDto[];
}

/**
 * Sections are null when the caller may not see them. An unknown or foreign
 * employee gets the same answer as an unseen one, without identity.
 */
export interface PersonPerformanceSummaryDto {
  employeeId: string;
  displayName: string | null;
  jobTitle: string | null;
  orgUnitName: string | null;
  /** Core HR record key, for linking to `/core/people/{key}`. */
  stableEmployeeKey: string | null;
  relation: PersonPerformanceRelation;
  currentCycle: PersonSummaryCycleDto | null;
  reviews: PersonSummaryReviewsDto | null;
  /** Development goals for the cycle, under the development plan's own visibility. */
  development: PersonSummaryDevelopmentDto | null;
  /** Praise the person received; for everyone with Performance access. */
  praise: PersonSummaryPraiseDto | null;
  /** Feedback the person received that the viewer may read; for the person, their manager and HR only. */
  feedback: PersonSummaryFeedbackDto | null;
  /** The viewer's active 1:1 with the person; only for the two people. */
  oneOnOne: PersonSummaryOneOnOneDto | null;
}

export interface PersonSummaryPraiseDto {
  items: PraiseDto[];
  total: number;
  href: string;
}

export interface PersonSummaryFeedbackDto {
  items: FeedbackDto[];
  total: number;
  href: string;
}

export interface PersonSummaryOneOnOneDto {
  seriesId: string;
  nextMeetingAt: string | null;
  href: string;
}

export interface PersonSummaryDevelopmentGoalDto {
  title: string;
  competencyName: string | null;
  status: DevelopmentGoalStatus;
  targetDate: string | null;
}

export interface PersonSummaryDevelopmentDto {
  goals: PersonSummaryDevelopmentGoalDto[];
  /** The plan's Development section. */
  href: string;
}

// ── Development plans (D-34) ───────────────────────────────────────────────────

export interface DevelopmentGoalDto {
  id: string;
  title: string;
  competencyId: string | null;
  competencyName: string | null;
  actions: string[];
  targetDate: string | null;
  status: DevelopmentGoalStatus;
  addedBy: PersonRefDto;
  updatedAt: string;
  /** Set once carried into a later cycle; the goal is then read-only here. */
  carriedToCycleName: string | null;
  carriedFromEarlierCycle: boolean;
}

export interface DevelopmentCarryOverDto {
  fromCycleId: string;
  fromCycleName: string;
  goals: DevelopmentGoalDto[];
}

/** A participant's development plan in one cycle, as the caller may see and act on it. */
export interface DevelopmentPlanDto {
  cycleId: string;
  employeeId: string;
  exists: boolean;
  version: number;
  goals: DevelopmentGoalDto[];
  /** How many more goals fit (up to 5 in all). */
  room: number;
  canEdit: boolean;
  /** Open goals of the most recent earlier plan, offered once per cycle. */
  carryOver: DevelopmentCarryOverDto | null;
  /** The tenant's active competencies a goal can name; given to those who edit. */
  competencyOptions: { id: string; name: string }[];
}

export interface DevelopmentGoalInput {
  expectedVersion: number;
  title: string;
  competencyId: string | null;
  actions: string[];
  targetDate: string | null;
  status: DevelopmentGoalStatus;
}

// ── Paths & query keys ─────────────────────────────────────────────────────────

export const performancePaths = {
  settings: () => "/performance/settings",
  ratingScale: () => "/performance/settings/rating-scale",
  competencies: () => "/performance/settings/competencies",
  competency: (id: string) => `/performance/settings/competencies/${id}`,
  archiveCompetency: (id: string) => `/performance/settings/competencies/${id}/archive`,
  createCycle: () => "/performance/cycles",
  cycle: (id: string) => `/performance/cycles/${id}`,
  overview: (cycleId?: string | null) =>
    cycleId ? `/performance/overview?cycleId=${encodeURIComponent(cycleId)}` : "/performance/overview",
  context: (cycleId?: string | null) =>
    cycleId ? `/performance/context?cycleId=${encodeURIComponent(cycleId)}` : "/performance/context",
  activate: (id: string) => `/performance/cycles/${id}/activate`,
  closure: (id: string) => `/performance/cycles/${id}/closure`,
  close: (id: string) => `/performance/cycles/${id}/close`,
  strategy: (cycleId: string) => `/performance/cycles/${cycleId}/strategy`,
  strategyItem: (cycleId: string, objectiveId: string) =>
    `/performance/cycles/${cycleId}/strategy/${objectiveId}`,
  archiveStrategy: (cycleId: string, objectiveId: string) => `/performance/cycles/${cycleId}/strategy/${objectiveId}/archive`,
  publishStrategy: (cycleId: string, objectiveId: string) =>
    `/performance/cycles/${cycleId}/strategy/${objectiveId}/publish`,
  population: (cycleId: string) => `/performance/cycles/${cycleId}/population`,
  confirmPopulation: (cycleId: string) =>
    `/performance/cycles/${cycleId}/population/confirm`,
  goals: (cycleId: string) => `/performance/cycles/${cycleId}/goals`,
  alignmentMap: (cycleId: string) => `/performance/cycles/${cycleId}/goals/map`,
  objectiveCoach: (cycleId: string) => `/performance/cycles/${cycleId}/objective-coach`,
  teamObjectiveWorkspace: (cycleId: string, orgUnitId?: string | null) => {
    const base = `/performance/cycles/${cycleId}/goals/team-workspace`;
    return orgUnitId
      ? `${base}?orgUnitId=${encodeURIComponent(orgUnitId)}`
      : base;
  },
  goal: (cycleId: string, objectiveId: string) =>
    `/performance/cycles/${cycleId}/goals/${objectiveId}`,
  alignGoal: (cycleId: string, objectiveId: string) =>
    `/performance/cycles/${cycleId}/goals/${objectiveId}/align`,
  archiveGoal: (cycleId: string, objectiveId: string) => `/performance/cycles/${cycleId}/goals/${objectiveId}/archive`,
  publishGoal: (cycleId: string, objectiveId: string) =>
    `/performance/cycles/${cycleId}/goals/${objectiveId}/publish`,
  goalContribution: (cycleId: string, objectiveId: string) =>
    `/performance/cycles/${cycleId}/goals/${objectiveId}/contribution`,
  lockGoalContribution: (cycleId: string, objectiveId: string) =>
    `/performance/cycles/${cycleId}/goals/${objectiveId}/contribution/lock`,
  myPlan: (cycleId: string) => `/performance/cycles/${cycleId}/plan`,
  alignmentTargets: (cycleId: string) =>
    `/performance/cycles/${cycleId}/plan/alignment-targets`,
  planObjectives: (cycleId: string) =>
    `/performance/cycles/${cycleId}/plan/objectives`,
  planObjective: (cycleId: string, objectiveId: string) =>
    `/performance/cycles/${cycleId}/plan/objectives/${objectiveId}`,
  planWeights: (cycleId: string) =>
    `/performance/cycles/${cycleId}/plan/weights`,
  submitPlan: (cycleId: string) => `/performance/cycles/${cycleId}/plan/submit`,
  yourPeople: (cycleId: string) =>
    `/performance/cycles/${cycleId}/team/people`,
  teamResults: (cycleId: string) => `/performance/cycles/${cycleId}/team/results`,
  insights: (cycleId: string) => `/performance/cycles/${cycleId}/insights`,
  insightsPeople: (cycleId: string) => `/performance/cycles/${cycleId}/insights/people`,
  planDetail: (cycleId: string, planId: string) =>
    `/performance/cycles/${cycleId}/plans/${planId}`,
  updateRequests: (cycleId: string, planId: string) =>
    `/performance/cycles/${cycleId}/plans/${planId}/update-requests`,
  withdrawUpdateRequest: (requestId: string) => `/performance/update-requests/${requestId}/withdraw`,
  returnPlan: (cycleId: string, planId: string) =>
    `/performance/cycles/${cycleId}/plans/${planId}/return`,
  approvePlan: (cycleId: string, planId: string) =>
    `/performance/cycles/${cycleId}/plans/${planId}/approve`,
  exceptionalApprovePlan: (cycleId: string, planId: string) =>
    `/performance/cycles/${cycleId}/plans/${planId}/exceptional-approve`,
  objectiveProgress: (cycleId: string, objectiveId: string) =>
    `/performance/cycles/${cycleId}/objectives/${objectiveId}/progress`,
  objectiveProgressHistory: (cycleId: string, objectiveId: string) =>
    `/performance/cycles/${cycleId}/objectives/${objectiveId}/progress/history`,
  evidenceUpload: (cycleId: string, objectiveId: string) =>
    `/performance/cycles/${cycleId}/objectives/${objectiveId}/evidence/uploads`,
  evidenceDownload: (cycleId: string, evidenceId: string) =>
    `/performance/cycles/${cycleId}/evidence/${evidenceId}`,
  reviewRounds: (cycleId: string) => `/performance/cycles/${cycleId}/review-rounds`,
  reviewRound: (roundId: string) => `/performance/review-rounds/${roundId}`,
  reviewRoundPopulation: (roundId: string) => `/performance/review-rounds/${roundId}/population`,
  reviewRoundEligibleReviewers: (roundId: string) => `/performance/review-rounds/${roundId}/eligible-reviewers`,
  reviewRoundLaunch: (roundId: string) => `/performance/review-rounds/${roundId}/launch`,
  reviewRoundStatus: (roundId: string) => `/performance/review-rounds/${roundId}/status`,
  reviewRoundFinalize: (roundId: string) => `/performance/review-rounds/${roundId}/finalize`,
  reviewRoundClose: (roundId: string) => `/performance/review-rounds/${roundId}/close`,
  reviewWork: () => "/performance/reviews/work",
  reviewHistory: () => "/performance/reviews/history",
  review: (reviewId: string) => `/performance/reviews/${reviewId}`,
  selfAssessment: (reviewId: string) => `/performance/reviews/${reviewId}/self-assessment`,
  managerAssessment: (reviewId: string) => `/performance/reviews/${reviewId}/manager-assessment`,
  reviewFinalize: (reviewId: string) => `/performance/reviews/${reviewId}/finalize`,
  reviewClose: (reviewId: string) => `/performance/reviews/${reviewId}/close`,
  calibrationRounds: (cycleId: string) => `/performance/cycles/${cycleId}/calibration`,
  calibration: (roundId: string) => `/performance/review-rounds/${roundId}/calibration`,
  calibrationCandidates: (roundId: string) => `/performance/review-rounds/${roundId}/calibration/facilitator-candidates`,
  calibrationFacilitators: (roundId: string) => `/performance/review-rounds/${roundId}/calibration/facilitators`,
  calibrationSubject: (roundId: string, reviewId: string) =>
    `/performance/review-rounds/${roundId}/calibration/subjects/${reviewId}`,
  calibrationFinalize: (roundId: string) => `/performance/review-rounds/${roundId}/calibration/finalize`,
  calibrationView: (roundId: string, view: "distribution" | "people" | "nine-box" | "finalize-preview" | "changes") =>
    `/performance/review-rounds/${roundId}/calibration/${view}`,
  personSummary: (employeeId: string) => `/performance/people/${employeeId}/summary`,
  acknowledgeStatus: (cycleId: string, objectiveId: string) =>
    `/performance/cycles/${cycleId}/objectives/${objectiveId}/status/acknowledge`,
  addressChangeRequest: (cycleId: string, requestId: string) =>
    `/performance/cycles/${cycleId}/plan/change-requests/${requestId}/address`,
  development: (cycleId: string, employeeId: string) =>
    `/performance/cycles/${cycleId}/people/${employeeId}/development`,
  developmentGoal: (cycleId: string, employeeId: string, goalId: string) =>
    `/performance/cycles/${cycleId}/people/${employeeId}/development/goals/${goalId}`,
} as const;

export const performanceQueryKeys = {
  all: () => ["performance"] as const,
  settings: () => [...performanceQueryKeys.all(), "settings"] as const,
  ratingScale: () => [...performanceQueryKeys.all(), "rating-scale"] as const,
  competencies: () => [...performanceQueryKeys.all(), "competencies"] as const,
  cycle: (id: string) => [...performanceQueryKeys.all(), "cycle", id] as const,
  cycleClosure: (id: string) => [...performanceQueryKeys.all(), "cycle-closure", id] as const,
  workspaceContext: (cycleId?: string | null) =>
    [...performanceQueryKeys.all(), "workspace-context", cycleId ?? "current"] as const,
  overviews: () => [...performanceQueryKeys.all(), "overview"] as const,
  overview: (cycleId?: string | null) =>
    [...performanceQueryKeys.overviews(), cycleId ?? "current"] as const,
  strategy: (cycleId: string) =>
    [...performanceQueryKeys.all(), "strategy", cycleId] as const,
  population: (cycleId: string) =>
    [...performanceQueryKeys.all(), "population", cycleId] as const,
  goals: (cycleId: string) =>
    [...performanceQueryKeys.all(), "goals", cycleId] as const,
  alignmentMap: (cycleId: string) =>
    [...performanceQueryKeys.all(), "alignment-map", cycleId] as const,
  teamObjectiveWorkspace: (cycleId: string, orgUnitId?: string | null) =>
    [
      ...performanceQueryKeys.all(),
      "team-objectives",
      cycleId,
      orgUnitId ?? "own-team",
    ] as const,
  goal: (cycleId: string, objectiveId: string) =>
    [...performanceQueryKeys.all(), "goal", cycleId, objectiveId] as const,
  myPlan: (cycleId: string) =>
    [...performanceQueryKeys.all(), "my-plan", cycleId] as const,
  alignmentTargets: (cycleId: string) =>
    [...performanceQueryKeys.all(), "alignment-targets", cycleId] as const,
  yourPeople: (cycleId: string, query?: YourPeopleQuery) =>
    query
      ? ([...performanceQueryKeys.all(), "your-people", cycleId, query] as const)
      : ([...performanceQueryKeys.all(), "your-people", cycleId] as const),
  teamResults: (cycleId: string) => [...performanceQueryKeys.all(), "team-results", cycleId] as const,
  insights: (cycleId: string, unitId?: string | null) =>
    [...performanceQueryKeys.all(), "insights", cycleId, unitId ?? "all"] as const,
  insightsPeople: (cycleId: string, query: InsightsPeopleQuery) =>
    [...performanceQueryKeys.all(), "insights-people", cycleId, query] as const,
  planDetail: (cycleId: string, planId: string) =>
    [...performanceQueryKeys.all(), "plan", cycleId, planId] as const,
  updateRequests: (cycleId: string, planId: string) =>
    [...performanceQueryKeys.all(), "update-requests", cycleId, planId] as const,
  objectiveProgress: (cycleId: string, objectiveId: string) =>
    [...performanceQueryKeys.all(), "progress", cycleId, objectiveId] as const,
  reviewWork: (cycleId: string) => [...performanceQueryKeys.all(), "review-work", cycleId] as const,
  reviewHistory: (cycleId: string) => [...performanceQueryKeys.all(), "review-history", cycleId] as const,
  reviewRounds: (cycleId: string) => [...performanceQueryKeys.all(), "review-rounds", cycleId] as const,
  reviewRound: (roundId: string) => [...performanceQueryKeys.all(), "review-round", roundId] as const,
  reviewRoundStatus: (roundId: string) => [...performanceQueryKeys.all(), "review-round-status", roundId] as const,
  reviewRoundEligibleReviewers: (roundId: string) => [...performanceQueryKeys.all(), "review-round-reviewers", roundId] as const,
  review: (reviewId: string) => [...performanceQueryKeys.all(), "review", reviewId] as const,
  calibrationRounds: (cycleId: string) => [...performanceQueryKeys.all(), "calibration-rounds", cycleId] as const,
  calibration: (roundId: string) => [...performanceQueryKeys.all(), "calibration", roundId] as const,
  calibrationView: (roundId: string, view: string, filter?: CalibrationFilter) =>
    [...performanceQueryKeys.all(), "calibration", roundId, view, filter ?? {}] as const,
  calibrationSubject: (roundId: string, reviewId: string) =>
    [...performanceQueryKeys.all(), "calibration", roundId, "subject", reviewId] as const,
  calibrationCandidates: (roundId: string) => [...performanceQueryKeys.all(), "calibration-candidates", roundId] as const,
  personSummary: (employeeId: string, cycleId?: string | null) =>
    [...performanceQueryKeys.all(), "person-summary", employeeId, cycleId ?? "default"] as const,
  development: (cycleId: string, employeeId: string) =>
    [...performanceQueryKeys.all(), "development", cycleId, employeeId] as const,
} as const;

/** Performance Cycle & Goals transport. UI state and cache behavior remain feature-owned. */
/** Only the filters that are set travel as query parameters. */
function calibrationParams(filter?: CalibrationFilter): Record<string, string> | undefined {
  if (!filter) return undefined;
  const params: Record<string, string> = {};
  if (filter.unit) params.unit = filter.unit;
  if (filter.manager) params.manager = filter.manager;
  if (filter.flagged) params.flagged = "true";
  if (filter.notDiscussed) params.notDiscussed = "true";
  if (filter.q?.trim()) params.q = filter.q.trim();
  return Object.keys(params).length > 0 ? params : undefined;
}

export function createPerformanceApi(client: ApiClient) {
  return {
    getSettings: (signal?: AbortSignal) =>
      client.get<CycleSettingsDto>(performancePaths.settings(), { signal }),
    updateSettings: (request: Omit<CycleSettingsDto, "nineBoxBands"> & { nineBoxBands?: NineBoxBandsRequest; expectedVersion: number }) =>
      client.put<CycleSettingsDto>(performancePaths.settings(), request),
    ratingScale: (signal?: AbortSignal) => client.get<RatingScaleDto>(performancePaths.ratingScale(), { signal }),
    updateRatingScale: (request: UpdateRatingScaleRequest) =>
      client.put<RatingScaleDto>(performancePaths.ratingScale(), request),
    getCompetencies: (signal?: AbortSignal) => client.get<CompetencyDto[]>(performancePaths.competencies(), { signal }),
    createCompetency: (request: CreateCompetencyRequest) => client.post<CompetencyDto>(performancePaths.competencies(), request),
    updateCompetency: (id: string, request: UpdateCompetencyRequest) => client.put<CompetencyDto>(performancePaths.competency(id), request),
    archiveCompetency: (id: string, request: CompetencyVersionRequest) => client.post<CompetencyDto>(performancePaths.archiveCompetency(id), request),
    deleteCompetency: (id: string, request: CompetencyVersionRequest) => client.delete<boolean>(performancePaths.competency(id), { body: request }),

    /** The detail of one authorized Cycle. */
    getCycle: (id: string, signal?: AbortSignal) =>
      client.get<CycleDetailDto>(performancePaths.cycle(id), { signal }),
    getOverview: (cycleId?: string | null, signal?: AbortSignal) =>
      client.get<OverviewDto>(performancePaths.overview(cycleId), { signal }),
    getWorkspaceContext: (cycleId?: string | null, signal?: AbortSignal) =>
      client.get<WorkspaceContextDto>(performancePaths.context(cycleId), { signal }),
    getReviewRounds: (cycleId: string, signal?: AbortSignal) =>
      client.get<ReviewRoundSummaryDto[]>(performancePaths.reviewRounds(cycleId), { signal }),
    createReviewRound: (cycleId: string, request: CreateReviewRoundRequest) =>
      client.post<ReviewRoundDto>(performancePaths.reviewRounds(cycleId), request),
    getReviewRound: (roundId: string, signal?: AbortSignal) =>
      client.get<ReviewRoundDto>(performancePaths.reviewRound(roundId), { signal }),
    getEligibleReviewers: (roundId: string, signal?: AbortSignal) =>
      client.get<EligibleReviewerDto[]>(performancePaths.reviewRoundEligibleReviewers(roundId), { signal }),
    updateReviewRound: (roundId: string, request: UpdateReviewRoundRequest) =>
      client.put<ReviewRoundDto>(performancePaths.reviewRound(roundId), request),
    getReviewRoundPopulation: (roundId: string, signal?: AbortSignal) =>
      client.get<ReviewRoundSubjectDto[]>(performancePaths.reviewRoundPopulation(roundId), { signal }),
    updateReviewRoundPopulation: (roundId: string, request: UpdateReviewRoundPopulationRequest) =>
      client.put<ReviewRoundSubjectDto[]>(performancePaths.reviewRoundPopulation(roundId), request),
    launchReviewRound: (roundId: string, expectedVersion: number) =>
      client.post<ReviewRoundLaunchDto>(performancePaths.reviewRoundLaunch(roundId), { expectedVersion }),
    getReviewRoundStatus: (roundId: string, signal?: AbortSignal) =>
      client.get<ReviewRoundStatusDto>(performancePaths.reviewRoundStatus(roundId), { signal }),
    finalizeReviewRound: (roundId: string, expectedVersion: number, reviewIds?: string[]) =>
      client.post<ReviewRoundFinalizationDto>(performancePaths.reviewRoundFinalize(roundId), { expectedVersion, reviewIds: reviewIds ?? null }),
    closeReviewRound: (roundId: string, expectedVersion: number) =>
      client.post<ReviewRoundFinalizationDto>(performancePaths.reviewRoundClose(roundId), { expectedVersion }),
    getReviewWork: (cycleId: string, signal?: AbortSignal) =>
      client.get<ReviewWorkItemDto[]>(performancePaths.reviewWork(), { signal, params: { cycleId } }),
    getReviewHistory: (cycleId?: string | null, signal?: AbortSignal) =>
      client.get<ReviewHistoryItemDto[]>(performancePaths.reviewHistory(), { signal, params: cycleId ? { cycleId } : undefined }),
    getReview: (reviewId: string, signal?: AbortSignal) =>
      client.get<PerformanceReviewDto>(performancePaths.review(reviewId), { signal }),
    saveSelfAssessment: (reviewId: string, request: SaveSelfAssessmentRequest) =>
      client.put<PerformanceReviewMutationDto>(performancePaths.selfAssessment(reviewId), request),
    submitSelfAssessment: (reviewId: string, request: SaveSelfAssessmentRequest) =>
      client.post<PerformanceReviewMutationDto>(performancePaths.selfAssessment(reviewId), request),
    saveManagerAssessment: (reviewId: string, request: SaveManagerAssessmentRequest) =>
      client.put<PerformanceReviewMutationDto>(performancePaths.managerAssessment(reviewId), request),
    submitManagerAssessment: (reviewId: string, request: SaveManagerAssessmentRequest) =>
      client.post<PerformanceReviewMutationDto>(performancePaths.managerAssessment(reviewId), request),
    finalizeReview: (reviewId: string, expectedVersion: number) =>
      client.post<ReviewFinalizationDto>(performancePaths.reviewFinalize(reviewId), { expectedVersion }),
    closeReview: (reviewId: string, expectedVersion: number, reason: string) =>
      client.post<PerformanceReviewMutationDto>(performancePaths.reviewClose(reviewId), { expectedVersion, reason }),
    getCalibrationRounds: (cycleId: string, signal?: AbortSignal) =>
      client.get<CalibrationRoundDto[]>(performancePaths.calibrationRounds(cycleId), { signal }),
    getCalibration: (roundId: string, signal?: AbortSignal) =>
      client.get<CalibrationSessionDto>(performancePaths.calibration(roundId), { signal }),
    openCalibration: (roundId: string) =>
      client.post<CalibrationSessionDto>(performancePaths.calibration(roundId), {}),
    getCalibrationCandidates: (roundId: string, signal?: AbortSignal) =>
      client.get<FacilitatorCandidateDto[]>(performancePaths.calibrationCandidates(roundId), { signal }),
    setCalibrationFacilitators: (roundId: string, userIds: string[], expectedVersion: number) =>
      client.put<CalibrationSessionDto>(performancePaths.calibrationFacilitators(roundId), { userIds, expectedVersion }),
    adjustCalibrationSubject: (roundId: string, reviewId: string, request: AdjustCalibrationSubjectRequest) =>
      client.put<CalibrationSubjectDto>(performancePaths.calibrationSubject(roundId, reviewId), request),
    finalizeCalibration: (roundId: string, expectedVersion: number) =>
      client.post<CalibrationSessionDto>(performancePaths.calibrationFinalize(roundId), { expectedVersion }),
    getCalibrationDistribution: (roundId: string, filter?: CalibrationFilter, signal?: AbortSignal) =>
      client.get<CalibrationDistributionViewDto>(performancePaths.calibrationView(roundId, "distribution"), { params: calibrationParams(filter), signal }),
    getCalibrationPeople: (roundId: string, filter?: CalibrationFilter, signal?: AbortSignal) =>
      client.get<CalibrationPeopleViewDto>(performancePaths.calibrationView(roundId, "people"), { params: calibrationParams(filter), signal }),
    getCalibrationNineBox: (roundId: string, filter?: CalibrationFilter, signal?: AbortSignal) =>
      client.get<CalibrationNineBoxViewDto>(performancePaths.calibrationView(roundId, "nine-box"), { params: calibrationParams(filter), signal }),
    getCalibrationSubject: (roundId: string, reviewId: string, signal?: AbortSignal) =>
      client.get<CalibrationSubjectDetailDto>(performancePaths.calibrationSubject(roundId, reviewId), { signal }),
    getCalibrationFinalizePreview: (roundId: string, signal?: AbortSignal) =>
      client.get<CalibrationFinalizePreviewDto>(performancePaths.calibrationView(roundId, "finalize-preview"), { signal }),
    getCalibrationChanges: (roundId: string, filter?: CalibrationFilter, signal?: AbortSignal) =>
      client.get<CalibrationChangesViewDto>(performancePaths.calibrationView(roundId, "changes"), { params: calibrationParams(filter), signal }),
    createCycle: (request: CreateCycleRequest) =>
      client.post<CycleSummaryDto>(performancePaths.createCycle(), request),
    updateCycle: (id: string, request: UpdateCycleRequest) =>
      client.put<CycleSummaryDto>(performancePaths.cycle(id), request),
    activateCycle: (id: string, expectedVersion: number) =>
      client.post<CycleDetailDto>(performancePaths.activate(id), { expectedVersion }),
    cycleClosure: (id: string) => client.get<CycleClosureDto>(performancePaths.closure(id)),
    closeCycle: (id: string, request: CloseCycleRequest, expectedVersion: number) =>
      client.post<CycleDetailDto>(performancePaths.close(id), { ...request, expectedVersion }),
    deleteDraftCycle: (id: string, expectedVersion: number) =>
      client.delete<boolean>(performancePaths.cycle(id), { body: { expectedVersion } }),

    listStrategy: (cycleId: string, signal?: AbortSignal) =>
      client.get<StrategicObjectiveDto[]>(performancePaths.strategy(cycleId), {
        signal,
      }),
    createStrategy: (
      cycleId: string,
      request: CreateStrategicObjectiveRequest
    ) =>
      client.post<StrategicObjectiveDto>(
        performancePaths.strategy(cycleId),
        request
      ),
    updateStrategy: (
      cycleId: string,
      objectiveId: string,
      request: UpdateStrategicObjectiveRequest
    ) =>
      client.put<StrategicObjectiveDto>(
        performancePaths.strategyItem(cycleId, objectiveId),
        request
      ),
    publishStrategy: (cycleId: string, objectiveId: string, expectedVersion: number) =>
      client.post<StrategicObjectiveDto>(
        performancePaths.publishStrategy(cycleId, objectiveId),
        { expectedVersion }
      ),
    archiveStrategy: (cycleId: string, objectiveId: string, expectedVersion: number) => client.post<StrategicObjectiveDto>(performancePaths.archiveStrategy(cycleId, objectiveId), { expectedVersion }),
    deleteStrategy: (cycleId: string, objectiveId: string, expectedVersion: number) =>
      client.delete<boolean>(
        performancePaths.strategyItem(cycleId, objectiveId), { body: { expectedVersion } }
      ),

    getPopulation: (cycleId: string, signal?: AbortSignal) =>
      client.get<PopulationDto>(performancePaths.population(cycleId), {
        signal,
      }),
    setPopulation: (cycleId: string, request: SetPopulationRequest) =>
      client.put<PopulationDto>(performancePaths.population(cycleId), request),
    confirmPopulation: (cycleId: string, expectedVersion: number) =>
      client.post<PopulationDto>(
        performancePaths.confirmPopulation(cycleId),
        { expectedVersion }
      ),

    getGoals: (cycleId: string, signal?: AbortSignal) =>
      client.get<GoalsOverviewDto>(performancePaths.goals(cycleId), { signal }),
    getAlignmentMap: (cycleId: string, signal?: AbortSignal) =>
      client.get<AlignmentMapDto>(performancePaths.alignmentMap(cycleId), { signal }),
    coachObjective: (cycleId: string, request: ObjectiveCoachRequest, signal?: AbortSignal) =>
      client.post<ObjectiveCoachResultDto>(performancePaths.objectiveCoach(cycleId), request, { signal }),
    getGoal: (cycleId: string, objectiveId: string, signal?: AbortSignal) =>
      client.get<GoalDetailDto>(performancePaths.goal(cycleId, objectiveId), {
        signal,
      }),
    getTeamObjectiveWorkspace: (
      cycleId: string,
      orgUnitId?: string | null,
      signal?: AbortSignal
    ) =>
      client.get<TeamObjectiveWorkspaceDto>(
        performancePaths.teamObjectiveWorkspace(cycleId, orgUnitId),
        { signal }
      ),
    createTeamObjective: (
      cycleId: string,
      request: CreateOrganizationalObjectiveRequest
    ) => client.post<GoalDetailDto>(performancePaths.goals(cycleId), request),
    updateGoal: (
      cycleId: string,
      objectiveId: string,
      request: UpdateOrganizationalObjectiveRequest
    ) =>
      client.put<GoalDetailDto>(
        performancePaths.goal(cycleId, objectiveId),
        request
      ),
    alignGoal: (
      cycleId: string,
      objectiveId: string,
      request: AlignObjectiveRequest
    ) =>
      client.post<GoalDetailDto>(
        performancePaths.alignGoal(cycleId, objectiveId),
        request
      ),
    publishGoal: (cycleId: string, objectiveId: string, expectedVersion: number) =>
      client.post<GoalDetailDto>(
        performancePaths.publishGoal(cycleId, objectiveId),
        { expectedVersion }
      ),
    configureGoalContribution: (
      cycleId: string,
      objectiveId: string,
      request: ConfigureContributionRequest
    ) =>
      client.put<GoalDetailDto>(
        performancePaths.goalContribution(cycleId, objectiveId),
        request
      ),
    lockGoalContribution: (cycleId: string, objectiveId: string, expectedVersion: number) =>
      client.post<GoalDetailDto>(
        performancePaths.lockGoalContribution(cycleId, objectiveId),
        { expectedVersion }
      ),
    archiveGoal: (cycleId: string, objectiveId: string, expectedVersion: number) => client.post<GoalDetailDto>(performancePaths.archiveGoal(cycleId, objectiveId), { expectedVersion }),
    deleteGoal: (cycleId: string, objectiveId: string, expectedVersion: number) =>
      client.delete<boolean>(performancePaths.goal(cycleId, objectiveId), { body: { expectedVersion } }),

    // Employee plans (Chunk C)
    getMyPlan: (cycleId: string, signal?: AbortSignal) =>
      client.get<MyPlanStateDto>(performancePaths.myPlan(cycleId), { signal }),
    getAlignmentTargets: (cycleId: string, signal?: AbortSignal) =>
      client.get<AlignmentTargetDto[]>(
        performancePaths.alignmentTargets(cycleId),
        { signal }
      ),
    createMyPlan: (cycleId: string, expectedVersion: number) =>
      client.post<EmployeePlanDto>(performancePaths.myPlan(cycleId), { expectedVersion }),
    addPlanObjective: (cycleId: string, request: AddPlanObjectiveRequest) =>
      client.post<EmployeePlanDto>(
        performancePaths.planObjectives(cycleId),
        request
      ),
    updatePlanObjective: (
      cycleId: string,
      objectiveId: string,
      request: UpdatePlanObjectiveRequest
    ) =>
      client.put<EmployeePlanDto>(
        performancePaths.planObjective(cycleId, objectiveId),
        request
      ),
    removePlanObjective: (cycleId: string, objectiveId: string, expectedVersion: number) =>
      client.delete<EmployeePlanDto>(
        performancePaths.planObjective(cycleId, objectiveId), { body: { expectedVersion } }
      ),
    setPlanWeights: (cycleId: string, request: SetPlanWeightsRequest) =>
      client.put<EmployeePlanDto>(
        performancePaths.planWeights(cycleId),
        request
      ),
    submitPlan: (cycleId: string, expectedVersion: number) =>
      client.post<EmployeePlanDto>(performancePaths.submitPlan(cycleId), { expectedVersion }),
    getYourPeople: (cycleId: string, query: YourPeopleQuery, signal?: AbortSignal) =>
      client.get<YourPeoplePageDto>(performancePaths.yourPeople(cycleId), {
        signal,
        params: { ...query },
      }),
    getTeamResults: (cycleId: string, signal?: AbortSignal) =>
      client.get<TeamResultsDto>(performancePaths.teamResults(cycleId), { signal }),
    getInsights: (cycleId: string, unitId?: string | null, signal?: AbortSignal) =>
      client.get<InsightsDto>(performancePaths.insights(cycleId), { signal, params: { unitId: unitId ?? undefined } }),
    getInsightsPeople: (cycleId: string, query: InsightsPeopleQuery, signal?: AbortSignal) =>
      client.get<InsightsPeoplePageDto>(performancePaths.insightsPeople(cycleId), {
        signal,
        params: {
          metric: query.metric,
          unitId: query.unitId ?? undefined,
          managerId: query.managerId ?? undefined,
          level: query.level ?? undefined,
          page: query.page ?? 1,
          pageSize: query.pageSize ?? 25,
        },
      }),
    getUpdateRequests: (cycleId: string, planId: string, signal?: AbortSignal) =>
      client.get<UpdateRequestDto[]>(performancePaths.updateRequests(cycleId, planId), { signal }),
    requestUpdate: (cycleId: string, planId: string, request: { objectiveId: string | null; note: string | null }) =>
      client.post<UpdateRequestDto>(performancePaths.updateRequests(cycleId, planId), request),
    withdrawUpdateRequest: (requestId: string, expectedVersion: number) =>
      client.post<UpdateRequestDto>(performancePaths.withdrawUpdateRequest(requestId), { expectedVersion }),
    getPlanDetail: (cycleId: string, planId: string, signal?: AbortSignal) =>
      client.get<EmployeePlanDto>(
        performancePaths.planDetail(cycleId, planId),
        { signal }
      ),
    returnPlan: (cycleId: string, planId: string, request: ReturnPlanRequest) =>
      client.post<EmployeePlanDto>(
        performancePaths.returnPlan(cycleId, planId),
        request
      ),
    approvePlan: (cycleId: string, planId: string, expectedVersion: number) =>
      client.post<EmployeePlanDto>(
        performancePaths.approvePlan(cycleId, planId),
        { expectedVersion }
      ),
    exceptionalApprovePlan: (
      cycleId: string,
      planId: string,
      request: ExceptionalApprovePlanRequest
    ) =>
      client.post<EmployeePlanDto>(
        performancePaths.exceptionalApprovePlan(cycleId, planId),
        request
      ),

    // Progress & contribution (Chunk D)
    getObjectiveProgress: (
      cycleId: string,
      objectiveId: string,
      signal?: AbortSignal
    ) =>
      client.get<ObjectiveProgressDto>(
        performancePaths.objectiveProgress(cycleId, objectiveId),
        { signal }
      ),
    getObjectiveProgressHistory: (
      cycleId: string,
      objectiveId: string,
      cursor: string | null,
      limit?: number,
      signal?: AbortSignal
    ) => {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (limit) params.set("limit", String(limit));
      const qs = params.toString();
      const base = performancePaths.objectiveProgressHistory(
        cycleId,
        objectiveId
      );
      return client.get<ProgressHistoryPageDto>(qs ? `${base}?${qs}` : base, {
        signal,
      });
    },
    submitProgress: (
      cycleId: string,
      objectiveId: string,
      request: SubmitProgressRequest
    ) =>
      client.post<ObjectiveProgressDto>(
        performancePaths.objectiveProgress(cycleId, objectiveId),
        request
      ),
    uploadEvidence: (cycleId: string, objectiveId: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return client.post<EvidenceDescriptorDto>(
        performancePaths.evidenceUpload(cycleId, objectiveId),
        form
      );
    },
    evidenceDownloadPath: (cycleId: string, evidenceId: string) =>
      performancePaths.evidenceDownload(cycleId, evidenceId),
    /** Fetches a file-evidence item as a Blob with auth attached — a plain link cannot carry the bearer token. */
    downloadEvidence: (
      cycleId: string,
      evidenceId: string,
      signal?: AbortSignal
    ) =>
      client.get<Blob>(performancePaths.evidenceDownload(cycleId, evidenceId), {
        responseType: "blob",
        signal,
      }),
    getPersonSummary: (employeeId: string, cycleId?: string | null, signal?: AbortSignal) =>
      client.get<PersonPerformanceSummaryDto>(performancePaths.personSummary(employeeId), {
        params: { cycleId },
        signal,
      }),

    // Status, change requests and development (slice 2a)
    acknowledgeObjectiveStatus: (cycleId: string, objectiveId: string, expectedVersion: number) =>
      client.post<GoalDetailDto>(performancePaths.acknowledgeStatus(cycleId, objectiveId), { expectedVersion }),
    addressChangeRequest: (cycleId: string, requestId: string, request: AddressChangeRequestRequest) =>
      client.post<EmployeePlanDto>(performancePaths.addressChangeRequest(cycleId, requestId), request),
    getDevelopmentPlan: (cycleId: string, employeeId: string, signal?: AbortSignal) =>
      client.get<DevelopmentPlanDto>(performancePaths.development(cycleId, employeeId), { signal }),
    addDevelopmentGoal: (cycleId: string, employeeId: string, input: DevelopmentGoalInput) =>
      client.post<DevelopmentPlanDto>(`${performancePaths.development(cycleId, employeeId)}/goals`, input),
    updateDevelopmentGoal: (cycleId: string, employeeId: string, goalId: string, input: DevelopmentGoalInput) =>
      client.put<DevelopmentPlanDto>(performancePaths.developmentGoal(cycleId, employeeId, goalId), input),
    removeDevelopmentGoal: (cycleId: string, employeeId: string, goalId: string, expectedVersion: number) =>
      client.delete<DevelopmentPlanDto>(performancePaths.developmentGoal(cycleId, employeeId, goalId), { body: { expectedVersion } }),
    carryOverDevelopmentGoals: (cycleId: string, employeeId: string, goalIds: string[], expectedVersion: number) =>
      client.post<DevelopmentPlanDto>(`${performancePaths.development(cycleId, employeeId)}/carry-over`, { goalIds, expectedVersion }),
    dismissDevelopmentCarryOver: (cycleId: string, employeeId: string, expectedVersion: number) =>
      client.post<DevelopmentPlanDto>(`${performancePaths.development(cycleId, employeeId)}/carry-over/dismiss`, { expectedVersion }),
  };
}

export type PerformanceApi = ReturnType<typeof createPerformanceApi>;

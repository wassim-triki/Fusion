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
import type { FusionWorkBooking, FusionWorkItem } from "./fusion-attention";
import type { ApiClient } from "./types";

// ── Enumerations (mirror the Performance service contracts) ──────────────────

export type MeasurementMethod =
  | "ManualPercentage"
  | "NumericTarget"
  | "WeightedMilestones";
export type ImprovementDirection = "Increase" | "Decrease";
export type CycleLifecycleState = "Draft" | "Active" | "Closed";
export type ObjectiveLifecycleState = "Draft" | "Published" | "Archived";
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

/** Competencies by job (D-41): Core HR's families with the levels their jobs use, and what each competency asks of each. */
export interface CompetenciesByJobDto {
  families: JobFamilyDto[];
  competencies: CompetencyDto[];
  expectations: CompetencyExpectationDto[];
  canDraft: boolean;
}
export interface JobFamilyDto { id: string; label: string; people: number; levels: JobLevelDto[] }
/** A level, with someone who holds it in this family today (where an expectation lands), when anyone does. */
export interface JobLevelDto { id: string; label: string; people: number; example: { employeeId: string; displayName: string; photoUrl: string | null } | null }
export type ExpectationSource = "Written" | "Drafted" | "File";
export interface CompetencyExpectationDto { competencyId: string; familyId: string; levelId: string; text: string; source: ExpectationSource }
/** Cells of one family to write; an empty text clears the cell. */
export interface SaveCompetencyExpectationsRequest {
  familyId: string;
  cells: { competencyId: string; levelId: string; text: string | null; source: ExpectationSource }[];
}
/** Proposed words, not saved: drafted from the jobs, or read from the company's own file (with how many of `of` cells it filled). */
export interface CompetencyExpectationProposalsDto {
  cells: { competencyId: string; levelId: string; text: string }[];
  fileName: string | null;
  of: number;
  unread: string[];
}

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

/** The year's step, read from what happened and the dates together; it only ever moves forward (D-34). */
export type CyclePhase = "Planning" | "Execution" | "Review" | "ResultsOut";

/** Objectives by the status their owners last set (D-05); never inferred. */
export interface StatusMixDto {
  onTrack: number;
  atRisk: number;
  offTrack: number;
  noStatus: number;
}

// ── The year (B-405 slice 2) ──────────────────────────────────────────────────────────

export type YearStepState = "Done" | "Current" | "Ahead";

export type YearStanding =
  | "notStarted" | "drafting" | "submitted" | "returned"
  | "updated" | "quiet"
  | "selfReview" | "withManager" | "reviewed" | "flagged"
  | "released" | "acknowledged" | "closed";

/** A person in a step of the year: their standing in it and since when. */
export interface YearPersonDto {
  employeeId: string;
  name: string;
  unitName: string | null;
  standing: YearStanding;
  since: string | null;
}

/** The people of one standing inside a step: the count, and faces (all, or the first few for a company). */
export interface YearGroupDto {
  standing: YearStanding;
  count: number;
  people: YearPersonDto[];
}

/** One step of the year on its dates (estimated until it happens), with who is in it at the viewer's reach, by standing. */
export interface YearStepDto {
  phase: CyclePhase;
  start: string;
  end: string;
  estimated: boolean;
  state: YearStepState;
  /** Everyone in the step within the viewer's scope. */
  count: number;
  groups: YearGroupDto[];
}

/** The viewer's own place in the year, with the manager who holds it when it waits on them. */
export interface YearMeDto {
  employeeId: string;
  step: CyclePhase;
  standing: YearStanding;
  since: string | null;
  managerEmployeeId: string | null;
  managerName: string | null;
}

export type YearMoveKind = "closePlanning" | "launchRound" | "release";

/** What moving the year on would do, for whom (D-58): the year's own dry run, shown in place before the move. */
export interface YearMoveDto {
  from: CyclePhase;
  to: CyclePhase;
  kind: YearMoveKind;
  canMove: boolean;
  blocker: "yearNotStarted" | "noDraftRound" | "nothingReady" | null;
  roundId: string | null;
  /** The planning deadline the move would set (closing planning sets it to today). */
  planningDeadline: string | null;
  affected: number;
  people: YearPersonDto[];
  /** A drafted round's own day to open by itself (D-74), and what opens with it. */
  opensOn: string | null;
  opens: YearRoundOpensDto | null;
  /** Releasing results (D-72): who goes out now and how, who waits, and the reviews to release in batches. */
  release: YearReleaseDto | null;
}

/** What releasing does today (D-35): ready as rated now, looked at with their decision; the rest once ready. */
export interface YearReleaseDto {
  asRated: number;
  asRatedFaces: YearPersonDto[];
  lookedAt: YearDecisionDto[];
  toLookAt: number;
  stillWriting: number;
  stillWritingFaces: YearPersonDto[];
  reviewIds: string[];
  roundVersion: number;
  /** What goes out, by the level it goes out with: highest first. */
  mix: YearLevelCountDto[];
}

export interface YearLevelCountDto {
  value: number;
  label: string;
  count: number;
}

/** A flagged review looked at: the manager's level and the one it goes out with. */
export interface YearDecisionDto { employeeId: string; name: string; from: string; to: string; kept: boolean }

/** What a drafted round opens: a self-review each, three peers asked each, managers' reviews, goals graded. */
export interface YearRoundOpensDto {
  people: number;
  peopleFaces: string[];
  peers: number;
  managers: number;
  managerFaces: string[];
  goals: number;
  selfReview: boolean;
  peerInput: boolean;
  selfDue: string | null;
  managerDue: string;
}

/** One manager's reviews in the running round (D-74); on pace when what's written keeps up with the days gone. */
export interface YearReviewerDto {
  employeeId: string;
  name: string;
  unitName: string | null;
  people: number;
  written: number;
  toWrite: number;
  waitingOnSelf: number;
  onPace: boolean;
  writtenPeople: YearPersonDto[];
  toWritePeople: YearPersonDto[];
  waitingPeople: YearPersonDto[];
}

/** The running round as HR follows it from the Year page, managers furthest behind first. */
export interface YearReviewRoundDto {
  roundId: string;
  openedOn: string;
  selfDue: string | null;
  managerDue: string;
  reviewed: number;
  total: number;
  reviewers: YearReviewerDto[];
  /** Flagged reviews waiting on a look in calibration (D-35). */
  toLookAt: number;
  toLookAtFaces: YearPersonDto[];
}

/** The year as one object: its phase, its steps with the people in each, and HR's next move. */
export interface YearDto {
  cycleId: string;
  name: string;
  startDate: string;
  endDate: string;
  today: string;
  state: CycleLifecycleState;
  phase: CyclePhase | null;
  planningClosedOn: string | null;
  scope: "Company" | "Team" | "You";
  total: number;
  steps: YearStepDto[];
  nextMove: YearMoveDto | null;
  me: YearMeDto | null;
  version: number;
  /** The running review round, for administrators while the year is in Review. */
  review: YearReviewRoundDto | null;
}

export interface NudgeResultDto {
  nudged: number;
  skipped: string[];
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
  myPlan: boolean;
  team: boolean;
  reviews: boolean;
  settings: boolean;
  /** A current manager or direct reports in Core HR, or any series. Not cycle-bound. */
  oneOnOnes: boolean;
  /** Everyone with Performance access. Not cycle-bound. */
  feedback: boolean;
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
  /** The day a Draft opens by itself (D-74). */
  opensOn: string | null;
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
  /** The round's version after it, so release can go on in batches. */
  version: number;
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
  /** A competency's expectation at the person's job family and level today, and the next level's (D-41). */
  expectation?: { level: string; text: string } | null;
  nextExpectation?: { level: string; text: string } | null;
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
  /** Present only for calibrators during calibration and for the reviewer and round administrators once decided; never for the subject. */
  calibration: ReviewCalibrationDto | null;
}

/** A calibration decision on the rating: kept or changed, why, and who decided. */
export interface ReviewCalibrationDto {
  decided: boolean;
  originalRating: number;
  calibratedRating: number | null;
  rationale: string | null;
  changedBy: string | null;
  changedAt: string | null;
}

export interface CalibrationLevelDto { value: number; label: string }
export interface CalibrationFaceDto { employeeId: string; name: string }
export interface CalibrationGroupDto { count: number; people: CalibrationFaceDto[] }
export type CalibrationFlagKind = "goals" | "moved" | "ratesHigh" | "ratesLow";
/** Why a review is flagged, as facts the page words and draws (D-70). */
export interface CalibrationFlagDto {
  kind: CalibrationFlagKind;
  grade: number | null;
  managerAverage: number | null;
  managerReviews: number | null;
  everyoneAverage: number | null;
  everyoneReviews: number | null;
  lastRating: number | null;
  lastCycle: string | null;
}
export interface CalibrationDecisionDto { rating: number; kept: boolean; reason: string | null; at: string }
/** A flagged review: who, who reviewed them, the manager's rating and words, why it's flagged, the decision if any. */
export interface CalibrationCardDto {
  reviewId: string;
  employeeId: string;
  name: string;
  jobTitle: string | null;
  reviewerEmployeeId: string;
  reviewerName: string;
  rating: number;
  flag: CalibrationFlagDto;
  words: string | null;
  decision: CalibrationDecisionDto | null;
  version: number;
}
/** A round's calibration by exception (D-35): reviews still being written, ready, to look at, released; the flagged ones. */
export interface CalibrationDto {
  roundId: string;
  cycleId: string;
  roundName: string;
  cycleName: string;
  scale: CalibrationLevelDto[];
  bandLowTop: number;
  bandMidTop: number;
  writing: CalibrationGroupDto;
  ready: CalibrationGroupDto;
  toLookAt: CalibrationGroupDto;
  released: number;
  flagged: CalibrationCardDto[];
  /** The viewer may release results (the year's move). */
  canRelease: boolean;
}
/** One person in the full view (D-71): their rating now, the manager's, and their goals' grade (null without an approved plan). */
export interface CalibrationPersonDto {
  reviewId: string;
  employeeId: string;
  name: string;
  reviewerName: string;
  rating: number;
  originalRating: number;
  grade: number | null;
  flagged: boolean;
  decided: boolean;
  released: boolean;
  version: number;
}
export interface CalibrationSpreadDto { value: number; count: number; lastYear: number }
export interface CalibrationEveryoneDto { people: CalibrationPersonDto[]; spread: CalibrationSpreadDto[]; lastCycleName: string | null }
export interface CalibrationSubjectDto { reviewId: string; rating: number; decision: CalibrationDecisionDto | null; released: boolean; version: number }
/** Keep: the manager's rating, no reason. Change: another level with a reason the manager reads. */
export interface CalibrationDecisionRequest { rating: number; reason: string | null; expectedVersion: number }

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
  /** A goal's grade changed from the measure's (D-38), with `gradeReason`; null keeps the measure's. */
  grade?: number | null;
  gradeReason?: string | null;
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
  /** Null shares what the weighted contributors leave, evenly. */
  weight: number | null;
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
  /** When the current status value began; repeats keep it (D-97). */
  statusSince: string | null;
  /** Whether someone chose planWeight; otherwise it is the goal's even share of what the chosen ones leave (D-40). */
  planWeightIsSet: boolean;
  /** The goal's grade from its measure, 0 to 1 (D-38). */
  grade: number;
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
  /** The plan's grade: its goals' grades weighted by their plan weights (D-38). */
  grade: number;
  /** On a plan resubmitted after a return: the goals added, removed and changed since, for its reviewer. */
  changesSinceReturn: PlanGoalChangeDto[] | null;
}

export interface PlanGoalChangeDto {
  objectiveId: string;
  title: string;
  kind: "added" | "removed" | "changed";
  /** For a changed goal: each field ("title", "measure", "weight") with its value then and now. */
  fields: Array<{ field: "title" | "measure" | "weight"; before: string | null; after: string | null }>;
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
  /** The measure in words. */
  measure: string | null;
  /** The unit a unit goal belongs to. */
  orgUnitId: string | null;
  /** Progress after each update, oldest first; a company goal's is the mean of the goals straight under it. Empty for a personal goal whose history you may not read. */
  line: ProgressPointDto[];
}

/** A goal's progress (0–100) as it stood after an update. */
export interface ProgressPointDto {
  at: string;
  progress: number;
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

/** A goal on the Team page's tree (D-79): whose it is, how it's measured, where it stands. */
export interface TeamYearGoalDto {
  objectiveId: string;
  ownerEmployeeId: string;
  ownerName: string;
  title: string;
  measure: string;
  current: number | null;
  progress: number;
  status: ObjectiveStatus | null;
}

/** One of the manager's goals with the team's goals under it, and the goal it supports in turn. */
export interface TeamYearBranchDto {
  goal: TeamYearGoalDto;
  supports: string | null;
  team: TeamYearGoalDto[];
}

/** One goal of a report's plan as their bar draws it. */
export interface TeamYearPersonGoalDto {
  weight: number;
  progress: number;
  status: ObjectiveStatus | null;
}

/** One report's year: their goals once put forward, the one thing they need from the viewer, their next 1:1. */
export interface TeamYearPersonDto {
  employeeId: string;
  name: string;
  jobTitle: string | null;
  stableEmployeeKey: string;
  photoUrl: string | null;
  planStatus: RosterPlanStatus;
  goals: TeamYearPersonGoalDto[];
  /** The viewer's own Home work item about them, answered the same way. */
  due: FusionWorkItem | null;
  nextOneOnOneAt: string | null;
  /** The latest progress update on any of their goals once the plan runs. */
  lastUpdateAt: string | null;
}

/** The Team page's Performance tab: the manager's goals with the team's under each, then each person's year. */
export interface TeamYearDto {
  cycleId: string;
  branches: TeamYearBranchDto[];
  /** People whose goals support other goals than the manager's. */
  elsewhere: string[];
  people: TeamYearPersonDto[];
}

export type UpdateRequestState = "Open" | "Satisfied" | "Withdrawn" | "Unresolved";

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
  /** A weight someone chose; null shares what the chosen weights leave, evenly (D-40). */
  planWeight: number | null;
}

export type UpdatePlanObjectiveRequest = AddPlanObjectiveRequest;

export interface SetPlanWeightsRequest {
  expectedVersion: number;
  /** A weight per goal; null hands the goal back to its even share. */
  weights: Array<{ objectiveId: string; weight: number | null }>;
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
  plan?: YearPlanInput | null;
}

export interface UpdateCycleRequest {
  expectedVersion: number;
  name: string;
  startDate: string;
  endDate: string;
  planningDeadline: string;
  description?: string | null;
  plan?: YearPlanInput | null;
}

/** When the review opens and results go out, the year's moments, who joins and which company goals stay behind (D-91). */
export interface YearPlanInput {
  reviewOpensOn: string;
  resultsOutOn: string;
  midYearCheckInOn: string | null;
  selfReviewsDueOn: string | null;
  calibrationOn: string | null;
  joinersJoin: boolean;
  droppedCompanyGoalIds: string[];
}

/** A year as set up: its name, dates, the steps' ends and its moments. */
export interface YearPlanDto {
  name: string;
  startDate: string;
  endDate: string;
  planningEndsOn: string;
  reviewOpensOn: string;
  resultsOutOn: string;
  midYearCheckInOn: string | null;
  selfReviewsDueOn: string | null;
  calibrationOn: string | null;
  joinersJoin: boolean;
  droppedCompanyGoalIds: string[];
}

export interface YearSetupPersonDto {
  employeeId: string;
  name: string;
  unitName: string | null;
}

export interface YearSetupGoalDto {
  id: string;
  title: string;
  ownerEmployeeId: string;
  ownerName: string | null;
}

/** Setting up a year: the draft or the year proposed from last year, last year's steps, who's in and what comes along. */
export interface YearSetupDto {
  draftId: string | null;
  draftVersion: number;
  year: YearPlanDto;
  lastYearName: string | null;
  lastYear: YearPlanDto | null;
  lastYearPhase: CyclePhase | null;
  /** "lastYearRunning" while last year's results aren't out and its end hasn't passed. */
  launchBlocker: string | null;
  peopleCount: number;
  people: YearSetupPersonDto[];
  leftOut: YearSetupPersonDto[];
  companyGoals: YearSetupGoalDto[];
  unfinishedGoals: number;
  unfinishedOwners: YearSetupPersonDto[];
}

export interface YearLaunchDto {
  cycleId: string;
  people: number;
  companyGoals: number;
  carriedGoals: number;
  endedCycleId: string | null;
}

/** A measure as written: a numeric one's direction is read from its baseline and target, never chosen. */
export interface MeasurementInput {
  method: MeasurementMethod;
  baseline?: number | null;
  target?: number | null;
  unit?: string | null;
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

// ── Person summary (D-32): one person's performance as the viewer may see it ──

/** The caller's relation to the person, from the most permissive that applies. */
/** Observer: sees plans and check-ins for the person's unit or for everyone; reads the plan on the summary only (B-212). */
export type PersonPerformanceRelation = "Self" | "Manager" | "Reviewer" | "Administrator" | "Other" | "Observer";

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
  /** The objective's record; null when the viewer reads the plan here only (an Observer). */
  href: string | null;
  /** The owner's latest status; null until reported, never assumed on track. */
  status: ObjectiveStatus | null;
  /** An update asked for and not yet given (the person page's Coming up). */
  openRequest?: { requestedByName: string; requestedAt: string } | null;
  /** The goal on its year (B-434): dates, measure, each update's progress oldest first. */
  startDate: string;
  endDate: string;
  measure: string | null;
  current: number | null;
  lastProgressAt: string | null;
  statusSince: string | null;
  line: ProgressPointDto[];
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
  startDate: string;
  endDate: string;
  /** When the plan reached its state: approved, else put forward. */
  planSince: string | null;
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
  reviewerName: string | null;
  acknowledgedAt: string | null;
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
  /** For the person's manager with no 1:1s together yet: times both are free, booked in place. */
  oneOnOneBooking: FusionWorkBooking | null;
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
  lastMeetingAt: string | null;
  /** What's on the next meeting's agenda. */
  waiting: string[];
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
  competenciesByJob: () => "/performance/settings/competencies/by-job",
  competencyExpectations: () => "/performance/settings/competencies/expectations",
  draftCompetencyExpectations: () => "/performance/settings/competencies/expectations/draft",
  readCompetencyExpectations: () => "/performance/settings/competencies/expectations/read",
  createCycle: () => "/performance/cycles",
  cycle: (id: string) => `/performance/cycles/${id}`,
  context: (cycleId?: string | null) =>
    cycleId ? `/performance/context?cycleId=${encodeURIComponent(cycleId)}` : "/performance/context",
  yearSetup: () => "/performance/cycles/setup",
  launch: (id: string) => `/performance/cycles/${id}/launch`,
  year: (id: string) => `/performance/cycles/${id}/year`,
  yearMove: (id: string) => `/performance/cycles/${id}/move-on`,
  nudges: (id: string) => `/performance/cycles/${id}/nudges`,
  strategy: (cycleId: string) => `/performance/cycles/${cycleId}/strategy`,
  strategyItem: (cycleId: string, objectiveId: string) =>
    `/performance/cycles/${cycleId}/strategy/${objectiveId}`,
  archiveStrategy: (cycleId: string, objectiveId: string) => `/performance/cycles/${cycleId}/strategy/${objectiveId}/archive`,
  publishStrategy: (cycleId: string, objectiveId: string) =>
    `/performance/cycles/${cycleId}/strategy/${objectiveId}/publish`,
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
  teamYear: (cycleId: string) => `/performance/cycles/${cycleId}/team/year`,
  answerOffTrack: (cycleId: string, planId: string, answer: "ask-for-update" | "talk-it-over") =>
    `/performance/cycles/${cycleId}/plans/${planId}/attention/${answer}`,
  roundResults: (roundId: string) => `/api/performance/review-rounds/${roundId}/results.csv`,
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
  reviewWork: () => "/performance/reviews/work",
  reviewHistory: () => "/performance/reviews/history",
  review: (reviewId: string) => `/performance/reviews/${reviewId}`,
  selfAssessment: (reviewId: string) => `/performance/reviews/${reviewId}/self-assessment`,
  managerAssessment: (reviewId: string) => `/performance/reviews/${reviewId}/manager-assessment`,
  reviewFinalize: (reviewId: string) => `/performance/reviews/${reviewId}/finalize`,
  reviewClose: (reviewId: string) => `/performance/reviews/${reviewId}/close`,
  calibration: (roundId: string) => `/performance/review-rounds/${roundId}/calibration`,
  calibrationEveryone: (roundId: string) => `/performance/review-rounds/${roundId}/calibration/everyone`,
  calibrationDecision: (roundId: string, reviewId: string) =>
    `/performance/review-rounds/${roundId}/calibration/subjects/${reviewId}/decision`,
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
  competenciesByJob: () => [...performanceQueryKeys.all(), "competencies", "by-job"] as const,
  cycle: (id: string) => [...performanceQueryKeys.all(), "cycle", id] as const,
  yearSetup: () => [...performanceQueryKeys.all(), "year-setup"] as const,
  /** Every year read and preview: what anything that moves someone through the year invalidates. */
  years: () => [...performanceQueryKeys.all(), "year"] as const,
  year: (id: string) => [...performanceQueryKeys.years(), id] as const,
  workspaceContext: (cycleId?: string | null) =>
    [...performanceQueryKeys.all(), "workspace-context", cycleId ?? "current"] as const,
  strategy: (cycleId: string) =>
    [...performanceQueryKeys.all(), "strategy", cycleId] as const,
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
  teamYear: (cycleId: string) => [...performanceQueryKeys.all(), "team-year", cycleId] as const,
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
  calibration: (roundId: string) => [...performanceQueryKeys.all(), "calibration", roundId] as const,
  calibrationEveryone: (roundId: string) => [...performanceQueryKeys.all(), "calibration", roundId, "everyone"] as const,
  personSummary: (employeeId: string, cycleId?: string | null) =>
    [...performanceQueryKeys.all(), "person-summary", employeeId, cycleId ?? "default"] as const,
  development: (cycleId: string, employeeId: string) =>
    [...performanceQueryKeys.all(), "development", cycleId, employeeId] as const,
} as const;

/** Performance Cycle & Goals transport. UI state and cache behavior remain feature-owned. */
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
    getCompetenciesByJob: (signal?: AbortSignal) => client.get<CompetenciesByJobDto>(performancePaths.competenciesByJob(), { signal }),
    saveCompetencyExpectations: (request: SaveCompetencyExpectationsRequest) =>
      client.put<CompetencyExpectationDto[]>(performancePaths.competencyExpectations(), request),
    draftCompetencyExpectations: (familyId: string) =>
      client.post<CompetencyExpectationProposalsDto>(performancePaths.draftCompetencyExpectations(), { familyId }),
    readCompetencyExpectations: (familyId: string, file: File) => {
      const form = new FormData();
      form.append("familyId", familyId);
      form.append("file", file);
      return client.post<CompetencyExpectationProposalsDto>(performancePaths.readCompetencyExpectations(), form);
    },
    deleteCompetency: (id: string, request: CompetencyVersionRequest) => client.delete<boolean>(performancePaths.competency(id), { body: request }),

    /** The detail of one authorized Cycle. */
    getCycle: (id: string, signal?: AbortSignal) =>
      client.get<CycleDetailDto>(performancePaths.cycle(id), { signal }),
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
    getCalibration: (roundId: string, signal?: AbortSignal) =>
      client.get<CalibrationDto>(performancePaths.calibration(roundId), { signal }),
    getCalibrationEveryone: (roundId: string, signal?: AbortSignal) =>
      client.get<CalibrationEveryoneDto>(performancePaths.calibrationEveryone(roundId), { signal }),
    decideCalibration: (roundId: string, reviewId: string, request: CalibrationDecisionRequest) =>
      client.put<CalibrationSubjectDto>(performancePaths.calibrationDecision(roundId, reviewId), request),
    undoCalibrationDecision: (roundId: string, reviewId: string, expectedVersion: number) =>
      client.delete<CalibrationSubjectDto>(performancePaths.calibrationDecision(roundId, reviewId), { params: { expectedVersion: String(expectedVersion) } }),
    createCycle: (request: CreateCycleRequest) =>
      client.post<CycleSummaryDto>(performancePaths.createCycle(), request),
    updateCycle: (id: string, request: UpdateCycleRequest) =>
      client.put<CycleSummaryDto>(performancePaths.cycle(id), request),
    yearSetup: (signal?: AbortSignal) => client.get<YearSetupDto>(performancePaths.yearSetup(), { signal }),
    launchYear: (id: string, expectedVersion: number) =>
      client.post<YearLaunchDto>(performancePaths.launch(id), { expectedVersion }),
    year: (id: string, signal?: AbortSignal) => client.get<YearDto>(performancePaths.year(id), { signal }),
    moveYearOn: (id: string, expectedVersion: number, to: CyclePhase) =>
      client.post<YearDto>(performancePaths.yearMove(id), { expectedVersion, to }),
    /** Nudges named people, or everyone at the caller's reach in these standings. */
    nudge: (id: string, who: { employeeIds?: string[]; standings?: YearStanding[] }) =>
      client.post<NudgeResultDto>(performancePaths.nudges(id), { employeeIds: who.employeeIds ?? [], standings: who.standings ?? [] }),
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
    getTeamYear: (cycleId: string, signal?: AbortSignal) =>
      client.get<TeamYearDto>(performancePaths.teamYear(cycleId), { signal }),
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

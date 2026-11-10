using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Progress;
using EY.HRPlatform.Performance.Domain.Reviews;

namespace EY.HRPlatform.Performance.Models;

// ----- Settings -----

public sealed record CycleSettingsDto(
    MeasurementMethod DefaultMeasurementMethod,
    int SuggestedObjectiveCountMin,
    int SuggestedObjectiveCountMax,
    int PlanningDeadlineOffsetDays,
    PlanAlignmentPolicy PlanAlignmentPolicy,
    bool DefaultSelfAssessmentEnabled,
    bool DefaultObjectiveRatingsEnabled,
    bool DefaultCalibrationEnabled,
    int EvidenceRetentionMonths,
    bool AiAssistanceEnabled)
{
    public uint Version { get; init; }
    public EY.HRPlatform.Performance.Domain.Conversations.OneOnOneCadence DefaultOneOnOneCadence { get; init; }
    public int SelfAssessmentDueDays { get; init; }
    public int PeerInputDueDays { get; init; }
    public int ManagerAssessmentDueDays { get; init; }
    public int AcknowledgementReminderDays { get; init; }
    /// <summary>The nine-box bands in force for the current scale; custom is false while the default applies.</summary>
    public NineBoxBandsDto NineBoxBands { get; init; } = new(2, 3, false);
}

public sealed record NineBoxBandsDto(int LowTop, int MidTop, bool Custom);
/// <summary>Both cut points, or both null to return to the default split.</summary>
public sealed record NineBoxBandsRequest(int? LowTop, int? MidTop);

public sealed record UpdateCycleSettingsRequest(
    MeasurementMethod DefaultMeasurementMethod,
    int SuggestedObjectiveCountMin,
    int SuggestedObjectiveCountMax,
    int PlanningDeadlineOffsetDays,
    PlanAlignmentPolicy PlanAlignmentPolicy)
{
    public int EvidenceRetentionMonths { get; init; } = 36;
    public bool? DefaultSelfAssessmentEnabled { get; init; }
    public bool? DefaultObjectiveRatingsEnabled { get; init; }
    public bool? DefaultCalibrationEnabled { get; init; }
    /// <summary>Omitted keeps the current value, so older clients never switch AI off by accident.</summary>
    public bool? AiAssistanceEnabled { get; init; }
    /// <summary>Omitted keeps the current default cadence for new 1:1 series.</summary>
    public EY.HRPlatform.Performance.Domain.Conversations.OneOnOneCadence? DefaultOneOnOneCadence { get; init; }
    /// <summary>Review due-date defaults in days; omitted keeps the current values. Only rounds created later use them.</summary>
    public int? SelfAssessmentDueDays { get; init; }
    public int? PeerInputDueDays { get; init; }
    public int? ManagerAssessmentDueDays { get; init; }
    public int? AcknowledgementReminderDays { get; init; }
    /// <summary>Omitted keeps the current bands. A session already open keeps the bands it copied.</summary>
    public NineBoxBandsRequest? NineBoxBands { get; init; }

    [System.Text.Json.Serialization.JsonRequired]
    public uint ExpectedVersion { get; init; }
}

public sealed record RatingScaleLevelDto(int Value, string Label, string? Description);
public sealed record RatingScaleDto(int ScaleVersion, IReadOnlyList<RatingScaleLevelDto> Levels)
{
    public uint Version { get; init; }
    /// <summary>Every version, newest first, with the launched review rounds that rated on it.</summary>
    public IReadOnlyList<RatingScaleVersionDto> Versions { get; init; } = [];
}
/// <summary>One version of the scale: when it was saved and the rounds ("FY2026 · Year-end review") that used it.</summary>
public sealed record RatingScaleVersionDto(int Number, DateTime CreatedAt, IReadOnlyList<string> UsedBy);
public sealed record UpdateRatingScaleRequest(IReadOnlyList<RatingScaleLevelDto>? Levels)
{
    [System.Text.Json.Serialization.JsonRequired]
    public uint ExpectedVersion { get; init; }
}

public sealed record CompetencyDto(Guid Id, string Name, string Description, IReadOnlyList<string> Behaviors,
    string State, DateTime? FirstUsedAt, uint Version)
{
    /// <summary>The cycles whose launched review rounds rated this competency, oldest first.</summary>
    public IReadOnlyList<string> UsedIn { get; init; } = [];
}
public sealed record CreateCompetencyRequest(string Name, string Description, IReadOnlyList<string>? Behaviors);
public sealed record UpdateCompetencyRequest([property: System.Text.Json.Serialization.JsonRequired] uint ExpectedVersion,
    string Name, string Description, IReadOnlyList<string>? Behaviors);
public sealed record CompetencyVersionRequest([property: System.Text.Json.Serialization.JsonRequired] uint ExpectedVersion);

public sealed record ReviewQuestionDto(Guid Id, string Text, ReviewQuestionAudience Audience, int SortOrder,
    ReviewQuestionState State, DateTime? FirstUsedAt, uint Version)
{
    /// <summary>How many launched review rounds asked it.</summary>
    public int RoundCount { get; init; }
}
public sealed record CreateReviewQuestionRequest(string Text, ReviewQuestionAudience Audience);
public sealed record UpdateReviewQuestionRequest([property: System.Text.Json.Serialization.JsonRequired] uint ExpectedVersion, string Text);
public sealed record ReviewQuestionVersionRequest([property: System.Text.Json.Serialization.JsonRequired] uint ExpectedVersion);
/// <summary>Every active question of one audience, in its new order.</summary>
public sealed record ReorderReviewQuestionsRequest(ReviewQuestionAudience Audience, IReadOnlyList<Guid> QuestionIds);

// ----- Cycles -----

public sealed record CycleSummaryDto(
    Guid Id,
    string Name,
    string? Description,
    DateOnly StartDate,
    DateOnly EndDate,
    DateOnly PlanningDeadline,
    CycleLifecycleState State,
    DateTime? ActivatedAt)
{
    public uint Version { get; init; }
}

public sealed record CreateCycleRequest(
    string Name,
    DateOnly StartDate,
    DateOnly EndDate,
    DateOnly? PlanningDeadline,
    string? Description = null);

public sealed record UpdateCycleRequest(
    string Name,
    DateOnly StartDate,
    DateOnly EndDate,
    DateOnly PlanningDeadline,
    string? Description = null)
{
    [System.Text.Json.Serialization.JsonRequired]
    public uint ExpectedVersion { get; init; }
}

public sealed record MilestoneStateDto(OperationalMilestone Milestone, bool Reached);

public sealed record LaunchReadinessAreaDto(string Key, string Label, bool Complete, string? Detail);

public sealed record LaunchReadinessDto(
    bool CanActivate,
    IReadOnlyList<LaunchReadinessAreaDto> Areas,
    IReadOnlyList<string> Blockers);

public sealed record CycleDetailDto(
    CycleSummaryDto Cycle,
    LaunchReadinessDto LaunchReadiness,
    IReadOnlyList<MilestoneStateDto> Milestones,
    int PublishedStrategyCount,
    int DraftStrategyCount,
    bool PopulationConfirmed,
    int ConfirmedParticipantCount,
    bool OtherActiveCycleExists)
{
    /// <summary>The Active Cycle's derived operational phase; null unless Active.</summary>
    public CyclePhase? Phase { get; init; }
}

/// <summary>Counts of objectives by the status their owners last set (D-05); never inferred.</summary>
public sealed record StatusMixDto(int OnTrack, int AtRisk, int OffTrack, int NoStatus);

// ── The year (B-405 slice 2, D-34, D-55, D-58) ──────────────────────────────────────────────────

/// <summary>Where a step sits against today.</summary>
public enum YearStepState { Done = 0, Current = 1, Ahead = 2 }

/// <summary>A person in a step of the year: their standing in it and since when.</summary>
public sealed record YearPersonDto(Guid EmployeeId, string Name, string? UnitName, string Standing, DateTime? Since);

/// <summary>The people of one standing inside a step: the count, and faces (all of them, or the first few for a company).</summary>
public sealed record YearGroupDto(string Standing, int Count, IReadOnlyList<YearPersonDto> People);

/// <summary>
/// One step of the year with its dates (estimated until it happens) and who is in it within the viewer's scope, by
/// standing (D-55). <see cref="Count"/> is everyone in the step.
/// </summary>
public sealed record YearStepDto(CyclePhase Phase, DateOnly Start, DateOnly End, bool Estimated, YearStepState State,
    int Count, IReadOnlyList<YearGroupDto> Groups);

/// <summary>The viewer's own place in the year, with the manager who holds it when it waits on them (D-49).</summary>
public sealed record YearMeDto(Guid EmployeeId, CyclePhase Step, string Standing, DateTime? Since, Guid? ManagerEmployeeId, string? ManagerName);

/// <summary>
/// What moving the year on would do: the step it goes to, how (closePlanning, launchRound or release), whether it can
/// happen now and why not, the planning deadline it would set, and who it changes for.
/// </summary>
public sealed record YearMoveDto(CyclePhase From, CyclePhase To, string Kind, bool CanMove, string? Blocker,
    Guid? RoundId, DateOnly? PlanningDeadline, int Affected, IReadOnlyList<YearPersonDto> People);

/// <summary>The year as one object: its phase, its steps with the people in each, and HR's next move.</summary>
public sealed record YearDto(Guid CycleId, string Name, DateOnly StartDate, DateOnly EndDate, DateOnly Today,
    CycleLifecycleState State, CyclePhase? Phase, DateOnly? PlanningClosedOn, string Scope, int Total,
    IReadOnlyList<YearStepDto> Steps, YearMoveDto? NextMove, YearMeDto? Me, uint Version);

public sealed record MoveYearOnRequest([property: System.Text.Json.Serialization.JsonRequired] uint ExpectedVersion, CyclePhase To);

/// <summary>Who to nudge: named people, or everyone at the caller's reach in these standings (a company is more than its faces).</summary>
public sealed record NudgeRequest(IReadOnlyList<Guid>? EmployeeIds, IReadOnlyList<string>? Standings);

/// <summary>Who was nudged and who was skipped (nothing to nudge them about, or out of the caller's reach).</summary>
public sealed record NudgeResultDto(int Nudged, IReadOnlyList<Guid> Skipped);

/// <summary>What closing the Cycle would involve: whether the end is reached and who lacks an approved plan.</summary>
public sealed record CycleClosureDto(
    Guid CycleId,
    uint Version,
    CycleLifecycleState State,
    DateOnly EndDate,
    bool EndReached,
    int ParticipantCount,
    int ApprovedCount,
    IReadOnlyList<ClosureParticipantDto> Unresolved,
    string? EarlyCloseReason,
    int RecordedExceptionCount);

/// <summary>A participant without an approved plan, as closure would record them.</summary>
public sealed record ClosureParticipantDto(
    Guid EmployeeId,
    string DisplayName,
    string? OrgUnitName,
    RosterPlanStatus Standing,
    string? ExceptionReason);

/// <summary>Closes an Active Cycle; reasons are required only when the end is not reached or plans are unresolved.</summary>
public sealed record CloseCycleRequest(
    [property: System.Text.Json.Serialization.JsonRequired] uint ExpectedVersion,
    string? EarlyCloseReason,
    string? ExceptionReason);

// ----- Strategic direction -----

public sealed record MilestoneInput(string Title, decimal Weight, DateOnly? DueDate);

/// <summary>A measure as written: a numeric one's direction is read from its baseline and target, never chosen.</summary>
public sealed record MeasurementInput(
    MeasurementMethod Method,
    decimal? Baseline,
    decimal? Target,
    string? Unit,
    IReadOnlyList<MilestoneInput>? Milestones);

// ----- Objective coach (AI) -----

/// <summary>Which composer the coach serves; it decides the authority and the allowed parents.</summary>
public enum ObjectiveCoachSurface { Plan, Team }

public enum ObjectiveCoachOutcome { Suggested, NothingToSuggest }

/// <summary>The draft as the composer holds it right now. Nothing here is saved.</summary>
public sealed record ObjectiveCoachRequest(
    ObjectiveCoachSurface Surface,
    Guid? OrgUnitId,
    string Title,
    string? Description,
    MeasurementInput? Measurement,
    Guid? ParentObjectiveId);

public sealed record CoachMilestoneDto(string Title, decimal Weight);

/// <summary>A suggested measure. A numeric baseline is present only when the draft stated one.</summary>
public sealed record CoachMeasureDto(
    MeasurementMethod Method,
    decimal? Baseline,
    decimal? Target,
    string? Unit,
    ImprovementDirection? Direction,
    IReadOnlyList<CoachMilestoneDto>? Milestones);

/// <summary>At most one suggestion of each kind; a missing one means AI abstained or the suggestion failed the composer's rules.</summary>
public sealed record ObjectiveCoachResultDto(
    ObjectiveCoachOutcome Outcome,
    string? Title,
    CoachMeasureDto? Measure,
    Guid? ParentObjectiveId);

public sealed record MilestoneDto(Guid Id, string Title, decimal Weight, DateOnly? DueDate, bool IsCompleted);

public sealed record MeasurementDto(
    MeasurementMethod Method,
    decimal? Baseline,
    decimal? Target,
    string? Unit,
    ImprovementDirection? Direction,
    IReadOnlyList<MilestoneDto> Milestones);

public sealed record StrategicObjectiveDto(
    Guid Id,
    string Title,
    string? Description,
    Guid AccountablePersonId,
    string? AccountablePersonName,
    DateOnly StartDate,
    DateOnly EndDate,
    ObjectiveLifecycleState State,
    DateTime? PublishedAt,
    MeasurementDto Measurement)
{
    public uint Version { get; init; }
}

public sealed record CreateStrategicObjectiveRequest(
    string Title,
    string? Description,
    Guid AccountablePersonId,
    DateOnly? StartDate,
    DateOnly? EndDate,
    MeasurementInput Measurement,
    bool Publish = false)
{
    [System.Text.Json.Serialization.JsonRequired]
    public uint ExpectedVersion { get; init; }
}

public sealed record UpdateStrategicObjectiveRequest(
    string Title,
    string? Description,
    Guid AccountablePersonId,
    DateOnly StartDate,
    DateOnly EndDate,
    MeasurementInput Measurement,
    bool Publish = false)
{
    [System.Text.Json.Serialization.JsonRequired]
    public uint ExpectedVersion { get; init; }
}

// ----- Population -----

public sealed record OrgUnitSelectionInput(Guid OrgUnitId, bool IncludeDescendants);

public sealed record ExclusionInput(Guid EmployeeId, string Reason);

public sealed record SetPopulationRequest(
    PopulationMode Mode,
    IReadOnlyList<OrgUnitSelectionInput>? OrgUnitSelections,
    IReadOnlyList<Guid>? Inclusions,
    IReadOnlyList<ExclusionInput>? Exclusions)
{
    [System.Text.Json.Serialization.JsonRequired]
    public uint ExpectedVersion { get; init; }
}

public sealed record ReadinessIssueDto(ReadinessIssueCode Code, string Label, bool IsHard);

public sealed record PopulationCandidateDto(
    Guid EmployeeId,
    string DisplayName,
    string? JobTitle,
    Guid? OrgUnitId,
    string? OrgUnitName,
    Guid? ManagerEmployeeId,
    string? ManagerDisplayName,
    bool ManagerIsActive,
    bool IsActive,
    bool ByExplicitInclusion,
    bool IsExcluded,
    string? ExclusionReason,
    bool IsEligible,
    bool CountsToRoster,
    bool HasValidReviewer,
    IReadOnlyList<ReadinessIssueDto> Issues);

public sealed record PopulationSelectionDto(
    PopulationMode Mode,
    DateOnly EligibilityDate,
    bool IsConfirmed,
    IReadOnlyList<OrgUnitSelectionInput> OrgUnitSelections,
    IReadOnlyList<Guid> Inclusions,
    IReadOnlyList<ExclusionInput> Exclusions)
{
    public uint Version { get; init; }
}

public sealed record PopulationDto(
    PopulationSelectionDto Selection,
    int ReadyCount,
    int NeedsAttentionCount,
    int ExcludedCount,
    int ReviewerReadyCount,
    int ReviewerRequiredCount,
    IReadOnlyList<PopulationCandidateDto> Candidates);

// ----- Organizational goals (Chunk B) -----

/// <summary>A person reference resolved from the Core snapshot for display.</summary>
public sealed record PersonRefDto(Guid Id, string? Name);

/// <summary>
/// One objective in the alignment graph — the shared node shape for the Alignment Map and the
/// List. Carries only what the map needs; full context comes from the detail read model.
/// </summary>
public sealed record GoalNodeDto(
    Guid Id,
    ObjectiveOwnershipScope OwnershipScope,
    string Title,
    ObjectiveLifecycleState State,
    Guid? ParentObjectiveId,
    Guid? OrgUnitId,
    string? OrgUnitName,
    Guid AccountablePersonId,
    string? AccountablePersonName,
    DateOnly StartDate,
    DateOnly EndDate,
    ObjectiveProgressSource ProgressSource,
    string MeasurementSummary,
    bool IsAlignmentBaseline,
    bool IsContributionBaselineLocked,
    decimal ContributionWeightTotal,
    int ChildCount,
    int ContributorCount,
    // This node's contribution weight to its parent, if the parent counts it as a contributor.
    decimal? ContributionToParent,
    // Canonical execution truth. Missing progress remains distinct from a reported 0; calculated
    // objectives contain only their explicitly configured contributors, never every aligned child.
    bool HasProgress,
    decimal DerivedProgress,
    decimal? ProgressCoverage,
    // When this objective was published as direction; null while it is still a Draft.
    DateTime? PublishedAt,
    // Creation and last-edit timestamps — used to show a Draft's "saved" date.
    DateTime CreatedAt,
    DateTime? UpdatedAt)
{
    public uint Version { get; init; }
}

// ----- Alignment map -----

public enum AlignmentMapNodeKind { Company, OrgUnit, Personal }

/// <summary>
/// Personal objectives aligned directly to one direction objective, from plans that were put
/// forward (Submitted or Approved), by owner-reported status. Counts only: no names or ids.
/// <paramref name="Readable"/> is how many of them the viewer may open, and gets as nodes.
/// </summary>
public sealed record PersonalAlignmentDto(int Total, int OnTrack, int AtRisk, int OffTrack, int NoStatus, int Readable);

/// <summary>One map node: published direction (Company, OrgUnit), or a personal objective the viewer may read.</summary>
public sealed record AlignmentMapNodeDto(
    Guid Id,
    AlignmentMapNodeKind Kind,
    Guid? ParentId,
    string Title,
    string? OrgUnitName,
    string? OwnerName,
    bool IsOwn,
    ObjectiveStatus? Status,
    DateTime? StatusSince,
    bool HasProgress,
    decimal Progress,
    PersonalAlignmentDto? Personal,
    string? Measure = null,
    Guid? OrgUnitId = null);

/// <summary>The cycle's published direction as a tree, shaped for the alignment map (D-06, S-15).</summary>
public sealed record AlignmentMapDto(Guid CycleId, IReadOnlyList<AlignmentMapNodeDto> Nodes);

/// <summary>The whole cycle's objective graph plus operational counts for the Goals area.</summary>
public sealed record GoalsOverviewDto(
    Guid CycleId,
    string CycleName,
    CycleLifecycleState CycleState,
    DateOnly CycleStart,
    DateOnly CycleEnd,
    int StrategicCount,
    int OrganizationalCount,
    int PublishedCount,
    int DraftCount,
    IReadOnlyList<GoalNodeDto> Nodes);

public sealed record ContributionLinkDto(
    Guid ChildObjectiveId,
    string ChildTitle,
    ObjectiveLifecycleState ChildState,
    decimal Weight);

public sealed record AlignedPlanObjectiveDto(
    Guid ObjectiveId,
    string Title,
    string? OwnerName,
    PlanLifecycleState PlanState,
    decimal? Progress);

/// <summary>The full context surface for one objective — summary, alignment, contribution.</summary>
public sealed record GoalDetailDto(
    GoalNodeDto Node,
    string? Description,
    PersonRefDto Accountable,
    GoalNodeDto? Parent,
    IReadOnlyList<GoalNodeDto> Children,
    MeasurementDto? Measurement,
    IReadOnlyList<ContributionLinkDto> Contribution,
    // What the current caller may do on this objective, resolved server-side (hide, don't deny).
    bool CanEdit,
    bool CanPublish,
    bool CanConfigureContribution,
    // The Cycle this objective belongs to — an objective is addressed by (cycle, objective), never by
    // whichever Cycle happens to be current.
    Guid CycleId,
    // Set for an Employee objective: the plan it belongs to and its weight within it.
    GoalPlanFacetDto? Plan,
    bool CanDelete,
    bool CanUpdateProgress,
    // Named progress detail (history, evidence) — stricter than reading the objective itself.
    bool CanReadProgressHistory)
{
    public bool CanArchive { get; init; }
    public DateTime? ArchivedAt { get; init; }
    public IReadOnlyList<AlignedPlanObjectiveDto> AlignedPlanObjectives { get; init; } = [];
    public ObjectiveStatusDto? Status { get; init; }
    public bool CanAcknowledgeStatus { get; init; }
    /// <summary>The viewer can give the objective's owner feedback about it (they aren't the owner).</summary>
    public bool CanGiveFeedback { get; init; }
    /// <summary>The viewer owns the objective and can ask colleagues for feedback on it.</summary>
    public bool CanAskForFeedback { get; init; }
}

/// <summary>
/// The owner's latest reported status with its reason (the note of that check-in), and the responsible
/// reviewer's acknowledgement of a risky one. Present only for viewers of named progress detail.
/// </summary>
public sealed record ObjectiveStatusDto(
    ObjectiveStatus Value,
    string? Reason,
    DateTime ReportedAt,
    DateTime Since,
    DateTime? AcknowledgedAt,
    PersonRefDto? AcknowledgedBy);

/// <summary>The plan an Employee objective belongs to, as seen from the objective.</summary>
public sealed record GoalPlanFacetDto(
    Guid PlanId,
    PlanLifecycleState PlanState,
    decimal? PlanWeight,
    PersonRefDto Owner,
    // The viewer is this Approved plan's responsible reviewer in an open Cycle, so may ask for an update.
    bool CanRequestUpdate = false);

public sealed record CreateOrganizationalObjectiveRequest(
    Guid? OrgUnitId,
    string? OrgUnitName,
    string Title,
    string? Description,
    Guid AccountablePersonId,
    Guid? ParentObjectiveId,
    DateOnly? StartDate,
    DateOnly? EndDate,
    ObjectiveProgressSource ProgressSource,
    MeasurementInput? Measurement)
{
    [System.Text.Json.Serialization.JsonRequired]
    public uint ExpectedVersion { get; init; }
}

public sealed record UpdateOrganizationalObjectiveRequest(
    string Title,
    string? Description,
    Guid AccountablePersonId,
    Guid? ParentObjectiveId,
    DateOnly StartDate,
    DateOnly EndDate,
    ObjectiveProgressSource ProgressSource,
    MeasurementInput? Measurement)
{
    [System.Text.Json.Serialization.JsonRequired]
    public uint ExpectedVersion { get; init; }
}

public sealed record AlignObjectiveRequest(Guid? ParentObjectiveId)
{
    [System.Text.Json.Serialization.JsonRequired]
    public uint ExpectedVersion { get; init; }
}

public sealed record TeamObjectiveWorkspaceItemDto(
    GoalNodeDto Node,
    string? Description,
    AlignmentTargetDto? Parent);

public sealed record TeamObjectiveWorkspaceDto(
    Guid OrgUnitId,
    string OrgUnitName,
    IReadOnlyList<TeamObjectiveWorkspaceItemDto> Objectives,
    IReadOnlyList<AlignmentTargetDto> AlignmentTargets,
    IReadOnlyList<PersonRefDto> EligibleOwners,
    bool CanCreate,
    bool CanChooseTeam);

/// <summary>A contributing child, with a weight or null to share what the weighted ones leave (D-40).</summary>
public sealed record ContributionInput(Guid ChildObjectiveId, decimal? Weight);

public sealed record ConfigureContributionRequest(IReadOnlyList<ContributionInput> Contributors)
{
    [System.Text.Json.Serialization.JsonRequired]
    public uint ExpectedVersion { get; init; }
}

// ----- Employee plans (Chunk C) -----

/// <summary>
/// One objective in an employee plan. Carries its plan weight, its measurement, and the upstream
/// direction it aligns to (as readable labels Company › strategic › organizational), so the plan
/// makes alignment understandable without a bare parent id. Standalone role objectives carry no
/// parent and an empty direction path.
/// </summary>
public sealed record PlanObjectiveDto(
    Guid Id,
    string Title,
    string? Description,
    Guid? ParentObjectiveId,
    // Readable upstream direction, top-down (e.g. ["Grow the customer base", "Lift NPS to 60"]). Empty for standalone.
    IReadOnlyList<string> DirectionPath,
    bool IsAligned,
    DateOnly StartDate,
    DateOnly EndDate,
    ObjectiveProgressSource ProgressSource,
    string MeasurementSummary,
    MeasurementDto? Measurement,
    decimal? PlanWeight,
    // Progress (Chunk D) — meaningful once the plan is locked.
    bool HasProgress,
    decimal DerivedProgress,
    // Latest reported measurement values, straight from the domain — the raw current value read the
    // employee sees, distinct from DerivedProgress. Null until a progress event exists.
    decimal? CurrentPercentage,
    decimal? CurrentActual,
    DateTime? LastProgressAt,
    bool CanUpdateProgress)
{
    public uint Version { get; init; }

    /// <summary>The owner's latest reported status; null until the first check-in that carries one.</summary>
    public ObjectiveStatus? Status { get; init; }
    public DateTime? StatusReportedAt { get; init; }

    /// <summary>Whether someone chose <see cref="PlanWeight"/>; otherwise it is the goal's even share (D-40).</summary>
    public bool PlanWeightIsSet { get; init; }

    /// <summary>The goal's grade from its measure, 0.0 to 1.0 (D-38).</summary>
    public decimal Grade { get; init; }
}

/// <summary>Live readiness of a plan for submission — the whole-plan invariants, computed continuously.</summary>
public sealed record PlanReadinessDto(
    int ObjectiveCount,
    decimal WeightTotal,
    // Positive = still to assign, negative = over by that much, 0 = exactly 100%.
    decimal WeightRemaining,
    bool EveryObjectiveHasWeight,
    bool ConnectsToStrategicDirection,
    bool HasStandaloneObjective,
    bool StandaloneAllowed,
    bool CanSubmit,
    IReadOnlyList<string> Blockers)
{
    public PlanAlignmentPolicy AlignmentPolicy { get; init; } = PlanAlignmentPolicy.AtLeastOneConnected;
    public bool EveryObjectiveConnectsToStrategicDirection { get; init; }

    /// <summary>Change requests from the latest return still to address before resubmitting.</summary>
    public int OpenChangeRequests { get; init; }
}

public sealed record PlanDecisionDto(
    PlanDecisionKind Kind,
    Guid ActorEmployeeId,
    string? ActorName,
    string? Feedback,
    DateTime DecidedAt)
{
    /// <summary>The change requests a return carried on specific objectives (D-09); empty for other decisions.</summary>
    public IReadOnlyList<PlanChangeRequestDto> ChangeRequests { get; init; } = [];
}

/// <summary>
/// One change requested on an objective when the plan was returned, with what came of it. ObjectiveChanged says
/// whether the objective was edited after the return; null once the objective has been removed.
/// </summary>
public sealed record PlanChangeRequestDto(
    Guid Id,
    Guid ObjectiveId,
    string ObjectiveTitle,
    string Text,
    PlanChangeRequestState State,
    string? Reply,
    DateTime? AddressedAt,
    bool? ObjectiveChanged);

public sealed record ChangeRequestInput(Guid ObjectiveId, string Text);

public sealed record AddressChangeRequestRequest(string? Reply)
{
    [System.Text.Json.Serialization.JsonRequired]
    public uint ExpectedVersion { get; init; }
}

/// <summary>The full employee-plan surface — objectives, readiness, agreement history, and caller capabilities.</summary>
public sealed record PlanGoalFieldChangeDto(string Field, string? Before, string? After);

/// <summary>A goal added, removed or changed since the plan was returned; `kind` is added, removed or changed.</summary>
public sealed record PlanGoalChangeDto(Guid ObjectiveId, string Title, string Kind, IReadOnlyList<PlanGoalFieldChangeDto> Fields);

public sealed record EmployeePlanDto(
    Guid Id,
    Guid CycleId,
    string CycleName,
    CycleLifecycleState CycleState,
    PersonRefDto Employee,
    string? OrgUnitName,
    PersonRefDto? ResponsibleManager,
    PlanLifecycleState State,
    DateTime? SubmittedAt,
    DateTime LastSavedAt,
    DateTime? ApprovedAt,
    PlanApprovalKind? ApprovalKind,
    bool IsLocked,
    // Derived Plan progress over the locked objectives (Chunk D); labeled Plan progress, never a rating.
    decimal PlanProgress,
    IReadOnlyList<PlanObjectiveDto> Objectives,
    PlanReadinessDto Readiness,
    IReadOnlyList<PlanDecisionDto> History,
    // Caller capabilities, resolved server-side (hide, don't deny).
    bool CanAuthor,
    bool CanSubmit,
    bool CanDecide,
    bool CanApproveExceptionally)
{
    public uint Version { get; init; }
    public bool IsOwner { get; init; }

    /// <summary>The caller is the Approved plan's responsible reviewer in an Active Cycle, so may ask for updates.</summary>
    public bool CanRequestUpdate { get; init; }

    /// <summary>The plan's grade: its goals' grades weighted by their plan weights (D-38).</summary>
    public decimal Grade { get; init; }

    /// <summary>On a plan resubmitted after a return: the goals added, removed and changed since, for its reviewer.</summary>
    public IReadOnlyList<PlanGoalChangeDto>? ChangesSinceReturn { get; init; }

    /// <summary>Why the responsible reviewer holds that responsibility, and as of when.</summary>
    public ReviewerBasis? ResponsibleReviewerBasis { get; init; }
    public DateOnly? ResponsibleReviewerAsOf { get; init; }
}

/// <summary>Whether the caller has a plan in this Cycle yet, and the plan if so. When the caller
/// participates but has not started a plan, <see cref="Preview"/> carries the reviewer and scope
/// drawn from their participant baseline so the not-started surface can name them before authoring.</summary>
public sealed record MyPlanStateDto(
    bool ParticipatesInCycle,
    bool HasPlan,
    EmployeePlanDto? Plan,
    PlanPreviewDto? Preview = null);

/// <summary>The reviewer and scope an employee will plan against, resolved from their participant baseline before a plan exists.</summary>
public sealed record PlanPreviewDto(
    PersonRefDto? Reviewer,
    string? OrgUnitName,
    bool StandaloneAllowed)
{
    public ReviewerBasis? ReviewerBasis { get; init; }
    public DateOnly? ReviewerAsOf { get; init; }
}

/// <summary>One alignable upstream objective an employee objective may connect to (published strategic or approved organizational).</summary>
public sealed record AlignmentTargetDto(
    Guid Id,
    ObjectiveOwnershipScope OwnershipScope,
    string Title,
    string? OrgUnitName,
    Guid AccountablePersonId,
    string? AccountablePersonName,
    DateOnly StartDate,
    DateOnly EndDate,
    // Readable direction path down to and including this objective.
    IReadOnlyList<string> DirectionPath);

/// <summary>
/// The lifecycle position of a roster member's plan as the manager reads it. Combines the plan
/// aggregate's lifecycle with two presentation distinctions the roster needs: a participant with no
/// plan yet (<see cref="NotStarted"/>), and a Draft whose most recent decision was a return, which the
/// employee now owns again (<see cref="ReturnedForChanges"/>). Never a fabricated status — each is
/// derived from real plan state.
/// </summary>
public enum RosterPlanStatus
{
    NotStarted = 0,
    Draft = 1,
    ReturnedForChanges = 2,
    Submitted = 3,
    Approved = 4,
}

/// <summary>
/// The kind of the single most-recent meaningful event on a roster member's plan, so the manager reads
/// a submission date and a progress-update date as the distinct concepts they are. <see cref="None"/>
/// covers a member with no plan. An approved plan not yet reporting reads as <see cref="Approved"/>, and a
/// submission that follows a return reads as <see cref="Resubmitted"/>.
/// </summary>
public enum RosterActivityKind
{
    None = 0,
    DraftUpdated = 1,
    Returned = 2,
    Submitted = 3,
    ProgressUpdated = 4,
    Approved = 5,
    Resubmitted = 6,
}

/// <summary>
/// One row of the manager's people roster for a Cycle — a participant enriched with their plan's real
/// lifecycle, execution facts, latest activity, and the caller's actual action authority. Roster
/// membership (the manager/report relationship) is deliberately distinct from decision authority
/// (<see cref="CanReview"/>): being a report does not by itself grant plan-decision capability.
/// </summary>
public sealed record TeamRosterMemberDto(
    Guid EmployeeId,
    string? EmployeeName,
    string? JobTitle,
    string? OrgUnitName,
    Guid? PlanId,
    RosterPlanStatus Status,
    bool HasProgress,
    decimal PlanProgress,
    // Each objective's share of the plan and its reported progress, in plan order — populated once the
    // plan is Approved, so the roster can show composition, coverage and weighted progress in one shape.
    IReadOnlyList<RosterObjectiveProgressDto> ObjectiveProgress,
    // Objectives on an Approved plan that are incomplete past their end date or an open milestone's due
    // date, counted once per objective (ExecutionFacts) — a fact, never a rating.
    int OverdueObjectiveCount,
    RosterActivityKind ActivityKind,
    DateTime? ActivityAt,
    // CanReview: the strong "Review plan" action — a Submitted plan the caller may actually decide.
    bool CanReview,
    // CanView: the quiet inspection action — an existing plan the caller may open.
    bool CanView,
    // Planning only (Draft, Returned, Submitted): the share of plan weight allocated so far — a scalar,
    // so a private Draft's standing is told without exposing its objectives. Null once Approved.
    decimal? AllocatedWeight = null,
    // Approved only: incomplete objectives with no progress update in the last 30 days of execution (ExecutionFacts).
    int ObjectivesWithoutRecentUpdate = 0,
    // The caller's latest update request on this plan, open or resolved, so the row shows its state.
    RosterUpdateRequestDto? UpdateRequest = null,
    // The caller is this Approved plan's responsible reviewer in an Active Cycle.
    bool CanRequestUpdate = false,
    RosterReviewDto? Review = null,
    // What needs the manager in this phase (see YourPeoplePageDto.Groups) and the phase's facts.
    string? Group = null,
    RosterPhaseFactsDto? Facts = null,
    // Leave they are on, or their next, from Core HR: shown beside the plan, pausing nothing (B-229).
    WorkforceLeaveSnapshot? Leave = null);

/// <summary>Why a person needs their manager during execution: `planWaiting`, `offTrack`, `atRisk`, `noUpdate`, `openRequest` or `notApproved`.</summary>
public sealed record RosterAttentionDto(string Kind, Guid? ObjectiveId, string? ObjectiveTitle, string? Reason, DateTime? Since, int? Days);

public sealed record RosterPlanningFactsDto(int Objectives, int AlignedToTeam);

public sealed record RosterExecutionFactsDto(StatusMixDto Status, RosterAttentionDto? Attention, DateTime? LastUpdateAt);

/// <summary>Peer input of one review: asked and answered, or a proposed list waiting for the manager, or none chosen yet.</summary>
public sealed record RosterPeersDto(bool Enabled, int Asked, int Answered, int Proposed, bool WaitingForYou);

/// <summary>Review facts: the person's self-assessment (`submitted`, `writing`, `notStarted`, `off`), peers, and the manager's own review (`submitted`, `draftSaved`, `notStarted`).</summary>
public sealed record RosterReviewFactsDto(string SelfState, DateTime? SelfSubmittedAt, DateOnly? SelfDue, RosterPeersDto Peers,
    string YourReview, DateTime? YourDraftSavedAt);

/// <summary>A released result: the final level, the manager's own when calibration changed it, acknowledgement and open development goals.</summary>
public sealed record RosterClosedFactsDto(Guid ReviewId, int Level, string Label, int? YourLevel, DateTime? AcknowledgedAt,
    bool AcknowledgedWithComment, int OpenGrowthGoals);

public sealed record RosterPhaseFactsDto(RosterPlanningFactsDto? Planning, RosterExecutionFactsDto? Execution,
    RosterReviewFactsDto? Review, RosterClosedFactsDto? Closed);

public sealed record RosterReviewDto(Guid ReviewId, PerformanceReviewState State, DateOnly? DueDate);

public sealed record RosterUpdateRequestDto(Guid Id, Domain.Plans.UpdateRequestState State, string? ObjectiveTitle,
    DateTime RequestedAt, DateTime? SatisfiedAt, uint Version);

/// <summary>
/// One objective's slice of an approved plan: its plan weight, reported progress (capped at 100), and
/// whether it is aligned to upstream direction — the identity its colour carries on every surface. A
/// milestone objective also carries its milestones (weight + completion, in order) so its slice can be
/// partitioned the way the plan partitions it; other methods carry none.
/// </summary>
public sealed record RosterObjectiveProgressDto(
    decimal Weight,
    decimal Progress,
    bool HasProgress,
    bool IsAligned,
    IReadOnlyList<RosterMilestoneSliceDto> Milestones);

/// <summary>One milestone inside a roster objective slice: its share of the objective and whether it is done.</summary>
public sealed record RosterMilestoneSliceDto(decimal Weight, bool IsCompleted, bool IsOverdue);

/// <summary>The views of Your People; the server filters, orders and pages.</summary>
public enum YourPeopleFilter
{
    All = 0,
    NeedsReview = 1,
    Planning = 2,
    Approved = 3,
    NoProgress = 4,
}

/// <summary>
/// One page of Your People: the people the caller is the recorded responsible reviewer of, action required
/// first. <see cref="TotalCount"/> is everyone before search and filter (what "empty" means);
/// <see cref="MatchCount"/> is what the current view and search match; <see cref="Counts"/> sizes each view.
/// </summary>
public sealed record YourPeoplePageDto(
    Guid CycleId,
    bool HasActiveReviewRound,
    IReadOnlyList<TeamRosterMemberDto> Items,
    int Page,
    int PageSize,
    int MatchCount,
    int TotalCount,
    YourPeopleCountsDto Counts,
    TeamStandingDto Standing,
    // `Planning`, `Execution`, `Review` or `Closed`: which groups and facts the entries carry.
    string Phase = "Planning",
    IReadOnlyList<RosterGroupCountDto>? Groups = null,
    TeamPhaseSummaryDto? Summary = null);

/// <summary>A group of Your People in the order the page shows them, with how many people it holds overall.</summary>
public sealed record RosterGroupCountDto(string Key, int Count);

/// <summary>The header facts of My Team for the phase, over the whole responsibility (unaffected by search and paging).</summary>
public sealed record TeamPhaseSummaryDto(
    StatusMixDto? Status,
    int UpdatedIn30Days,
    int Approved,
    string? RoundName,
    int SelfSubmitted,
    int SelfTotal,
    DateOnly? SelfDue,
    IReadOnlyList<string> PeerListsToApprove,
    int ReviewsSubmitted,
    int ReviewsReady,
    int ReviewsTotal,
    DateOnly? ReviewsDue,
    string? FirstReadyName,
    Guid? FirstReadyReviewId,
    DateTime? ReleasedAt);

public sealed record TeamResultPersonDto(Guid EmployeeId, string Name);
public sealed record TeamResultLevelDto(int Value, string Label, int Count, IReadOnlyList<TeamResultPersonDto> People);
public sealed record TeamCalibrationChangeDto(Guid EmployeeId, string Name, int From, int To);

/// <summary>
/// The released results of the caller's own recorded team in a cycle (D-R2): people per final level, acknowledgement,
/// calibration changes and open development goals. Empty before release; never another team; no averages.
/// </summary>
public sealed record TeamResultsDto(
    Guid CycleId,
    int Released,
    DateTime? ReleasedAt,
    IReadOnlyList<TeamResultLevelDto> Levels,
    int Acknowledged,
    IReadOnlyList<string> NotAcknowledged,
    IReadOnlyList<TeamCalibrationChangeDto> CalibrationChanges,
    int OpenGrowthGoals);

/// <summary>
/// The caller's whole responsibility in this Cycle, unaffected by search or view: plan states as a distribution,
/// then execution attention as counts of people. Facts only; no averaged progress and no health labels.
/// </summary>
public sealed record TeamStandingDto(
    int People, int NotStarted, int Draft, int Returned, int Submitted, int Approved,
    int ApprovedReporting, int PeopleWithOverdue, int PeopleWithoutRecentUpdate, int ActiveLastSevenDays);

public sealed record YourPeopleCountsDto(int NeedsReview, int Planning, int Approved, int NoProgress);


/// <summary>
/// Cycle-wide planning and execution standing for administration: operational counts only. There is
/// deliberately no averaged progress; plans are not comparable enough for an average to mean anything
/// but a misleading organizational score.
/// </summary>
/// <param name="ApprovedReportingCount">Approved plans with at least one progress update.</param>
/// <param name="ApprovedNotReportingCount">Approved plans still without any progress update.</param>
/// <param name="ParticipantsWithOverdueObjectives">Approved plans with at least one overdue objective (ExecutionFacts).</param>
public sealed record CyclePlanSummaryDto(
    Guid CycleId,
    int ParticipantCount,
    int NotStartedCount,
    int DraftCount,
    int ReturnedForChangesCount,
    int SubmittedCount,
    int ApprovedCount,
    int ApprovedReportingCount,
    int ApprovedNotReportingCount,
    int ParticipantsWithOverdueObjectives);

public sealed record AddPlanObjectiveRequest(
    string Title,
    string? Description,
    Guid? ParentObjectiveId,
    DateOnly? StartDate,
    DateOnly? EndDate,
    MeasurementInput Measurement,
    decimal? PlanWeight)
{
    [System.Text.Json.Serialization.JsonRequired]
    public uint ExpectedVersion { get; init; }
}

public sealed record UpdatePlanObjectiveRequest(
    string Title,
    string? Description,
    Guid? ParentObjectiveId,
    DateOnly? StartDate,
    DateOnly? EndDate,
    MeasurementInput Measurement,
    decimal? PlanWeight)
{
    [System.Text.Json.Serialization.JsonRequired]
    public uint ExpectedVersion { get; init; }
}

/// <summary>A weight someone chose, or null to hand the goal back to its even share (D-40).</summary>
public sealed record PlanWeightInput(Guid ObjectiveId, decimal? Weight);

public sealed record SetPlanWeightsRequest(IReadOnlyList<PlanWeightInput> Weights)
{
    [System.Text.Json.Serialization.JsonRequired]
    public uint ExpectedVersion { get; init; }
}

/// <summary>Returning a plan needs a general note, at least one change request on an objective, or both (D-09).</summary>
public sealed record ReturnPlanRequest(string? Feedback, IReadOnlyList<ChangeRequestInput>? ChangeRequests = null)
{
    [System.Text.Json.Serialization.JsonRequired]
    public uint ExpectedVersion { get; init; }
}

/// <summary>What Home sends when a reviewer asks for a change in place: the note that goes back with the plan.</summary>
public sealed record PlanDecisionReasonRequest(string? Reason);

public sealed record ExceptionalApprovePlanRequest(string Reason)
{
    [System.Text.Json.Serialization.JsonRequired]
    public uint ExpectedVersion { get; init; }
}

// ----- Progress & contribution (Chunk D) -----

public sealed record EvidenceDto(
    Guid Id,
    EvidenceKind Kind,
    string? FileName,
    string? ContentType,
    long? SizeBytes,
    string? Url,
    string? ReferenceText,
    // Present only for a File the caller may open; null hides the action when authorization fails.
    string? DownloadPath)
{
    public bool IsRemovedUnderRetention { get; init; }
}

/// <summary>One milestone completed or reopened in a check-in.</summary>
public sealed record ProgressMilestoneChangeDto(Guid MilestoneId, string? Title, bool Completed);

public sealed record ProgressUpdateDto(
    Guid Id,
    ProgressEventKind Kind,
    decimal? Value,
    IReadOnlyList<ProgressMilestoneChangeDto> MilestoneChanges,
    // The owner's status with this check-in; null on check-ins recorded before status existed.
    ObjectiveStatus? Status,
    string? ContextNote,
    bool IsCorrection,
    PersonRefDto Author,
    DateTime RecordedAt,
    IReadOnlyList<EvidenceDto> Evidence,
    // The objective's derived progress immediately after this update, and its signed change from the
    // previous update (the first update's delta is measured from the objective's unstarted 0).
    decimal ResultingProgress,
    decimal DeltaProgress);

/// <summary>One page of an objective's progress history, newest first, with the cursor for the next older page.</summary>
public sealed record ProgressHistoryPageDto(IReadOnlyList<ProgressUpdateDto> Items, string? NextCursor);

public sealed record ProgressMilestoneDto(Guid Id, string Title, decimal Weight, DateOnly? DueDate, bool IsCompleted);

/// <summary>The full progress surface for one objective — current state, measurement, and attributable history.</summary>
public sealed record ObjectiveProgressDto(
    Guid ObjectiveId,
    string Title,
    ObjectiveOwnershipScope OwnershipScope,
    MeasurementMethod Method,
    bool HasProgress,
    decimal DerivedProgress,
    decimal? CurrentPercentage,
    decimal? CurrentActual,
    decimal? Baseline,
    decimal? Target,
    string? Unit,
    ImprovementDirection? Direction,
    IReadOnlyList<ProgressMilestoneDto> Milestones,
    bool CanUpdate,
    IReadOnlyList<ProgressUpdateDto> History,
    // Cursor for the next older page of History; null when the first page already holds all of it.
    string? HistoryNextCursor)
{
    public uint Version { get; init; }

    /// <summary>The owner's latest status, preselected when recording the next check-in.</summary>
    public ObjectiveStatus? CurrentStatus { get; init; }
}

/// <summary>Staged file descriptor returned by the evidence upload, folded into the progress submit.</summary>
public sealed record EvidenceDescriptorDto(Guid UploadId, string FileName, string ContentType, long SizeBytes);

public sealed record EvidenceInput(
    EvidenceKind Kind,
    Guid? UploadId,
    string? FileName,
    string? ContentType,
    long? SizeBytes,
    string? Url,
    string? Label,
    string? ReferenceText);

public sealed record MilestoneChangeInput(Guid MilestoneId, bool Completed);

/// <summary>
/// One progress check-in: the status (required), at most one measurement change matching the objective's
/// method — a percentage, a numeric actual, or the milestones changed together — or none for a status-only
/// check-in, plus the note (the reason when at risk or off track) and evidence.
/// </summary>
public sealed record SubmitProgressRequest(
    decimal? Percentage,
    decimal? NumericActual,
    IReadOnlyList<MilestoneChangeInput>? Milestones,
    ObjectiveStatus? Status,
    string? ContextNote,
    bool IsCorrection,
    IReadOnlyList<EvidenceInput>? Evidence)
{
    [System.Text.Json.Serialization.JsonRequired]
    public uint ExpectedVersion { get; init; }
}

public sealed record ExpectedVersionRequest([property: System.Text.Json.Serialization.JsonRequired] uint ExpectedVersion);

// ----- Workspace context -----

/// <summary>What the caller can do in the selected Cycle, from capabilities plus recorded responsibility.</summary>
public sealed record WorkspaceCapabilitiesDto(
    bool Participates,
    bool IsResponsibleReviewer,
    bool HasReviewWork,
    bool Administers,
    bool PublishesStrategy,
    bool ManagesOrgObjectives,
    bool CanCalibrate,
    bool CanViewOrgDirection,
    bool CanChooseOrganizationScope,
    // Performance AI may run for this tenant now: the tenant switch is on and the provider is up.
    bool AiAssistance);

/// <summary>Which primary destinations the workspace offers the caller in the selected Cycle.</summary>
public sealed record WorkspaceDestinationsDto(
    bool MyPlan,
    bool Team,
    bool Reviews,
    bool Settings)
{
    /// <summary>1:1s: a current Core HR manager or direct reports, or any series. Not cycle-bound.</summary>
    public bool OneOnOnes { get; init; }
    /// <summary>Feedback: everyone with Performance access. Not cycle-bound.</summary>
    public bool Feedback { get; init; }
}

/// <summary>The selected Cycle, the Cycles the caller may switch to, and the workspace composition for them.</summary>
public sealed record WorkspaceContextDto(
    IReadOnlyList<CycleSummaryDto> Cycles,
    CycleSummaryDto? Selected,
    CyclePhase? Phase,
    WorkspaceCapabilitiesDto Capabilities,
    WorkspaceDestinationsDto Destinations);

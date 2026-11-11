using System.Text.Json.Serialization;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Settings;

namespace EY.HRPlatform.Performance.Models;

public sealed record CreateReviewRoundRequest(string Name, DateOnly PeriodStart, DateOnly PeriodEnd);

/// <summary>
/// The whole Draft configuration, saved as each section of the setup page changes. Fields added with peer input,
/// questions and potential are optional: omitted keeps the current value.
/// </summary>
public sealed record UpdateReviewRoundRequest(
    [property: JsonRequired] uint ExpectedVersion,
    string Name,
    DateOnly PeriodStart,
    DateOnly PeriodEnd,
    bool SelfAssessmentEnabled,
    bool ObjectiveRatingsEnabled,
    bool CalibrationEnabled,
    DateOnly? SelfAssessmentDueDate,
    DateOnly? ManagerAssessmentDueDate,
    IReadOnlyList<Guid> CompetencyIds)
{
    public bool? PeerInputEnabled { get; init; }
    public bool? QuestionsEnabled { get; init; }
    public bool? PotentialEnabled { get; init; }
    /// <summary>Null with <see cref="PeerInputDueDateSet"/> follows the default offset again.</summary>
    public DateOnly? PeerInputDueDate { get; init; }
    public bool PeerInputDueDateSet { get; init; }
    /// <summary>Library question ids in order within each audience; omitted keeps the current picks.</summary>
    public IReadOnlyList<Guid>? QuestionIds { get; init; }
    /// <summary>The day the round opens by itself; omitted keeps the current day.</summary>
    public DateOnly? OpensOn { get; init; }
}

public sealed record ReviewRoundSummaryDto(
    Guid Id, Guid CycleId, string Name, DateOnly PeriodStart, DateOnly PeriodEnd,
    ReviewRoundState State, int SubjectCount, int ExcludedCount, uint Version);

public sealed record ReviewRoundSubjectDto(
    Guid ParticipantId, Guid SubjectEmployeeId, string SubjectDisplayName,
    Guid? ReviewerEmployeeId, string? ReviewerDisplayName, ReviewerBasis ReviewerBasis,
    bool IsExcluded, string? ExclusionReason, IReadOnlyList<ReviewReadinessIssueDto> ReadinessIssues);

public sealed record ReviewReadinessIssueDto(string Code, Guid SubjectEmployeeId, Guid? ReviewerEmployeeId);

public sealed record ReviewRoundDto(
    Guid Id, Guid CycleId, string Name, DateOnly PeriodStart, DateOnly PeriodEnd,
    bool SelfAssessmentEnabled, bool ObjectiveRatingsEnabled, bool CalibrationEnabled,
    DateOnly? SelfAssessmentDueDate, DateOnly? ManagerAssessmentDueDate,
    IReadOnlyList<Guid> CompetencyIds, ReviewRoundState State, uint Version,
    IReadOnlyList<ReviewRoundSubjectDto> Subjects)
{
    public bool PeerInputEnabled { get; init; }
    public bool QuestionsEnabled { get; init; }
    public bool PotentialEnabled { get; init; }
    public DateOnly? PeerInputDueDate { get; init; }
    public string CycleName { get; init; } = string.Empty;
    public DateOnly CycleStart { get; init; }
    public DateOnly CycleEnd { get; init; }
    public DateTime? LaunchedAt { get; init; }
    public DateOnly? OpensOn { get; init; }
    /// <summary>The dates each task is due on: computed from today while Draft, fixed at launch.</summary>
    public ReviewRoundScheduleDto Schedule { get; init; } = null!;
    /// <summary>Draft: library picks. Launched: the frozen snapshot.</summary>
    public IReadOnlyList<ReviewRoundQuestionDto> Questions { get; init; } = [];
    /// <summary>Draft only.</summary>
    public ReviewRoundReadinessDto? Readiness { get; init; }
    /// <summary>Active only.</summary>
    public ReviewRoundProgressDto? Progress { get; init; }
    /// <summary>Closed only.</summary>
    public ReviewRoundOutcomeDto? Outcome { get; init; }
    /// <summary>Active and Closed: what launch froze.</summary>
    public ReviewRoundFrozenConfigurationDto? Configuration { get; init; }
    public IReadOnlyList<ReviewRoundActivityDto> Activity { get; init; } = [];
}

/// <summary>One task's due date; <c>FollowsDefault</c> is true while a Draft date is computed from its day offset.</summary>
public sealed record ReviewDueDateDto(DateOnly Date, bool FollowsDefault, int OffsetDays);
public sealed record ReviewRoundScheduleDto(DateOnly LaunchDay, ReviewDueDateDto SelfAssessment, ReviewDueDateDto PeerInput,
    ReviewDueDateDto ManagerAssessment, int AcknowledgementReminderDays);

public sealed record ReviewRoundQuestionDto(Guid Id, Guid QuestionId, ReviewQuestionAudience Audience, int SortOrder, string Text);

/// <summary>What stands between a Draft and launch. <c>RunningRound</c> names the round that blocks it (B-060).</summary>
public sealed record ReviewRoundReadinessDto(bool Ready, int LaunchCount, int SubjectIssueCount,
    IReadOnlyList<string> Issues, RunningReviewRoundDto? RunningRound);
public sealed record RunningReviewRoundDto(Guid Id, string Name, DateTime? LaunchedAt, int ReviewCount,
    int SelfSubmitted, int SelfRequired, int ManagerSubmitted, int ManagerRequired);

public sealed record ReviewStageProgressDto(string Stage, int Done, int Total, DateOnly? DueDate, int Open, int Late,
    int Declined = 0, int ReadyToWrite = 0);
public sealed record ReviewRatioDto(int Done, int Total);
/// <summary>One reviewer's reviews: a "team" for monitoring.</summary>
public sealed record ReviewTeamProgressDto(Guid ReviewerEmployeeId, string ReviewerDisplayName, string? OrgUnitName, int People,
    ReviewRatioDto Self, ReviewRatioDto Peers, ReviewRatioDto Manager);
public sealed record ReviewReminderForecastDto(DateOnly Date, int SelfAssessments, int PeerInputs, int ManagerAssessments);
public sealed record ReviewRoundProgressDto(IReadOnlyList<ReviewStageProgressDto> Stages, IReadOnlyList<ReviewTeamProgressDto> Teams,
    ReviewReminderForecastDto? NextReminder, int ReadyToFinalize, int Finalized, int Closed);

public sealed record ReviewRoundFrozenConfigurationDto(bool SelfAssessment, bool PeerInput, bool ObjectiveRatings, bool Questions,
    bool Potential, bool Calibration, IReadOnlyList<string> Competencies, int RatingScaleVersion);

public sealed record ReviewRoundActivityDto(string Kind, DateTime At, string? ActorName, string Text, string? Detail = null);

public sealed record ReviewRoundOutcomeDto(int Released, int Total, int Acknowledged, int CalibratedChanged, int CalibratedDown,
    int CalibratedUp, IReadOnlyList<ReviewClosedWithoutResultDto> ClosedWithoutResult, IReadOnlyList<ReviewRatingBucketDto> Distribution,
    IReadOnlyList<ReviewPersonRefDto> NotAcknowledged, DateOnly? NextAcknowledgementReminder, DateTime? ReleasedAt);
public sealed record ReviewClosedWithoutResultDto(Guid ReviewId, string SubjectDisplayName, string Reason, DateTime? ClosedAt);
public sealed record ReviewRatingBucketDto(int Value, string Label, int Count);
public sealed record ReviewPersonRefDto(Guid ReviewId, string DisplayName);

public sealed record UpdateReviewRoundPopulationRequest(
    [property: JsonRequired] uint ExpectedVersion,
    IReadOnlyList<ReviewRoundPopulationSubjectRequest> Subjects);

public sealed record ReviewRoundPopulationSubjectRequest(
    Guid ParticipantId, bool IsExcluded, string? ExclusionReason, Guid? ReviewerEmployeeId);

/// <summary>Moves one stage's due date for every open review of an Active round (HR, with a reason).</summary>
public sealed record MoveRoundDueDateRequest([property: JsonRequired] uint ExpectedVersion, ReviewStage Stage, DateOnly DueDate, string Reason);
/// <summary>Moves the current task's due date of one open review (HR, with a reason).</summary>
public sealed record MoveReviewDueDateRequest([property: JsonRequired] uint ExpectedVersion, DateOnly DueDate, string Reason);
public sealed record ReviewDueDateMoveDto(Guid Id, ReviewStage Stage, DateOnly? From, DateOnly To, string Reason, string ActorName,
    DateTime MovedAt, int Affected, Guid? ReviewId, string? SubjectDisplayName);

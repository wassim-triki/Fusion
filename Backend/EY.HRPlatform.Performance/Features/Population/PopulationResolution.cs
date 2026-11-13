using EY.HRPlatform.Performance.Domain.Population;

namespace EY.HRPlatform.Performance.Features.Population;

/// <summary>
/// One resolved population candidate with its readiness. Eligibility is derived from the Core
/// snapshot as-of the Cycle start date — the frontend never computes this.
/// </summary>
public sealed record PopulationCandidate(
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
    IReadOnlyList<ReadinessIssueCode> Issues)
{
    /// <summary>The facts the Leave out rules read (D-104).</summary>
    public string? EmploymentType { get; init; }
    public DateOnly? StartedOn { get; init; }
    public bool OnLeaveOnDayOne { get; init; }
    public DateOnly? LeaveUntil { get; init; }
    public string? PhotoUrl { get; init; }

    /// <summary>The first Leave out rule that catches them, written as stored; null when none does.</summary>
    public string? RuledOutBy { get; init; }

    /// <summary>Why they were brought in by name, though a rule catches them.</summary>
    public string? InclusionReason { get; init; }

    /// <summary>No hard readiness issue — may join the confirmed roster.</summary>
    public bool IsEligible => !Issues.Any(ReadinessIssue.IsHard);

    /// <summary>Counts toward the confirmed roster: eligible, not left out by name, and no rule catches them unless they were brought in.</summary>
    public bool CountsToRoster => IsEligible && !IsExcluded && (RuledOutBy is null || ByExplicitInclusion);

    /// <summary>A valid, active reviewer (accountable manager) resolves for this candidate.</summary>
    public bool HasValidReviewer => !Issues.Any(ReadinessIssue.IsReviewerIssue);
}

/// <summary>The full resolved population for a Cycle: candidates, readiness, and the rule.</summary>
public sealed record PopulationResolution(
    PopulationMode Mode,
    DateOnly EligibilityDate,
    bool IsConfirmed,
    IReadOnlyList<PopulationCandidate> Candidates)
{
    public int ReadyCount => Candidates.Count(candidate => candidate.CountsToRoster);
    public int NeedsAttentionCount => Candidates.Count(candidate => !candidate.IsExcluded && !candidate.IsEligible);
    public int ExcludedCount => Candidates.Count(candidate => candidate.IsExcluded);

    /// <summary>In-scope (non-excluded) candidates with a valid, active reviewer.</summary>
    public int ReviewerReadyCount => Candidates.Count(candidate => !candidate.IsExcluded && candidate.HasValidReviewer);

    /// <summary>In-scope (non-excluded) candidates — the reviewer-coverage denominator.</summary>
    public int ReviewerRequiredCount => Candidates.Count(candidate => !candidate.IsExcluded);

    /// <summary>Candidates whose hard issues are neither resolved nor excluded — block activation.</summary>
    public IReadOnlyList<PopulationCandidate> UnresolvedBlockers
        => Candidates.Where(candidate => !candidate.IsExcluded && !candidate.IsEligible).ToList();
}

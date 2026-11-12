using EY.HRPlatform.Performance.Domain.Common;

namespace EY.HRPlatform.Performance.Domain.Cycles;

/// <summary>
/// A Performance Cycle: the container for one planning-and-progress horizon. Defined by name,
/// dates, and planning deadline (never a hard-coded type). Formal lifecycle Draft → Active →
/// Closed with at most one Active per tenant (enforced by the application + a filtered unique
/// index). Activation freezes an <see cref="ActivationSnapshot"/> and opens planning.
/// </summary>
public sealed class PerformanceCycle : PerformanceAggregate
{
    private PerformanceCycle() { }

    public string Name { get; private set; } = string.Empty;

    /// <summary>Optional free-text context for the horizon. Plain metadata; never gates anything.</summary>
    public string? Description { get; private set; }

    public DateOnly StartDate { get; private set; }
    public DateOnly EndDate { get; private set; }
    public DateOnly PlanningDeadline { get; private set; }
    public CycleLifecycleState State { get; private set; }
    public DateTime? ActivatedAt { get; private set; }
    public DateTime? ClosedAt { get; private set; }

    public ActivationSnapshot? ActivationSnapshot { get; private set; }

    /// <summary>
    /// Marks the filtered-unique "one Active per tenant" slot. Null for Draft/Closed, equal to
    /// TenantId while Active — so the database can enforce single-Active without a race.
    /// </summary>
    public Guid? ActiveTenantSlot { get; private set; }

    public static PerformanceCycle CreateDraft(
        Guid tenantId,
        string name,
        DateOnly startDate,
        DateOnly endDate,
        DateOnly planningDeadline,
        string? description = null)
    {
        if (tenantId == Guid.Empty) throw new ArgumentException("TenantId is required.", nameof(tenantId));
        if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("A Cycle requires a name.", nameof(name));

        ValidateDates(startDate, endDate, planningDeadline);

        return new PerformanceCycle
        {
            TenantId = tenantId,
            Name = name.Trim(),
            Description = NormalizeDescription(description),
            StartDate = startDate,
            EndDate = endDate,
            PlanningDeadline = planningDeadline,
            State = CycleLifecycleState.Draft,
        };
    }

    public void UpdateDraftDetails(string name, DateOnly startDate, DateOnly endDate, DateOnly planningDeadline, string? description = null)
    {
        RequireDraft();
        if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("A Cycle requires a name.", nameof(name));
        ValidateDates(startDate, endDate, planningDeadline);

        Name = name.Trim();
        Description = NormalizeDescription(description);
        StartDate = startDate;
        EndDate = endDate;
        PlanningDeadline = planningDeadline;
        MarkUpdated();
    }

    /// <summary>The day the year's review opens, as planned when it was set up (D-81); the round's own date wins once drafted.</summary>
    public DateOnly? ReviewOpensOn { get; private set; }

    /// <summary>The day results go out, as planned.</summary>
    public DateOnly? ResultsOutOn { get; private set; }

    /// <summary>The year's moments pinned on it as planned (D-91): shown on the year, never gates anything.</summary>
    public DateOnly? MidYearCheckInOn { get; private set; }
    public DateOnly? SelfReviewsDueOn { get; private set; }
    public DateOnly? CalibrationOn { get; private set; }

    /// <summary>Whether people who join during the year come in from their first day, or wait for the next year.</summary>
    public bool JoinersJoin { get; private set; } = true;

    /// <summary>Last year's company goals the setup leaves behind; every other one comes along as a draft.</summary>
    public List<Guid> DroppedCompanyGoalIds { get; private set; } = [];

    /// <summary>
    /// Plans the year's steps and moments while it is a draft: Planning to the deadline, then Execution to the day the
    /// review opens, Review to results out, Results out to the year's end. Each step has at least a day.
    /// </summary>
    public void PlanYear(DateOnly reviewOpensOn, DateOnly resultsOutOn, DateOnly? midYearCheckInOn, DateOnly? selfReviewsDueOn,
        DateOnly? calibrationOn, bool joinersJoin, IEnumerable<Guid> droppedCompanyGoalIds)
    {
        RequireDraft();
        if (reviewOpensOn <= PlanningDeadline)
            throw new ArgumentException("The review opens after planning ends.", nameof(reviewOpensOn));
        if (resultsOutOn <= reviewOpensOn)
            throw new ArgumentException("Results go out after the review opens.", nameof(resultsOutOn));
        if (resultsOutOn > EndDate)
            throw new ArgumentException("Results go out before the year ends.", nameof(resultsOutOn));
        foreach (var (moment, label) in new[] { (midYearCheckInOn, "mid-year check-in"), (selfReviewsDueOn, "self-reviews"), (calibrationOn, "calibration") })
        {
            if (moment is { } on && (on < StartDate || on > EndDate))
                throw new ArgumentException($"The {label} falls inside the year.", nameof(midYearCheckInOn));
        }

        ReviewOpensOn = reviewOpensOn;
        ResultsOutOn = resultsOutOn;
        MidYearCheckInOn = midYearCheckInOn;
        SelfReviewsDueOn = selfReviewsDueOn;
        CalibrationOn = calibrationOn;
        JoinersJoin = joinersJoin;
        DroppedCompanyGoalIds = droppedCompanyGoalIds.Distinct().ToList();
        MarkUpdated();
    }

    /// <summary>Whether the year's steps are planned, so it can launch.</summary>
    public bool IsPlanned => ReviewOpensOn is not null && ResultsOutOn is not null;

    private static string? NormalizeDescription(string? description)
        => string.IsNullOrWhiteSpace(description) ? null : description.Trim();

    /// <summary>Whether the Cycle's own dates form a valid, activatable range.</summary>
    public bool HasValidDates => EndDate > StartDate
        && PlanningDeadline >= StartDate
        && PlanningDeadline <= EndDate;

    /// <summary>
    /// Activates a Draft Cycle, capturing its activation snapshot. The caller is responsible
    /// for the cross-aggregate blockers (no other Active Cycle, published strategy, confirmed
    /// non-empty population); this method enforces the Cycle-local preconditions and the
    /// single-Active database slot.
    /// </summary>
    public void Activate(ActivationSnapshot snapshot)
    {
        RequireDraft();
        ArgumentNullException.ThrowIfNull(snapshot);
        if (!HasValidDates)
            throw new InvalidOperationException("A Cycle with invalid dates cannot be activated.");

        ActivationSnapshot = snapshot;
        State = CycleLifecycleState.Active;
        ActivatedAt = PerformanceClock.UtcNow;
        ActiveTenantSlot = TenantId;
        MarkUpdated();
    }

    /// <summary>The day HR moved the year from Planning to Execution before the deadline (D-34); null when the dates did it.</summary>
    public DateOnly? PlanningClosedOn { get; private set; }

    /// <summary>
    /// Moves the year on from Planning to Execution today: the planning deadline becomes today and the
    /// move is recorded, so the phase reads Execution from this moment and never falls back.
    /// </summary>
    public void ClosePlanning(DateOnly today)
    {
        if (State != CycleLifecycleState.Active)
            throw new InvalidOperationException("Only an Active year can be moved on.");
        if (PlanningClosedOn is not null || today > PlanningDeadline)
            throw new InvalidOperationException("Planning is already over.");
        if (today < StartDate)
            throw new InvalidOperationException("The year has not started.");
        PlanningDeadline = today;
        PlanningClosedOn = today;
        MarkUpdated();
    }

    /// <summary>
    /// Ends the year (D-57): nobody presses Close; it ends when the next year launches, which needs its results out or
    /// its end date passed (the caller reads the phase).
    /// </summary>
    public void Close()
    {
        if (State != CycleLifecycleState.Active)
            throw new InvalidOperationException("Only an Active Cycle can be closed.");

        State = CycleLifecycleState.Closed;
        ClosedAt = PerformanceClock.UtcNow;
        ActiveTenantSlot = null;
        MarkUpdated();
    }

    public bool IsDraft => State == CycleLifecycleState.Draft;
    public bool IsActive => State == CycleLifecycleState.Active;
    public bool IsClosed => State == CycleLifecycleState.Closed;

    private void RequireDraft()
    {
        if (State != CycleLifecycleState.Draft)
            throw new InvalidOperationException("Only a Draft Cycle can be edited or activated.");
    }

    private static void ValidateDates(DateOnly startDate, DateOnly endDate, DateOnly planningDeadline)
    {
        if (endDate <= startDate)
            throw new ArgumentException("A Cycle's end date must be after its start date.", nameof(endDate));
        if (planningDeadline < startDate || planningDeadline > endDate)
            throw new ArgumentException("The planning deadline must fall within the Cycle's dates.", nameof(planningDeadline));
    }
}

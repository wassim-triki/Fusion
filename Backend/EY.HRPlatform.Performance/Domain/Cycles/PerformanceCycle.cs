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

    /// <summary>Why the Cycle was closed before its end date, when it was.</summary>
    public string? EarlyCloseReason { get; private set; }

    /// <summary>
    /// Closes an Active Cycle deliberately. Reaching the end date never closes a Cycle on its own;
    /// closing before it requires a stated reason. Participant-level closure exceptions are the
    /// caller's responsibility because they live on the roster.
    /// </summary>
    public void CloseDeliberately(DateOnly today, string? earlyCloseReason)
    {
        if (State != CycleLifecycleState.Active)
            throw new InvalidOperationException("Only an Active Cycle can be closed.");
        var reason = string.IsNullOrWhiteSpace(earlyCloseReason) ? null : earlyCloseReason.Trim();
        if (today < EndDate && reason is null)
            throw new ArgumentException("Closing before the Cycle's end date requires a reason.", nameof(earlyCloseReason));
        if (reason is { Length: > 1000 })
            throw new ArgumentException("The early-close reason must be 1000 characters or fewer.", nameof(earlyCloseReason));

        EarlyCloseReason = today < EndDate ? reason : null;
        Close();
    }

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

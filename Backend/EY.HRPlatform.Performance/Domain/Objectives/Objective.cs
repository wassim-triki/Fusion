using EY.HRPlatform.Performance.Domain.Progress;
using EY.HRPlatform.Performance.Domain.Common;

namespace EY.HRPlatform.Performance.Domain.Objectives;

/// <summary>
/// The single objective aggregate for all three ownership scopes (product-spec §8). Chunk A
/// creates and publishes <see cref="ObjectiveOwnershipScope.Company"/> strategic objectives;
/// Chunk B adds <see cref="ObjectiveOwnershipScope.OrgUnit"/> organizational objectives — one
/// accountable person, one owning org unit, one-parent alignment, a Draft→Published lifecycle the
/// authorized scope owner drives (no routine parent approval), and a progress source that is either
/// a direct measurement or a calculated roll-up of configured contributing children. Employee-plan
/// objectives (Chunk C) extend the same aggregate.
/// </summary>
public sealed class Objective : PerformanceAggregate
{
    private readonly List<ContributionLink> _contributionLinks = [];

    private Objective() { }

    public Guid CycleId { get; private set; }
    public ObjectiveOwnershipScope OwnershipScope { get; private set; }
    public string Title { get; private set; } = string.Empty;
    public string? Description { get; private set; }

    /// <summary>The single accountable person, referenced by stable Core employee id.</summary>
    public Guid AccountablePersonId { get; private set; }

    /// <summary>The owning organizational unit (organizational objectives only), by stable Core id.</summary>
    public Guid? OrgUnitId { get; private set; }

    /// <summary>Display context for the owning org unit, snapshotted for historical meaning.</summary>
    public string? OrgUnitName { get; private set; }

    /// <summary>The owning employee plan (employee objectives only).</summary>
    public Guid? EmployeePlanId { get; private set; }

    /// <summary>
    /// This objective's weight within its employee plan (employee objectives only), the weight in force: the one someone
    /// chose, or its even share of what the chosen ones leave (D-40). The plan totals 100%.
    /// </summary>
    public decimal? PlanWeight { get; private set; }

    /// <summary>Whether someone chose <see cref="PlanWeight"/>; when not, it is the goal's even share (<see cref="PlanWeights"/>).</summary>
    public bool PlanWeightIsSet { get; private set; }

    /// <summary>The single aligned parent objective. Organizational and employee objectives may be standalone.</summary>
    public Guid? ParentObjectiveId { get; private set; }

    public DateOnly StartDate { get; private set; }
    public DateOnly EndDate { get; private set; }

    public ObjectiveProgressSource ProgressSource { get; private set; }

    /// <summary>The direct measurement — present when <see cref="ProgressSource"/> is Direct, null when Calculated.</summary>
    public ObjectiveMeasurement? Measurement { get; private set; }

    /// <summary>Configured contributing children for a calculated organizational objective.</summary>
    public IReadOnlyList<ContributionLink> ContributionLinks => _contributionLinks;

    /// <summary>Set once a calculated objective's 100% contribution baseline is locked; then read-only.</summary>
    public DateTime? ContributionBaselineLockedAt { get; private set; }

    public ObjectiveLifecycleState State { get; private set; }
    public DateTime? PublishedAt { get; private set; }
    public DateTime? ArchivedAt { get; private set; }

    // ── Progress (Chunk D) — denormalized current state; the append-only ProgressUpdate list is the trail ──

    /// <summary>Latest reported manual completion percentage, when the method is ManualPercentage.</summary>
    public decimal? CurrentPercentage { get; private set; }

    /// <summary>Latest reported numeric current actual, when the method is NumericTarget.</summary>
    public decimal? CurrentActual { get; private set; }

    /// <summary>When progress was last recorded; null means never reported (missing, not 0%).</summary>
    public DateTime? LastProgressAt { get; private set; }

    /// <summary>Whether any progress has ever been reported (distinguishes missing from a reported 0).</summary>
    public bool HasProgress => LastProgressAt is not null;

    /// <summary>The owner's latest reported status (D-05); null until the first check-in that carries one.</summary>
    public ObjectiveStatus? CurrentStatus { get; private set; }

    /// <summary>When the current status value began; repeating the same status leaves it unchanged.</summary>
    public DateTime? StatusSince { get; private set; }

    /// <summary>When a status was last reported, including repeats and status-only check-ins.</summary>
    public DateTime? StatusReportedAt { get; private set; }

    /// <summary>When the plan's responsible reviewer acknowledged the current risky status; cleared when it changes.</summary>
    public DateTime? StatusAcknowledgedAt { get; private set; }
    public Guid? StatusAcknowledgedByEmployeeId { get; private set; }

    /// <summary>An At risk or Off track status the responsible reviewer hasn't acknowledged yet.</summary>
    public bool NeedsStatusAttention => ObjectiveStatuses.IsRisky(CurrentStatus) && StatusAcknowledgedAt is null;

    /// <summary>The last sign of life: a measurement change or a status report, whichever is later.</summary>
    public DateTime? LastCheckInAt => StatusReportedAt is { } reported && (LastProgressAt is null || reported > LastProgressAt)
        ? reported
        : LastProgressAt;

    /// <summary>The derived progress percentage from current state (may exceed 100%); 0 when never reported.</summary>
    public decimal DerivedProgress => Measurement?.DerivedProgress(CurrentPercentage, CurrentActual) ?? 0m;

    /// <summary>Whether this objective is a published alignment baseline downstream work may align to.</summary>
    public bool IsAlignmentBaseline => State == ObjectiveLifecycleState.Published;

    public bool IsCalculated => ProgressSource == ObjectiveProgressSource.Calculated;
    public bool IsContributionBaselineLocked => ContributionBaselineLockedAt is not null;
    public decimal ContributionWeightTotal => _contributionLinks.Sum(link => link.Weight);

    // ── Strategic (Chunk A) ──────────────────────────────────────────────────

    public static Objective CreateStrategic(
        Guid tenantId,
        Guid cycleId,
        string title,
        string? description,
        Guid accountablePersonId,
        DateOnly startDate,
        DateOnly endDate,
        ObjectiveMeasurement measurement,
        DateOnly cycleStart,
        DateOnly cycleEnd)
    {
        if (tenantId == Guid.Empty) throw new ArgumentException("TenantId is required.", nameof(tenantId));
        if (cycleId == Guid.Empty) throw new ArgumentException("CycleId is required.", nameof(cycleId));
        if (string.IsNullOrWhiteSpace(title)) throw new ArgumentException("A strategic objective requires a title.", nameof(title));
        if (accountablePersonId == Guid.Empty) throw new ArgumentException("A strategic objective requires an accountable person.", nameof(accountablePersonId));
        ArgumentNullException.ThrowIfNull(measurement);

        ValidateDatesWithin(startDate, endDate, cycleStart, cycleEnd, "the Cycle's dates");

        var objective = new Objective
        {
            TenantId = tenantId,
            CycleId = cycleId,
            OwnershipScope = ObjectiveOwnershipScope.Company,
            Title = title.Trim(),
            Description = Normalize(description),
            AccountablePersonId = accountablePersonId,
            StartDate = startDate,
            EndDate = endDate,
            ProgressSource = ObjectiveProgressSource.Direct,
            Measurement = measurement,
            State = ObjectiveLifecycleState.Draft,
        };

        objective.AttachMilestones();
        return objective;
    }

    public void UpdateStrategicDetails(
        string title,
        string? description,
        Guid accountablePersonId,
        DateOnly startDate,
        DateOnly endDate,
        ObjectiveMeasurement measurement,
        DateOnly cycleStart,
        DateOnly cycleEnd)
    {
        if (State != ObjectiveLifecycleState.Draft)
            throw new InvalidOperationException("Only a Draft strategic objective can be edited. A published objective's measurement is fixed.");
        if (string.IsNullOrWhiteSpace(title)) throw new ArgumentException("A strategic objective requires a title.", nameof(title));
        if (accountablePersonId == Guid.Empty) throw new ArgumentException("A strategic objective requires an accountable person.", nameof(accountablePersonId));
        ArgumentNullException.ThrowIfNull(measurement);

        ValidateDatesWithin(startDate, endDate, cycleStart, cycleEnd, "the Cycle's dates");

        Title = title.Trim();
        Description = Normalize(description);
        AccountablePersonId = accountablePersonId;
        StartDate = startDate;
        EndDate = endDate;
        Measurement = measurement;
        AttachMilestones();
        MarkUpdated();
    }

    /// <summary>
    /// Transitions a strategic or organizational objective Draft → Published, making it official
    /// direction available as a downstream alignment baseline. A weighted objective must total 100%
    /// first; a calculated organizational objective may publish its business definition before its
    /// contribution structure is complete (contribution config is a separate parent responsibility).
    /// </summary>
    public void Publish()
    {
        if (OwnershipScope == ObjectiveOwnershipScope.Employee)
            throw new InvalidOperationException("Employee objectives are governed by their plan's lifecycle, not published individually.");
        if (State == ObjectiveLifecycleState.Published)
            return;
        if (State != ObjectiveLifecycleState.Draft)
            throw new InvalidOperationException("Only a Draft objective can be published.");
        if (Measurement is not null && !Measurement.WeightsAreCompleteForLock())
            throw new InvalidOperationException("A weighted-milestones objective's weights must total 100% before it can be published.");

        State = ObjectiveLifecycleState.Published;
        PublishedAt = PerformanceClock.UtcNow;
        MarkUpdated();
    }

    public void Archive()
    {
        if (OwnershipScope == ObjectiveOwnershipScope.Employee)
            throw new InvalidOperationException("Employee objectives are governed through their plan.");
        if (State == ObjectiveLifecycleState.Archived) return;
        if (State != ObjectiveLifecycleState.Published)
            throw new InvalidOperationException("Only a Published objective can be archived.");
        State = ObjectiveLifecycleState.Archived;
        ArchivedAt = PerformanceClock.UtcNow;
        MarkUpdated();
    }

    // ── Organizational (Chunk B) ─────────────────────────────────────────────

    public static Objective CreateOrganizational(
        Guid tenantId,
        Guid cycleId,
        Guid orgUnitId,
        string? orgUnitName,
        string title,
        string? description,
        Guid accountablePersonId,
        Guid? parentObjectiveId,
        DateOnly startDate,
        DateOnly endDate,
        ObjectiveProgressSource progressSource,
        ObjectiveMeasurement? measurement,
        DateOnly? parentStart,
        DateOnly? parentEnd,
        DateOnly cycleStart,
        DateOnly cycleEnd)
    {
        if (tenantId == Guid.Empty) throw new ArgumentException("TenantId is required.", nameof(tenantId));
        if (cycleId == Guid.Empty) throw new ArgumentException("CycleId is required.", nameof(cycleId));
        if (orgUnitId == Guid.Empty) throw new ArgumentException("An organizational objective requires an owning organizational unit.", nameof(orgUnitId));
        if (string.IsNullOrWhiteSpace(title)) throw new ArgumentException("An organizational objective requires a title.", nameof(title));
        if (accountablePersonId == Guid.Empty) throw new ArgumentException("An organizational objective requires an accountable person.", nameof(accountablePersonId));
        if (parentObjectiveId == Guid.Empty) parentObjectiveId = null;

        ValidateDatesWithin(startDate, endDate, cycleStart, cycleEnd, "the Cycle's dates");
        if (parentObjectiveId is not null)
        {
            if (parentStart is null || parentEnd is null)
                throw new ArgumentException("An aligned organizational objective requires its parent's dates.", nameof(parentStart));
            ValidateDatesWithin(startDate, endDate, parentStart.Value, parentEnd.Value, "its parent objective's dates");
        }
        RequireProgressSource(progressSource, measurement);

        var objective = new Objective
        {
            TenantId = tenantId,
            CycleId = cycleId,
            OwnershipScope = ObjectiveOwnershipScope.OrgUnit,
            OrgUnitId = orgUnitId,
            OrgUnitName = Normalize(orgUnitName),
            ParentObjectiveId = parentObjectiveId,
            Title = title.Trim(),
            Description = Normalize(description),
            AccountablePersonId = accountablePersonId,
            StartDate = startDate,
            EndDate = endDate,
            ProgressSource = progressSource,
            Measurement = measurement,
            State = ObjectiveLifecycleState.Draft,
        };

        objective.AttachMilestones();
        return objective;
    }

    public void UpdateOrganizationalDetails(
        string title,
        string? description,
        Guid accountablePersonId,
        Guid? parentObjectiveId,
        DateOnly startDate,
        DateOnly endDate,
        ObjectiveProgressSource progressSource,
        ObjectiveMeasurement? measurement,
        DateOnly? parentStart,
        DateOnly? parentEnd,
        DateOnly cycleStart,
        DateOnly cycleEnd)
    {
        RequireOrganizational();
        if (State != ObjectiveLifecycleState.Draft)
            throw new InvalidOperationException("Only a Draft objective can be edited.");
        if (string.IsNullOrWhiteSpace(title)) throw new ArgumentException("An organizational objective requires a title.", nameof(title));
        if (accountablePersonId == Guid.Empty) throw new ArgumentException("An organizational objective requires an accountable person.", nameof(accountablePersonId));
        if (parentObjectiveId == Guid.Empty) parentObjectiveId = null;

        ValidateDatesWithin(startDate, endDate, cycleStart, cycleEnd, "the Cycle's dates");
        if (parentObjectiveId is not null)
        {
            if (parentStart is null || parentEnd is null)
                throw new ArgumentException("An aligned organizational objective requires its parent's dates.", nameof(parentStart));
            ValidateDatesWithin(startDate, endDate, parentStart.Value, parentEnd.Value, "its parent objective's dates");
        }
        RequireProgressSource(progressSource, measurement);

        Title = title.Trim();
        Description = Normalize(description);
        AccountablePersonId = accountablePersonId;
        ParentObjectiveId = parentObjectiveId;
        StartDate = startDate;
        EndDate = endDate;

        // Switching progress source replaces the other (never both). Moving away from Calculated
        // clears any prepared contribution structure; moving away from Direct drops the measurement.
        if (progressSource != ProgressSource)
        {
            if (progressSource == ObjectiveProgressSource.Direct)
                _contributionLinks.Clear();
        }

        ProgressSource = progressSource;
        Measurement = measurement;
        AttachMilestones();
        MarkUpdated();
    }

    /// <summary>Reassigns the accountable person without changing ownership scope (product-spec §8).</summary>
    public void ReassignAccountablePerson(Guid accountablePersonId)
    {
        RequireOrganizational();
        if (accountablePersonId == Guid.Empty) throw new ArgumentException("An accountable person is required.", nameof(accountablePersonId));
        AccountablePersonId = accountablePersonId;
        MarkUpdated();
    }

    /// <summary>Sets or clears a Draft objective's parent while preserving its definition.</summary>
    public void AlignTo(Guid? parentObjectiveId, DateOnly? parentStart, DateOnly? parentEnd)
    {
        RequireOrganizational();
        if (State != ObjectiveLifecycleState.Draft)
            throw new InvalidOperationException("Alignment can only change while the objective is Draft.");
        if (parentObjectiveId == Guid.Empty) parentObjectiveId = null;
        if (parentObjectiveId == Id) throw new InvalidOperationException("An objective cannot be its own parent.");

        if (parentObjectiveId is not null)
        {
            if (parentStart is null || parentEnd is null)
                throw new ArgumentException("An aligned organizational objective requires its parent's dates.", nameof(parentStart));
            ValidateDatesWithin(StartDate, EndDate, parentStart.Value, parentEnd.Value, "its parent objective's dates");
        }
        ParentObjectiveId = parentObjectiveId;
        MarkUpdated();
    }

    /// <summary>
    /// Configures the contributing children of a calculated objective (product-spec §21). Children given no weight share
    /// what the weighted ones leave, evenly (D-40).
    /// </summary>
    public void ConfigureContribution(IEnumerable<(Guid ChildObjectiveId, decimal? Weight)> links)
    {
        RequireOrganizational();
        if (!IsCalculated)
            throw new InvalidOperationException("Only a calculated objective has a contribution baseline.");
        if (IsContributionBaselineLocked)
            throw new InvalidOperationException("The contribution baseline is locked and cannot be reconfigured.");

        var materialized = links?.ToList() ?? [];
        var childIds = materialized.Select(link => link.ChildObjectiveId).ToList();
        if (childIds.Contains(Id))
            throw new InvalidOperationException("An objective cannot contribute to itself.");
        if (childIds.Distinct().Count() != childIds.Count)
            throw new InvalidOperationException("A child may appear at most once in the contribution set.");

        var shares = new Queue<decimal>(PlanWeights.Shares(100m - materialized.Sum(link => link.Weight ?? 0m),
            materialized.Count(link => link.Weight is null)));
        _contributionLinks.Clear();
        foreach (var link in materialized)
        {
            var contribution = ContributionLink.Create(TenantId, link.ChildObjectiveId, link.Weight ?? shares.Dequeue());
            contribution.AttachTo(Id);
            _contributionLinks.Add(contribution);
        }

        MarkUpdated();
    }

    /// <summary>
    /// Locks the calculation baseline once weights total 100% and every configured child has a
    /// published/locked baseline (that cross-aggregate check is resolved by the caller). Then the
    /// configured contributors and weights become read-only (product-spec §21).
    /// </summary>
    public void LockContributionBaseline(bool allChildrenHavePublishedBaseline)
    {
        RequireOrganizational();
        if (!IsCalculated)
            throw new InvalidOperationException("Only a calculated objective has a contribution baseline.");
        if (IsContributionBaselineLocked)
            return;
        if (_contributionLinks.Count == 0)
            throw new InvalidOperationException("Configure at least one contributing child before locking the baseline.");
        if (ContributionWeightTotal != 100m)
            throw new InvalidOperationException("Contribution weights must total 100% before the calculation baseline can lock.");
        if (!allChildrenHavePublishedBaseline)
            throw new InvalidOperationException("Every contributing child must be published before the calculation baseline can lock.");

        ContributionBaselineLockedAt = PerformanceClock.UtcNow;
        MarkUpdated();
    }

    // ── Employee plan objectives (Chunk C) ───────────────────────────────────

    /// <summary>
    /// Creates one objective inside an employee's plan. Employee objectives are always directly
    /// measured (product-spec §21). An aligned objective carries a parent (a Published strategic or
    /// Approved organizational objective) and must fall within the parent's dates; a standalone role
    /// objective has no parent and is bounded only by the Cycle. The accountable person is the
    /// employee. The plan weight is validated (0, 100] and the whole plan totals 100% before it locks.
    /// </summary>
    public static Objective CreateEmployee(
        Guid tenantId,
        Guid cycleId,
        Guid employeePlanId,
        Guid employeeId,
        string title,
        string? description,
        Guid? parentObjectiveId,
        DateOnly startDate,
        DateOnly endDate,
        ObjectiveMeasurement measurement,
        decimal? planWeight,
        DateOnly? parentStart,
        DateOnly? parentEnd,
        DateOnly cycleStart,
        DateOnly cycleEnd)
    {
        if (tenantId == Guid.Empty) throw new ArgumentException("TenantId is required.", nameof(tenantId));
        if (cycleId == Guid.Empty) throw new ArgumentException("CycleId is required.", nameof(cycleId));
        if (employeePlanId == Guid.Empty) throw new ArgumentException("An employee objective belongs to a plan.", nameof(employeePlanId));
        if (employeeId == Guid.Empty) throw new ArgumentException("An employee objective requires the accountable employee.", nameof(employeeId));
        if (string.IsNullOrWhiteSpace(title)) throw new ArgumentException("An objective requires a title.", nameof(title));
        ArgumentNullException.ThrowIfNull(measurement);

        ValidateDatesWithin(startDate, endDate, cycleStart, cycleEnd, "the Cycle's dates");
        if (parentObjectiveId is not null)
        {
            if (parentStart is null || parentEnd is null)
                throw new ArgumentException("An aligned objective needs its parent's dates.", nameof(parentStart));
            ValidateDatesWithin(startDate, endDate, parentStart.Value, parentEnd.Value, "its aligned objective's dates");
        }
        if (planWeight is decimal chosen) ValidatePlanWeight(chosen);

        var objective = new Objective
        {
            TenantId = tenantId,
            CycleId = cycleId,
            OwnershipScope = ObjectiveOwnershipScope.Employee,
            EmployeePlanId = employeePlanId,
            ParentObjectiveId = parentObjectiveId,
            Title = title.Trim(),
            Description = Normalize(description),
            AccountablePersonId = employeeId,
            StartDate = startDate,
            EndDate = endDate,
            ProgressSource = ObjectiveProgressSource.Direct,
            Measurement = measurement,
            PlanWeight = planWeight ?? 0m,
            PlanWeightIsSet = planWeight is not null,
            State = ObjectiveLifecycleState.Draft,
        };

        objective.AttachMilestones();
        return objective;
    }

    public void UpdateEmployeeDetails(
        string title,
        string? description,
        Guid? parentObjectiveId,
        DateOnly startDate,
        DateOnly endDate,
        ObjectiveMeasurement measurement,
        decimal? planWeight,
        DateOnly? parentStart,
        DateOnly? parentEnd,
        DateOnly cycleStart,
        DateOnly cycleEnd)
    {
        RequireEmployee();
        if (string.IsNullOrWhiteSpace(title)) throw new ArgumentException("An objective requires a title.", nameof(title));
        ArgumentNullException.ThrowIfNull(measurement);

        ValidateDatesWithin(startDate, endDate, cycleStart, cycleEnd, "the Cycle's dates");
        if (parentObjectiveId is not null)
        {
            if (parentStart is null || parentEnd is null)
                throw new ArgumentException("An aligned objective needs its parent's dates.", nameof(parentStart));
            ValidateDatesWithin(startDate, endDate, parentStart.Value, parentEnd.Value, "its aligned objective's dates");
        }
        if (planWeight is decimal chosen) ValidatePlanWeight(chosen);

        Title = title.Trim();
        Description = Normalize(description);
        ParentObjectiveId = parentObjectiveId;
        StartDate = startDate;
        EndDate = endDate;
        Measurement = measurement;
        if (planWeight is decimal set) PlanWeight = set;
        PlanWeightIsSet = planWeight is not null;
        AttachMilestones();
        MarkUpdated();
    }

    /// <summary>Chooses this objective's plan weight, or with null hands it back to the even share (employee objectives only).</summary>
    public void SetPlanWeight(decimal? planWeight)
    {
        RequireEmployee();
        if (planWeight is decimal chosen)
        {
            ValidatePlanWeight(chosen);
            PlanWeight = chosen;
        }
        PlanWeightIsSet = planWeight is not null;
        MarkUpdated();
    }

    /// <summary>Gives an unchosen weight its even share; only <see cref="PlanWeights"/> calls it.</summary>
    internal void ShareWeight(decimal share)
    {
        if (PlanWeightIsSet || PlanWeight == share) return;
        PlanWeight = share;
        MarkUpdated();
    }

    /// <summary>Last year's goal this one carries on (D-57), drawn striped where it shows (D-83).</summary>
    public Guid? CarriedFromObjectiveId { get; private set; }

    /// <summary>
    /// This unfinished employee goal, or this company goal, as a draft in the next year: the same words and measure from
    /// where it stood, over the new year's dates, unaligned and with an even weight until its owner chooses.
    /// </summary>
    public Objective CarryInto(Guid cycleId, Guid? employeePlanId, DateOnly cycleStart, DateOnly cycleEnd)
    {
        if (OwnershipScope == ObjectiveOwnershipScope.OrgUnit)
            throw new InvalidOperationException("A unit's goal is set again under next year's company goals, not carried.");
        if (OwnershipScope == ObjectiveOwnershipScope.Employee && employeePlanId is null)
            throw new ArgumentException("A carried goal lands in its owner's plan.", nameof(employeePlanId));
        var measurement = (Measurement ?? ObjectiveMeasurement.ManualPercentage()).CarriedOn(TenantId, CurrentActual);
        var copy = OwnershipScope == ObjectiveOwnershipScope.Employee
            ? CreateEmployee(TenantId, cycleId, employeePlanId!.Value, AccountablePersonId, Title, Description, null,
                cycleStart, cycleEnd, measurement, null, null, null, cycleStart, cycleEnd)
            : CreateStrategic(TenantId, cycleId, Title, Description, AccountablePersonId, cycleStart, cycleEnd, measurement, cycleStart, cycleEnd);
        copy.CarriedFromObjectiveId = Id;
        return copy;
    }

    /// <summary>Whether this employee objective connects to strategic direction through an aligned parent.</summary>
    public bool IsAligned => ParentObjectiveId is not null;

    // ── Progress recording (Chunk D) ─────────────────────────────────────────

    /// <summary>Records a new manual completion percentage. Whether it decreased is decided by the caller.</summary>
    public void ApplyManualPercentage(decimal value)
    {
        RequireDirectMethod(MeasurementMethod.ManualPercentage);
        if (value is < 0m or > 100m) throw new ArgumentOutOfRangeException(nameof(value), "Enter a percentage between 0 and 100.");
        CurrentPercentage = value;
        LastProgressAt = PerformanceClock.UtcNow;
        MarkUpdated();
    }

    /// <summary>Records a new numeric current actual.</summary>
    public void ApplyNumericActual(decimal actual)
    {
        RequireDirectMethod(MeasurementMethod.NumericTarget);
        CurrentActual = actual;
        LastProgressAt = PerformanceClock.UtcNow;
        MarkUpdated();
    }

    /// <summary>Completes or reopens milestones together (reversible); progress is derived from completed weights.</summary>
    public void ApplyMilestones(IEnumerable<(Guid MilestoneId, bool Completed)> changes)
    {
        RequireDirectMethod(MeasurementMethod.WeightedMilestones);
        foreach (var (milestoneId, completed) in changes)
        {
            if (Measurement is null || !Measurement.ToggleMilestone(milestoneId, completed))
                throw new ArgumentException("That milestone is not part of this objective.", nameof(changes));
        }
        LastProgressAt = PerformanceClock.UtcNow;
        MarkUpdated();
    }

    /// <summary>
    /// Records the owner's reported status. A new value starts a new period and clears any acknowledgement;
    /// repeating the same value only refreshes when it was reported. Returns whether the objective has just
    /// entered At risk or Off track — the transition that asks for the reviewer's attention.
    /// </summary>
    public bool ReportStatus(ObjectiveStatus status, DateTime at)
    {
        if (ProgressSource != ObjectiveProgressSource.Direct)
            throw new InvalidOperationException("A calculated objective takes no status of its own.");
        var changed = CurrentStatus != status;
        if (changed)
        {
            CurrentStatus = status;
            StatusSince = at;
            StatusAcknowledgedAt = null;
            StatusAcknowledgedByEmployeeId = null;
        }
        StatusReportedAt = at;
        MarkUpdated();
        return changed && ObjectiveStatuses.IsRisky(status);
    }

    /// <summary>The responsible reviewer acknowledges the current risky status. False when already acknowledged.</summary>
    public bool AcknowledgeStatus(Guid reviewerEmployeeId, DateTime at)
    {
        if (!ObjectiveStatuses.IsRisky(CurrentStatus))
            throw new InvalidOperationException("Only an objective at risk or off track can be acknowledged.");
        if (StatusAcknowledgedAt is not null) return false;
        StatusAcknowledgedAt = at;
        StatusAcknowledgedByEmployeeId = reviewerEmployeeId;
        MarkUpdated();
        return true;
    }

    private void RequireDirectMethod(MeasurementMethod method)
    {
        if (ProgressSource != ObjectiveProgressSource.Direct || Measurement is null)
            throw new InvalidOperationException("Progress is recorded on a directly measured objective; a calculated objective rolls up from its contributors.");
        if (Measurement.Method != method)
            throw new InvalidOperationException($"This objective is measured by {Measurement.Method}, not {method}.");
    }

    // ── Internals ────────────────────────────────────────────────────────────

    private void RequireEmployee()
    {
        if (OwnershipScope != ObjectiveOwnershipScope.Employee)
            throw new InvalidOperationException("This operation applies to employee objectives only.");
    }

    private static void ValidatePlanWeight(decimal planWeight)
    {
        if (planWeight <= 0m || planWeight > 100m)
            throw new ArgumentOutOfRangeException(nameof(planWeight), "A plan weight must be between 0 and 100.");
    }

    /// <summary>
    /// Binds the measurement's milestones to this objective once its dates are settled, so a milestone's
    /// optional due date is checked against the window it belongs to — every create and update path
    /// passes through here.
    /// </summary>
    private void AttachMilestones()
    {
        if (Measurement is null) return;
        foreach (var milestone in Measurement.Milestones)
        {
            if (milestone.DueDate is { } due && (due < StartDate || due > EndDate))
                throw new ArgumentException(
                    $"Milestone \"{milestone.Title}\" is due outside the objective's dates.", nameof(Measurement));
            milestone.AttachTo(Id);
        }
    }

    private void RequireOrganizational()
    {
        if (OwnershipScope != ObjectiveOwnershipScope.OrgUnit)
            throw new InvalidOperationException("This operation applies to organizational objectives only.");
    }

    private static void RequireProgressSource(ObjectiveProgressSource progressSource, ObjectiveMeasurement? measurement)
    {
        if (progressSource == ObjectiveProgressSource.Direct && measurement is null)
            throw new ArgumentException("A directly measured objective requires a measurement.", nameof(measurement));
        if (progressSource == ObjectiveProgressSource.Calculated && measurement is not null)
            throw new ArgumentException("A calculated objective must not carry a direct measurement.", nameof(measurement));
    }

    private static string? Normalize(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static void ValidateDatesWithin(DateOnly startDate, DateOnly endDate, DateOnly boundStart, DateOnly boundEnd, string boundLabel)
    {
        if (endDate <= startDate)
            throw new ArgumentException("An objective's end date must be after its start date.", nameof(endDate));
        if (startDate < boundStart || endDate > boundEnd)
            throw new ArgumentException($"An objective's dates must fall within {boundLabel}.", nameof(startDate));
    }
}

using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Domain.Common;

namespace EY.HRPlatform.Performance.Domain.Plans;

/// <summary>
/// The facts about a plan's authored objectives that the submission gate needs but that live on the
/// objective rows rather than the plan aggregate. The command layer computes them from the loaded
/// objectives and passes them in, so the aggregate enforces the whole-plan invariants in one place
/// without reaching across aggregates itself (the same pattern as the contribution-baseline lock).
/// </summary>
public sealed record PlanSubmissionFacts(
    int ObjectiveCount,
    bool EveryObjectiveHasWeight,
    decimal WeightTotal,
    bool ConnectsToStrategicDirection,
    bool HasStandaloneObjective,
    PlanAlignmentPolicy AlignmentPolicy,
    bool EveryObjectiveConnectsToStrategicDirection = false)
{
    public bool StandaloneAllowed => AlignmentPolicy != PlanAlignmentPolicy.EveryObjectiveConnected;
    public bool AlignmentSatisfied => AlignmentPolicy switch
    {
        PlanAlignmentPolicy.Optional => true,
        PlanAlignmentPolicy.AtLeastOneConnected => ConnectsToStrategicDirection,
        PlanAlignmentPolicy.EveryObjectiveConnected => EveryObjectiveConnectsToStrategicDirection,
        _ => false,
    };
}

/// <summary>A change request the reviewer drafted on one objective, sent with the return.</summary>
public sealed record PlanChangeRequestDraft(Guid ObjectiveId, string ObjectiveTitle, string Text);

/// <summary>
/// An employee's own weighted objective plan within one Cycle. The employee authors the objectives
/// and weights (Draft), submits the whole plan once, and the responsible manager returns it with
/// feedback or approves it, which locks the expectation baseline. A participant holds at most one
/// plan per Cycle (invariant plus a unique constraint). The plan objectives themselves are
/// <see cref="Objectives.Objective"/> rows in Employee scope carrying this plan's id and a plan
/// weight; this aggregate owns the lifecycle, the agreement trail, and the whole-plan invariants.
/// </summary>
public sealed class EmployeePlan : PerformanceAggregate
{
    private readonly List<PlanDecision> _decisions = [];

    private EmployeePlan() { }

    public Guid CycleId { get; private set; }
    public Guid ParticipantId { get; private set; }
    public Guid EmployeeId { get; private set; }
    public string EmployeeDisplayName { get; private set; } = string.Empty;
    public string? OrgUnitName { get; private set; }

    /// <summary>The responsible manager captured for this Cycle, who reviews and approves the plan.</summary>
    public Guid? ResponsibleManagerId { get; private set; }
    public string? ResponsibleManagerName { get; private set; }

    public PlanLifecycleState State { get; private set; }
    public DateTime? SubmittedAt { get; private set; }
    public DateTime? ApprovedAt { get; private set; }

    /// <summary>Whether the single final approval was the normal manager path or the governed escape hatch.</summary>
    public PlanApprovalKind? ApprovalKind { get; private set; }

    /// <summary>Who recorded the final approval — the manager, or the administrator for an exceptional approval.</summary>
    public Guid? ApprovedByEmployeeId { get; private set; }

    public IReadOnlyList<PlanDecision> Decisions => _decisions;

    public bool IsLocked => State == PlanLifecycleState.Approved;

    public static EmployeePlan Create(
        Guid tenantId,
        Guid cycleId,
        Guid participantId,
        Guid employeeId,
        string employeeDisplayName,
        string? orgUnitName,
        Guid? responsibleManagerId,
        string? responsibleManagerName)
    {
        if (tenantId == Guid.Empty) throw new ArgumentException("TenantId is required.", nameof(tenantId));
        if (cycleId == Guid.Empty) throw new ArgumentException("CycleId is required.", nameof(cycleId));
        if (participantId == Guid.Empty) throw new ArgumentException("A plan belongs to a Cycle participant.", nameof(participantId));
        if (employeeId == Guid.Empty) throw new ArgumentException("A plan belongs to an employee.", nameof(employeeId));

        return new EmployeePlan
        {
            TenantId = tenantId,
            CycleId = cycleId,
            ParticipantId = participantId,
            EmployeeId = employeeId,
            EmployeeDisplayName = employeeDisplayName,
            OrgUnitName = Normalize(orgUnitName),
            ResponsibleManagerId = responsibleManagerId == Guid.Empty ? null : responsibleManagerId,
            ResponsibleManagerName = Normalize(responsibleManagerName),
            State = PlanLifecycleState.Draft,
        };
    }

    /// <summary>Submits the whole Draft plan for the responsible manager's decision once it is ready.</summary>
    public void Submit(Guid actorEmployeeId, PlanSubmissionFacts facts)
    {
        if (State != PlanLifecycleState.Draft)
            throw new InvalidOperationException("Only a Draft plan can be submitted.");
        if (actorEmployeeId != EmployeeId)
            throw new InvalidOperationException("Only the plan's own employee can submit it.");

        if (facts.ObjectiveCount == 0)
            throw new InvalidOperationException("Add at least one objective before submitting.");
        if (!facts.EveryObjectiveHasWeight)
            throw new InvalidOperationException("Every objective needs a plan weight before submitting.");
        if (facts.WeightTotal != 100m)
            throw new InvalidOperationException("Plan weights must total exactly 100% before submitting.");
        if (OpenChangeRequests.Count > 0)
            throw new InvalidOperationException(OpenChangeRequests.Count == 1
                ? "Address 1 change request before resubmitting."
                : $"Address {OpenChangeRequests.Count} change requests before resubmitting.");
        if (!facts.AlignmentSatisfied)
            throw new InvalidOperationException(facts.AlignmentPolicy == PlanAlignmentPolicy.EveryObjectiveConnected
                ? "Every objective must connect to strategic direction."
                : "At least one objective must connect to strategic direction.");

        State = PlanLifecycleState.Submitted;
        SubmittedAt = PerformanceClock.UtcNow;
        RecordDecision(PlanDecisionKind.Submitted, actorEmployeeId, null);
        MarkUpdated();
    }

    /// <summary>Marks the plan as edited — its objectives or weights changed — so "last saved" tracks authoring, not only lifecycle.</summary>
    public void RecordEdit() => MarkUpdated();

    /// <summary>
    /// Returns a Submitted plan to Draft, performed by the responsible manager. It needs a general note, at
    /// least one change request on a specific objective, or both (D-09); at most one request per objective.
    /// The caller has checked that each request's objective belongs to this plan.
    /// </summary>
    public void Return(Guid actorEmployeeId, string? feedback, IReadOnlyCollection<PlanChangeRequestDraft>? changeRequests = null,
        IReadOnlyList<PlanGoalSnapshot>? goals = null)
    {
        if (State != PlanLifecycleState.Submitted)
            throw new InvalidOperationException("Only a Submitted plan can be returned.");
        var requests = changeRequests ?? [];
        if (string.IsNullOrWhiteSpace(feedback) && requests.Count == 0)
            throw new ArgumentException("Add a note or a change request on an objective before returning the plan.", nameof(feedback));
        if (requests.Select(request => request.ObjectiveId).Distinct().Count() != requests.Count)
            throw new ArgumentException("Each objective can carry one change request.", nameof(changeRequests));
        var built = requests.Select(request => PlanChangeRequest.Create(TenantId, request.ObjectiveId, request.ObjectiveTitle, request.Text)).ToList();

        State = PlanLifecycleState.Draft;
        SubmittedAt = null;
        var decision = RecordDecision(PlanDecisionKind.Returned, actorEmployeeId, feedback);
        foreach (var request in built) decision.Carry(request);
        if (goals is not null) decision.Snapshot(goals);
        MarkUpdated();
    }

    /// <summary>
    /// The return a resubmitted plan answers: while the plan is Submitted again after being returned, the latest return,
    /// whose snapshot tells the reviewer what changed since (B-406).
    /// </summary>
    public PlanDecision? AnsweredReturn
    {
        get
        {
            if (State != PlanLifecycleState.Submitted) return null;
            var ordered = _decisions.OrderBy(decision => decision.DecidedAt).ToList();
            return ordered.Count >= 2 && ordered[^1].Kind == PlanDecisionKind.Submitted && ordered[^2].Kind == PlanDecisionKind.Returned
                ? ordered[^2] : null;
        }
    }

    /// <summary>The latest return, while the plan is back in Draft because of it.</summary>
    public PlanDecision? ActiveReturn
    {
        get
        {
            if (State != PlanLifecycleState.Draft) return null;
            var last = _decisions.OrderBy(decision => decision.DecidedAt).LastOrDefault();
            return last?.Kind == PlanDecisionKind.Returned ? last : null;
        }
    }

    /// <summary>The change requests that still stand between a returned plan and its resubmission.</summary>
    public IReadOnlyList<PlanChangeRequest> OpenChangeRequests
        => ActiveReturn?.ChangeRequests.Where(request => request.IsOpen).ToList() ?? [];

    /// <summary>The owner marks a request from the active return addressed. False when it already was.</summary>
    public bool AddressChangeRequest(Guid actorEmployeeId, Guid requestId, string? reply)
    {
        if (actorEmployeeId != EmployeeId)
            throw new UnauthorizedAccessException("Only the plan's own employee addresses its change requests.");
        var request = _decisions.SelectMany(decision => decision.ChangeRequests).FirstOrDefault(item => item.Id == requestId)
            ?? throw new KeyNotFoundException("That change request is not part of this plan.");
        if (ActiveReturn?.ChangeRequests.Contains(request) != true)
            throw new InvalidOperationException("Change requests can be addressed only while the plan is back with you after that return.");
        var changed = request.Address(reply, PerformanceClock.UtcNow);
        if (changed) MarkUpdated();
        return changed;
    }

    /// <summary>Removing an objective addresses the active return's request on it.</summary>
    public PlanChangeRequest? ObjectiveRemoved(Guid objectiveId)
    {
        var request = OpenChangeRequests.FirstOrDefault(item => item.ObjectiveId == objectiveId);
        if (request is null || !request.ObjectiveWasRemoved(PerformanceClock.UtcNow)) return null;
        MarkUpdated();
        return request;
    }

    /// <summary>Approves a Submitted plan through the normal manager path, locking the expectation baseline.</summary>
    public void Approve(Guid managerEmployeeId)
    {
        if (State != PlanLifecycleState.Submitted)
            throw new InvalidOperationException("Only a Submitted plan can be approved.");

        State = PlanLifecycleState.Approved;
        ApprovedAt = PerformanceClock.UtcNow;
        ApprovalKind = PlanApprovalKind.Normal;
        ApprovedByEmployeeId = managerEmployeeId;
        RecordDecision(PlanDecisionKind.Approved, managerEmployeeId, null);
        MarkUpdated();
    }

    /// <summary>
    /// Approves a Submitted plan through the governed administrative escape hatch when the normal
    /// approver is blocked. Requires a recorded reason, is attributed to the administrator, and
    /// preserves the responsible-manager identity separately — it never pretends the manager approved.
    /// </summary>
    public void ApproveExceptionally(Guid administratorEmployeeId, string reason)
    {
        if (State != PlanLifecycleState.Submitted)
            throw new InvalidOperationException("Only a Submitted plan can be exceptionally approved.");
        if (string.IsNullOrWhiteSpace(reason))
            throw new ArgumentException("An exceptional approval requires a recorded reason.", nameof(reason));

        State = PlanLifecycleState.Approved;
        ApprovedAt = PerformanceClock.UtcNow;
        ApprovalKind = PlanApprovalKind.Exceptional;
        ApprovedByEmployeeId = administratorEmployeeId;
        RecordDecision(PlanDecisionKind.ApprovedExceptionally, administratorEmployeeId, reason);
        MarkUpdated();
    }

    public bool IsTransitionRetry(PlanDecisionKind kind, Guid actorEmployeeId, string? feedback = null,
        IReadOnlyCollection<PlanChangeRequestDraft>? changeRequests = null)
    {
        var target = kind switch
        {
            PlanDecisionKind.Submitted => PlanLifecycleState.Submitted,
            PlanDecisionKind.Returned => PlanLifecycleState.Draft,
            PlanDecisionKind.Approved or PlanDecisionKind.ApprovedExceptionally => PlanLifecycleState.Approved,
            _ => (PlanLifecycleState?)null,
        };
        var last = _decisions.OrderBy(decision => decision.DecidedAt).LastOrDefault();
        return target == State && last is not null && last.Kind == kind
            && last.ActorEmployeeId == actorEmployeeId && last.Feedback == Normalize(feedback)
            && SameRequests(last, changeRequests ?? []);
    }

    private static bool SameRequests(PlanDecision decision, IReadOnlyCollection<PlanChangeRequestDraft> requests)
        => decision.ChangeRequests.Count == requests.Count
           && requests.All(request => decision.ChangeRequests.Any(item =>
               item.ObjectiveId == request.ObjectiveId && item.Text == request.Text.Trim()));

    private PlanDecision RecordDecision(PlanDecisionKind kind, Guid actorEmployeeId, string? feedback)
    {
        var decision = PlanDecision.Record(TenantId, kind, actorEmployeeId, feedback);
        decision.AttachTo(Id);
        _decisions.Add(decision);
        return decision;
    }

    private static string? Normalize(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

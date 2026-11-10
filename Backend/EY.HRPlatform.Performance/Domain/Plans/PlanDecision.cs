using EY.HRPlatform.Performance.Domain.Common;

namespace EY.HRPlatform.Performance.Domain.Plans;

/// <summary>
/// One attributable step in an employee plan's agreement history: who acted, what they did, and (for
/// a return) the reviewer's note and the change requests on specific objectives. Append-only; the plan
/// surfaces read it to show the agreement trail. Exceptional approvals carry the administrator's reason
/// as feedback (product-spec §14/§15).
/// </summary>
public sealed class PlanDecision : PerformanceChildEntity
{
    private readonly List<PlanChangeRequest> _changeRequests = [];

    private PlanDecision() { }

    public Guid PlanId { get; private set; }
    public PlanDecisionKind Kind { get; private set; }
    public Guid ActorEmployeeId { get; private set; }
    public string? Feedback { get; private set; }
    public DateTime DecidedAt { get; private set; }

    /// <summary>On a return: the plan's goals as the reviewer saw them, so the resubmission shows what changed since.</summary>
    public string? GoalsSnapshotJson { get; private set; }

    public IReadOnlyList<PlanGoalSnapshot> GoalsSnapshot => GoalsSnapshotJson is null ? []
        : System.Text.Json.JsonSerializer.Deserialize<List<PlanGoalSnapshot>>(GoalsSnapshotJson) ?? [];

    internal void Snapshot(IReadOnlyList<PlanGoalSnapshot> goals) => GoalsSnapshotJson = System.Text.Json.JsonSerializer.Serialize(goals);

    public IReadOnlyList<PlanChangeRequest> ChangeRequests => _changeRequests;

    public static PlanDecision Record(Guid tenantId, PlanDecisionKind kind, Guid actorEmployeeId, string? feedback)
        => new()
        {
            TenantId = tenantId,
            Kind = kind,
            ActorEmployeeId = actorEmployeeId,
            Feedback = string.IsNullOrWhiteSpace(feedback) ? null : feedback.Trim(),
            DecidedAt = PerformanceClock.UtcNow,
        };

    internal void AttachTo(Guid planId) => PlanId = planId;

    internal void Carry(PlanChangeRequest request)
    {
        request.AttachTo(Id);
        _changeRequests.Add(request);
    }
}

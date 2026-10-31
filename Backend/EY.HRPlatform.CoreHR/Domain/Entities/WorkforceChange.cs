using EY.HRPlatform.SharedKernel.Domain;
using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.CoreHR.Domain.Entities;

public enum WorkforceChangeKind
{
    Join = 1,
    JobChange = 2,
    EndEmployment = 3,
}

public enum WorkforceChangeStatus
{
    Scheduled = 1,
    InEffect = 2,
    Cancelled = 3,
}

public enum WorkforceChangeEffectAction
{
    Created = 1,
    Ended = 2,
}

/// <summary>
/// One decision about a person (join, job change, end of employment) with the effective-dated rows it wrote,
/// including its ripple on other people (a team staying behind, reports reassigned, dotted lines ended). It is
/// what Coming up shows and what Cancel and Edit act on; cancelling restores every row it touched.
/// </summary>
public sealed class WorkforceChange : BaseEntity, ITenantEntity
{
    private readonly List<WorkforceChangeEffect> _effects = [];

    private WorkforceChange() { }

    public Guid TenantId { get; private set; }
    public Guid EmployeeId { get; private set; }
    public WorkforceChangeKind Kind { get; private set; }

    /// <summary>The first day the change is in effect (for an end of employment, the day after the last day).</summary>
    public DateOnly EffectiveDate { get; private set; }

    public string? Note { get; private set; }
    public string PayloadJson { get; private set; } = "{}";
    public bool IsCancelled { get; private set; }
    public DateTime? CancelledAt { get; private set; }
    public string? CancelledBy { get; private set; }

    public IReadOnlyList<WorkforceChangeEffect> Effects => _effects;

    public static WorkforceChange Create(
        Guid tenantId,
        Guid employeeId,
        WorkforceChangeKind kind,
        DateOnly effectiveDate,
        string? note,
        string payloadJson,
        string? actor,
        IEnumerable<WorkforceChangeEffect> effects)
    {
        if (tenantId == Guid.Empty || employeeId == Guid.Empty)
            throw new ArgumentException("Tenant and employee are required.");

        var change = new WorkforceChange
        {
            TenantId = tenantId,
            EmployeeId = employeeId,
            Kind = kind,
            EffectiveDate = effectiveDate,
            Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim(),
            PayloadJson = string.IsNullOrWhiteSpace(payloadJson) ? "{}" : payloadJson,
            CreatedBy = actor,
        };
        foreach (var effect in effects)
        {
            effect.AttachTo(change);
            change._effects.Add(effect);
        }
        return change;
    }

    public WorkforceChangeStatus StatusOn(DateOnly today)
        => IsCancelled ? WorkforceChangeStatus.Cancelled
            : EffectiveDate > today ? WorkforceChangeStatus.Scheduled
            : WorkforceChangeStatus.InEffect;

    public void Cancel(string? actor)
    {
        if (IsCancelled)
            throw new InvalidOperationException("Change is already cancelled.");

        IsCancelled = true;
        CancelledAt = DateTime.UtcNow;
        CancelledBy = actor;
        UpdatedAt = CancelledAt;
        UpdatedBy = actor;
    }
}

/// <summary>A row a <see cref="WorkforceChange"/> created, or ended (with the end it replaced).</summary>
public sealed class WorkforceChangeEffect : BaseEntity, ITenantEntity
{
    public const string EmployeeEntity = "Employee";
    public const string EmploymentEntity = "Employment";
    public const string EmploymentTypePeriodEntity = "EmploymentTypePeriod";
    public const string WorkAssignmentEntity = "WorkAssignment";
    public const string ManagerRelationshipEntity = "ManagerRelationship";

    private WorkforceChangeEffect() { }

    public Guid TenantId { get; private set; }
    public Guid ChangeId { get; private set; }
    public Guid SubjectEmployeeId { get; private set; }
    public string EntityType { get; private set; } = string.Empty;
    public Guid EntityId { get; private set; }
    public WorkforceChangeEffectAction Action { get; private set; }

    /// <summary>For an ended row, its end before the change (null = open-ended).</summary>
    public DateTime? PreviousEffectiveTo { get; private set; }

    /// <summary>The row's end as the change left it; a different value later means another change built on it.</summary>
    public DateTime? AppliedEffectiveTo { get; private set; }

    public static WorkforceChangeEffect Record(
        Guid tenantId,
        Guid subjectEmployeeId,
        string entityType,
        Guid entityId,
        WorkforceChangeEffectAction action,
        DateTime? previousEffectiveTo,
        DateTime? appliedEffectiveTo)
        => new()
        {
            TenantId = tenantId,
            SubjectEmployeeId = subjectEmployeeId,
            EntityType = entityType,
            EntityId = entityId,
            Action = action,
            PreviousEffectiveTo = previousEffectiveTo,
            AppliedEffectiveTo = appliedEffectiveTo,
        };

    internal void AttachTo(WorkforceChange change) => ChangeId = change.Id;
}

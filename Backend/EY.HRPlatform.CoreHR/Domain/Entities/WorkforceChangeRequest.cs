using EY.HRPlatform.SharedKernel.Domain;
using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.CoreHR.Domain.Entities;

public enum WorkforceChangeRequestKind
{
    JobChange = 1,
    EndEmployment = 2,
    /// <summary>A person's own new home address, waiting for HR.</summary>
    HomeAddress = 3,
}

public enum WorkforceChangeRequestStatus
{
    Pending = 1,
    Approved = 2,
    Declined = 3,
    Withdrawn = 4,
}

/// <summary>
/// The parts of a change a company can ask approval for (Settings › Changes and approvals). A change needs approval
/// when any of its parts does.
/// </summary>
public static class ChangeApprovalTypes
{
    /// <summary>Job or unit.</summary>
    public const string Job = "job";
    public const string Manager = "manager";
    public const string Place = "place";
    public const string Leaving = "leaving";
    public const string HomeAddress = "homeAddress";

    public static readonly IReadOnlyList<string> All = [Job, Manager, Place, Leaving, HomeAddress];

    public static bool IsKnown(string type) => All.Contains(type, StringComparer.Ordinal);
}

/// <summary>One change type the company wants approved. No row: changes of that type apply on their date.</summary>
public sealed class ChangeApprovalRule : BaseEntity, ITenantEntity
{
    private ChangeApprovalRule() { }

    public Guid TenantId { get; private set; }
    public string Type { get; private set; } = string.Empty;

    public static ChangeApprovalRule For(Guid tenantId, string type, string? actor)
    {
        if (tenantId == Guid.Empty)
            throw new ArgumentException("Tenant is required.", nameof(tenantId));
        if (!ChangeApprovalTypes.IsKnown(type))
            throw new ArgumentException("Unknown change type.", nameof(type));
        return new ChangeApprovalRule { TenantId = tenantId, Type = type, CreatedBy = actor };
    }
}

/// <summary>
/// A change someone asked for, waiting for whoever approves changes. The draft is the request: <see cref="PayloadJson"/>
/// is exactly what is staged on approval, and <see cref="PreviewJson"/> is what it would do, captured when asked.
/// <see cref="Basis"/> fingerprints the person's job and line on the date when asked, so an approval never applies a
/// change drafted against a state that has since moved. Nothing is written to the person until it is approved.
/// </summary>
public sealed class WorkforceChangeRequest : BaseEntity, ITenantEntity
{
    public const int MaxDescriptionLength = 500;
    public const int MaxNoteLength = 1000;
    public const int MaxDeclineReasonLength = 500;

    private WorkforceChangeRequest() { }

    public Guid TenantId { get; private set; }
    public Guid SubjectEmployeeId { get; private set; }
    public WorkforceChangeRequestKind Kind { get; private set; }
    public WorkforceChangeRequestStatus Status { get; private set; }

    /// <summary>The first day the change is in effect (for an end of employment, the last day; an address, the day asked).</summary>
    public DateOnly EffectiveDate { get; private set; }

    /// <summary>The types that needed approval, comma-separated.</summary>
    public string Types { get; private set; } = string.Empty;

    public string PayloadJson { get; private set; } = "{}";
    public string PreviewJson { get; private set; } = "{}";
    public string Basis { get; private set; } = string.Empty;

    /// <summary>The sentence it was described in, when it was.</summary>
    public string? Description { get; private set; }
    public string? Note { get; private set; }
    public Guid? ReasonId { get; private set; }
    public string? Reason { get; private set; }

    public string RequestedByUserId { get; private set; } = string.Empty;
    public Guid? RequestedByEmployeeId { get; private set; }
    public string RequestedByName { get; private set; } = string.Empty;

    public string? DecidedByUserId { get; private set; }
    public Guid? DecidedByEmployeeId { get; private set; }
    public string? DecidedByName { get; private set; }
    public DateTime? DecidedAt { get; private set; }
    public string? DeclineReason { get; private set; }
    public Guid? AppliedChangeId { get; private set; }

    /// <summary>Row version (PostgreSQL xmin): two approvers acting at once can't both decide.</summary>
    public uint Version { get; private set; }

    public IReadOnlyList<string> TypeList => Types.Split(',', StringSplitOptions.RemoveEmptyEntries);

    public static WorkforceChangeRequest Ask(
        Guid tenantId,
        Guid subjectEmployeeId,
        WorkforceChangeRequestKind kind,
        DateOnly effectiveDate,
        IReadOnlyCollection<string> types,
        string payloadJson,
        string previewJson,
        string basis,
        string? description,
        string? note,
        (Guid Id, string Label)? reason,
        string requestedByUserId,
        Guid? requestedByEmployeeId,
        string requestedByName)
    {
        if (tenantId == Guid.Empty || subjectEmployeeId == Guid.Empty)
            throw new ArgumentException("Tenant and person are required.");
        if (types.Count == 0 || types.Any(type => !ChangeApprovalTypes.IsKnown(type)))
            throw new ArgumentException("A request names the change types that need approval.", nameof(types));
        if (string.IsNullOrWhiteSpace(requestedByUserId))
            throw new ArgumentException("A request needs whoever asked.", nameof(requestedByUserId));

        return new WorkforceChangeRequest
        {
            TenantId = tenantId,
            SubjectEmployeeId = subjectEmployeeId,
            Kind = kind,
            Status = WorkforceChangeRequestStatus.Pending,
            EffectiveDate = effectiveDate,
            Types = string.Join(',', ChangeApprovalTypes.All.Where(types.Contains)),
            PayloadJson = payloadJson,
            PreviewJson = string.IsNullOrWhiteSpace(previewJson) ? "{}" : previewJson,
            Basis = basis,
            Description = Clip(description, MaxDescriptionLength),
            Note = Clip(note, MaxNoteLength),
            ReasonId = reason?.Id,
            Reason = reason?.Label,
            RequestedByUserId = requestedByUserId,
            RequestedByEmployeeId = requestedByEmployeeId,
            RequestedByName = string.IsNullOrWhiteSpace(requestedByName) ? "Someone" : requestedByName.Trim(),
            CreatedBy = requestedByName,
        };
    }

    public void Approve(string userId, Guid? employeeId, string name, Guid? appliedChangeId)
    {
        Decide(userId, employeeId, name);
        Status = WorkforceChangeRequestStatus.Approved;
        AppliedChangeId = appliedChangeId;
    }

    public void Decline(string userId, Guid? employeeId, string name, string reason)
    {
        var why = Clip(reason, MaxDeclineReasonLength)
            ?? throw new ArgumentException("Declining needs a reason.", nameof(reason));
        Decide(userId, employeeId, name);
        Status = WorkforceChangeRequestStatus.Declined;
        DeclineReason = why;
    }

    public void Withdraw(string userId)
    {
        if (!string.Equals(userId, RequestedByUserId, StringComparison.Ordinal))
            throw new InvalidOperationException("Only whoever asked can withdraw a request.");
        Decide(userId, RequestedByEmployeeId, RequestedByName);
        Status = WorkforceChangeRequestStatus.Withdrawn;
    }

    private void Decide(string userId, Guid? employeeId, string name)
    {
        if (Status != WorkforceChangeRequestStatus.Pending)
            throw new InvalidOperationException("This request was already decided.");
        DecidedByUserId = userId;
        DecidedByEmployeeId = employeeId;
        DecidedByName = string.IsNullOrWhiteSpace(name) ? "Someone" : name.Trim();
        DecidedAt = DateTime.UtcNow;
        UpdatedAt = DecidedAt;
        UpdatedBy = DecidedByName;
    }

    private static string? Clip(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        return trimmed.Length <= max ? trimmed : trimmed[..max];
    }
}

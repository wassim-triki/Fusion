using EY.HRPlatform.SharedKernel.Domain;
using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.CoreHR.Domain.Entities;

public enum OrganizationChangeKind
{
    Create = 1,
    Change = 2,
    Move = 3,
    Inactivate = 4,
    Correction = 5,
    CodeCorrection = 6,
}

/// <summary>
/// Stable identity for a business operation. It remains separate from the resulting
/// effective-state snapshot so same-date operations can be viewed/cancelled individually.
/// </summary>
public sealed class OrganizationChange : BaseEntity, ITenantEntity
{
    private OrganizationChange() { }

    public Guid TenantId { get; private set; }
    public Guid OrgUnitId { get; private set; }
    public OrgUnit OrgUnit { get; private set; } = null!;
    public DateOnly EffectiveDate { get; private set; }
    public OrganizationChangeKind Kind { get; private set; }
    public string? Reason { get; private set; }
    public string? Summary { get; private set; }
    public string PayloadJson { get; private set; } = "{}";
    public bool IsCancelled { get; private set; }
    public DateTime? CancelledAt { get; private set; }

    public static OrganizationChange Create(Guid tenantId, Guid orgUnitId, DateOnly effectiveDate, OrganizationChangeKind kind, string? reason, string? summary, string payloadJson)
    {
        if (tenantId == Guid.Empty || orgUnitId == Guid.Empty)
            throw new ArgumentException("Tenant and Organizational Unit are required.");

        return new OrganizationChange
        {
            TenantId = tenantId,
            OrgUnitId = orgUnitId,
            EffectiveDate = effectiveDate,
            Kind = kind,
            Reason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim(),
            Summary = string.IsNullOrWhiteSpace(summary) ? null : summary.Trim(),
            PayloadJson = string.IsNullOrWhiteSpace(payloadJson) ? "{}" : payloadJson,
        };
    }

    /// <summary>A creation moved earlier: the company's root, made on day one, opens when its imported history starts (B-188).</summary>
    public void OpenFrom(DateOnly effectiveDate)
    {
        if (Kind != OrganizationChangeKind.Create)
            throw new InvalidOperationException("Only a creation can open earlier.");

        EffectiveDate = effectiveDate;
        UpdatedAt = DateTime.UtcNow;
    }

    public void Cancel()
    {
        if (IsCancelled)
            throw new InvalidOperationException("Organization change is already cancelled.");

        IsCancelled = true;
        CancelledAt = DateTime.UtcNow;
        UpdatedAt = CancelledAt;
    }
}

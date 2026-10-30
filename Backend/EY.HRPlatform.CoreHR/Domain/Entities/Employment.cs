using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Domain.ValueObjects;
using EY.HRPlatform.SharedKernel.Domain;
using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.CoreHR.Domain.Entities;

/// <summary>
/// Canonical, minimal, tenant-scoped employment record. Sole owner of the employment truth
/// the legacy <c>Employee</c> row used to carry (hire date, status, employment type). At most
/// one active employment exists per employee at a time; rehire creates a new <c>Employment</c>
/// rather than reopening a prior one. Work assignments and manager relationships attach through
/// an employment, not directly to <c>Employee</c>.
/// </summary>
public sealed class Employment : AggregateRoot, ITenantEntity
{
    private Employment() { }

    public Guid TenantId { get; private set; }
    public Guid EmployeeId { get; private set; }

    public DateTime EffectiveFrom { get; private set; }
    public DateTime? EffectiveTo { get; private set; }
    public EmploymentStatus Status { get; private set; }
    /// <summary>The employment type, a value of the company's "Employment types" list.</summary>
    public Guid? EmploymentTypeId { get; private set; }

    /// <summary>The employment type's label, kept in step by the list (Performance and the readers filter on it).</summary>
    public string? EmploymentType { get; private set; }

    public WorkforceSourceType Source { get; private set; }
    public string? SourceReference { get; private set; }
    public Guid? ImportBatchId { get; private set; }

    /// <summary>The half-open effective interval for this employment.</summary>
    public EffectiveDateRange Interval => EffectiveDateRange.Create(EffectiveFrom, EffectiveTo);

    /// <summary>An employment currently in effect: active status and open-ended.</summary>
    public bool IsActive => Status == EmploymentStatus.Active && EffectiveTo is null;

    public bool IsActiveOn(DateTime asOf) => Interval.IsActiveOn(asOf);

    public static Employment Start(
        Guid tenantId,
        Guid employeeId,
        DateTime effectiveFrom,
        CompanyListValue? employmentType,
        WorkforceSourceType source,
        string? sourceReference = null,
        Guid? importBatchId = null)
    {
        if (tenantId == Guid.Empty)
            throw new ArgumentException("Tenant id is required.", nameof(tenantId));
        if (employeeId == Guid.Empty)
            throw new ArgumentException("Employee id is required.", nameof(employeeId));
        RequireEmploymentType(tenantId, employmentType);

        var interval = EffectiveDateRange.Create(effectiveFrom);

        return new Employment
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            EmployeeId = employeeId,
            EffectiveFrom = interval.EffectiveFrom,
            EffectiveTo = null,
            Status = EmploymentStatus.Active,
            EmploymentTypeId = employmentType?.Id,
            EmploymentType = employmentType?.Label,
            Source = source,
            SourceReference = sourceReference?.Trim(),
            ImportBatchId = importBatchId,
        };
    }

    /// <summary>Ends an active employment effective the given date (close-and-succeed convention).</summary>
    public void End(DateTime effectiveDate)
    {
        if (Status == EmploymentStatus.Ended)
            throw new InvalidOperationException("Employment has already ended.");

        var closed = Interval.CloseAt(effectiveDate);
        EffectiveTo = closed.EffectiveTo;
        Status = EmploymentStatus.Ended;
        UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>Puts back the end a cancelled change replaced; an open end makes the employment active again.</summary>
    public void RestoreEnd(DateTime? effectiveTo)
    {
        EffectiveTo = effectiveTo;
        Status = effectiveTo is null ? EmploymentStatus.Active : EmploymentStatus.Ended;
        UpdatedAt = DateTime.UtcNow;
    }

    public void UpdateEmploymentType(CompanyListValue? employmentType)
    {
        RequireEmploymentType(TenantId, employmentType);
        EmploymentTypeId = employmentType?.Id;
        EmploymentType = employmentType?.Label;
        UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>Takes the list value's current label (after a rename) without counting as a change.</summary>
    public void ReflectEmploymentType(CompanyListValue employmentType)
    {
        if (employmentType.Id == EmploymentTypeId) EmploymentType = employmentType.Label;
    }

    private static void RequireEmploymentType(Guid tenantId, CompanyListValue? employmentType)
    {
        if (employmentType is not null && (employmentType.TenantId != tenantId || employmentType.List != CompanyList.EmploymentTypes))
            throw new ArgumentException("The employment type must be one of the company's employment types.", nameof(employmentType));
    }
}

using EY.HRPlatform.SharedKernel.Domain;
using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.CoreHR.Domain.Entities;

/// <summary>
/// One effective-dated employment type within an employment. The Employment row remains the person's tenure;
/// these periods let a dated Job change alter only the type without pretending the person left and rejoined.
/// </summary>
public sealed class EmploymentTypePeriod : BaseEntity, ITenantEntity
{
    private EmploymentTypePeriod() { }

    public Guid TenantId { get; private set; }
    public Guid EmployeeId { get; private set; }
    public Guid EmploymentId { get; private set; }
    public Guid? EmploymentTypeId { get; private set; }
    public string? EmploymentType { get; private set; }
    public DateTime EffectiveFrom { get; private set; }
    public DateTime? EffectiveTo { get; private set; }

    public static EmploymentTypePeriod Start(
        Guid tenantId,
        Guid employeeId,
        Guid employmentId,
        DateTime effectiveFrom,
        CompanyListValue? employmentType,
        string? actor)
    {
        if (tenantId == Guid.Empty || employeeId == Guid.Empty || employmentId == Guid.Empty)
            throw new ArgumentException("Tenant, employee and employment are required.");
        if (employmentType is not null
            && (employmentType.TenantId != tenantId || employmentType.List != CompanyList.EmploymentTypes))
            throw new ArgumentException("The employment type must be one of the company's employment types.");
        return new EmploymentTypePeriod
        {
            TenantId = tenantId,
            EmployeeId = employeeId,
            EmploymentId = employmentId,
            EmploymentTypeId = employmentType?.Id,
            EmploymentType = employmentType?.Label,
            EffectiveFrom = DateTime.SpecifyKind(effectiveFrom, DateTimeKind.Utc),
            CreatedBy = actor,
        };
    }

    public void End(DateTime effectiveTo, string? actor)
    {
        var at = DateTime.SpecifyKind(effectiveTo, DateTimeKind.Utc);
        if (at <= EffectiveFrom) throw new ArgumentException("The employment type period must end after it starts.");
        if (EffectiveTo is not null) throw new InvalidOperationException("The employment type period has already ended.");
        EffectiveTo = at;
        UpdatedAt = DateTime.UtcNow;
        UpdatedBy = actor;
    }

    public void RestoreEnd(DateTime? effectiveTo)
    {
        EffectiveTo = effectiveTo;
        UpdatedAt = DateTime.UtcNow;
    }

    public void ReflectEmploymentType(CompanyListValue employmentType)
    {
        if (employmentType.Id == EmploymentTypeId) EmploymentType = employmentType.Label;
    }
}

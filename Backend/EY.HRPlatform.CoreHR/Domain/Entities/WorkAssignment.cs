using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Domain.ValueObjects;
using EY.HRPlatform.SharedKernel.Domain;
using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.CoreHR.Domain.Entities;

/// <summary>
/// Canonical, effective-dated, tenant-scoped work assignment belonging to an <c>Employment</c>.
/// It is the ONLY source of an employee's organization context (via <see cref="OrgUnitId"/>),
/// job (from the company's catalogue), and optional place of work. At most one active primary work assignment
/// exists per active employment; assignment dates must fit within the parent employment window.
/// </summary>
public sealed class WorkAssignment : AggregateRoot, ITenantEntity
{
    private WorkAssignment() { }

    public Guid TenantId { get; private set; }
    public Guid EmploymentId { get; private set; }

    /// <summary>
    /// Denormalized owning employee, copied from the parent employment, so that as-of resolvers
    /// and tenant indexes can answer "this employee's primary assignment" without a join.
    /// </summary>
    public Guid EmployeeId { get; private set; }

    public Guid OrgUnitId { get; private set; }

    /// <summary>The job held, from the company's catalogue. A job, not a position: no seat outlives its holder.</summary>
    public Guid JobId { get; private set; }

    /// <summary>The job's title, kept in step by the catalogue (rename and merge rewrite it) so readers need no join.</summary>
    public string JobTitle { get; private set; } = string.Empty;

    public Guid? PlaceId { get; private set; }

    /// <summary>The place's name, kept in step by the catalogue like <see cref="JobTitle"/>.</summary>
    public string? WorkLocation { get; private set; }
    public bool IsPrimary { get; private set; }

    public DateTime EffectiveFrom { get; private set; }
    public DateTime? EffectiveTo { get; private set; }

    public WorkforceSourceType Source { get; private set; }
    public string? SourceReference { get; private set; }
    public Guid? ImportBatchId { get; private set; }

    public EffectiveDateRange Interval => EffectiveDateRange.Create(EffectiveFrom, EffectiveTo);
    public bool IsActiveOn(DateTime asOf) => Interval.IsActiveOn(asOf);

    public static WorkAssignment Create(
        Guid tenantId,
        Guid employmentId,
        Guid employeeId,
        Guid orgUnitId,
        Job job,
        Place? place,
        bool isPrimary,
        DateTime effectiveFrom,
        DateTime? effectiveTo,
        WorkforceSourceType source,
        string? sourceReference = null,
        Guid? importBatchId = null)
    {
        if (tenantId == Guid.Empty)
            throw new ArgumentException("Tenant id is required.", nameof(tenantId));
        if (employmentId == Guid.Empty)
            throw new ArgumentException("Employment id is required.", nameof(employmentId));
        if (employeeId == Guid.Empty)
            throw new ArgumentException("Employee id is required.", nameof(employeeId));
        if (orgUnitId == Guid.Empty)
            throw new ArgumentException("Organization unit is required.", nameof(orgUnitId));
        ArgumentNullException.ThrowIfNull(job);
        RequireCatalogue(tenantId, job, place);

        var interval = EffectiveDateRange.Create(effectiveFrom, effectiveTo);

        return new WorkAssignment
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            EmploymentId = employmentId,
            EmployeeId = employeeId,
            OrgUnitId = orgUnitId,
            JobId = job.Id,
            JobTitle = job.Title,
            PlaceId = place?.Id,
            WorkLocation = place?.Name,
            IsPrimary = isPrimary,
            EffectiveFrom = interval.EffectiveFrom,
            EffectiveTo = interval.EffectiveTo,
            Source = source,
            SourceReference = sourceReference?.Trim(),
            ImportBatchId = importBatchId,
        };
    }

    /// <summary>Closes this assignment effective the given date (close-and-succeed convention).</summary>
    public void End(DateTime effectiveDate)
    {
        var closed = Interval.CloseAt(effectiveDate);
        EffectiveTo = closed.EffectiveTo;
        UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>Puts back the end a cancelled change replaced (null reopens the row).</summary>
    public void RestoreEnd(DateTime? effectiveTo)
    {
        EffectiveTo = effectiveTo;
        UpdatedAt = DateTime.UtcNow;
    }

    public void UpdateDetails(Guid orgUnitId, Job job, Place? place)
    {
        if (orgUnitId == Guid.Empty)
            throw new ArgumentException("Organization unit is required.", nameof(orgUnitId));
        ArgumentNullException.ThrowIfNull(job);
        RequireCatalogue(TenantId, job, place);

        OrgUnitId = orgUnitId;
        JobId = job.Id;
        JobTitle = job.Title;
        PlaceId = place?.Id;
        WorkLocation = place?.Name;
        UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>
    /// Points at <paramref name="job"/> with its current title: after a rename, or a merge into it. A catalogue
    /// correction, not a change of the person's job, so the row's dates and history stay as they are.
    /// </summary>
    public void ReflectJob(Job job)
    {
        RequireCatalogue(TenantId, job, null);
        JobId = job.Id;
        JobTitle = job.Title;
    }

    /// <summary>Points at <paramref name="place"/> with its current name, like <see cref="ReflectJob"/>.</summary>
    public void ReflectPlace(Place place)
    {
        RequireCatalogue(TenantId, null, place);
        PlaceId = place.Id;
        WorkLocation = place.Name;
    }

    private static void RequireCatalogue(Guid tenantId, Job? job, Place? place)
    {
        if (job is not null && job.TenantId != tenantId)
            throw new ArgumentException("The job must be one of the company's jobs.", nameof(job));
        if (place is not null && place.TenantId != tenantId)
            throw new ArgumentException("The place must be one of the company's places.", nameof(place));
    }
}

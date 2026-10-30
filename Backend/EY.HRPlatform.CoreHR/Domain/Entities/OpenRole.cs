using EY.HRPlatform.SharedKernel.Domain;
using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.CoreHR.Domain.Entities;

public enum OpenRoleStatus
{
    Open = 1,
    OnHold = 2,
    Filled = 3,
    Closed = 4,
}

/// <summary>
/// A role Core HR plans in the structure before anyone holds it: its job (from the catalogue), the manager it
/// reports to, its unit and, optionally, its place. It shows on the org chart in that manager's line while it is open (or, for HR, on hold). Recruitment owns
/// hiring for it and may link its requisitions to it later.
/// </summary>
public sealed class OpenRole : BaseEntity, ITenantEntity
{
    public const int MaxJobTitleLength = 200;

    private OpenRole() { }

    public Guid TenantId { get; private set; }
    public Guid JobId { get; private set; }

    /// <summary>The job's title, kept in step by the catalogue like a work assignment's.</summary>
    public string JobTitle { get; private set; } = string.Empty;

    public Guid? PlaceId { get; private set; }

    /// <summary>The place's name, kept in step by the catalogue.</summary>
    public string? PlaceName { get; private set; }

    public Guid ManagerEmployeeId { get; private set; }
    public Guid OrgUnitId { get; private set; }

    /// <summary>When the new person should start; null when not set yet.</summary>
    public DateOnly? TargetStartDate { get; private set; }

    public OpenRoleStatus Status { get; private set; }

    /// <summary>Filled and Closed take the role off the chart.</summary>
    public bool IsActive => Status is OpenRoleStatus.Open or OpenRoleStatus.OnHold;

    public static OpenRole Create(
        Guid tenantId,
        Job job,
        Place? place,
        Guid managerEmployeeId,
        Guid orgUnitId,
        DateOnly? targetStartDate,
        OpenRoleStatus status,
        string? actor)
    {
        if (tenantId == Guid.Empty)
            throw new ArgumentException("Tenant is required.");
        if (status is not (OpenRoleStatus.Open or OpenRoleStatus.OnHold))
            throw new ArgumentException("A new role is open or on hold.");

        var role = new OpenRole { TenantId = tenantId, Status = status, CreatedBy = actor };
        role.Set(job, place, managerEmployeeId, orgUnitId, targetStartDate);
        return role;
    }

    public void Update(
        Job job,
        Place? place,
        Guid managerEmployeeId,
        Guid orgUnitId,
        DateOnly? targetStartDate,
        OpenRoleStatus status,
        string? actor)
    {
        if (!Enum.IsDefined(status))
            throw new ArgumentException("Unknown status.");

        Set(job, place, managerEmployeeId, orgUnitId, targetStartDate);
        Status = status;
        UpdatedAt = DateTime.UtcNow;
        UpdatedBy = actor;
    }

    /// <summary>Points at <paramref name="job"/> with its current title (a rename, or a merge into it).</summary>
    public void ReflectJob(Job job)
    {
        if (job.TenantId != TenantId) throw new ArgumentException("The job must be one of the company's jobs.");
        JobId = job.Id;
        JobTitle = job.Title;
    }

    /// <summary>Points at <paramref name="place"/> with its current name.</summary>
    public void ReflectPlace(Place place)
    {
        if (place.TenantId != TenantId) throw new ArgumentException("The place must be one of the company's places.");
        PlaceId = place.Id;
        PlaceName = place.Name;
    }

    private void Set(Job job, Place? place, Guid managerEmployeeId, Guid orgUnitId, DateOnly? targetStartDate)
    {
        ArgumentNullException.ThrowIfNull(job);
        if (job.TenantId != TenantId || (place is not null && place.TenantId != TenantId))
            throw new ArgumentException("The job and place must be the company's own.");
        if (managerEmployeeId == Guid.Empty || orgUnitId == Guid.Empty)
            throw new ArgumentException("Manager and unit are required.");

        JobId = job.Id;
        JobTitle = job.Title;
        PlaceId = place?.Id;
        PlaceName = place?.Name;
        ManagerEmployeeId = managerEmployeeId;
        OrgUnitId = orgUnitId;
        TargetStartDate = targetStartDate;
    }
}

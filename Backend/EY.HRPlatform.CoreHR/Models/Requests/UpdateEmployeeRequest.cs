using System.ComponentModel.DataAnnotations;

namespace EY.HRPlatform.CoreHR.Models.Requests;

/// <summary>
/// Request body for updating an existing employee.
/// Supports partial updates - only provided fields are updated.
/// Null fields are ignored (existing values preserved).
/// To clear ManagerId, send Guid.Empty.
/// To clear OrgUnitId, send Guid.Empty.
/// </summary>
public sealed record UpdateEmployeeRequest(
    [StringLength(64)] string? EmployeeNumber,
    [StringLength(100, MinimumLength = 1)] string? FirstName,
    [StringLength(100, MinimumLength = 1)] string? LastName,
    [StringLength(100)] string? PreferredName,
    [EmailAddress] string? Email,
    [StringLength(50)] string? Phone,
    Guid? JobId,
    Guid? PlaceId,
    Guid? EmploymentTypeId,
    Guid? ManagerId,
    Guid? OrgUnitId = null,
    DateTime? HireDate = null);

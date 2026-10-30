using System.ComponentModel.DataAnnotations;

namespace EY.HRPlatform.CoreHR.Models.Requests;

/// <summary>
/// Request body for creating a new employee.
/// </summary>
public sealed record CreateEmployeeRequest(
    [StringLength(64)] string? EmployeeNumber,
    [Required] string FirstName,
    [Required] string LastName,
    [EmailAddress] string? Email,
    [Required] DateTime HireDate,
    [StringLength(50)] string? Phone = null,
    Guid? JobId = null,
    Guid? PlaceId = null,
    Guid? EmploymentTypeId = null,
    Guid? ManagerId = null,
    Guid? OrgUnitId = null);

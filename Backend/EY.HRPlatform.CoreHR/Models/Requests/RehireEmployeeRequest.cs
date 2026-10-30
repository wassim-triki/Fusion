using System.ComponentModel.DataAnnotations;

namespace EY.HRPlatform.CoreHR.Models.Requests;

/// <summary>Request body for rehiring a previously employed worker effective a given date.</summary>
public sealed record RehireEmployeeRequest(
    [Required] DateTime EffectiveDate,
    [Required] Guid OrgUnitId,
    [Required] Guid JobId,
    Guid? PlaceId = null,
    Guid? ManagerId = null,
    Guid? EmploymentTypeId = null);

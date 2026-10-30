using EY.HRPlatform.CoreHR.Features.Employees.Dtos;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;

namespace EY.HRPlatform.CoreHR.Features.Employees.Commands.RehireEmployee;

/// <summary>
/// Command to rehire a previously employed worker: reuses the <c>Employee</c> and creates a new
/// <c>Employment</c>, a new primary <c>WorkAssignment</c>, and an optional manager relationship.
/// Never reopens a prior employment.
/// </summary>
public sealed record RehireEmployeeCommand(
    Guid EmployeeId,
    uint ExpectedVersion,
    DateTime EffectiveDate,
    Guid OrgUnitId,
    Guid JobId,
    Guid? PlaceId = null,
    Guid? ManagerId = null,
    Guid? EmploymentTypeId = null) : ICommand<Result<EmployeeDetailsDto>>;

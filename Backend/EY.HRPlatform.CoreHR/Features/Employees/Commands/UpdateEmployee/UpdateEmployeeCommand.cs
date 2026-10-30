using EY.HRPlatform.CoreHR.Features.Employees.Dtos;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;

namespace EY.HRPlatform.CoreHR.Features.Employees.Commands.UpdateEmployee;

/// <summary>
/// Command to update an existing employee's details.
/// Supports partial updates - null fields are ignored.
/// </summary>
/// <param name="ExpectedVersion">Row version for optimistic concurrency check.</param>
/// <param name="FirstName">New first name, or null to keep existing.</param>
/// <param name="LastName">New last name, or null to keep existing.</param>
/// <param name="PreferredName">New preferred name, null to keep existing, or empty to clear.</param>
/// <param name="Email">New email, or null to keep existing.</param>
/// <param name="JobId">New job from the catalogue, or null to keep existing.</param>
/// <param name="ManagerId">New manager ID, Guid.Empty to clear, or null to keep existing.</param>
/// <param name="OrgUnitId">New org unit ID, Guid.Empty to clear, or null to keep existing.</param>
/// <param name="HireDate">New hire date, or null to keep existing.</param>
public sealed record UpdateEmployeeCommand(
    Guid EmployeeId,
    uint ExpectedVersion,
    string? FirstName,
    string? LastName,
    string? PreferredName,
    string? Email,
    Guid? JobId,
    Guid? ManagerId,
    Guid? OrgUnitId = null,
    DateTime? HireDate = null,
    string? EmployeeNumber = null,
    string? Phone = null,
    Guid? PlaceId = null,
    Guid? EmploymentTypeId = null) : ICommand<Result<EmployeeDetailsDto>>
{
    public UpdateEmployeeCommand(
        Guid employeeId,
        uint expectedVersion,
        string? firstName,
        string? lastName,
        string? email,
        Guid? jobId,
        Guid? managerId,
        Guid? orgUnitId = null,
        DateTime? hireDate = null)
        : this(
            employeeId,
            expectedVersion,
            firstName,
            lastName,
            null,
            email,
            jobId,
            managerId,
            orgUnitId,
            hireDate)
    {
    }
}

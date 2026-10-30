using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;

namespace EY.HRPlatform.CoreHR.Features.People;

public enum EmployeeNumberMode
{
    Generated,
    Manual
}

public sealed record HireEmployeeRequest(
    string FirstName,
    string LastName,
    string? PreferredName,
    string? WorkEmail,
    string? Phone,
    EmployeeNumberMode EmployeeNumberMode,
    string? EmployeeNumber,
    DateTime StartDate,
    Guid? EmploymentTypeId,
    Guid OrgUnitId,
    Guid JobId,
    Guid? PlaceId,
    Guid? PrimaryManagerEmployeeId);

public sealed record AddExistingEmployeeRequest(
    string FirstName,
    string LastName,
    string? PreferredName,
    string? WorkEmail,
    string? Phone,
    EmployeeNumberMode EmployeeNumberMode,
    string? EmployeeNumber,
    DateTime EmploymentStart,
    DateTime WorkDetailsEffectiveFrom,
    Guid? EmploymentTypeId,
    Guid OrgUnitId,
    Guid JobId,
    Guid? PlaceId,
    Guid? PrimaryManagerEmployeeId);

public sealed record EstablishmentSuggestionDto(
    string EmployeeKey,
    string EmployeeNumber,
    string DisplayName,
    string Reason);

public sealed record EstablishmentReviewRequest(
    string FirstName,
    string LastName,
    string? WorkEmail,
    EmployeeNumberMode EmployeeNumberMode,
    string? EmployeeNumber);

public sealed record EstablishmentConflictDto(
    string Kind,
    string EmployeeKey,
    string EmployeeNumber,
    string DisplayName,
    string Message);

public sealed record EstablishmentReviewDto(
    EstablishmentConflictDto? Conflict,
    IReadOnlyList<EstablishmentSuggestionDto> Suggestions);

public sealed record EstablishmentReviewQuery(
    EstablishmentReviewRequest Request) : IQuery<Result<EstablishmentReviewDto>>;

public sealed record EstablishmentResultDto(
    string EmployeeKey,
    string EmployeeNumber,
    string DisplayName,
    string? WorkEmail,
    PeopleEmploymentState EmploymentState,
    DateTime EmploymentStart,
    DateTime WorkDetailsEffectiveFrom,
    string JobTitle,
    string OrganizationName,
    string OrganizationPath,
    string? Location,
    string? PrimaryManagerName,
    IReadOnlyList<EstablishmentSuggestionDto> ReviewSuggestions);

public sealed record HireEmployeeCommand(
    HireEmployeeRequest Request,
    string Actor) : ICommand<Result<EstablishmentResultDto>>;

public sealed record AddExistingEmployeeCommand(
    AddExistingEmployeeRequest Request,
    string Actor) : ICommand<Result<EstablishmentResultDto>>;

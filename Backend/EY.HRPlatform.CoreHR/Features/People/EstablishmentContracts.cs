using System.Text.Json;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;

namespace EY.HRPlatform.CoreHR.Features.People;

public enum EmployeeNumberMode
{
    Generated,
    Manual
}

/// <summary>When the new person is invited to Fusion; none means the company's usual rule. Now and FirstDay need a work email; FirstDay is for joiners.</summary>
public enum HireInvite
{
    FirstDay,
    Now,
    Later
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
    Guid? PrimaryManagerEmployeeId,
    /// <summary>An open role under the chosen manager that the person fills from their first day.</summary>
    Guid? OpenRoleId = null,
    HireInvite? Invite = null,
    /// <summary>Values for the company's own fields, by field key; every required one is needed.</summary>
    IReadOnlyDictionary<string, JsonElement>? Fields = null);

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
    Guid? PrimaryManagerEmployeeId,
    /// <summary>An open role under the chosen manager that the person fills from their first day.</summary>
    Guid? OpenRoleId = null,
    HireInvite? Invite = null,
    /// <summary>Values for the company's own fields, by field key; every required one is needed.</summary>
    IReadOnlyDictionary<string, JsonElement>? Fields = null);

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
    IReadOnlyList<EstablishmentSuggestionDto> ReviewSuggestions,
    /// <summary>Sent, FirstDay, Later, or NotSent when sending now failed.</summary>
    string Invitation = "Later");

/// <param name="CanInvite">Whether the caller may send invitations (access management).</param>
public sealed record HireEmployeeCommand(
    HireEmployeeRequest Request,
    string Actor,
    bool CanInvite = false) : ICommand<Result<EstablishmentResultDto>>;

public sealed record AddExistingEmployeeCommand(
    AddExistingEmployeeRequest Request,
    string Actor,
    bool CanInvite = false) : ICommand<Result<EstablishmentResultDto>>;

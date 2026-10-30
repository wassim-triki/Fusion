using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;

namespace EY.HRPlatform.CoreHR.Features.People;

public enum PeopleEmploymentState
{
    Active,
    Scheduled,
    Former,
    Incomplete
}

public enum PeopleOrganizationScope
{
    Direct,
    Subtree
}

public enum PeopleSortField
{
    Name,
    EmployeeNumber,
    EmploymentDate
}

public enum PeopleSortDirection
{
    Asc,
    Desc
}

public sealed record PeopleQuery(
    string? Q = null,
    PeopleEmploymentState? State = null,
    Guid? OrgUnitId = null,
    PeopleOrganizationScope OrganizationScope = PeopleOrganizationScope.Subtree,
    PeopleSortField Sort = PeopleSortField.Name,
    PeopleSortDirection Direction = PeopleSortDirection.Asc,
    int Page = 1,
    int PageSize = 25,
    /// <summary>Transient handoff filter: the cohort added by a completed Workforce Import session.</summary>
    Guid? ImportBatchId = null) : IQuery<Result<PeoplePageDto>>;

public sealed record PeopleManagerDto(
    string EmployeeKey,
    string DisplayName,
    string EmployeeNumber,
    /// <summary>API-relative photo address with a cache version, or null without a photo.</summary>
    string? PhotoUrl = null);

public sealed record PeopleWorkDto(
    Guid? OrgUnitId,
    string JobTitle,
    string OrganizationName,
    string OrganizationPath,
    string? Location,
    DateTime EffectiveFrom,
    bool IsHistorical,
    /// <summary>The job and place from the catalogue, with the job's family and level (profile only).</summary>
    Guid? JobId = null,
    Guid? PlaceId = null,
    string? JobFamily = null,
    string? JobLevel = null);

public sealed record PeopleRowDto(
    string EmployeeKey,
    string EmployeeNumber,
    string DisplayName,
    string FirstName,
    string LastName,
    string? WorkEmail,
    PeopleEmploymentState EmploymentState,
    DateTime? EmploymentStart,
    DateTime? EmploymentEnd,
    PeopleWorkDto? Work,
    PeopleManagerDto? PrimaryManager,
    string Completeness,
    /// <summary>API-relative photo address with a cache version, or null without a photo.</summary>
    string? PhotoUrl = null);

public sealed record PeoplePageDto(
    IReadOnlyList<PeopleRowDto> Items,
    int TotalCount,
    int Page,
    int PageSize,
    int TotalPages);

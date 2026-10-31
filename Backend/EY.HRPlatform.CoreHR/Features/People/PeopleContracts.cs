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

/// <summary>People's views (D-13). Everyone is today's and future people; Left holds former ones.</summary>
public enum PeopleView
{
    Everyone,
    StartingSoon,
    Leaving,
    NotSignedIn,
    Left
}

/// <summary>Whether and how a person signs in to Fusion, as Identity sees it now.</summary>
public enum PeopleSignInState
{
    SignsIn,
    Invited,
    Expired,
    NotInvited,
    NoEmail,
    Suspended
}

public sealed record PeopleSignInDto(
    PeopleSignInState State,
    /// <summary>Last sign-in, when the invitation was sent, or when it expired.</summary>
    DateTime? At);

/// <summary>A company Tags field People can filter on, with the values people hold.</summary>
public sealed record PeopleFieldFacetDto(string Key, string Label, IReadOnlyList<string> Values);

public sealed record PeopleViewCountsDto(int Everyone, int StartingSoon, int Leaving, int? NotSignedIn, int Left);

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
    Guid? ImportBatchId = null,
    PeopleView? View = null,
    Guid? JobId = null,
    Guid? PlaceId = null,
    string? ManagerKey = null,
    /// <summary>The company's own Tags fields: field key → a value the person must have.</summary>
    IReadOnlyDictionary<string, string>? Fields = null,
    /// <summary>Set when the viewer may see Fusion access: rows carry sign-in and the Not signed in view counts.</summary>
    bool IncludeSignIn = false,
    /// <summary>Every matching row in one page (export).</summary>
    bool Unpaged = false) : IQuery<Result<PeoplePageDto>>;

public sealed record PeopleManagerDto(
    string EmployeeKey,
    string DisplayName,
    string EmployeeNumber,
    /// <summary>API-relative photo address with a cache version, or null without a photo.</summary>
    string? PhotoUrl = null,
    /// <summary>Set on a profile's primary manager, so a manager's own client knows the person is on their team.</summary>
    Guid? EmployeeId = null);

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
    string? PhotoUrl = null,
    /// <summary>Only for viewers who may see Fusion access.</summary>
    PeopleSignInDto? SignIn = null,
    /// <summary>The worker's id, which invitations and other modules key by.</summary>
    Guid? EmployeeId = null);

public sealed record PeoplePageDto(
    IReadOnlyList<PeopleRowDto> Items,
    int TotalCount,
    int Page,
    int PageSize,
    int TotalPages,
    /// <summary>How many people each view holds under the other filters.</summary>
    PeopleViewCountsDto? Views = null,
    IReadOnlyList<PeopleFieldFacetDto>? Facets = null);

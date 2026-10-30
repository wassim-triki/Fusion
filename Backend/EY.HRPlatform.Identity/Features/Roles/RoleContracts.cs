namespace EY.HRPlatform.Identity.Features.Roles;

/// <summary>A catalogue grant an option holds, so the editor can show linked areas move together as saving would.</summary>
public sealed record RoleGrantDto(string Key, string Scope);

/// <summary>One setting an area offers: a level, whose records when the area has a reach, and the grants behind it.</summary>
public sealed record RoleAreaOptionDto(string Level, string? Reach, IReadOnlyList<RoleGrantDto> Defining, IReadOnlyList<RoleGrantDto> Companions);

/// <summary>An area of the roles model as the company sees it (only the modules it has).</summary>
public sealed record RoleAreaDto(string Id, string Group, bool AdministratorsOnly, IReadOnlyList<RoleAreaOptionDto> Options);

/// <summary>A role's setting in one area.</summary>
public sealed record RoleCellDto(string AreaId, string Level, string? Reach);

/// <summary>One value of a role's rule: a department, job, place or unit, by its Core HR id.</summary>
public sealed record RoleConditionDto(string Kind, Guid TargetId);

public sealed record RoleFaceDto(Guid UserId, Guid? EmployeeId, string Name);

public sealed record RoleSummaryDto(
    Guid Id,
    string Name,
    string? Description,
    bool IsBuiltIn,
    bool IsAdministrators,
    bool IsLocked,
    string HolderKind,
    IReadOnlyList<RoleConditionDto> Conditions,
    int HolderCount,
    IReadOnlyList<RoleFaceDto> Faces,
    IReadOnlyList<RoleCellDto> Cells,
    uint Version,
    DateTime? UpdatedAt);

public sealed record RoleChangeDto(DateTime At, string ActorName, string RoleName);

public sealed record RolesOverviewDto(
    IReadOnlyList<RoleAreaDto> Areas,
    IReadOnlyList<RoleSummaryDto> Roles,
    RoleChangeDto? LastChange);

/// <summary>Someone who holds the role, and whether by name, by its holders, or both.</summary>
public sealed record RoleHolderDto(Guid UserId, Guid? EmployeeId, string Name, string? Email, bool IsChosen, bool ByRule);

public sealed record RoleDetailDto(RoleSummaryDto Role, IReadOnlyList<RoleAreaDto> Areas, IReadOnlyList<RoleHolderDto> Holders);

public sealed record CreateRoleRequest(string Name, string? Description);

/// <param name="ChosenUserIds">The accounts chosen by name (they must already sign in to this company).</param>
public sealed record SaveRoleRequest(
    string Name,
    string? Description,
    IReadOnlyList<RoleCellDto> Cells,
    string HolderKind,
    IReadOnlyList<RoleConditionDto> Conditions,
    IReadOnlyList<Guid> ChosenUserIds);

/// <summary>Why a person has a role: everyone, has a team, a rule (with the conditions they meet), chosen, administrator.</summary>
public sealed record PersonRoleReasonDto(string Kind, IReadOnlyList<RoleConditionDto> Conditions, int? DirectReports);

public sealed record PersonRoleDto(Guid RoleId, string Name, bool IsAdministrators, IReadOnlyList<PersonRoleReasonDto> Reasons);

/// <summary>A person who signs in and can be chosen for a role.</summary>
public sealed record RoleCandidateDto(Guid UserId, Guid EmployeeId, string Name, string? Email);

public static class PersonRoleReasons
{
    public const string Everyone = "everyone";
    public const string Team = "team";
    public const string Rule = "rule";
    public const string Chosen = "chosen";
    public const string Administrator = "administrator";
}

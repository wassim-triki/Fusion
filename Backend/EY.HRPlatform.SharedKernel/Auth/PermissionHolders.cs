namespace EY.HRPlatform.SharedKernel.Auth;

/// <summary>
/// Asks Identity which active accounts of a tenant hold a permission at or above a scope.
/// Services use it when they must name another user by capability (for example a
/// calibration facilitator) and cannot read that user's token.
/// </summary>
public sealed record PermissionHoldersRequest(Guid TenantId, string PermissionKey, string Scope);

public sealed record PermissionHolder(Guid UserId, Guid? EmployeeId, string DisplayName, string Email);

/// <summary>
/// Asks Identity which of a tenant's roles hold any of these permissions, and at what scope. Lets a page say who
/// sees something by role (the Personal tab's "who sees each", B-214) without reading anyone's token.
/// </summary>
public sealed record PermissionRolesRequest(Guid TenantId, IReadOnlyList<string> PermissionKeys);

/// <param name="IsAdministrators">The protected Administrators role, which holds everything.</param>
public sealed record PermissionRole(string Name, string PermissionKey, string Scope, bool IsAdministrators);

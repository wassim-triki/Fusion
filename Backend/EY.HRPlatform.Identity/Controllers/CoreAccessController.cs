using EY.HRPlatform.Identity.Features.Notifications;
using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.Identity.Features.Roles;
using EY.HRPlatform.Identity.Models.Requests;
using EY.HRPlatform.Identity.Models.Responses;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ApiResponse = EY.HRPlatform.SharedKernel.Api.ApiResponse;

namespace EY.HRPlatform.Identity.Controllers;

[ApiController]
[Route("api/identity/core-access")]
[Authorize]
public sealed class CoreAccessController(
    IAccessProfileService accessProfileService,
    IAccessAuditService accessAuditService,
    IRoleService roles,
    ITenantContext tenantContext,
    IAdministratorRoleMail roleMail) : ControllerBase
{
    [HttpGet("me")]
    [ProducesResponseType(typeof(ApiResponse<CurrentUserAccessDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<CurrentUserAccessDto>>> GetCurrentUserAccess(CancellationToken cancellationToken)
    {
        var userId = User.GetUserId();
        var tenantId = ResolveTenantId();
        if (!tenantId.HasValue)
        {
            return BadRequest(ApiResponse<CurrentUserAccessDto>.Failure("Tenant context is required."));
        }

        var user = new Domain.Entities.ApplicationUser
        {
            Id = userId,

            Email = User.GetEmail(),
            FirstName = User.GetFullName(),
            LastName = string.Empty,
            EmployeeId = User.GetEmployeeId(),
        };

        var response = await accessProfileService.GetCurrentUserAccessAsync(user, cancellationToken);
        return Ok(ApiResponse<CurrentUserAccessDto>.Success(response));
    }

    [HttpGet("profiles")]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<AccessProfileSummaryDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<AccessProfileSummaryDto>>>> GetProfiles(CancellationToken cancellationToken)
    {
        var tenantId = ResolveTenantId();
        if (!tenantId.HasValue)
        {
            return BadRequest(ApiResponse<IReadOnlyList<AccessProfileSummaryDto>>.Failure("Tenant context is required."));
        }

        if (!CanReadAccessProfiles())
        {
            return Forbid();
        }

        var response = await accessProfileService.GetProfilesAsync(tenantId.Value, cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<AccessProfileSummaryDto>>.Success(response));
    }

    [HttpGet("audit")]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<AccessAuditEventDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<AccessAuditEventDto>>>> GetAudit(
        [FromQuery] int take = 50,
        CancellationToken cancellationToken = default)
    {
        var tenantId = ResolveTenantId();
        if (!tenantId.HasValue)
        {
            return BadRequest(ApiResponse<IReadOnlyList<AccessAuditEventDto>>.Failure("Tenant context is required."));
        }

        if (!CanReadAccessAudit())
        {
            return Forbid();
        }

        var response = await accessAuditService.GetRecentAsync(tenantId.Value, take, cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<AccessAuditEventDto>>.Success(response));
    }

    [HttpGet("profiles/{profileId:guid}")]
    [ProducesResponseType(typeof(ApiResponse<AccessProfileSummaryDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ApiResponse<AccessProfileSummaryDto>>> GetProfile(Guid profileId, CancellationToken cancellationToken)
    {
        var tenantId = ResolveTenantId();
        if (!tenantId.HasValue)
        {
            return BadRequest(ApiResponse<AccessProfileSummaryDto>.Failure("Tenant context is required."));
        }

        if (!CanReadAccessProfiles())
        {
            return Forbid();
        }

        var response = await accessProfileService.GetProfileAsync(tenantId.Value, profileId, cancellationToken);
        return response is null
            ? NotFound(ApiResponse<AccessProfileSummaryDto>.Failure("Access profile not found."))
            : Ok(ApiResponse<AccessProfileSummaryDto>.Success(response));
    }

    [HttpGet("roles")]
    public async Task<ActionResult<ApiResponse<RolesOverviewDto>>> GetRoles(CancellationToken cancellationToken)
    {
        var tenantId = ResolveTenantId();
        if (!tenantId.HasValue)
            return BadRequest(ApiResponse<RolesOverviewDto>.Failure("Tenant context is required."));
        if (!CanReadAccessProfiles())
            return Forbid();

        return Ok(ApiResponse<RolesOverviewDto>.Success(await roles.GetOverviewAsync(tenantId.Value, cancellationToken)));
    }

    [HttpGet("roles/{roleId:guid}")]
    public async Task<ActionResult<ApiResponse<RoleDetailDto>>> GetRole(Guid roleId, CancellationToken cancellationToken)
    {
        var tenantId = ResolveTenantId();
        if (!tenantId.HasValue)
            return BadRequest(ApiResponse<RoleDetailDto>.Failure("Tenant context is required."));
        if (!CanReadAccessProfiles())
            return Forbid();

        try
        {
            var role = await roles.GetRoleAsync(tenantId.Value, roleId, cancellationToken);
            Response.Headers.ETag = $"\"{role.Role.Version}\"";
            return Ok(ApiResponse<RoleDetailDto>.Success(role));
        }
        catch (RoleNotFoundException)
        {
            return NotFound(ApiResponse<RoleDetailDto>.Failure("Role not found."));
        }
    }

    /// <summary>People who sign in and can be chosen for a role.</summary>
    [HttpGet("roles/candidates")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<RoleCandidateDto>>>> GetCandidates(
        [FromQuery] string? search, CancellationToken cancellationToken)
    {
        var tenantId = ResolveTenantId();
        if (!tenantId.HasValue)
            return BadRequest(ApiResponse<IReadOnlyList<RoleCandidateDto>>.Failure("Tenant context is required."));
        if (!CanManageAccessProfiles())
            return Forbid();

        return Ok(ApiResponse<IReadOnlyList<RoleCandidateDto>>.Success(await roles.FindCandidatesAsync(tenantId.Value, search, cancellationToken)));
    }

    [HttpPost("roles")]
    public async Task<ActionResult<ApiResponse<RoleDetailDto>>> CreateRole([FromBody] CreateRoleRequest request, CancellationToken cancellationToken)
    {
        var tenantId = ResolveTenantId();
        if (!tenantId.HasValue)
            return BadRequest(ApiResponse<RoleDetailDto>.Failure("Tenant context is required."));
        if (!CanManageAccessProfiles())
            return Forbid();

        try
        {
            var role = await roles.CreateRoleAsync(tenantId.Value, request, cancellationToken);
            await accessAuditService.RecordAsync(tenantId.Value, "access.profile.created", "AccessProfile", role.Role.Id.ToString(),
                $"Role '{role.Role.Name}' created.", null, role.Role, User, cancellationToken);
            return CreatedAtAction(nameof(GetRole), new { roleId = role.Role.Id }, ApiResponse<RoleDetailDto>.Success(role));
        }
        catch (InvalidOperationException exception)
        {
            return BadRequest(ApiResponse<RoleDetailDto>.Failure(exception.Message));
        }
    }

    [HttpPut("roles/{roleId:guid}")]
    public async Task<ActionResult<ApiResponse<RoleDetailDto>>> SaveRole(
        Guid roleId,
        [FromBody] SaveRoleRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        CancellationToken cancellationToken)
    {
        var tenantId = ResolveTenantId();
        if (!tenantId.HasValue)
            return BadRequest(ApiResponse<RoleDetailDto>.Failure("Tenant context is required."));
        if (!CanManageAccessProfiles())
            return Forbid();
        if (!TryParseVersion(ifMatch, out var version))
            return Conflict(ApiResponse<RoleDetailDto>.Failure("If-Match header with a valid version is required."));

        try
        {
            var before = await roles.GetRoleAsync(tenantId.Value, roleId, cancellationToken);
            var after = await roles.SaveRoleAsync(tenantId.Value, roleId, version, request, cancellationToken);
            await accessAuditService.RecordAsync(tenantId.Value, "access.profile.updated", "AccessProfile", roleId.ToString(),
                $"Role '{after.Role.Name}' updated.", before.Role, after.Role, User, cancellationToken);
            await roleMail.SendProfileChangesAsync(tenantId.Value, User.GetUserId(), HolderChanges(roleId, before, after), cancellationToken);
            Response.Headers.ETag = $"\"{after.Role.Version}\"";
            return Ok(ApiResponse<RoleDetailDto>.Success(after));
        }
        catch (RoleNotFoundException)
        {
            return NotFound(ApiResponse<RoleDetailDto>.Failure("Role not found."));
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict(ApiResponse<RoleDetailDto>.Failure("Someone changed this role since you opened it."));
        }
        catch (InvalidOperationException exception)
        {
            return BadRequest(ApiResponse<RoleDetailDto>.Failure(exception.Message));
        }
        catch (HttpRequestException)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                ApiResponse<RoleDetailDto>.Failure("Fusion couldn't check the rule's departments, jobs, places and units. Try again."));
        }
    }

    [HttpDelete("roles/{roleId:guid}")]
    public async Task<IActionResult> DeleteRole(Guid roleId, CancellationToken cancellationToken)
    {
        var tenantId = ResolveTenantId();
        if (!tenantId.HasValue)
            return BadRequest(ApiResponse.Failure("Tenant context is required."));
        if (!CanManageAccessProfiles())
            return Forbid();

        try
        {
            var before = await roles.GetRoleAsync(tenantId.Value, roleId, cancellationToken);
            await roles.DeleteRoleAsync(tenantId.Value, roleId, cancellationToken);
            await accessAuditService.RecordAsync(tenantId.Value, "access.profile.deleted", "AccessProfile", roleId.ToString(),
                $"Role '{before.Role.Name}' deleted.", before.Role, null, User, cancellationToken);
            return NoContent();
        }
        catch (RoleNotFoundException)
        {
            return NotFound(ApiResponse.Failure("Role not found."));
        }
        catch (InvalidOperationException exception)
        {
            return BadRequest(ApiResponse.Failure(exception.Message));
        }
    }

    /// <summary>A person's roles and why they have each (their Access tab). Someone without an account has none.</summary>
    [HttpGet("people/{employeeId:guid}/roles")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<PersonRoleDto>>>> GetPersonRoles(Guid employeeId, CancellationToken cancellationToken)
    {
        var tenantId = ResolveTenantId();
        if (!tenantId.HasValue)
            return BadRequest(ApiResponse<IReadOnlyList<PersonRoleDto>>.Failure("Tenant context is required."));
        if (!CanReadAccessProfiles() && User.GetEmployeeId() != employeeId)
            return Forbid();

        var result = await roles.GetPersonRolesAsync(tenantId.Value, employeeId, cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<PersonRoleDto>>.Success(result ?? []));
    }

    /// <summary>Who gained or lost the role, for the administrator-role mail.</summary>
    private static IReadOnlyList<(Guid UserId, IReadOnlyCollection<Guid> Before, IReadOnlyCollection<Guid> After)> HolderChanges(
        Guid roleId, RoleDetailDto before, RoleDetailDto after)
    {
        var was = before.Holders.Select(holder => holder.UserId).ToHashSet();
        var now = after.Holders.Select(holder => holder.UserId).ToHashSet();
        return was.Union(now)
            .Where(userId => was.Contains(userId) != now.Contains(userId))
            .Select(userId => (userId,
                (IReadOnlyCollection<Guid>)(was.Contains(userId) ? [roleId] : []),
                (IReadOnlyCollection<Guid>)(now.Contains(userId) ? [roleId] : [])))
            .ToList();
    }

    private Guid? ResolveTenantId()
        => tenantContext.TenantIdOrDefault;

    private bool CanReadAccessProfiles()
        => CanManageAccessProfiles()
            || User.HasCorePermission(CorePermissions.AccessProfilesView, PermissionScopes.Tenant)
            || User.HasCorePermission(CorePermissions.AccessView, PermissionScopes.Tenant)
            || User.HasCorePermission(CorePermissions.AccessManage, PermissionScopes.Tenant)
            || User.HasCorePermission(CorePermissions.SettingsProvisioningView, PermissionScopes.Tenant)
            || User.HasCorePermission(CorePermissions.SettingsProvisioningManage, PermissionScopes.Tenant);

    private bool CanManageAccessProfiles()
        => User.HasCorePermission(CorePermissions.AccessProfilesManageV2, PermissionScopes.Tenant)
            || User.HasCorePermission(CorePermissions.AccessProfilesManage, PermissionScopes.Tenant);

    private bool CanReadAccessAudit()
        => User.HasCorePermission(CorePermissions.SettingsGovernanceView, PermissionScopes.Tenant)
            || CanReadAccessProfiles();

    private static bool TryParseVersion(string? ifMatch, out uint version)
    {
        version = 0;
        if (string.IsNullOrWhiteSpace(ifMatch))
        {
            return false;
        }

        return uint.TryParse(ifMatch.Trim().Trim('"'), out version);
    }
}

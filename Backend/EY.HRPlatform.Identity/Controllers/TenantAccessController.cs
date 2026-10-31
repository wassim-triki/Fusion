using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Features.TenantAdministration;
using EY.HRPlatform.Identity.Models.Responses;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Controllers;

public sealed record AdministratorActionRequest(string? Reason);

/// <param name="UserId">Someone in this company who already signs in.</param>
/// <param name="Password">The caller's own password, asked again for every administrator they add.</param>
public sealed record AddAdministratorRequest(Guid UserId, string? Password);

/// <summary>
/// The customer Access Management surface: who administers this tenant, who has
/// been invited to, and what has happened to that access.
/// <para>
/// Every refusal carries a stable problem type, so the workspace can distinguish
/// a duplicate invitation from an existing account from the final-administrator
/// rule from a stale screen — each of which the person resolves differently.
/// </para>
/// </summary>
[ApiController]
[Route("api/identity/tenant-access")]
[Authorize]
public sealed class TenantAccessController(
    ITenantAccessProjection projection,
    ITenantAdministratorLifecycleService lifecycle,
    AppIdentityDbContext dbContext,
    UserManager<ApplicationUser> userManager,
    ITenantContext tenantContext) : ControllerBase
{
    // ── Reads ────────────────────────────────────────────

    [HttpGet("summary")]
    public async Task<IActionResult> Summary(CancellationToken cancellationToken)
        => Resolve(out var tenantId, requireManage: false, out var refusal)
            ? Success(await projection.GetSummaryAsync(tenantId, cancellationToken))
            : refusal;

    /// <summary>Who administers the company; anyone who can read roles sees them, as the roles table does.</summary>
    [HttpGet("administrators")]
    public async Task<IActionResult> Administrators(CancellationToken cancellationToken)
        => Resolve(out var tenantId, requireManage: false, out var refusal, rolesReaders: true)
            ? Success(await projection.GetAdministratorsAsync(tenantId, cancellationToken))
            : refusal;

    /// <summary>Every grant and removal of administrator authority, newest first.</summary>
    [HttpGet("administrators/history")]
    public async Task<IActionResult> History(CancellationToken cancellationToken)
        => Resolve(out var tenantId, requireManage: false, out var refusal, rolesReaders: true)
            ? Success(await projection.GetAdministratorHistoryAsync(tenantId, cancellationToken))
            : refusal;

    /// <summary>Who could be added: people who sign in, and people invited who haven't yet (shown, not choosable).</summary>
    [HttpGet("administrators/candidates")]
    public async Task<IActionResult> Candidates([FromQuery] string? search, CancellationToken cancellationToken)
        => Resolve(out var tenantId, requireManage: true, out var refusal)
            ? Success(await projection.GetAdministratorCandidatesAsync(tenantId, search, cancellationToken))
            : refusal;

    [HttpGet("administrators/removed")]
    public async Task<IActionResult> RemovedAdministrators(CancellationToken cancellationToken)
        => Resolve(out var tenantId, requireManage: false, out var refusal)
            ? Success(await projection.GetRemovedAdministratorsAsync(tenantId, cancellationToken))
            : refusal;

    [HttpGet("invitations")]
    public async Task<IActionResult> Invitations(
        [FromQuery] bool includeHistorical, CancellationToken cancellationToken)
        => Resolve(out var tenantId, requireManage: false, out var refusal)
            ? Success(await projection.GetInvitationsAsync(tenantId, includeHistorical, cancellationToken))
            : refusal;

    [HttpGet("activity")]
    public async Task<IActionResult> Activity(
        [FromQuery] DateTime? cursorOccurredAt,
        [FromQuery] Guid? cursorId,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] string? category,
        [FromQuery] int pageSize,
        CancellationToken cancellationToken)
        => Resolve(out var tenantId, requireManage: false, out var refusal)
            ? Success(await projection.GetActivityPageAsync(
                tenantId, cursorOccurredAt, cursorId, from, to, category,
                pageSize == 0 ? 25 : pageSize, cancellationToken))
            : refusal;

    [HttpGet("activity/recent")]
    public async Task<IActionResult> RecentActivity(CancellationToken cancellationToken)
        => Resolve(out var tenantId, requireManage: false, out var refusal)
            ? Success(await projection.GetRecentActivityAsync(tenantId, 5, cancellationToken))
            : refusal;

    // ── Administrator lifecycle ──────────────────────────

    [HttpPost("administrators/{membershipId:guid}/suspend")]
    public async Task<IActionResult> Suspend(
        Guid membershipId, [FromBody] AdministratorActionRequest? request, CancellationToken cancellationToken)
        => Resolve(out var tenantId, requireManage: true, out var refusal)
            ? Translate(await lifecycle.SuspendAsync(
                Command(tenantId, membershipId, request?.Reason), cancellationToken))
            : refusal;

    [HttpPost("administrators/{membershipId:guid}/reactivate")]
    public async Task<IActionResult> Reactivate(
        Guid membershipId, CancellationToken cancellationToken)
        => Resolve(out var tenantId, requireManage: true, out var refusal)
            ? Translate(await lifecycle.ReactivateAsync(
                Command(tenantId, membershipId, null), cancellationToken))
            : refusal;

    /// <summary>
    /// Makes someone who already signs in an administrator. Asks for the caller's own password every time, so an
    /// unattended session can't hand out the company; five wrong tries lock the check for a few minutes.
    /// </summary>
    [HttpPost("administrators")]
    public async Task<IActionResult> AddAdministrator(
        [FromBody] AddAdministratorRequest request, CancellationToken cancellationToken)
    {
        if (!Resolve(out var tenantId, requireManage: true, out var refusal))
        {
            return refusal;
        }

        var actorId = User.GetUserId();
        var actor = await dbContext.Users.IgnoreQueryFilters()
            .FirstOrDefaultAsync(user => user.Id == actorId, cancellationToken);
        if (actor is null)
        {
            return Problem("permission-denied", "You do not have permission to perform this action.", StatusCodes.Status403Forbidden);
        }

        if (await userManager.IsLockedOutAsync(actor))
        {
            return Problem("password-locked", "Too many wrong passwords. Try again in a few minutes.", StatusCodes.Status429TooManyRequests);
        }

        if (string.IsNullOrEmpty(request.Password) || string.IsNullOrEmpty(actor.PasswordHash)
            || userManager.PasswordHasher.VerifyHashedPassword(actor, actor.PasswordHash, request.Password) == PasswordVerificationResult.Failed)
        {
            await userManager.AccessFailedAsync(actor);
            return Problem("password-incorrect", "That isn't your password.", StatusCodes.Status403Forbidden);
        }

        await userManager.ResetAccessFailedCountAsync(actor);

        // Only someone who already signs in to this company: an Active membership on an active account with a
        // password. Fusion's own staff hold no membership, and are refused here even if one existed.
        var membership = await dbContext.TenantMemberships.IgnoreQueryFilters()
            .Where(item => item.TenantId == tenantId && item.UserId == request.UserId
                && item.Status == TenantMembershipStatus.Active
                && item.User!.IsActive && item.User!.PasswordHash != null)
            .Select(item => new { item.Id, item.UserId })
            .FirstOrDefaultAsync(cancellationToken);
        var isOperator = membership is not null && await (
                from userRole in dbContext.UserRoles
                join role in dbContext.Roles on userRole.RoleId equals role.Id
                where userRole.UserId == membership.UserId && role.Name == PlatformRole.PlatformAdmin
                select userRole.UserId)
            .AnyAsync(cancellationToken);
        if (membership is null || isOperator)
        {
            return Problem("not-eligible", "Only people who already sign in to this company can be made administrators.",
                StatusCodes.Status409Conflict);
        }

        return Translate(await lifecycle.GrantAuthorityAsync(Command(tenantId, membership.Id, null), cancellationToken));
    }

    /// <summary>Covers self-removal: the actor names their own membership.</summary>
    [HttpPost("administrators/{membershipId:guid}/authority:revoke")]
    public async Task<IActionResult> RevokeAuthority(
        Guid membershipId, [FromBody] AdministratorActionRequest? request, CancellationToken cancellationToken)
        => Resolve(out var tenantId, requireManage: true, out var refusal)
            ? Translate(await lifecycle.RevokeAuthorityAsync(
                Command(tenantId, membershipId, request?.Reason), cancellationToken))
            : refusal;

    // ── plumbing ─────────────────────────────────────────

    private AdministratorCommand Command(Guid tenantId, Guid membershipId, string? reason)
        => new(tenantId, membershipId, User.GetUserId(), ReadIfMatch(), reason);

    /// <summary>
    /// The version of the administrator's state the caller was looking at, echoed
    /// from the projection. Absent means the caller is making no claim about what
    /// they saw, so there is nothing to conflict with.
    /// </summary>
    private uint? ReadIfMatch()
    {
        var header = Request.Headers.IfMatch.FirstOrDefault()?.Trim('"');
        return uint.TryParse(header, out var version) ? version : null;
    }

    /// <summary>
    /// Resolves the tenant and the caller's authority together, because a request
    /// with no tenant context and a request from someone without permission are
    /// different refusals with different recoveries.
    /// </summary>
    private bool Resolve(out Guid tenantId, bool requireManage, out IActionResult refusal, bool rolesReaders = false)
    {
        tenantId = Guid.Empty;
        refusal = Problem(
            type: "tenant-context-invalid",
            title: "A customer tenant context is required.",
            statusCode: StatusCodes.Status403Forbidden);

        var resolved = tenantContext.TenantIdOrDefault;

        if (resolved is null || resolved == Guid.Empty)
        {
            return false;
        }

        var permitted = requireManage
            ? User.HasCorePermission(CorePermissions.AccessAssignmentsManage, PermissionScopes.Tenant)
            : User.HasCorePermission(CorePermissions.AccessAssignmentsView, PermissionScopes.Tenant)
              || User.HasCorePermission(CorePermissions.AccessAssignmentsManage, PermissionScopes.Tenant)
              || (rolesReaders
                  && (User.HasCorePermission(CorePermissions.AccessProfilesView, PermissionScopes.Tenant)
                      || User.HasCorePermission(CorePermissions.AccessProfilesManageV2, PermissionScopes.Tenant)));

        if (!permitted)
        {
            refusal = Problem(
                type: "permission-denied",
                title: "You do not have permission to manage Tenant Administrators.",
                statusCode: StatusCodes.Status403Forbidden);
            return false;
        }

        tenantId = resolved.Value;
        return true;
    }

    private IActionResult Translate<T>(ContinuityResult<T> result) => result.Failure switch
    {
        ContinuityFailure.None => Success(result.Value),
        ContinuityFailure.TooFewAdministrators => Problem(
            "too-few-administrators",
            TenantAccessProjection.FinalAdministratorReason,
            StatusCodes.Status409Conflict),
        // States the conflict only. Whether anything was reloaded is a fact about
        // the caller, not about this response, and asserting it here made the
        // message untrue for every client that did not refetch.
        ContinuityFailure.StaleState => Problem(
            "stale-state",
            "Administrator access changed while you were reviewing it.",
            StatusCodes.Status409Conflict),
        ContinuityFailure.NotFound => Problem(
            "not-found", "That administrator no longer exists.", StatusCodes.Status404NotFound),
        ContinuityFailure.NotApplicable => Problem(
            "not-applicable", result.Reason ?? "That action no longer applies.", StatusCodes.Status409Conflict),
        ContinuityFailure.NotAuthorized => Problem(
            "permission-denied", "You do not have permission to perform this action.",
            StatusCodes.Status403Forbidden),
        _ => Problem("unexpected", "The request could not be completed.", StatusCodes.Status500InternalServerError),
    };

    private IActionResult Problem(string type, string title, int statusCode)
        => StatusCode(
            statusCode,
            ApiResponse<object>.Failure(title, new { code = type }));

    private IActionResult Success<T>(T value)
        => Ok(ApiResponse<T>.Success(value));
}

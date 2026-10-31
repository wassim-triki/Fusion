using System.Text.Json;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.Accounts;
using EY.HRPlatform.Identity.Features.Roles;
using EY.HRPlatform.Identity.Features.TenantAdministration;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Infrastructure.Services;
using EY.HRPlatform.Identity.Models.Responses;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Controllers;

public sealed record StartViewAsRequest(Guid UserId);

/// <param name="Roles">The person's roles, for the bar ("Manager", "Employee").</param>
/// <param name="Session">The person's own session: their token, marked read-only, with no refresh token.</param>
public sealed record ViewAsSessionDto(
    Guid SessionId, string ViewerName, string PersonName, DateTime ExpiresAt, IReadOnlyList<PersonRoleDto> Roles, AuthResponse Session);

/// <summary>
/// Seeing Fusion as someone (D-25): an administrator gets the person's real authority, read-only, for up to 30
/// minutes, and the view is recorded in Change history. Nothing is faked in the browser: every service answers the
/// person's token as it would answer them, and refuses every change because the token is a view.
/// </summary>
[ApiController]
[Route("api/identity/view-as")]
[Authorize]
public sealed class ViewAsController(
    AppIdentityDbContext dbContext,
    IAuthSessionFactory sessions,
    IRoleService roles,
    ITenantContext tenantContext) : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<ApiResponse<ViewAsSessionDto>>> Start(
        [FromBody] StartViewAsRequest request, CancellationToken cancellationToken)
    {
        if (tenantContext.TenantIdOrDefault is not { } tenantId || tenantId == Guid.Empty)
        {
            return StatusCode(StatusCodes.Status403Forbidden, ApiResponse<ViewAsSessionDto>.Failure("A company is required."));
        }

        // Only an administrator who can still act for this company; Fusion's operators carry no company at all.
        var viewerId = User.GetUserId();
        var viewerMembershipId = await UsableTenantAdministrator.ForTenant(dbContext, tenantId)
            .Where(assignment => assignment.UserId == viewerId)
            .Select(assignment => (Guid?)assignment.TenantMembershipId)
            .FirstOrDefaultAsync(cancellationToken);
        if (viewerMembershipId is null)
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                ApiResponse<ViewAsSessionDto>.Failure("Only administrators can see Fusion as someone."));
        }

        if (request.UserId == viewerId)
        {
            return BadRequest(ApiResponse<ViewAsSessionDto>.Failure("You already see Fusion as yourself."));
        }

        // Someone who signs in to this company, by an Active membership; another company's people aren't found.
        var target = await dbContext.TenantMemberships
            .IgnoreQueryFilters()
            .Where(membership => membership.TenantId == tenantId
                && membership.UserId == request.UserId
                && membership.Status == TenantMembershipStatus.Active
                && membership.User!.IsActive)
            .Select(membership => new { membership.Id, membership.EmployeeId, User = membership.User! })
            .FirstOrDefaultAsync(cancellationToken);
        if (target is null)
        {
            return NotFound(ApiResponse<ViewAsSessionDto>.Failure("That person doesn't sign in to this company."));
        }

        var now = DateTime.UtcNow;
        var session = ViewAsSession.Start(tenantId, viewerId, viewerMembershipId.Value, target.User.Id, target.Id, now);
        dbContext.ViewAsSessions.Add(session);
        dbContext.AccessAuditEvents.Add(AccessAuditEvent.Create(
            tenantId,
            viewerId,
            User.GetFullName(),
            TenantAdministratorAuthority.DisplayName,
            AccessAuditActions.SeenAs,
            AccessAuditActions.ResourceTypeMembership,
            target.Id.ToString(),
            $"Fusion seen as {target.User.FullName.Trim()}.",
            beforeJson: null,
            afterJson: JsonSerializer.Serialize(new { person = target.User.FullName.Trim(), until = session.ExpiresAt }),
            correlationId: HttpContext.TraceIdentifier));
        await dbContext.SaveChangesAsync(cancellationToken);

        var auth = await sessions.CreateViewAsync(target.User, new ViewAsToken(session.Id, viewerId, session.ExpiresAt), cancellationToken);
        if (auth.TenantId != tenantId)
        {
            // Their one company isn't this one (they belong to several), so their token couldn't show it.
            session.End(DateTime.UtcNow);
            await dbContext.SaveChangesAsync(cancellationToken);
            return Conflict(ApiResponse<ViewAsSessionDto>.Failure("Fusion can't show this company as that person."));
        }

        var theirRoles = target.EmployeeId is { } employeeId
            ? await roles.GetPersonRolesAsync(tenantId, employeeId, cancellationToken) ?? []
            : [];
        return Ok(ApiResponse<ViewAsSessionDto>.Success(new ViewAsSessionDto(
            session.Id, User.GetFullName(), target.User.FullName.Trim(), session.ExpiresAt, theirRoles, auth)));
    }

    /// <summary>Ends the view this token belongs to; the one change a view token can make.</summary>
    [HttpPost("end")]
    public async Task<IActionResult> End(CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirst(CustomClaimTypes.ViewSession)?.Value, out var sessionId))
        {
            return BadRequest(ApiResponse.Failure("This isn't a view of Fusion as someone."));
        }

        var userId = User.GetUserId();
        var session = await dbContext.ViewAsSessions
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.Id == sessionId && item.TargetUserId == userId, cancellationToken);
        session?.End(DateTime.UtcNow);
        await dbContext.SaveChangesAsync(cancellationToken);
        return Ok(ApiResponse.Success());
    }
}

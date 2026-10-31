using EY.HRPlatform.Identity.Features.ViewAs;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Controllers;

/// <summary>
/// The authoritative answer to "does this access token still carry tenant
/// authority", asked by the Gateway on every authenticated customer request.
/// <para>
/// Deliberately minimal. It evaluates account, tenant, membership, and revision
/// currency and nothing else: permissions, scopes, and module rules stay with the
/// services that own them. It answers from a single indexed query because it sits
/// on the hot path of every customer request.
/// </para>
/// </summary>
[ApiController]
[AllowAnonymous]
[ApiExplorerSettings(IgnoreApi = true)]
[Route("internal/identity/access")]
public sealed class InternalTenantAccessController(
    IInternalServiceRequestAuthorizer authorizer,
    AppIdentityDbContext dbContext) : ControllerBase
{
    [HttpPost("authority-state")]
    public async Task<ActionResult<TenantAuthorityStateResponse>> AuthorityState(
        [FromBody] TenantAuthorityStateRequest request,
        CancellationToken cancellationToken)
    {
        if (!await authorizer.AuthorizeAsync(Request, cancellationToken))
        {
            return Unauthorized();
        }

        var state = await dbContext.TenantMemberships
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(membership => membership.Id == request.MembershipId
                && membership.UserId == request.UserId
                && membership.TenantId == request.TenantId)
            .Select(membership => new
            {
                membership.Status,
                membership.AccessRevision,
                AccountIsActive = membership.User!.IsActive,
                TenantIsLive = membership.Tenant!.IsActive && !membership.Tenant!.IsArchived,
            })
            .FirstOrDefaultAsync(cancellationToken);

        // The token names a membership that does not exist as described. Treated
        // as a mismatch rather than a not-found, because from the caller's side
        // both mean the same thing: this token is not authority.
        if (state is null)
        {
            return Ok(TenantAuthorityStateResponse.Denied(
                TenantAuthorityDenialReasons.MembershipMismatch));
        }

        if (!state.AccountIsActive)
        {
            return Ok(TenantAuthorityStateResponse.Denied(
                TenantAuthorityDenialReasons.AccountDisabled));
        }

        if (!state.TenantIsLive)
        {
            return Ok(TenantAuthorityStateResponse.Denied(
                TenantAuthorityDenialReasons.TenantInactive));
        }

        if (state.Status != TenantMembershipStatus.Active)
        {
            return Ok(TenantAuthorityStateResponse.Denied(
                TenantAuthorityDenialReasons.MembershipSuspended));
        }

        // Any change to this membership's access increments the revision inside
        // the same commit, so a token minted before that change fails here on the
        // very next request rather than when it expires.
        if (state.AccessRevision != request.AccessRevision)
        {
            return Ok(TenantAuthorityStateResponse.Denied(
                TenantAuthorityDenialReasons.RevisionStale));
        }

        if (!await ViewAsSessions.IsOpenAsync(dbContext, request, cancellationToken))
        {
            return Ok(TenantAuthorityStateResponse.Denied(TenantAuthorityDenialReasons.ViewEnded));
        }

        return Ok(TenantAuthorityStateResponse.Allowed());
    }
}

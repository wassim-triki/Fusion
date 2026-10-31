using EY.HRPlatform.Identity.Features.TenantAdministration;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Features.ViewAs;

/// <summary>The one answer to "is this view token still good", read by the Gateway's check and Identity's own.</summary>
public static class ViewAsSessions
{
    /// <summary>
    /// Open means not ended, not expired, for exactly the membership the token names, and its viewer is still a usable
    /// administrator of the company: removing an administrator ends their views on the next request.
    /// </summary>
    public static async Task<bool> IsOpenAsync(
        AppIdentityDbContext dbContext, TenantAuthorityStateRequest request, CancellationToken cancellationToken)
    {
        if (request.ViewSessionId is not { } sessionId)
        {
            return true;
        }

        var now = DateTime.UtcNow;
        var viewer = await dbContext.ViewAsSessions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(session => session.Id == sessionId
                && session.TenantId == request.TenantId
                && session.TargetMembershipId == request.MembershipId
                && session.TargetUserId == request.UserId
                && session.EndedAt == null
                && session.ExpiresAt > now)
            .Select(session => (Guid?)session.ViewerMembershipId)
            .FirstOrDefaultAsync(cancellationToken);

        return viewer is { } membershipId
            && await UsableTenantAdministrator.ForTenant(dbContext, request.TenantId)
                .AnyAsync(assignment => assignment.TenantMembershipId == membershipId, cancellationToken);
    }
}

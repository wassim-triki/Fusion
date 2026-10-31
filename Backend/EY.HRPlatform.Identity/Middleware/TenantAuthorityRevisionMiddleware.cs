using EY.HRPlatform.Identity.Features.ViewAs;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Middleware;

/// <summary>
/// Enforces customer authority revision inside Identity so a direct request
/// cannot bypass the Gateway's equivalent per-request gate.
/// </summary>
public sealed class TenantAuthorityRevisionMiddleware(RequestDelegate next)
{
    private static readonly string[] ExemptPathPrefixes =
    [
        "/health",
        "/swagger",
        "/api/identity/auth",
        "/api/identity/tenant-activation",
        "/api/identity/tenant-access/invitations/inspect",
        "/api/identity/tenant-access/invitations/accept",
        "/api/identity/platform/",
        "/internal/",
    ];

    public async Task InvokeAsync(HttpContext context, AppIdentityDbContext dbContext)
    {
        if (context.User.Identity?.IsAuthenticated != true
            || ExemptPathPrefixes.Any(prefix =>
                context.Request.Path.StartsWithSegments(prefix, StringComparison.OrdinalIgnoreCase)))
        {
            await next(context);
            return;
        }

        var read = CustomerAuthorityClaims.Read(context.User);
        if (read.Kind == CustomerClaimsKind.None)
        {
            await next(context);
            return;
        }

        string? reason = TenantAuthorityDenialReasons.RevisionStale;
        if (read is { Kind: CustomerClaimsKind.Complete, Claims: { } claims })
        {
            var state = await dbContext.TenantMemberships
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(membership => membership.Id == claims.MembershipId
                    && membership.UserId == claims.UserId
                    && membership.TenantId == claims.TenantId)
                .Select(membership => new
                {
                    membership.Status,
                    membership.AccessRevision,
                    AccountIsActive = membership.User!.IsActive,
                    TenantIsLive = membership.Tenant!.IsActive && !membership.Tenant!.IsArchived,
                })
                .SingleOrDefaultAsync(context.RequestAborted);

            reason = state switch
            {
                null => TenantAuthorityDenialReasons.MembershipMismatch,
                { AccountIsActive: false } => TenantAuthorityDenialReasons.AccountDisabled,
                { TenantIsLive: false } => TenantAuthorityDenialReasons.TenantInactive,
                { Status: not TenantMembershipStatus.Active } =>
                    TenantAuthorityDenialReasons.MembershipSuspended,
                { AccessRevision: var revision } when revision != claims.AccessRevision =>
                    TenantAuthorityDenialReasons.RevisionStale,
                _ => null,
            };

            if (reason is null && !await ViewAsSessions.IsOpenAsync(dbContext, claims, context.RequestAborted))
            {
                reason = TenantAuthorityDenialReasons.ViewEnded;
            }
        }

        if (reason is null)
        {
            await next(context);
            return;
        }

        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        context.Response.ContentType = "application/problem+json";
        await context.Response.WriteAsJsonAsync(new
        {
            type = "authority-revoked",
            title = "Tenant access is no longer authorized.",
            status = StatusCodes.Status401Unauthorized,
            reason,
        });
    }
}

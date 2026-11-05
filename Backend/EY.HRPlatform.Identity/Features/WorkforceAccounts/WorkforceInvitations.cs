using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.TenantProvisioning;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Features.WorkforceAccounts;

public static class WorkforceInvitations
{
    /// <summary>
    /// Resolves a Workforce invitation from a presented value: a selector/secret credential verified by digest, or
    /// (transitionally) a pre-cutover raw token. Read-only; the acceptance service does the locked, authoritative
    /// resolution.
    /// </summary>
    public static async Task<InviteToken?> ResolveAsync(
        AppIdentityDbContext dbContext, string? presented, CancellationToken cancellationToken = default)
    {
        if (BootstrapCredential.TryParse(presented, out var selector, out var secret))
        {
            var bySelector = await dbContext.InviteTokens
                .IgnoreQueryFilters()
                .Include(i => i.Tenant)
                .FirstOrDefaultAsync(i => i.CredentialSelector == selector, cancellationToken);

            if (bySelector is null
                || bySelector.Purpose != InvitationPurpose.WorkforceAccount
                || !bySelector.MatchesCredentialDigest(BootstrapCredential.Digest(secret)))
            {
                return null;
            }

            return bySelector;
        }

        if (string.IsNullOrWhiteSpace(presented))
            return null;

        var byToken = await dbContext.InviteTokens
            .IgnoreQueryFilters()
            .Include(i => i.Tenant)
            .FirstOrDefaultAsync(i => i.Token == presented, cancellationToken);

        return byToken?.Purpose == InvitationPurpose.WorkforceAccount ? byToken : null;
    }
}

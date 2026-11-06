using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.TenantProvisioning;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Features.TenantAdministration;

public interface IAdministratorInvitationService
{
    Task<AdministrativeInvitationEntry> InspectAsync(
        string credential, CancellationToken cancellationToken = default);
}

/// <summary>
/// What an administrative invitation's link opens onto. Platform recovery issues
/// them (<see cref="PlatformAdministratorRecoveryService"/>).
/// </summary>
public sealed class AdministratorInvitationService(
    AppIdentityDbContext dbContext,
    UserManager<ApplicationUser> userManager) : IAdministratorInvitationService
{
    /// <summary>
    /// Read-only. Inspection never mutates, and never distinguishes an unknown
    /// selector from a wrong-purpose credential or a secret that does not verify,
    /// so a caller cannot probe for valid selectors.
    /// </summary>
    public async Task<AdministrativeInvitationEntry> InspectAsync(
        string credential, CancellationToken cancellationToken = default)
    {
        if (!BootstrapCredential.TryParse(credential, out var selector, out var secret))
        {
            return new AdministrativeInvitationEntry(AdministrativeInvitationEntryState.Invalid);
        }

        var invitation = await dbContext.InviteTokens
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.CredentialSelector == selector, cancellationToken);

        if (invitation is null
            || !InvitationPurposes.IsAdministrative(invitation.Purpose)
            || !invitation.MatchesCredentialDigest(BootstrapCredential.Digest(secret)))
        {
            return new AdministrativeInvitationEntry(AdministrativeInvitationEntryState.Invalid);
        }

        var terminal = invitation.State switch
        {
            InvitationState.Accepted => AdministrativeInvitationEntryState.AlreadyAccepted,
            InvitationState.Expired => AdministrativeInvitationEntryState.Expired,
            InvitationState.Revoked => AdministrativeInvitationEntryState.Revoked,
            InvitationState.Superseded => AdministrativeInvitationEntryState.Superseded,
            _ => (AdministrativeInvitationEntryState?)null,
        };

        if (terminal is not null)
        {
            return new AdministrativeInvitationEntry(terminal.Value, invitation.Purpose);
        }

        var tenant = await dbContext.Tenants
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == invitation.TenantId, cancellationToken);

        if (tenant is null || !tenant.IsActive || tenant.IsArchived)
        {
            return new AdministrativeInvitationEntry(
                AdministrativeInvitationEntryState.Revoked, invitation.Purpose);
        }

        // Surfaced before the form rather than after a filled-in submission: the
        // recipient cannot resolve this themselves, so asking them to choose a
        // password first would waste the only effort they can make.
        if (await AddressBelongsToAnAccountAsync(invitation.Email, cancellationToken))
        {
            return new AdministrativeInvitationEntry(
                AdministrativeInvitationEntryState.ExistingAccountConflict, invitation.Purpose);
        }

        return new AdministrativeInvitationEntry(
            AdministrativeInvitationEntryState.AccountCreation,
            invitation.Purpose,
            tenant.Name,
            invitation.Email,
            invitation.ExpiresAt,
            invitation.FirstName,
            invitation.LastName,
            invitation.Role);
    }

    /// <summary>
    /// New-account-only, checked with Identity's own normalizer so the comparison
    /// matches the unique index that ultimately enforces it.
    /// </summary>
    private async Task<bool> AddressBelongsToAnAccountAsync(string email, CancellationToken cancellationToken)
    {
        var normalized = userManager.NormalizeEmail(email);
        return await dbContext.Users
            .IgnoreQueryFilters()
            .AnyAsync(user => user.NormalizedEmail == normalized, cancellationToken);
    }
}

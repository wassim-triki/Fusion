using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.TenantProvisioning;
using EY.HRPlatform.Identity.Infrastructure.Persistence;

namespace EY.HRPlatform.Identity.Tests.TestHelpers;

/// <summary>A pending administrative invitation, for tests of acceptance and continuity.</summary>
internal static class AdministrativeInvitations
{
    public static async Task<(Guid Id, BootstrapCredential Credential)> IssueAsync(
        AppIdentityDbContext db, Guid tenantId, string email, Guid actor)
    {
        var invitation = InviteToken.CreateAdministrative(
            email, tenantId, actor, InvitationPurpose.TenantAdministrator, 7, null, null);
        var credential = BootstrapCredential.Issue();
        invitation.IssueCredential(credential.Selector, BootstrapCredential.Digest(credential.Secret));
        db.InviteTokens.Add(invitation);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        return (invitation.Id, credential);
    }
}

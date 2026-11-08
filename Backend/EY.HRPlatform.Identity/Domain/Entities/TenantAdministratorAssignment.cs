using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.Identity.Domain.Entities;

/// <summary>
/// The canonical record of Tenant Administrator authority for one membership.
/// <para>
/// This is the single answer to "who administers this tenant". A role name, an
/// access-profile assignment, and a projected permission set are all derived
/// output; none of them is authority.
/// </para>
/// <para>
/// Revocation does not delete the row. A revoked assignment stays as history, so
/// grant → revoke → re-grant is a queryable sequence rather than something a
/// reader has to reconstruct from an audit log.
/// </para>
/// </summary>
public class TenantAdministratorAssignment : ITenantEntity
{
    private TenantAdministratorAssignment() { } // EF constructor

    public Guid Id { get; private set; }

    public Guid TenantId { get; private set; }

    /// <summary>Account holding the authority.</summary>
    public Guid UserId { get; private set; }

    /// <summary>Membership that authorizes it. Authority never outlives its membership.</summary>
    public Guid TenantMembershipId { get; private set; }

    public DateTime GrantedAt { get; private set; }

    /// <summary>Actor who granted it, or null when no Fusion account acted.</summary>
    public Guid? GrantedByUserId { get; private set; }

    public TenantAdministratorGrantActor GrantedByActorType { get; private set; }

    /// <summary>Invitation this authority originated from, where one exists.</summary>
    public Guid? SourceInvitationId { get; private set; }

    public DateTime? RevokedAt { get; private set; }

    public Guid? RevokedByUserId { get; private set; }

    public string? RevocationReason { get; private set; }

    public ApplicationUser? User { get; private set; }

    public TenantMembership? TenantMembership { get; private set; }

    /// <summary>Authority is effective only while the assignment is unrevoked.</summary>
    public bool IsActive => RevokedAt is null;

    public static TenantAdministratorAssignment Grant(
        TenantMembership membership,
        TenantAdministratorGrantActor grantedByActorType,
        Guid? grantedByUserId = null,
        Guid? sourceInvitationId = null,
        DateTime? grantedAt = null)
    {
        ArgumentNullException.ThrowIfNull(membership);

        return new TenantAdministratorAssignment
        {
            Id = Guid.NewGuid(),
            TenantId = membership.TenantId,
            UserId = membership.UserId,
            TenantMembershipId = membership.Id,
            GrantedAt = grantedAt ?? DateTime.UtcNow,
            GrantedByUserId = grantedByUserId,
            GrantedByActorType = grantedByActorType,
            SourceInvitationId = sourceInvitationId,
        };
    }

    /// <summary>
    /// Ends this authority while preserving it as history. Callers reach this only
    /// through the tenant continuity command boundary, which is what guarantees the
    /// tenant is not left without a usable administrator.
    /// </summary>
    public void Revoke(Guid? revokedByUserId, string? reason = null, DateTime? revokedAt = null)
    {
        if (RevokedAt is not null)
        {
            throw new InvalidOperationException("Administrator authority is already revoked.");
        }

        RevokedAt = revokedAt ?? DateTime.UtcNow;
        RevokedByUserId = revokedByUserId;
        RevocationReason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
    }
}

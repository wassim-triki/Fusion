using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.Identity.Domain.Entities;

/// <summary>
/// A tenant access assignment. The assignment stays tenant-scoped for efficient
/// authorization and tenant-safe foreign keys, but its account authority is the
/// referenced membership: a composite foreign key makes it impossible to store an
/// assignment whose account/tenant pair disagrees with its membership.
/// </summary>
public class UserAccessProfile : ITenantEntity
{
    private UserAccessProfile() { }

    public Guid TenantId { get; private set; }
    public Guid UserId { get; private set; }
    public Guid AccessProfileId { get; private set; }

    /// <summary>Membership that authorizes this assignment.</summary>
    public Guid TenantMembershipId { get; private set; }

    public DateTime CreatedAt { get; private set; } = DateTime.UtcNow;

    /// <summary>Chosen for the role by name. The row stays while it is chosen or matched by the role's holders.</summary>
    public bool IsChosen { get; private set; } = true;

    /// <summary>Held because the role's holders (everyone, anyone with a team, a rule) include this person.</summary>
    public bool ByRule { get; private set; }

    /// <summary>Whether anything still gives this person the role.</summary>
    public bool IsHeld => IsChosen || ByRule;

    public void SetChosen(bool chosen) => IsChosen = chosen;

    public void SetByRule(bool byRule) => ByRule = byRule;

    public ApplicationUser? User { get; private set; }
    public AccessProfile? AccessProfile { get; private set; }
    public TenantMembership? TenantMembership { get; private set; }

    public static UserAccessProfile Create(
        Guid tenantId,
        Guid userId,
        Guid accessProfileId,
        Guid tenantMembershipId)
    {
        if (tenantId == Guid.Empty)
            throw new ArgumentException("TenantId is required.", nameof(tenantId));

        if (userId == Guid.Empty)
            throw new ArgumentException("UserId is required.", nameof(userId));

        if (accessProfileId == Guid.Empty)
            throw new ArgumentException("AccessProfileId is required.", nameof(accessProfileId));

        if (tenantMembershipId == Guid.Empty)
            throw new ArgumentException("TenantMembershipId is required.", nameof(tenantMembershipId));

        return new UserAccessProfile
        {
            TenantId = tenantId,
            UserId = userId,
            AccessProfileId = accessProfileId,
            TenantMembershipId = tenantMembershipId,
        };
    }

    /// <summary>
    /// Creates an assignment from its authorizing membership, which guarantees the
    /// account and tenant match the membership.
    /// </summary>
    public static UserAccessProfile ForMembership(TenantMembership membership, Guid accessProfileId)
    {
        ArgumentNullException.ThrowIfNull(membership);

        return Create(membership.TenantId, membership.UserId, accessProfileId, membership.Id);
    }

    /// <summary>A row held only because the role's holders include the person.</summary>
    public static UserAccessProfile MatchedByRule(Guid tenantId, Guid userId, Guid accessProfileId, Guid tenantMembershipId)
    {
        var assignment = Create(tenantId, userId, accessProfileId, tenantMembershipId);
        assignment.IsChosen = false;
        assignment.ByRule = true;
        return assignment;
    }
}

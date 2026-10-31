using System.Security.Claims;

namespace EY.HRPlatform.SharedKernel.Auth;

/// <summary>
/// What an access token says about the customer authority it carries.
/// </summary>
public enum CustomerClaimsKind
{
    /// <summary>No tenant claims. Not a customer-context request.</summary>
    None = 0,

    /// <summary>Every claim the authority check needs is present and well formed.</summary>
    Complete,

    /// <summary>
    /// Tenant context is asserted but the authority claims are missing or
    /// unreadable.
    /// <para>
    /// Deliberately distinct from <see cref="None"/>. A token minted before the
    /// access-revision claim existed still names a tenant and a membership, so
    /// collapsing the two cases would let every pre-cutover token skip the
    /// authority check and outlive a suspension until it expired — exactly the
    /// window the check exists to close.
    /// </para>
    /// </summary>
    Incomplete,
}

public readonly record struct CustomerAuthorityClaims(
    CustomerClaimsKind Kind,
    TenantAuthorityStateRequest? Claims)
{
    /// <summary>
    /// Reads the customer authority a principal asserts, without deciding whether
    /// it is still valid. Kept beside the claim names it depends on, and pure, so
    /// the distinction that matters can be tested directly.
    /// </summary>
    public static CustomerAuthorityClaims Read(ClaimsPrincipal principal)
    {
        ArgumentNullException.ThrowIfNull(principal);

        var tenantId = principal.FindFirstValue(CustomClaimTypes.TenantId);
        var membershipId = principal.FindFirstValue(CustomClaimTypes.TenantMembershipId);

        // A token claiming no tenancy at all is the Platform and no-membership
        // case. Anything naming a tenant or a membership is asserting customer
        // authority and has to prove it.
        if (string.IsNullOrEmpty(tenantId) && string.IsNullOrEmpty(membershipId))
        {
            return new CustomerAuthorityClaims(CustomerClaimsKind.None, null);
        }

        var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        var revision = principal.FindFirstValue(CustomClaimTypes.MembershipAccessRevision);

        if (!Guid.TryParse(userId, out var user)
            || !Guid.TryParse(tenantId, out var tenant)
            || !Guid.TryParse(membershipId, out var membership)
            || !int.TryParse(revision, out var accessRevision))
        {
            return new CustomerAuthorityClaims(CustomerClaimsKind.Incomplete, null);
        }

        // A view token names its session; one that names it unreadably can't prove the view is still open.
        var view = principal.FindFirstValue(CustomClaimTypes.ViewSession);
        Guid? viewSession = null;
        if (view is not null)
        {
            if (!Guid.TryParse(view, out var session))
            {
                return new CustomerAuthorityClaims(CustomerClaimsKind.Incomplete, null);
            }

            viewSession = session;
        }

        return new CustomerAuthorityClaims(
            CustomerClaimsKind.Complete,
            new TenantAuthorityStateRequest(user, tenant, membership, accessRevision, viewSession));
    }
}

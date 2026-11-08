namespace EY.HRPlatform.Identity.Domain.Enums;

/// <summary>
/// Explicit purpose of an invitation. Purpose is bound at creation and is never
/// inferred from the assigned role, so a bootstrap invitation can never be
/// activated through the workforce route and vice versa.
/// </summary>
public enum InvitationPurpose
{
    /// <summary>Existing Core workforce-account invitation. Business behavior unchanged.</summary>
    WorkforceAccount = 0,

    /// <summary>Initial administrator bootstrap invitation issued by Platform provisioning.</summary>
    OrganizationBootstrap = 1,

    /// <summary>
    /// Platform-assisted recovery of customer-controlled administration, issued by
    /// a Platform Administrator only while the tenant has no usable administrator.
    /// The only administrative invitation: customers make administrators of people
    /// who already sign in, without an invitation.
    /// </summary>
    TenantAdministratorRecovery = 3,
}

public static class InvitationPurposes
{
    /// <summary>
    /// Purposes that use the hash-only selector/digest credential rather than the
    /// legacy raw token. A raw reusable secret is never persisted for these.
    /// Workforce joined the scheme in the workforce-access-activation change; a
    /// bounded transitional acceptance path still honours pre-cutover raw tokens.
    /// </summary>
    public static readonly IReadOnlyList<InvitationPurpose> CredentialBearing =
    [
        InvitationPurpose.OrganizationBootstrap,
        InvitationPurpose.TenantAdministratorRecovery,
        InvitationPurpose.WorkforceAccount,
    ];

    /// <summary>
    /// Purposes that establish administrator authority. These may never be
    /// issued or accepted through a workforce route.
    /// </summary>
    public static readonly IReadOnlyList<InvitationPurpose> Administrative =
    [
        InvitationPurpose.TenantAdministratorRecovery,
    ];

    public static bool IsCredentialBearing(InvitationPurpose purpose)
        => CredentialBearing.Contains(purpose);

    public static bool IsAdministrative(InvitationPurpose purpose)
        => Administrative.Contains(purpose);
}

namespace EY.HRPlatform.Identity.Features.TenantAdministration;

/// <summary>
/// The closed vocabulary of access-administration events.
/// <para>
/// These names are rendered to customers in the Access activity view, so they are
/// written in business language rather than in service or provider terms. The set
/// is closed: an event this capability can produce has a name here, and a name
/// here has an event that produces it.
/// </para>
/// </summary>
public static class AccessAuditActions
{
    public const string ResourceTypeAdministrator = "TenantAdministrator";
    public const string ResourceTypeInvitation = "AdministratorInvitation";
    public const string ResourceTypeMembership = "TenantMembership";

    /// <summary>The tenant's initial administrator authority became canonical.</summary>
    public const string AuthorityRecognized = "AdministratorAuthorityRecognized";

    public const string InvitationIssued = "AdministratorInvitationIssued";
    public const string InvitationResent = "AdministratorInvitationResent";
    public const string InvitationEmailReplaced = "AdministratorInvitationEmailReplaced";
    public const string InvitationRevoked = "AdministratorInvitationRevoked";
    public const string InvitationAccepted = "AdministratorInvitationAccepted";
    public const string InvitationRejectedExistingAccount = "AdministratorInvitationRejectedExistingAccount";

    public const string MembershipSuspended = "MembershipSuspended";
    public const string MembershipReactivated = "MembershipReactivated";

    public const string AuthorityGranted = "AdministratorAuthorityGranted";
    public const string AuthorityRevoked = "AdministratorAuthorityRevoked";
    public const string AuthoritySelfRemoved = "AdministratorAuthoritySelfRemoved";

    /// <summary>
    /// An action refused because it would have left the tenant unadministered.
    /// A refused attempt on the last administrator is security-relevant evidence,
    /// so it is recorded even though the command itself rolled back.
    /// </summary>
    public const string FinalAdministratorActionBlocked = "FinalAdministratorActionBlocked";

    /// <summary>An administrator saw Fusion as someone in the company (read-only, recorded).</summary>
    public const string SeenAs = "FusionSeenAs";

    public const string PlatformRecoveryInitiated = "PlatformRecoveryInitiated";
    public const string PlatformRecoveryInvitationAccepted = "PlatformRecoveryInvitationAccepted";
    public const string PlatformRecoveryCompleted = "PlatformRecoveryCompleted";
    public const string PlatformRecoveryFailed = "PlatformRecoveryFailed";

    public static readonly IReadOnlyList<string> All =
    [
        AuthorityRecognized,
        InvitationIssued,
        InvitationResent,
        InvitationEmailReplaced,
        InvitationRevoked,
        InvitationAccepted,
        InvitationRejectedExistingAccount,
        MembershipSuspended,
        MembershipReactivated,
        AuthorityGranted,
        AuthorityRevoked,
        AuthoritySelfRemoved,
        FinalAdministratorActionBlocked,
        SeenAs,
        PlatformRecoveryInitiated,
        PlatformRecoveryInvitationAccepted,
        PlatformRecoveryCompleted,
        PlatformRecoveryFailed,
    ];
}

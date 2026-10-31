namespace EY.HRPlatform.SharedKernel.Auth;

/// <summary>
/// What the Gateway presents from an access token when asking whether that token
/// still carries tenant authority.
/// </summary>
public sealed record TenantAuthorityStateRequest(
    Guid UserId,
    Guid TenantId,
    Guid MembershipId,
    int AccessRevision,
    /// <summary>The view session a read-only token for seeing Fusion as someone belongs to; null otherwise.</summary>
    Guid? ViewSessionId = null);

/// <summary>
/// Why a token no longer carries authority. Typed rather than boolean so the
/// frontend can tell a suspension from a revoked authority from an account that
/// was disabled, and so operators can see which condition is firing.
/// </summary>
public static class TenantAuthorityDenialReasons
{
    public const string AccountDisabled = "account-disabled";
    public const string TenantInactive = "tenant-inactive";
    public const string MembershipSuspended = "membership-suspended";

    /// <summary>The token's revision predates a change to this membership's access.</summary>
    public const string RevisionStale = "revision-stale";

    /// <summary>The token's account, tenant, and membership do not describe one real membership.</summary>
    public const string MembershipMismatch = "membership-mismatch";

    /// <summary>The token was for seeing Fusion as someone, and that view has ended, expired, or lost its viewer.</summary>
    public const string ViewEnded = "view-ended";

    /// <summary>Identity could not be reached or did not answer. Denies, never allows.</summary>
    public const string AuthorityUnavailable = "authority-unavailable";
}

public sealed record TenantAuthorityStateResponse(bool Valid, string? Reason = null)
{
    public static TenantAuthorityStateResponse Allowed() => new(true);

    public static TenantAuthorityStateResponse Denied(string reason) => new(false, reason);
}

namespace EY.HRPlatform.SharedKernel.Auth;

/// <summary>
/// Custom claim type constants used across the platform.
/// Centralizes claim keys to avoid magic strings.
/// </summary>
public static class CustomClaimTypes
{
    /// <summary>
    /// Customer tenant. Present only when the account has exactly one Active
    /// tenant membership; its absence means no customer-workspace authority.
    /// </summary>
    public const string TenantId = "tenant_id";

    /// <summary>Membership that authorizes the customer tenant context.</summary>
    public const string TenantMembershipId = "tenant_membership_id";

    /// <summary>
    /// Revision of the membership's tenant access at the moment this token was
    /// issued. The Gateway compares it against authoritative Identity state on
    /// every request, so a token issued before a suspension or an authority
    /// change stops being honoured immediately rather than when it expires.
    /// </summary>
    public const string MembershipAccessRevision = "membership_access_revision";

    /// <summary>One claim per module enabled for the customer tenant.</summary>
    public const string ModuleEntitlement = "module_entitlement";
    public const string EmployeeId = "employee_id";
    public const string FullName = "full_name";
    public const string Department = "department";
    public const string JobTitle = "job_title";
    public const string CorePermission = "core_permission";

    /// <summary>
    /// Present only on a token for seeing Fusion as someone: the open view session it belongs to. Such a token is
    /// the person's own authority, read-only, and stops working when the session ends.
    /// </summary>
    public const string ViewSession = "view_session";

    /// <summary>The administrator doing the seeing, on a view token.</summary>
    public const string ViewerId = "view_viewer_id";
}

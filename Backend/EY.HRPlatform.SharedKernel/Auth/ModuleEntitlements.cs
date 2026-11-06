namespace EY.HRPlatform.SharedKernel.Auth;

/// <summary>
/// Stable module identifiers used in entitlement claims and authorization
/// policies. These match the Platform-owned entitlement records; they are not
/// navigation metadata.
/// </summary>
public static class ModuleEntitlements
{
    public const string CoreHR = "CoreHR";
    public const string Performance = "Performance";
    public const string Learning = "Learning";
    public const string Recruitment = "Recruitment";
    public const string Interview = "Interview";
}

/// <summary>
/// Names of the authorization policies that require a customer tenant context
/// plus the module entitlement for that tenant.
/// </summary>
public static class ModuleEntitlementPolicies
{
    public const string CoreHR = "module:corehr";
    public const string Performance = "module:performance";
}

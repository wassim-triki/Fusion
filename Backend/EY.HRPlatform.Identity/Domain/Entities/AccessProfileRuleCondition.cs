using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.Identity.Domain.Entities;

/// <summary>What a role's rule can look at. Department and unit match the person's unit or any unit above it.</summary>
public static class AccessProfileRuleKinds
{
    public const string Department = "department";
    public const string Job = "job";
    public const string Place = "place";
    public const string Unit = "unit";

    public static readonly IReadOnlyList<string> All = [Department, Job, Place, Unit];

    public static bool IsValid(string kind) => All.Contains(kind, StringComparer.Ordinal);
}

/// <summary>
/// One value a role's rule accepts: a person matches a rule when, for every kind it names, they match one of
/// its values (any of the departments, and any of the jobs, …). Values are Core HR ids, checked against the
/// tenant when the rule is saved.
/// </summary>
public sealed class AccessProfileRuleCondition : ITenantEntity
{
    private AccessProfileRuleCondition() { }

    public Guid TenantId { get; private set; }
    public Guid AccessProfileId { get; private set; }
    public string Kind { get; private set; } = string.Empty;
    public Guid TargetId { get; private set; }

    public static AccessProfileRuleCondition Create(Guid tenantId, Guid accessProfileId, string kind, Guid targetId)
    {
        if (tenantId == Guid.Empty)
            throw new ArgumentException("TenantId is required.", nameof(tenantId));
        if (accessProfileId == Guid.Empty)
            throw new ArgumentException("AccessProfileId is required.", nameof(accessProfileId));
        if (!AccessProfileRuleKinds.IsValid(kind))
            throw new ArgumentException($"Invalid rule kind '{kind}'.", nameof(kind));
        if (targetId == Guid.Empty)
            throw new ArgumentException("A rule value is required.", nameof(targetId));

        return new AccessProfileRuleCondition
        {
            TenantId = tenantId,
            AccessProfileId = accessProfileId,
            Kind = kind,
            TargetId = targetId,
        };
    }
}

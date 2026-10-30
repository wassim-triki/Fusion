using EY.HRPlatform.SharedKernel.Domain;
using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.Identity.Domain.Entities;

public static class AccessProfileTypes
{
    public const string SystemSeeded = "SystemSeeded";
    public const string Custom = "Custom";
}

/// <summary>How people come to hold a role, besides the people chosen for it.</summary>
public static class AccessProfileHolderKinds
{
    /// <summary>Only the people chosen for it.</summary>
    public const string Chosen = "chosen";

    /// <summary>Every person in the company (an active member bound to an employee).</summary>
    public const string Everyone = "everyone";

    /// <summary>Anyone with at least one direct report.</summary>
    public const string Team = "team";

    /// <summary>Whoever matches the role's conditions on department, job, place or unit.</summary>
    public const string Rule = "rule";

    public static bool IsValid(string kind) => kind is Chosen or Everyone or Team or Rule;
}

public class AccessProfile : BaseEntity, ITenantEntity
{
    private AccessProfile() { }

    public Guid TenantId { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string? InternalKey { get; private set; }
    public string NormalizedName { get; private set; } = string.Empty;
    public string? Description { get; private set; }
    public string Type { get; private set; } = AccessProfileTypes.Custom;
    public bool IsSystemProtected { get; private set; }
    public uint Version { get; private set; }

    /// <summary>How people come to hold this role besides being chosen (<see cref="AccessProfileHolderKinds"/>).</summary>
    public string HolderKind { get; private set; } = AccessProfileHolderKinds.Chosen;

    public List<AccessProfileGrant> Grants { get; private set; } = [];
    public List<UserAccessProfile> UserAssignments { get; private set; } = [];
    public List<InviteAccessProfile> InviteAssignments { get; private set; } = [];
    public List<AccessProfileRuleCondition> RuleConditions { get; private set; } = [];

    public static AccessProfile Create(
        Guid tenantId,
        string name,
        string? description,
        string type,
        bool isSystemProtected,
        string? internalKey = null)
    {
        if (tenantId == Guid.Empty)
            throw new ArgumentException("TenantId is required.", nameof(tenantId));

        var normalizedName = NormalizeName(name);
        if (type is not AccessProfileTypes.SystemSeeded and not AccessProfileTypes.Custom)
            throw new ArgumentException($"Invalid access profile type '{type}'.", nameof(type));

        return new AccessProfile
        {
            TenantId = tenantId,
            Name = normalizedName,
            InternalKey = type == AccessProfileTypes.SystemSeeded ? internalKey : null,
            NormalizedName = normalizedName.ToUpperInvariant(),
            Description = NormalizeDescription(description),
            Type = type,
            IsSystemProtected = isSystemProtected,
        };
    }

    public void SetInternalKey(string internalKey)
    {
        if (Type != AccessProfileTypes.SystemSeeded)
            throw new InvalidOperationException("Only system-seeded profiles can have an internal key.");

        InternalKey = internalKey;
        UpdatedAt = DateTime.UtcNow;
    }

    public void UpdateDetails(string name, string? description, string? internalKey = null)
    {
        var normalizedName = NormalizeName(name);
        Name = normalizedName;
        NormalizedName = normalizedName.ToUpperInvariant();
        Description = NormalizeDescription(description);
        if (internalKey is not null)
            InternalKey = internalKey;
        UpdatedAt = DateTime.UtcNow;
    }

    public void MarkSystemState(string type, bool isSystemProtected)
    {
        if (type is not AccessProfileTypes.SystemSeeded and not AccessProfileTypes.Custom)
            throw new ArgumentException($"Invalid access profile type '{type}'.", nameof(type));

        Type = type;
        IsSystemProtected = isSystemProtected;
        UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>Sets how people come to hold this role. Conditions only belong to a rule.</summary>
    public void SetHolders(string holderKind, IEnumerable<AccessProfileRuleCondition> conditions)
    {
        if (!AccessProfileHolderKinds.IsValid(holderKind))
            throw new ArgumentException($"Invalid holder kind '{holderKind}'.", nameof(holderKind));

        var list = conditions.ToList();
        if (holderKind == AccessProfileHolderKinds.Rule && list.Count == 0)
            throw new InvalidOperationException("A rule needs at least one condition.");
        if (holderKind != AccessProfileHolderKinds.Rule && list.Count > 0)
            throw new InvalidOperationException("Only a rule has conditions.");

        HolderKind = holderKind;
        RuleConditions.Clear();
        RuleConditions.AddRange(list);
        UpdatedAt = DateTime.UtcNow;
    }

    public void ReplaceGrants(IEnumerable<AccessProfileGrant> grants)
    {
        Grants.Clear();
        Grants.AddRange(grants);
        UpdatedAt = DateTime.UtcNow;
    }

    private static string NormalizeName(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new ArgumentException("Access profile name is required.", nameof(name));

        return name.Trim();
    }

    private static string? NormalizeDescription(string? description)
        => string.IsNullOrWhiteSpace(description) ? null : description.Trim();
}

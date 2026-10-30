using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.SharedKernel.Auth;

namespace EY.HRPlatform.Identity.Features.AccessProfiles;

public sealed record SeededAccessProfileTemplate(
    string InternalKey,
    string Name,
    string Description,
    IReadOnlyList<EffectivePermissionGrant> Grants,
    bool IsSystemProtected = true,
    string HolderKind = AccessProfileHolderKinds.Chosen);

/// <summary>
/// The roles every company starts with, written as area cells (D-25). Employees is everyone, Managers is anyone
/// with a team, HR is chosen people; Administrators is the canonical authority, composed separately.
/// </summary>
public static class AccessProfileTemplates
{
    private static RoleAreaCell C(string area, string level, string? reach = null) => new(area, level, reach);

    private static readonly RoleAreaCell[] EmployeeCells =
    [
        C("job", RoleLevels.See, RoleReaches.Self),
        C("personal", RoleLevels.Change, RoleReaches.Self),
        C("org", RoleLevels.See),
        C("plans", RoleLevels.Change, RoleReaches.Self),
    ];

    private static readonly RoleAreaCell[] ManagerCells =
    [
        C("job", RoleLevels.See, RoleReaches.Team),
        C("personal", RoleLevels.See, RoleReaches.Team),
        C("org", RoleLevels.See),
        C("approve", RoleLevels.Propose, RoleReaches.Team),
        C("plans", RoleLevels.Change, RoleReaches.Team),
    ];

    private static readonly RoleAreaCell[] HrCells =
    [
        C("job", RoleLevels.Change, RoleReaches.Everyone),
        C("personal", RoleLevels.Change, RoleReaches.Everyone),
        C("org", RoleLevels.Change),
        C("approve", RoleLevels.Approve, RoleReaches.Everyone),
        C("reports", RoleLevels.See, RoleReaches.Everyone),
        C("signin", RoleLevels.Change),
        C("plans", RoleLevels.See, RoleReaches.Everyone),
        C("cycles", RoleLevels.Change),
    ];

    private static IReadOnlyList<EffectivePermissionGrant> Grants(IEnumerable<RoleAreaCell> cells, bool performanceEnabled)
    {
        var areas = RoleAreas.For(performanceEnabled ? [PermissionModuleKeys.Performance] : [])
            .Select(area => area.Id)
            .ToHashSet(StringComparer.Ordinal);
        return RoleAreas.Compose(cells.Where(cell => areas.Contains(cell.AreaId)), []);
    }

    private static SeededAccessProfileTemplate Build(string key, string name, string description, RoleAreaCell[] cells, bool performanceEnabled, string holderKind)
        => new(key, name, description, Grants(cells, performanceEnabled), HolderKind: holderKind);

    private static IReadOnlyList<SeededAccessProfileTemplate> Seeded(bool performanceEnabled) =>
    [
        Build("employee", "Employees", "Everyone in the company.", EmployeeCells, performanceEnabled, AccessProfileHolderKinds.Everyone),
        Build("manager", "Managers", "Anyone with a team.", ManagerCells, performanceEnabled, AccessProfileHolderKinds.Team),
        Build("hr-admin", "HR", "The people who look after everyone's records.", HrCells, performanceEnabled, AccessProfileHolderKinds.Chosen),
    ];

    public static readonly SeededAccessProfileTemplate Employee = Seeded(performanceEnabled: false)[0];
    public static readonly SeededAccessProfileTemplate Manager = Seeded(performanceEnabled: false)[1];
    public static readonly SeededAccessProfileTemplate HrAdmin = Seeded(performanceEnabled: false)[2];

    /// <summary>The retired Org Admin role's key: no longer seeded, removed wherever nobody holds it.</summary>
    public const string RetiredOrgAdminKey = "org-admin";

    /// <summary>
    /// The canonical Tenant Administrator definition for one tenant.
    /// <para>
    /// Its grants depend on the tenant's module entitlements, so it is composed per
    /// tenant at seed and re-seed time rather than declared as a static template.
    /// </para>
    /// </summary>
    public static SeededAccessProfileTemplate BuildTenantAdministrator(IEnumerable<string> enabledModuleKeys)
        => new(
            TenantAdministratorAuthority.InternalKey,
            TenantAdministratorAuthority.DisplayName,
            TenantAdministratorAuthority.Description,
            TenantAdministratorAuthority.BuildGrants(enabledModuleKeys));

    /// <summary>Statically declared seeded roles, without module areas.</summary>
    public static IReadOnlyList<SeededAccessProfileTemplate> All => [Employee, Manager, HrAdmin];

    /// <summary>
    /// The seeded roles for a tenant, with the Performance areas included only when the tenant holds Performance.
    /// The Tenant Administrator is composed separately through <see cref="BuildTenantAdministrator"/>.
    /// </summary>
    public static IReadOnlyList<SeededAccessProfileTemplate> ComposeSeeded(bool performanceEnabled) => Seeded(performanceEnabled);

    public static SeededAccessProfileTemplate? GetByInternalKey(string internalKey)
        => All.FirstOrDefault(t =>
            string.Equals(t.InternalKey, internalKey, StringComparison.Ordinal));

    /// <summary>
    /// Maps legacy/old profile names to their target internal key for migration.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, string> LegacyNameMapping =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["HRAdmin"] = "hr-admin",
            ["HR Admin"] = "hr-admin",
            ["Core Admin"] = "org-admin",
            ["Core Administrator"] = "org-admin",
            ["Organization Administrator"] = "org-admin",
            ["Org Admin"] = "org-admin",
            ["Access Admin"] = "hr-admin",
            ["Access Manager"] = "hr-admin",
            ["Access Administrator"] = "hr-admin",
        };

    /// <summary>
    /// Old legacy names that should be removed if system-seeded with no assignments.
    /// </summary>
    public static readonly IReadOnlySet<string> ObsoleteLegacyNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "HRAdmin",
        "Core Admin",
        "Core Administrator",
        "Organization Administrator",
        "Access Admin",
        "Access Manager",
        "Access Administrator",
    };
}

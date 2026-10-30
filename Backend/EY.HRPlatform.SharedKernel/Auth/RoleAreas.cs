using System.Collections.ObjectModel;

namespace EY.HRPlatform.SharedKernel.Auth;

/// <summary>How far an area reaches: whose records. Rendered as themselves, their team, everyone.</summary>
public static class RoleReaches
{
    public const string Self = "self";
    public const string Team = "team";
    public const string Everyone = "everyone";
}

/// <summary>What a role may do in an area. <c>none</c> is the absence of every option.</summary>
public static class RoleLevels
{
    public const string None = "none";
    public const string See = "see";
    public const string Change = "change";
    public const string Propose = "propose";
    public const string Approve = "approve";
}

/// <summary>
/// One thing a role can be set to in an area. The <see cref="Defining"/> grants decide whether a role is at this
/// option; <see cref="Companions"/> come with it when the role is saved. Options are listed weakest first.
/// </summary>
public sealed record RoleAreaOption(
    string Level,
    string? Reach,
    IReadOnlyList<EffectivePermissionGrant> Defining,
    IReadOnlyList<EffectivePermissionGrant> Companions)
{
    public IEnumerable<EffectivePermissionGrant> Grants => Defining.Concat(Companions);
}

/// <param name="Id">Stable area id, also the key of its words in the apps.</param>
/// <param name="Module">The module whose entitlement the area needs (Core HR is always on).</param>
/// <param name="AdministratorsOnly">Only the protected Administrators role holds it; any other role is refused its grants.</param>
public sealed record RoleArea(
    string Id,
    string Group,
    string Module,
    bool AdministratorsOnly,
    IReadOnlyList<RoleAreaOption> Options);

/// <summary>A role's setting in one area.</summary>
public sealed record RoleAreaCell(string AreaId, string Level, string? Reach);

/// <summary>
/// The roles model (D-25): ten plain areas, each with a level and a reach, mapped onto the permission catalogue.
/// <para>
/// Access profiles and their grants stay the storage and the token; areas are how people read and write them.
/// A role's cell in an area is the strongest option whose defining grants it holds; saving a role writes each
/// cell's defining and companion grants, and keeps every grant no area owns (legacy keys, colleague modules).
/// What the editor shows is therefore exactly what is saved.
/// </para>
/// <para>
/// Jobs and Personal details for others share Core HR's one record read and edit today, so their options for a
/// team or everyone share defining grants and move together until the person page splits them.
/// </para>
/// </summary>
public static class RoleAreas
{
    public const string CoreGroup = "core";
    public const string PerformanceGroup = "performance";
    public const string CompanyGroup = "company";

    private static EffectivePermissionGrant G(string key, string scope) => new(key, scope);
    private static RoleAreaOption O(string level, string? reach, EffectivePermissionGrant[] defining, params EffectivePermissionGrant[] companions)
        => new(level, reach, defining, companions);

    private const string T = PermissionScopes.Tenant;
    private const string Dr = PermissionScopes.DirectReports;
    private const string S = PermissionScopes.Self;

    private static readonly EffectivePermissionGrant[] OwnPersonal =
        [G(CorePermissions.ProfileSelfView, S), G(CorePermissions.ProfileSelfUpdate, S)];

    public static readonly ReadOnlyCollection<RoleArea> All = Array.AsReadOnly<RoleArea>([
        new("job", CoreGroup, PermissionModuleKeys.CoreHR, false, [
            O(RoleLevels.See, RoleReaches.Self, [G(CorePermissions.EmployeeView, S)]),
            O(RoleLevels.See, RoleReaches.Team, [G(CorePermissions.EmployeeView, Dr)], G(CorePermissions.TeamView, Dr)),
            O(RoleLevels.See, RoleReaches.Everyone, [G(CorePermissions.EmployeeView, T)]),
            O(RoleLevels.Change, RoleReaches.Everyone, [G(CorePermissions.EmployeeManage, T)],
                G(CorePermissions.EmployeeView, T), G(CorePermissions.ReportingManage, T), G(CorePermissions.EmployeeImport, T)),
        ]),
        new("personal", CoreGroup, PermissionModuleKeys.CoreHR, false, [
            O(RoleLevels.See, RoleReaches.Self, [G(CorePermissions.ProfileSelfView, S)]),
            O(RoleLevels.Change, RoleReaches.Self, [G(CorePermissions.ProfileSelfUpdate, S)], G(CorePermissions.ProfileSelfView, S)),
            O(RoleLevels.See, RoleReaches.Team, [G(CorePermissions.EmployeeView, Dr)], OwnPersonal),
            O(RoleLevels.See, RoleReaches.Everyone, [G(CorePermissions.EmployeeView, T)], OwnPersonal),
            O(RoleLevels.Change, RoleReaches.Everyone, [G(CorePermissions.EmployeeManage, T)], [G(CorePermissions.EmployeeView, T), .. OwnPersonal]),
        ]),
        new("org", CoreGroup, PermissionModuleKeys.CoreHR, false, [
            O(RoleLevels.See, null, [G(CorePermissions.OrgChartView, T)]),
            O(RoleLevels.Change, null, [G(CorePermissions.OrganizationManage, T)],
                G(CorePermissions.OrgChartView, T), G(CorePermissions.OrganizationView, T), G(CorePermissions.SetupView, T),
                G(CorePermissions.SetupManage, T), G(CorePermissions.SettingsStructureView, T), G(CorePermissions.SettingsStructureManage, T)),
        ]),
        new("approve", CoreGroup, PermissionModuleKeys.CoreHR, false, [
            O(RoleLevels.Propose, RoleReaches.Team, [G(CorePermissions.ChangePropose, Dr)]),
            O(RoleLevels.Approve, RoleReaches.Everyone, [G(CorePermissions.ChangeApprove, T)]),
        ]),
        new("reports", CoreGroup, PermissionModuleKeys.CoreHR, false, [
            O(RoleLevels.See, RoleReaches.Everyone, [G(CorePermissions.OverviewView, T)], G(CorePermissions.SettingsGovernanceView, T)),
        ]),
        new("signin", CoreGroup, PermissionModuleKeys.CoreHR, false, [
            O(RoleLevels.See, null, [G(CorePermissions.AccessView, T)], G(CorePermissions.SettingsProvisioningView, T)),
            O(RoleLevels.Change, null, [G(CorePermissions.AccessManage, T)],
                G(CorePermissions.AccessView, T), G(CorePermissions.SettingsProvisioningView, T), G(CorePermissions.SettingsProvisioningManage, T)),
        ]),
        new("plans", PerformanceGroup, PermissionModuleKeys.Performance, false, [
            O(RoleLevels.See, RoleReaches.Self, [G(PerformancePermissions.CycleView, S)]),
            O(RoleLevels.Change, RoleReaches.Self, [G(PerformancePermissions.ObjectiveSelfManage, S)], G(PerformancePermissions.CycleView, S)),
            O(RoleLevels.Change, RoleReaches.Team, [G(PerformancePermissions.CycleView, Dr)],
                G(PerformancePermissions.ObjectiveSelfManage, S), G(PerformancePermissions.ObjectiveOrgManage, T), G(CorePermissions.OrganizationView, T)),
            O(RoleLevels.See, RoleReaches.Everyone, [G(PerformancePermissions.CycleView, T)], G(PerformancePermissions.ObjectiveSelfManage, S)),
        ]),
        new("cycles", PerformanceGroup, PermissionModuleKeys.Performance, false, [
            O(RoleLevels.See, null, [G(PerformancePermissions.SettingsView, T)], G(PerformancePermissions.CycleView, T)),
            O(RoleLevels.Change, null, [G(PerformancePermissions.CycleManage, T)],
                G(PerformancePermissions.CycleView, T), G(PerformancePermissions.StrategyPublish, T), G(PerformancePermissions.ReviewCalibrate, T),
                G(PerformancePermissions.SettingsView, T), G(PerformancePermissions.SettingsManage, T), G(PerformancePermissions.ObjectiveOrgManage, T)),
        ]),
        new("brand", CompanyGroup, PermissionModuleKeys.CoreHR, true, [
            O(RoleLevels.Change, null, [G(CorePermissions.SettingsOrganizationManage, T)],
                G(CorePermissions.SettingsOrganizationView, T), G(CorePermissions.SettingsPeopleDataView, T), G(CorePermissions.SettingsPeopleDataManage, T),
                G(CorePermissions.SettingsView, T), G(CorePermissions.SettingsManage, T)),
        ]),
        new("roles", CompanyGroup, PermissionModuleKeys.CoreHR, true, [
            O(RoleLevels.Change, null, [G(CorePermissions.AccessProfilesManageV2, T)],
                G(CorePermissions.AccessProfilesView, T), G(CorePermissions.AccessAssignmentsView, T), G(CorePermissions.AccessAssignmentsManage, T),
                G(CorePermissions.AccessProfilesManage, T)),
        ]),
    ]);

    private static readonly IReadOnlyDictionary<string, RoleArea> ById = All.ToDictionary(area => area.Id, StringComparer.Ordinal);

    /// <summary>Every key some area's options mention. A grant on one of these is written only through its area.</summary>
    public static readonly IReadOnlySet<string> OwnedKeys = All
        .SelectMany(area => area.Options)
        .SelectMany(option => option.Grants)
        .Select(grant => grant.PermissionKey)
        .ToHashSet(StringComparer.Ordinal);

    /// <summary>Keys only the protected Administrators role may hold.</summary>
    public static readonly IReadOnlySet<string> AdministratorOnlyKeys = All
        .Where(area => area.AdministratorsOnly)
        .SelectMany(area => area.Options)
        .SelectMany(option => option.Grants)
        .Select(grant => grant.PermissionKey)
        .ToHashSet(StringComparer.Ordinal);

    public static RoleArea? Find(string areaId) => ById.GetValueOrDefault(areaId);

    /// <summary>The areas a tenant with these modules sees.</summary>
    public static IEnumerable<RoleArea> For(IEnumerable<string> enabledModuleKeys)
    {
        var enabled = new HashSet<string>(enabledModuleKeys, StringComparer.OrdinalIgnoreCase) { PermissionModuleKeys.CoreHR };
        return All.Where(area => enabled.Contains(area.Module));
    }

    /// <summary>A role's cell in each area: the strongest option whose defining grants it holds.</summary>
    public static IReadOnlyList<RoleAreaCell> Read(IEnumerable<EffectivePermissionGrant> grants)
    {
        var held = Strongest(grants);
        return All.Select(area =>
        {
            var option = area.Options.LastOrDefault(candidate => candidate.Defining.All(required => Holds(held, required)));
            return option is null
                ? new RoleAreaCell(area.Id, RoleLevels.None, null)
                : new RoleAreaCell(area.Id, option.Level, option.Reach);
        }).ToList();
    }

    /// <summary>
    /// The grants a role saves: each cell's option, plus the existing grants no area owns. An unknown area or an
    /// option the area doesn't offer is refused, as is any administrators-only area.
    /// </summary>
    public static IReadOnlyList<EffectivePermissionGrant> Compose(
        IEnumerable<RoleAreaCell> cells,
        IEnumerable<EffectivePermissionGrant> existing)
    {
        var composed = new Dictionary<string, EffectivePermissionGrant>(StringComparer.Ordinal);
        void Add(EffectivePermissionGrant grant)
        {
            if (!composed.TryGetValue(grant.PermissionKey, out var current)
                || PermissionScopes.GetRank(grant.Scope) > PermissionScopes.GetRank(current.Scope))
            {
                composed[grant.PermissionKey] = grant;
            }
        }

        foreach (var grant in existing.Where(grant => !OwnedKeys.Contains(grant.PermissionKey)))
        {
            Add(grant);
        }

        foreach (var cell in cells)
        {
            var area = Find(cell.AreaId)
                ?? throw new InvalidOperationException($"Unknown area '{cell.AreaId}'.");
            if (cell.Level == RoleLevels.None)
            {
                continue;
            }

            if (area.AdministratorsOnly)
            {
                throw new InvalidOperationException($"Only administrators can have '{area.Id}'.");
            }

            var option = area.Options.FirstOrDefault(candidate => candidate.Level == cell.Level && candidate.Reach == cell.Reach)
                ?? throw new InvalidOperationException($"'{area.Id}' has no '{cell.Level}' for '{cell.Reach ?? "-"}'.");
            foreach (var grant in option.Grants)
            {
                Add(grant);
            }
        }

        return composed.Values.ToList();
    }

    private static Dictionary<string, string> Strongest(IEnumerable<EffectivePermissionGrant> grants)
    {
        var held = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var grant in grants)
        {
            if (!held.TryGetValue(grant.PermissionKey, out var scope) || PermissionScopes.GetRank(grant.Scope) > PermissionScopes.GetRank(scope))
            {
                held[grant.PermissionKey] = grant.Scope;
            }
        }

        return held;
    }

    // Self is narrower than a team, and a team narrower than everyone; DirectReports and OrgUnit rank alike.
    private static bool Holds(Dictionary<string, string> held, EffectivePermissionGrant required)
        => held.TryGetValue(required.PermissionKey, out var scope)
            && PermissionScopes.GetRank(scope) >= PermissionScopes.GetRank(required.Scope);
}

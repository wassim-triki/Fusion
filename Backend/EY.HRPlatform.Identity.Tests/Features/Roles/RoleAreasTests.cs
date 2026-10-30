using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.SharedKernel.Auth;

namespace EY.HRPlatform.Identity.Tests.Features.Roles;

/// <summary>The roles model's mapping (B-177): a role's cells read from its grants, and saving writes exactly those cells.</summary>
public sealed class RoleAreasTests
{
    private static RoleAreaCell Cell(IReadOnlyList<RoleAreaCell> cells, string area) => cells.Single(cell => cell.AreaId == area);

    [Fact]
    public void Every_catalogue_key_an_area_writes_is_a_known_grant()
    {
        foreach (var option in RoleAreas.All.SelectMany(area => area.Options))
        {
            foreach (var grant in option.Grants)
            {
                Assert.True(PermissionCatalog.IsValidScope(grant.PermissionKey, grant.Scope), $"{grant.PermissionKey}@{grant.Scope}");
            }
        }
    }

    [Fact]
    public void There_are_ten_areas()
        => Assert.Equal(10, RoleAreas.All.Count);

    [Fact]
    public void The_seeded_roles_read_back_as_drawn()
    {
        var seeded = AccessProfileTemplates.ComposeSeeded(performanceEnabled: true).ToDictionary(template => template.InternalKey);

        var employees = RoleAreas.Read(seeded["employee"].Grants);
        Assert.Equal(new RoleAreaCell("job", RoleLevels.See, RoleReaches.Self), Cell(employees, "job"));
        Assert.Equal(new RoleAreaCell("personal", RoleLevels.Change, RoleReaches.Self), Cell(employees, "personal"));
        Assert.Equal(new RoleAreaCell("plans", RoleLevels.Change, RoleReaches.Self), Cell(employees, "plans"));
        Assert.Equal(RoleLevels.None, Cell(employees, "signin").Level);

        var managers = RoleAreas.Read(seeded["manager"].Grants);
        Assert.Equal(new RoleAreaCell("job", RoleLevels.See, RoleReaches.Team), Cell(managers, "job"));
        Assert.Equal(new RoleAreaCell("approve", RoleLevels.Propose, RoleReaches.Team), Cell(managers, "approve"));
        Assert.Equal(new RoleAreaCell("plans", RoleLevels.Change, RoleReaches.Team), Cell(managers, "plans"));

        var hr = RoleAreas.Read(seeded["hr-admin"].Grants);
        Assert.Equal(new RoleAreaCell("job", RoleLevels.Change, RoleReaches.Everyone), Cell(hr, "job"));
        Assert.Equal(new RoleAreaCell("approve", RoleLevels.Approve, RoleReaches.Everyone), Cell(hr, "approve"));
        Assert.Equal(new RoleAreaCell("cycles", RoleLevels.Change, null), Cell(hr, "cycles"));
        Assert.Equal(RoleLevels.None, Cell(hr, "brand").Level);
        Assert.Equal(RoleLevels.None, Cell(hr, "roles").Level);
    }

    [Fact]
    public void Saving_writes_what_was_read()
    {
        foreach (var template in AccessProfileTemplates.ComposeSeeded(performanceEnabled: true))
        {
            var cells = RoleAreas.Read(template.Grants);
            var saved = RoleAreas.Compose(cells, []);
            Assert.Equal(cells, RoleAreas.Read(saved));
        }
    }

    [Fact]
    public void The_seeded_roles_keep_what_they_could_do_before_the_model()
    {
        var seeded = AccessProfileTemplates.ComposeSeeded(performanceEnabled: true).ToDictionary(template => template.InternalKey);
        string[] employeeBefore = ["core.employee.view@Self", "core.orgchart.view@Tenant", "core.profile.self.update@Self", "core.profile.self.view@Self", "performance.cycle.view@Self", "performance.objective.self.manage@Self"];
        string[] managerBefore = ["core.employee.view@DirectReports", "core.organization.view@Tenant", "core.orgchart.view@Tenant", "core.profile.self.update@Self", "core.profile.self.view@Self", "core.team.view@DirectReports", "performance.cycle.view@DirectReports", "performance.objective.org.manage@Tenant", "performance.objective.self.manage@Self"];

        Assert.Equal(employeeBefore.Order(), seeded["employee"].Grants.Select(Key).Order());
        Assert.Subset(seeded["manager"].Grants.Select(Key).ToHashSet(), managerBefore.ToHashSet());
    }

    [Fact]
    public void Brand_and_roles_are_refused_to_any_role_but_administrators()
    {
        Assert.Throws<InvalidOperationException>(() => RoleAreas.Compose([new RoleAreaCell("brand", RoleLevels.Change, null)], []));
        Assert.Throws<InvalidOperationException>(() => RoleAreas.Compose([new RoleAreaCell("roles", RoleLevels.Change, null)], []));
        Assert.All(RoleAreas.AdministratorOnlyKeys, key => Assert.DoesNotContain(
            AccessProfileTemplates.ComposeSeeded(performanceEnabled: true).SelectMany(template => template.Grants),
            grant => grant.PermissionKey == key));
    }

    [Theory]
    [InlineData("job", RoleLevels.Change, RoleReaches.Team)]
    [InlineData("reports", RoleLevels.See, RoleReaches.Team)]
    [InlineData("job", RoleLevels.See, "unit")]
    [InlineData("nowhere", RoleLevels.See, null)]
    public void An_option_an_area_does_not_offer_is_refused(string area, string level, string? reach)
        => Assert.Throws<InvalidOperationException>(() => RoleAreas.Compose([new RoleAreaCell(area, level, reach)], []));

    [Fact]
    public void Grants_no_area_owns_survive_a_save_and_owned_ones_follow_the_cells()
    {
        EffectivePermissionGrant[] existing =
        [
            new(ModuleSettingsPermissions.LearningManage, PermissionScopes.Module),
            new(CorePermissions.EmployeeManage, PermissionScopes.Tenant),
            new(CorePermissions.SettingsPeopleDataView, PermissionScopes.Tenant),
        ];

        var saved = RoleAreas.Compose([new RoleAreaCell("job", RoleLevels.See, RoleReaches.Everyone)], existing);

        Assert.Contains(saved, grant => grant.PermissionKey == ModuleSettingsPermissions.LearningManage);
        Assert.DoesNotContain(saved, grant => grant.PermissionKey == CorePermissions.EmployeeManage);
        Assert.DoesNotContain(saved, grant => grant.PermissionKey == CorePermissions.SettingsPeopleDataView);
    }

    [Fact]
    public void Personal_details_for_others_move_with_jobs_because_one_record_carries_both()
    {
        var saved = RoleAreas.Compose([new RoleAreaCell("personal", RoleLevels.Change, RoleReaches.Everyone)], []);
        var cells = RoleAreas.Read(saved);

        Assert.Equal(new RoleAreaCell("job", RoleLevels.Change, RoleReaches.Everyone), Cell(cells, "job"));
    }

    private static string Key(EffectivePermissionGrant grant) => $"{grant.PermissionKey}@{grant.Scope}";
}

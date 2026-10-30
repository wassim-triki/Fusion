using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.Identity.Features.Roles;
using EY.HRPlatform.Identity.Infrastructure.Core;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Tests.Features.Roles;

/// <summary>
/// Who holds a role (B-177): everyone, anyone with a team, a rule on department, job, place or unit, chosen people;
/// rules follow Core HR's facts when a job or unit changes; nothing reaches across companies.
/// </summary>
public sealed class RoleHoldersTests
{
    private static readonly Guid TenantA = Guid.NewGuid();
    private static readonly Guid TenantB = Guid.NewGuid();
    private static readonly Guid PeopleAndGrowth = Guid.NewGuid();
    private static readonly Guid Engineering = Guid.NewGuid();
    private static readonly Guid Company = Guid.NewGuid();
    private static readonly Guid DataEngineer = Guid.NewGuid();
    private static readonly Guid Tunis = Guid.NewGuid();

    private sealed class FakeFacts : ICoreRoleFacts
    {
        public Dictionary<Guid, List<CoreRoleFact>> ByTenant { get; } = [];
        public bool Down { get; set; }

        public Task<IReadOnlyList<CoreRoleFact>> GetFactsAsync(Guid tenantId, CancellationToken cancellationToken)
            => Down ? throw new HttpRequestException("Core HR is down")
                : Task.FromResult<IReadOnlyList<CoreRoleFact>>(ByTenant.GetValueOrDefault(tenantId, []));

        public Task<CoreRoleTargets> ResolveTargetsAsync(Guid tenantId, IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken)
            => Task.FromResult(tenantId == TenantA
                ? new CoreRoleTargets(
                    ids.Where(id => id == PeopleAndGrowth || id == Engineering).ToList(),
                    ids.Where(id => id == PeopleAndGrowth || id == Engineering || id == Company).ToList(),
                    ids.Where(id => id == DataEngineer).ToList(),
                    ids.Where(id => id == Tunis).ToList())
                : new CoreRoleTargets([], [], [], []));
    }

    private sealed record Person(Guid UserId, Guid EmployeeId, Guid MembershipId);

    private sealed class World : IAsyncDisposable
    {
        public required AppIdentityDbContext Db { get; init; }
        public required FakeFacts Facts { get; init; }
        public required Dictionary<string, Person> People { get; init; }
        public required Dictionary<string, Guid> Roles { get; init; }

        public RoleService Service()
        {
            var profiles = new AccessProfileService(Db, RelationalTestDatabase.CreateUserManager(Db));
            return new RoleService(Db, new RoleHolderService(Db, Facts, profiles), new RoleRecomputeQueue(), Facts, profiles);
        }

        public RoleHolderService Holders()
            => new(Db, Facts, new AccessProfileService(Db, RelationalTestDatabase.CreateUserManager(Db)));

        public async Task<HashSet<string>> HoldersOfAsync(string role)
        {
            var userIds = await Db.UserAccessProfiles.IgnoreQueryFilters().AsNoTracking()
                .Where(row => row.AccessProfileId == Roles[role])
                .Select(row => row.UserId)
                .ToListAsync();
            return People.Where(person => userIds.Contains(person.Value.UserId)).Select(person => person.Key).ToHashSet();
        }

        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }

    private static async Task<World> ArrangeAsync()
    {
        var db = TestDbContextFactory.CreateWithoutTenant(Guid.NewGuid().ToString());
        db.Tenants.AddRange(Tenant.Create(TenantA, "Carthage"), Tenant.Create(TenantB, "Atlas"));

        var people = new Dictionary<string, Person>();
        void Add(string name, Guid tenantId, bool bound = true)
        {
            var user = new ApplicationUser
            {
                Id = Guid.NewGuid(),
                UserName = $"{name}@x.test",
                Email = $"{name}@x.test",
                NormalizedEmail = $"{name}@X.TEST".ToUpperInvariant(),
                NormalizedUserName = $"{name}@X.TEST".ToUpperInvariant(),
                FirstName = name,
                LastName = "Test",
                SecurityStamp = Guid.NewGuid().ToString(),
            };
            db.Users.Add(user);
            var membership = TenantMembership.Create(user.Id, tenantId);
            var employeeId = Guid.NewGuid();
            if (bound)
                membership.BindEmployee(employeeId);
            db.TenantMemberships.Add(membership);
            people[name] = new Person(user.Id, employeeId, membership.Id);
        }

        Add("nour", TenantA);
        Add("mariam", TenantA);
        Add("aicha", TenantA);
        Add("admin", TenantA, bound: false);
        Add("outsider", TenantB);

        var roles = new Dictionary<string, Guid>();
        AccessProfile Role(string name, string kind, Guid tenantId, string? key = null)
        {
            var profile = AccessProfile.Create(tenantId, name, null, key is null ? AccessProfileTypes.Custom : AccessProfileTypes.SystemSeeded, false, key);
            if (kind != AccessProfileHolderKinds.Rule)
                profile.SetHolders(kind, []);
            db.AccessProfiles.Add(profile);
            roles[name] = profile.Id;
            return profile;
        }

        Role("Employees", AccessProfileHolderKinds.Everyone, TenantA, "employee");
        Role("Managers", AccessProfileHolderKinds.Team, TenantA, "manager");
        var hr = Role("HR", AccessProfileHolderKinds.Rule, TenantA, "hr-admin");
        hr.SetHolders(AccessProfileHolderKinds.Rule, [AccessProfileRuleCondition.Create(TenantA, hr.Id, AccessProfileRuleKinds.Department, PeopleAndGrowth)]);
        Role("Atlas staff", AccessProfileHolderKinds.Everyone, TenantB);
        await db.SaveChangesAsync();

        var facts = new FakeFacts();
        facts.ByTenant[TenantA] =
        [
            new(people["nour"].EmployeeId, [PeopleAndGrowth, Company], null, Tunis, 0),
            new(people["mariam"].EmployeeId, [Engineering, Company], DataEngineer, Tunis, 5),
            new(people["aicha"].EmployeeId, [Engineering, Company], DataEngineer, null, 0),
        ];
        facts.ByTenant[TenantB] = [new(people["outsider"].EmployeeId, [PeopleAndGrowth], null, null, 3)];

        return new World { Db = db, Facts = facts, People = people, Roles = roles };
    }

    [Fact]
    public async Task Everyone_anyone_with_a_team_and_a_rule_fill_themselves()
    {
        await using var world = await ArrangeAsync();

        await world.Holders().RecomputeAsync(TenantA, CancellationToken.None);

        Assert.Equal(["aicha", "mariam", "nour"], (await world.HoldersOfAsync("Employees")).Order());
        Assert.Equal(["mariam"], await world.HoldersOfAsync("Managers"));
        Assert.Equal(["nour"], await world.HoldersOfAsync("HR"));
        // An account that isn't a person in the company (an administrator without a record) isn't "everyone".
        Assert.DoesNotContain("admin", await world.HoldersOfAsync("Employees"));
    }

    [Fact]
    public async Task A_job_or_unit_change_moves_the_rule_holders()
    {
        await using var world = await ArrangeAsync();
        await world.Holders().RecomputeAsync(TenantA, CancellationToken.None);

        // Aicha moves to People & Growth; Mariam's team leaves her.
        world.Facts.ByTenant[TenantA] =
        [
            new(world.People["nour"].EmployeeId, [PeopleAndGrowth, Company], null, Tunis, 0),
            new(world.People["mariam"].EmployeeId, [Engineering, Company], DataEngineer, Tunis, 0),
            new(world.People["aicha"].EmployeeId, [PeopleAndGrowth, Company], null, null, 0),
        ];
        await world.Holders().RecomputeAsync(TenantA, CancellationToken.None);

        Assert.Equal(["aicha", "nour"], (await world.HoldersOfAsync("HR")).Order());
        Assert.Empty(await world.HoldersOfAsync("Managers"));
    }

    [Fact]
    public async Task Someone_chosen_keeps_the_role_when_the_rule_lets_go()
    {
        await using var world = await ArrangeAsync();
        var service = world.Service();
        await world.Holders().RecomputeAsync(TenantA, CancellationToken.None);

        var hr = await service.GetRoleAsync(TenantA, world.Roles["HR"], CancellationToken.None);
        await service.SaveRoleAsync(TenantA, world.Roles["HR"], hr.Role.Version, new SaveRoleRequest(
            "HR", null, hr.Role.Cells, AccessProfileHolderKinds.Rule,
            [new RoleConditionDto(AccessProfileRuleKinds.Department, PeopleAndGrowth)],
            [world.People["mariam"].UserId]), CancellationToken.None);

        world.Facts.ByTenant[TenantA][0] = new(world.People["nour"].EmployeeId, [Engineering, Company], null, Tunis, 0);
        await world.Holders().RecomputeAsync(TenantA, CancellationToken.None);

        Assert.Equal(["mariam"], await world.HoldersOfAsync("HR"));
    }

    [Fact]
    public async Task Conditions_of_different_kinds_must_all_match()
    {
        await using var world = await ArrangeAsync();
        var service = world.Service();
        var role = await service.CreateRoleAsync(TenantA, new CreateRoleRequest("Data in Tunis", null), CancellationToken.None);

        await service.SaveRoleAsync(TenantA, role.Role.Id, role.Role.Version, new SaveRoleRequest(
            "Data in Tunis", null, [], AccessProfileHolderKinds.Rule,
            [new RoleConditionDto(AccessProfileRuleKinds.Job, DataEngineer), new RoleConditionDto(AccessProfileRuleKinds.Place, Tunis)],
            []), CancellationToken.None);
        world.Roles["Data in Tunis"] = role.Role.Id;

        Assert.Equal(["mariam"], await world.HoldersOfAsync("Data in Tunis"));
    }

    [Fact]
    public async Task A_person_sees_each_role_and_why()
    {
        await using var world = await ArrangeAsync();
        await world.Holders().RecomputeAsync(TenantA, CancellationToken.None);

        var roles = await world.Service().GetPersonRolesAsync(TenantA, world.People["nour"].EmployeeId, CancellationToken.None);

        Assert.NotNull(roles);
        var hr = Assert.Single(roles, role => role.Name == "HR");
        var reason = Assert.Single(hr.Reasons);
        Assert.Equal(PersonRoleReasons.Rule, reason.Kind);
        Assert.Equal([new RoleConditionDto(AccessProfileRuleKinds.Department, PeopleAndGrowth)], reason.Conditions);
        Assert.Equal(PersonRoleReasons.Everyone, Assert.Single(roles, role => role.Name == "Employees").Reasons.Single().Kind);
    }

    [Fact]
    public async Task Core_HR_down_changes_nothing()
    {
        await using var world = await ArrangeAsync();
        await world.Holders().RecomputeAsync(TenantA, CancellationToken.None);
        world.Facts.Down = true;

        await Assert.ThrowsAsync<HttpRequestException>(() => world.Holders().RecomputeAsync(TenantA, CancellationToken.None));

        Assert.Equal(["mariam"], await world.HoldersOfAsync("Managers"));
    }

    [Fact]
    public async Task Another_companys_role_is_not_found()
    {
        await using var world = await ArrangeAsync();
        var service = world.Service();

        await Assert.ThrowsAsync<RoleNotFoundException>(() => service.GetRoleAsync(TenantA, world.Roles["Atlas staff"], CancellationToken.None));
        await Assert.ThrowsAsync<RoleNotFoundException>(() => service.SaveRoleAsync(TenantA, world.Roles["Atlas staff"], 0,
            new SaveRoleRequest("Mine now", null, [], AccessProfileHolderKinds.Chosen, [], []), CancellationToken.None));
        await Assert.ThrowsAsync<RoleNotFoundException>(() => service.DeleteRoleAsync(TenantA, world.Roles["Atlas staff"], CancellationToken.None));
    }

    [Fact]
    public async Task Another_companys_people_and_values_are_refused()
    {
        await using var world = await ArrangeAsync();
        var service = world.Service();
        var role = await service.CreateRoleAsync(TenantA, new CreateRoleRequest("Recruiters", null), CancellationToken.None);

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.SaveRoleAsync(TenantA, role.Role.Id, role.Role.Version,
            new SaveRoleRequest("Recruiters", null, [], AccessProfileHolderKinds.Chosen, [], [world.People["outsider"].UserId]),
            CancellationToken.None));
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.SaveRoleAsync(TenantA, role.Role.Id, role.Role.Version,
            new SaveRoleRequest("Recruiters", null, [], AccessProfileHolderKinds.Rule, [new RoleConditionDto(AccessProfileRuleKinds.Unit, Guid.NewGuid())], []),
            CancellationToken.None));
        // A unit that isn't a department can't stand for one.
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.SaveRoleAsync(TenantA, role.Role.Id, role.Role.Version,
            new SaveRoleRequest("Recruiters", null, [], AccessProfileHolderKinds.Rule, [new RoleConditionDto(AccessProfileRuleKinds.Department, Company)], []),
            CancellationToken.None));

        Assert.Null(await service.GetPersonRolesAsync(TenantA, world.People["outsider"].EmployeeId, CancellationToken.None));
    }

    [Fact]
    public async Task Recomputing_one_company_leaves_the_other_alone()
    {
        await using var world = await ArrangeAsync();

        await world.Holders().RecomputeAsync(TenantA, CancellationToken.None);

        Assert.Empty(await world.HoldersOfAsync("Atlas staff"));
        Assert.DoesNotContain("outsider", await world.HoldersOfAsync("Employees"));
    }

    [Fact]
    public async Task Administrators_only_areas_and_the_administrators_role_are_refused()
    {
        await using var world = await ArrangeAsync();
        var service = world.Service();
        var role = await service.CreateRoleAsync(TenantA, new CreateRoleRequest("Office managers", null), CancellationToken.None);

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.SaveRoleAsync(TenantA, role.Role.Id, role.Role.Version,
            new SaveRoleRequest("Office managers", null, [new RoleCellDto("roles", RoleLevels.Change, null)], AccessProfileHolderKinds.Chosen, [], []),
            CancellationToken.None));

        var administrators = AccessProfile.Create(TenantA, "Tenant Administrator", null, AccessProfileTypes.SystemSeeded, true,
            TenantAdministratorAuthority.InternalKey);
        world.Db.AccessProfiles.Add(administrators);
        await world.Db.SaveChangesAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.SaveRoleAsync(TenantA, administrators.Id, administrators.Version,
            new SaveRoleRequest("Administrators", null, [], AccessProfileHolderKinds.Everyone, [], []), CancellationToken.None));
    }

    [Fact]
    public async Task Only_people_who_sign_in_can_be_chosen_and_everyone_takes_no_chosen()
    {
        await using var world = await ArrangeAsync();
        var service = world.Service();
        var employees = await service.GetRoleAsync(TenantA, world.Roles["Employees"], CancellationToken.None);

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.SaveRoleAsync(TenantA, employees.Role.Id, employees.Role.Version,
            new SaveRoleRequest("Employees", null, employees.Role.Cells, AccessProfileHolderKinds.Everyone, [], [world.People["nour"].UserId]),
            CancellationToken.None));
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.SaveRoleAsync(TenantA, employees.Role.Id, employees.Role.Version,
            new SaveRoleRequest("Employees", null, employees.Role.Cells, AccessProfileHolderKinds.Chosen, [], [Guid.NewGuid()]),
            CancellationToken.None));
    }

    [Fact]
    public async Task A_row_naming_the_administrator_definition_grants_nothing_without_the_administrator_assignment()
    {
        await using var world = await ArrangeAsync();
        var administrators = AccessProfile.Create(TenantA, "Tenant Administrator", null, AccessProfileTypes.SystemSeeded, true,
            TenantAdministratorAuthority.InternalKey);
        administrators.ReplaceGrants([AccessProfileGrant.Create(TenantA, administrators.Id, CorePermissions.AccessProfilesManageV2, PermissionScopes.Tenant)]);
        world.Db.AccessProfiles.Add(administrators);
        var nour = world.People["nour"];
        world.Db.UserAccessProfiles.Add(UserAccessProfile.Create(TenantA, nour.UserId, administrators.Id, nour.MembershipId));
        await world.Db.SaveChangesAsync();

        var profiles = new AccessProfileService(world.Db, RelationalTestDatabase.CreateUserManager(world.Db));
        var user = await world.Db.Users.SingleAsync(item => item.Id == nour.UserId);
        var grants = await profiles.GetEffectivePermissionsAsync(user);

        Assert.DoesNotContain(grants, grant => grant.PermissionKey == CorePermissions.AccessProfilesManageV2);
    }

    [Fact]
    public async Task An_invitation_can_not_carry_the_administrator_definition()
    {
        await using var world = await ArrangeAsync();
        var administrators = AccessProfile.Create(TenantA, "Tenant Administrator", null, AccessProfileTypes.SystemSeeded, true,
            TenantAdministratorAuthority.InternalKey);
        world.Db.AccessProfiles.Add(administrators);
        await world.Db.SaveChangesAsync();
        var profiles = new AccessProfileService(world.Db, RelationalTestDatabase.CreateUserManager(world.Db));

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            profiles.SetInviteAccessProfilesAsync(TenantA, Guid.NewGuid(), [administrators.Id]));
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            profiles.SetInviteAccessProfilesAsync(TenantA, Guid.NewGuid(), [world.Roles["Atlas staff"]]));
    }
}

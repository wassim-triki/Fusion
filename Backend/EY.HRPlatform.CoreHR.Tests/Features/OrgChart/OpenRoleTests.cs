using EY.HRPlatform.CoreHR.Tests.TestSupport;
using System.Security.Claims;
using EY.HRPlatform.CoreHR.Controllers;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.OrgChart;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Results;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;

namespace EY.HRPlatform.CoreHR.Tests.Features.OrgChart;

/// <summary>
/// B-128: open roles on the org chart. People admins add and edit them under a manager who works here today, in a
/// unit active today; the chart shows open ones to whoever sees the manager, on-hold ones to HR, none on past
/// dates; nothing reads or writes across tenants.
/// </summary>
public sealed class OpenRoleTests
{
    private static readonly Guid TenantA = Guid.NewGuid();
    private static readonly Guid TenantB = Guid.NewGuid();
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private static readonly DateTime TodayAt = Today.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
    private const string Actor = "hr-1|Amira Khelifi";

    private sealed record World(string Db, Dictionary<string, Guid> Ids, Dictionary<string, string> Keys, Guid Team, Guid Closed, Guid UnitB,
        Dictionary<string, Guid> Jobs);

    /// <summary>
    /// Tenant A: Sami (CEO) → Mariam → Aicha; Sami → Nour. Omar's last day was yesterday. Everyone works in Team;
    /// Closed is a unit made inactive today. Tenant B holds Zed in Unit B.
    /// </summary>
    private static async Task<World> SeedAsync()
    {
        var db = Guid.NewGuid().ToString();
        await using var seed = TestDbContextFactory.CreateWithoutTenant(db);
        var since = Today.AddDays(-90);

        OrgUnit Unit(Guid tenant, string name, OrgUnit? parent, bool closesToday = false)
        {
            var unit = OrgUnit.Create(tenant, $"U-{Guid.NewGuid():N}"[..10], name, "Department", parent?.Id);
            seed.OrgUnits.Add(unit);
            seed.OrgUnitEffectiveStates.Add(OrgUnitEffectiveState.Create(tenant, unit.Id, OrganizationalUnitTypeCatalog.DepartmentId,
                parent?.Id, name, OrgUnitLifecycleState.Active, since, closesToday ? Today : null));
            if (closesToday)
                seed.OrgUnitEffectiveStates.Add(OrgUnitEffectiveState.Create(tenant, unit.Id, OrganizationalUnitTypeCatalog.DepartmentId,
                    parent?.Id, name, OrgUnitLifecycleState.Inactive, Today));
            return unit;
        }

        var root = Unit(TenantA, "Carthage", null);
        var team = Unit(TenantA, "Product A", root);
        var closed = Unit(TenantA, "Old Lab", root, closesToday: true);
        var unitB = Unit(TenantB, "Borealis", null);

        var ids = new Dictionary<string, Guid>();
        var keys = new Dictionary<string, string>();
        var assignments = new Dictionary<Guid, Guid>();
        Employment Person(Guid tenant, string first, OrgUnit unit)
        {
            var employee = Employee.Create(tenant, first, "Test", $"{first.ToLowerInvariant()}@example.com", employeeNumber: $"E-{Guid.NewGuid():N}");
            var employment = Employment.Start(tenant, employee.Id, TodayAt.AddYears(-2), null, WorkforceSourceType.Manual);
            var assignment = WorkAssignment.Create(tenant, employment.Id, employee.Id, unit.Id, TestCatalog.Job(tenant, "Role"), TestCatalog.Place(tenant, "Tunis"), true, TodayAt.AddYears(-2), null, WorkforceSourceType.Manual);
            seed.Employees.Add(employee);
            seed.Employments.Add(employment);
            seed.WorkAssignments.Add(assignment);
            assignments[employee.Id] = assignment.Id;
            ids[first] = employee.Id;
            keys[first] = employee.StableEmployeeKey;
            return employment;
        }

        void Reports(string subject, string manager)
            => seed.ManagerRelationships.Add(ManagerRelationship.Create(TenantA, ids[subject], ids[manager],
                assignments[ids[subject]], assignments[ids[manager]], ReportingRelationshipType.PrimaryManager, TodayAt.AddYears(-1), WorkforceSourceType.Manual));

        foreach (var first in new[] { "Sami", "Mariam", "Aicha", "Nour" }) Person(TenantA, first, team);
        Person(TenantA, "Omar", team).End(TodayAt);
        Person(TenantB, "Zed", unitB);
        Reports("Mariam", "Sami");
        Reports("Aicha", "Mariam");
        Reports("Nour", "Sami");
        var jobs = new[] { "Data Engineer", "Recruiter", "Senior Recruiter" }
            .ToDictionary(title => title, title => seed.JobId(TenantA, title));
        var retired = seed.Job(TenantA, "Old Title");
        retired.Retire("test");
        jobs["Old Title"] = retired.Id;
        jobs["Taken"] = seed.JobId(TenantB, "Taken");
        await seed.SaveChangesAsync();
        return new World(db, ids, keys, team.Id, closed.Id, unitB.Id, jobs);
    }

    private static Task<Result<OrgChartOpenRoleDto>> CreateAsync(World world, OpenRoleRequest request, Guid? tenant = null)
    {
        var tenantContext = TestTenantContext.WithTenant(tenant ?? TenantA);
        return new CreateOpenRoleCommandHandler(TestDbContextFactory.Create(tenantContext, world.Db), tenantContext)
            .Handle(new CreateOpenRoleCommand(request, Actor), default);
    }

    private static Task<Result<OrgChartOpenRoleDto>> UpdateAsync(World world, Guid id, OpenRoleRequest request, Guid? tenant = null)
        => new UpdateOpenRoleCommandHandler(TestDbContextFactory.Create(TestTenantContext.WithTenant(tenant ?? TenantA), world.Db),
                TestTenantContext.WithTenant(tenant ?? TenantA))
            .Handle(new UpdateOpenRoleCommand(id, request, Actor), default);

    private static async Task<OrgChartDto> ChartAsync(World world, string scope = OrgChartScopes.Tenant, Guid? viewer = null, bool hr = false, DateOnly? asOf = null, Guid? tenant = null)
    {
        var tenantSettings = new Mock<ITenantSettingsReadService>();
        tenantSettings.Setup(s => s.GetCurrentAsync(It.IsAny<CancellationToken>())).ReturnsAsync(new TenantSettingsDto());
        var result = await new OrgChartQueryHandler(TestDbContextFactory.Create(TestTenantContext.WithTenant(tenant ?? TenantA), world.Db), tenantSettings.Object)
            .Handle(new OrgChartQuery(asOf ?? Today, scope, viewer, hr), default);
        return result.Value;
    }

    private static OpenRoleRequest Role(World world, string manager = "Mariam", string title = "Data Engineer", Guid? unit = null,
        DateOnly? start = null, OpenRoleStatus status = OpenRoleStatus.Open)
        => new(world.Jobs.GetValueOrDefault(title, Guid.NewGuid()), world.Keys[manager].ToLowerInvariant(), unit ?? world.Team, start, status);

    [Fact]
    public async Task HR_adds_a_role_under_a_manager_and_everyone_sees_it_in_that_line_from_today_on()
    {
        var world = await SeedAsync();
        var created = await CreateAsync(world, Role(world, start: Today.AddDays(40)));

        Assert.True(created.IsSuccess);
        Assert.Equal(("Data Engineer", world.Keys["Mariam"], OpenRoleStatus.Open, Today.AddDays(40), "Product A"),
            (created.Value.JobTitle, created.Value.ManagerKey, created.Value.Status, created.Value.TargetStartDate, created.Value.Unit?.Name));

        var employee = await ChartAsync(world, viewer: world.Ids["Aicha"]);
        var shown = Assert.Single(employee.OpenRoles);
        Assert.Equal((created.Value.Id, world.Keys["Mariam"]), (shown.Id, shown.ManagerKey));
        Assert.Single((await ChartAsync(world, hr: true, asOf: Today.AddDays(10))).OpenRoles);
        Assert.Empty((await ChartAsync(world, hr: true, asOf: Today.AddDays(-1))).OpenRoles);
    }

    [Fact]
    public async Task On_hold_shows_to_HR_only_and_filled_or_closed_leave_the_chart()
    {
        var world = await SeedAsync();
        var held = (await CreateAsync(world, Role(world, status: OpenRoleStatus.OnHold))).Value;
        Assert.Equal(OpenRoleStatus.OnHold, held.Status);
        Assert.Empty((await ChartAsync(world, viewer: world.Ids["Aicha"])).OpenRoles);
        Assert.Single((await ChartAsync(world, hr: true)).OpenRoles);

        Assert.True((await UpdateAsync(world, held.Id, Role(world, status: OpenRoleStatus.Filled))).IsSuccess);
        Assert.Empty((await ChartAsync(world, hr: true)).OpenRoles);
        Assert.True((await UpdateAsync(world, held.Id, Role(world, status: OpenRoleStatus.Open))).IsSuccess);
        Assert.Single((await ChartAsync(world, viewer: world.Ids["Aicha"])).OpenRoles);
        Assert.True((await UpdateAsync(world, held.Id, Role(world, status: OpenRoleStatus.Closed))).IsSuccess);
        Assert.Empty((await ChartAsync(world, hr: true)).OpenRoles);
    }

    [Fact]
    public async Task A_branch_viewer_sees_roles_only_under_people_they_can_see()
    {
        var world = await SeedAsync();
        await CreateAsync(world, Role(world, "Mariam"));
        await CreateAsync(world, Role(world, "Nour", "Recruiter"));

        var branch = await ChartAsync(world, OrgChartScopes.DirectReports, world.Ids["Mariam"]);
        var shown = Assert.Single(branch.OpenRoles);
        Assert.Equal(world.Keys["Mariam"], shown.ManagerKey);
        Assert.Equal(2, (await ChartAsync(world)).OpenRoles.Count);
    }

    [Fact]
    public async Task Edit_moves_a_role_to_another_manager_and_unit_and_keeps_a_target_start_that_has_passed()
    {
        var world = await SeedAsync();
        var role = (await CreateAsync(world, Role(world, start: Today))).Value;
        var moved = await UpdateAsync(world, role.Id, Role(world, "Nour", "Senior Recruiter", start: Today));
        Assert.True(moved.IsSuccess);
        Assert.Equal(("Senior Recruiter", world.Keys["Nour"]), (moved.Value.JobTitle, moved.Value.ManagerKey));
        Assert.False((await UpdateAsync(world, role.Id, Role(world, start: Today.AddDays(-3)))).IsSuccess);
    }

    [Fact]
    public async Task Invalid_roles_are_refused()
    {
        var world = await SeedAsync();
        async Task Refused(OpenRoleRequest request, string code)
        {
            var result = await CreateAsync(world, request);
            Assert.True(result.IsFailure);
            Assert.Equal(code, result.Error.Code);
        }

        await Refused(Role(world, title: "Unknown"), "Job.NotFound");
        await Refused(Role(world, title: "Old Title"), "Job.Retired");
        await Refused(Role(world) with { ManagerKey = "NOPE-1" }, "OpenRole.Manager");
        await Refused(Role(world, "Omar"), "OpenRole.Manager");
        await Refused(Role(world, unit: world.Closed), "OpenRole.Unit");
        await Refused(Role(world, unit: Guid.NewGuid()), "OpenRole.Unit");
        await Refused(Role(world, start: Today.AddDays(-1)), "OpenRole.TargetStart");
        await Refused(Role(world, status: OpenRoleStatus.Filled), "OpenRole.Status");
        await Refused(Role(world, status: (OpenRoleStatus)99), "OpenRole.Status");
        Assert.Empty((await ChartAsync(world, hr: true)).OpenRoles);
    }

    [Fact]
    public async Task Nothing_crosses_tenants()
    {
        var world = await SeedAsync();
        // Another tenant's manager or unit is refused as unknown.
        Assert.Equal("OpenRole.Manager", (await CreateAsync(world, Role(world, "Zed"))).Error.Code);
        Assert.Equal("OpenRole.Unit", (await CreateAsync(world, Role(world, unit: world.UnitB))).Error.Code);

        var role = (await CreateAsync(world, Role(world))).Value;
        // Another tenant's job is refused as unknown.
        Assert.Equal("Job.NotFound", (await CreateAsync(world, Role(world, title: "Taken"))).Error.Code);
        var fromB = await UpdateAsync(world, role.Id, new OpenRoleRequest(world.Jobs["Taken"], world.Keys["Zed"], world.UnitB), TenantB);
        Assert.Equal(OpenRoleErrors.NotFoundCode, fromB.Error.Code);
        Assert.Empty((await ChartAsync(world, hr: true, tenant: TenantB)).OpenRoles);
        Assert.Equal("Data Engineer", Assert.Single((await ChartAsync(world, hr: true)).OpenRoles).JobTitle);
    }

    // ── Controller: only people admins write ────────────────────────────────

    private static ClaimsPrincipal Caller(params (string Key, string Scope)[] grants)
    {
        var claims = new List<Claim>
        {
            new(CustomClaimTypes.TenantId, TenantA.ToString()),
            new(ClaimTypes.NameIdentifier, "hr-1"),
            new(CustomClaimTypes.FullName, "Amira Khelifi"),
        };
        claims.AddRange(grants.Select(grant => new Claim(CustomClaimTypes.CorePermission, CorePermissionClaimValue.Encode(grant.Key, grant.Scope))));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "Test"));
    }

    private static (OrgChartController Controller, Mock<ISender> Sender) Controller(ClaimsPrincipal caller, Error? failure = null)
    {
        var sender = new Mock<ISender>();
        var dto = new OrgChartOpenRoleDto(Guid.NewGuid(), "Data Engineer", "EMP-1", null, null, OpenRoleStatus.Open);
        var result = failure is null ? Result.Success(dto) : Result.Failure<OrgChartOpenRoleDto>(failure);
        sender.Setup(s => s.Send(It.IsAny<CreateOpenRoleCommand>(), It.IsAny<CancellationToken>())).ReturnsAsync(result);
        sender.Setup(s => s.Send(It.IsAny<UpdateOpenRoleCommand>(), It.IsAny<CancellationToken>())).ReturnsAsync(result);
        return (new OrgChartController(sender.Object, new CoreAccessPolicyService(), Mock.Of<ITenantSettingsReadService>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = caller } },
        }, sender);
    }

    private static readonly OpenRoleRequest Body = new(Guid.NewGuid(), "EMP-1", Guid.NewGuid());

    [Fact]
    public async Task Only_people_admins_add_or_edit_open_roles()
    {
        foreach (var grants in new[]
                 {
                     new[] { (CorePermissions.OrgChartView, PermissionScopes.Tenant) },
                     new[] { (CorePermissions.OrgChartView, PermissionScopes.Tenant), (CorePermissions.EmployeeView, PermissionScopes.Tenant) },
                     new[] { (CorePermissions.ReportingManage, PermissionScopes.Tenant) },
                     new[] { (CorePermissions.OrgChartView, PermissionScopes.Tenant), (CorePermissions.EmployeeView, PermissionScopes.DirectReports) },
                 })
        {
            var (controller, sender) = Controller(Caller(grants));
            Assert.IsType<ForbidResult>(await controller.CreateOpenRole(Body, default));
            Assert.IsType<ForbidResult>(await controller.UpdateOpenRole(Guid.NewGuid(), Body, default));
            sender.VerifyNoOtherCalls();
        }

        var (admin, adminSender) = Controller(Caller((CorePermissions.EmployeeManage, PermissionScopes.Tenant)));
        Assert.Equal(StatusCodes.Status201Created, Assert.IsType<ObjectResult>(await admin.CreateOpenRole(Body, default)).StatusCode);
        Assert.IsType<OkObjectResult>(await admin.UpdateOpenRole(Guid.NewGuid(), Body, default));
        adminSender.Verify(s => s.Send(It.Is<CreateOpenRoleCommand>(c => c.Actor == "hr-1|Amira Khelifi"), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Failures_map_to_not_found_and_bad_request()
    {
        var hr = Caller((CorePermissions.EmployeeManage, PermissionScopes.Tenant));
        var (missing, _) = Controller(hr, new Error(OpenRoleErrors.NotFoundCode, "Not found."));
        Assert.IsType<NotFoundObjectResult>(await missing.UpdateOpenRole(Guid.NewGuid(), Body, default));
        var (invalid, _) = Controller(hr, Error.Validation("OpenRole.Unit", "Pick a unit that is active today."));
        Assert.IsType<BadRequestObjectResult>(await invalid.CreateOpenRole(Body, default));
    }
}

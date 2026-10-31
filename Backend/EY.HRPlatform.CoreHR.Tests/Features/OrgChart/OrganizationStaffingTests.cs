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
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Results;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;

namespace EY.HRPlatform.CoreHR.Tests.Features.OrgChart;

/// <summary>
/// B-183: who works in each unit as of a date, for the Organization's Structure and List views, the time slider and
/// the unit pages. Counts include the units below; a head is whoever in the unit reports outside it; open roles are
/// a plan from today on; another date than today is HR only; heads and unit pages need the whole company's chart;
/// nothing crosses tenants.
/// </summary>
public sealed class OrganizationStaffingTests
{
    private static readonly Guid TenantA = Guid.NewGuid();
    private static readonly Guid TenantB = Guid.NewGuid();
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private static readonly DateTime TodayAt = Today.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
    private static readonly DateTime LongAgo = TodayAt.AddYears(-3);

    private sealed record World(string Db, Dictionary<string, Guid> Units, Dictionary<string, string> Keys);

    /// <summary>
    /// Tenant A: Carthage (Sami) › Product &amp; Engineering (Amira) › Product A (Mariam, Aicha who joined 30 days
    /// ago, Skander joining in 20 days) and Empty. Product A has an open role and an on-hold one. Tenant B: Borealis (Zed).
    /// </summary>
    private static async Task<World> SeedAsync()
    {
        var db = Guid.NewGuid().ToString();
        await using var seed = TestDbContextFactory.CreateWithoutTenant(db);
        var units = new Dictionary<string, Guid>();
        var keys = new Dictionary<string, string>();
        var people = new Dictionary<string, (Guid Id, Guid Assignment)>();

        OrgUnit Unit(Guid tenant, string name, OrgUnit? parent)
        {
            var unit = OrgUnit.Create(tenant, $"U-{Guid.NewGuid():N}"[..10], name, "Department", parent?.Id);
            seed.OrgUnits.Add(unit);
            seed.OrgUnitEffectiveStates.Add(OrgUnitEffectiveState.Create(tenant, unit.Id, OrganizationalUnitTypeCatalog.DepartmentId,
                parent?.Id, name, OrgUnitLifecycleState.Active, DateOnly.FromDateTime(LongAgo)));
            units[name] = unit.Id;
            return unit;
        }

        void Person(Guid tenant, string first, OrgUnit unit, DateTime start, string? manager = null)
        {
            var employee = Employee.Create(tenant, first, "Test", $"{first.ToLowerInvariant()}@example.com", employeeNumber: $"E-{Guid.NewGuid():N}");
            var employment = Employment.Start(tenant, employee.Id, start, null, WorkforceSourceType.Manual);
            var assignment = WorkAssignment.Create(tenant, employment.Id, employee.Id, unit.Id, TestCatalog.Job(tenant, "Engineer"),
                TestCatalog.Place(tenant, "Tunis"), true, start, null, WorkforceSourceType.Manual);
            seed.Employees.Add(employee);
            seed.Employments.Add(employment);
            seed.WorkAssignments.Add(assignment);
            people[first] = (employee.Id, assignment.Id);
            keys[first] = employee.StableEmployeeKey;
            if (manager is not null)
                seed.ManagerRelationships.Add(ManagerRelationship.Create(tenant, employee.Id, people[manager].Id, assignment.Id,
                    people[manager].Assignment, ReportingRelationshipType.PrimaryManager, start, WorkforceSourceType.Manual));
        }

        var root = Unit(TenantA, "Carthage", null);
        var division = Unit(TenantA, "Product & Engineering", root);
        var team = Unit(TenantA, "Product A", division);
        Unit(TenantA, "Empty", division);
        var rootB = Unit(TenantB, "Borealis", null);

        Person(TenantA, "Sami", root, LongAgo);
        Person(TenantA, "Amira", division, LongAgo, "Sami");
        Person(TenantA, "Mariam", team, LongAgo, "Amira");
        Person(TenantA, "Aicha", team, TodayAt.AddDays(-30), "Mariam");
        Person(TenantA, "Skander", team, TodayAt.AddDays(20), "Mariam");
        Person(TenantB, "Zed", rootB, LongAgo);

        seed.OpenRoles.Add(OpenRole.Create(TenantA, TestCatalog.Job(TenantA, "Data Engineer"), null, people["Mariam"].Id, team.Id, null, OpenRoleStatus.Open, "test"));
        seed.OpenRoles.Add(OpenRole.Create(TenantA, TestCatalog.Job(TenantA, "Analyst"), null, people["Mariam"].Id, team.Id, null, OpenRoleStatus.OnHold, "test"));
        await seed.SaveChangesAsync();
        return new World(db, units, keys);
    }

    private static Mock<ITenantSettingsReadService> Settings()
    {
        var settings = new Mock<ITenantSettingsReadService>();
        settings.Setup(s => s.GetCurrentAsync(It.IsAny<CancellationToken>())).ReturnsAsync(new TenantSettingsDto());
        return settings;
    }

    private static async Task<OrganizationStaffingDto> StaffingAsync(World world, DateOnly? asOf = null, bool withHeads = true, bool hr = false, Guid? tenant = null)
    {
        var context = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenant ?? TenantA), world.Db);
        var result = await new OrganizationStaffingQueryHandler(context, Settings().Object)
            .Handle(new OrganizationStaffingQuery(asOf ?? Today, withHeads, hr), default);
        Assert.True(result.IsSuccess);
        return result.Value;
    }

    private static async Task<Result<OrganizationUnitPeopleDto>> UnitAsync(World world, Guid unit, DateOnly? asOf = null, bool hr = false, Guid? tenant = null)
    {
        var context = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenant ?? TenantA), world.Db);
        return await new OrganizationUnitPeopleQueryHandler(context, Settings().Object)
            .Handle(new OrganizationUnitPeopleQuery(unit, asOf ?? Today, hr), default);
    }

    private static UnitStaffingDto Of(OrganizationStaffingDto staffing, World world, string unit)
        => Assert.Single(staffing.Units, u => u.UnitId == world.Units[unit]);

    [Fact]
    public async Task Each_unit_counts_its_people_and_those_below_with_its_head()
    {
        var world = await SeedAsync();
        var staffing = await StaffingAsync(world);

        Assert.Equal((4, 1, world.Keys["Sami"]), (Of(staffing, world, "Carthage").People, Of(staffing, world, "Carthage").Direct, Of(staffing, world, "Carthage").Head!.EmployeeKey));
        Assert.Equal((3, world.Keys["Amira"]), (Of(staffing, world, "Product & Engineering").People, Of(staffing, world, "Product & Engineering").Head!.EmployeeKey));
        Assert.Equal((2, world.Keys["Mariam"]), (Of(staffing, world, "Product A").People, Of(staffing, world, "Product A").Head!.EmployeeKey));
        Assert.Equal(0, Of(staffing, world, "Empty").People);
        Assert.Null(Of(staffing, world, "Empty").Head);
        Assert.Equal(DateOnly.FromDateTime(LongAgo), staffing.FirstDate);
    }

    [Fact]
    public async Task Counts_follow_the_date_back_and_forward()
    {
        var world = await SeedAsync();
        Assert.Equal(1, Of(await StaffingAsync(world, Today.AddDays(-60), hr: true), world, "Product A").People);
        Assert.Equal(3, Of(await StaffingAsync(world, Today.AddDays(30), hr: true), world, "Product A").People);
    }

    [Fact]
    public async Task Open_roles_count_from_today_on_hold_ones_for_HR_only()
    {
        var world = await SeedAsync();
        Assert.Equal(1, Of(await StaffingAsync(world), world, "Product A").OpenRoles);
        Assert.Equal(1, Of(await StaffingAsync(world), world, "Carthage").OpenRoles);
        Assert.Equal(2, Of(await StaffingAsync(world, hr: true), world, "Product A").OpenRoles);
        Assert.Equal(0, Of(await StaffingAsync(world, Today.AddDays(-1), hr: true), world, "Product A").OpenRoles);
    }

    [Fact]
    public async Task Without_the_whole_chart_no_head_comes_back()
    {
        var world = await SeedAsync();
        var staffing = await StaffingAsync(world, withHeads: false);
        Assert.All(staffing.Units, unit => Assert.Null(unit.Head));
        Assert.Equal(4, Of(staffing, world, "Carthage").People);
    }

    [Fact]
    public async Task A_unit_page_brings_its_head_everyone_below_and_its_open_roles()
    {
        var world = await SeedAsync();
        var page = (await UnitAsync(world, world.Units["Product & Engineering"])).Value;
        Assert.Equal(world.Keys["Amira"], page.Head!.EmployeeKey);
        Assert.Equal(new[] { "Aicha", "Amira", "Mariam" }.Select(n => world.Keys[n]).Order(), page.People.Select(p => p.EmployeeKey).Order());
        Assert.Equal("Data Engineer", Assert.Single(page.OpenRoles).JobTitle);

        var later = (await UnitAsync(world, world.Units["Product A"], Today.AddDays(30), hr: true)).Value;
        Assert.Contains(later.People, p => p.EmployeeKey == world.Keys["Skander"]);
        Assert.Equal(2, later.OpenRoles.Count);
    }

    [Fact]
    public async Task Nothing_crosses_tenants()
    {
        var world = await SeedAsync();
        var staffing = await StaffingAsync(world);
        Assert.DoesNotContain(staffing.Units, unit => unit.UnitId == world.Units["Borealis"]);
        Assert.Equal(4, staffing.Units.Count);

        var other = await UnitAsync(world, world.Units["Borealis"]);
        Assert.Equal(OrganizationStaffingErrors.UnitNotFoundCode, other.Error.Code);
        var fromB = await UnitAsync(world, world.Units["Product A"], tenant: TenantB);
        Assert.True(fromB.IsFailure);
        Assert.Equal(1, Assert.Single((await StaffingAsync(world, tenant: TenantB)).Units).People);
    }

    // --- Who may read it ---------------------------------------------------------------------------

    private static readonly (string, string) OrgView = (CorePermissions.OrganizationView, PermissionScopes.Tenant);
    private static readonly (string, string) Everyone = (CorePermissions.OrgChartView, PermissionScopes.Tenant);
    private static readonly (string, string) Branch = (CorePermissions.OrgChartView, PermissionScopes.DirectReports);
    private static readonly (string, string) Hr = (CorePermissions.EmployeeView, PermissionScopes.Tenant);

    private static ClaimsPrincipal Caller(params (string Key, string Scope)[] grants)
    {
        var claims = new List<Claim> { new(CustomClaimTypes.TenantId, TenantA.ToString()), new(CustomClaimTypes.EmployeeId, Guid.NewGuid().ToString()) };
        claims.AddRange(grants.Select(grant => new Claim(CustomClaimTypes.CorePermission, CorePermissionClaimValue.Encode(grant.Key, grant.Scope))));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "Test"));
    }

    private static (OrgChartController Controller, Mock<ISender> Sender) Controller(params (string, string)[] grants)
    {
        var sender = new Mock<ISender>();
        sender.Setup(s => s.Send(It.IsAny<OrganizationStaffingQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((OrganizationStaffingQuery q, CancellationToken _) => Result.Success(new OrganizationStaffingDto(q.AsOf, null, [])));
        sender.Setup(s => s.Send(It.IsAny<OrganizationUnitPeopleQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((OrganizationUnitPeopleQuery q, CancellationToken _) => Result.Success(new OrganizationUnitPeopleDto(q.UnitId, q.AsOf, null, [], [])));
        return (new OrgChartController(sender.Object, new CoreAccessPolicyService(), Settings().Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = Caller(grants) } },
        }, sender);
    }

    [Fact]
    public async Task Without_Organization_view_both_are_forbidden()
    {
        var (controller, sender) = Controller(Everyone, Hr);
        Assert.IsType<ForbidResult>(await controller.GetStaffing(null, default));
        Assert.IsType<ForbidResult>(await controller.GetUnit(Guid.NewGuid(), null, default));
        sender.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Another_date_than_today_is_for_HR_only()
    {
        var (viewer, viewerSender) = Controller(OrgView, Everyone);
        Assert.IsType<ForbidResult>(await viewer.GetStaffing(Today.AddDays(30), default));
        Assert.IsType<ForbidResult>(await viewer.GetUnit(Guid.NewGuid(), Today.AddDays(-30), default));
        viewerSender.VerifyNoOtherCalls();

        var (hr, hrSender) = Controller(OrgView, Everyone, Hr);
        Assert.IsType<OkObjectResult>(await hr.GetStaffing(Today.AddDays(-400), default));
        Assert.IsType<OkObjectResult>(await hr.GetUnit(Guid.NewGuid(), Today.AddDays(30), default));
        hrSender.Verify(s => s.Send(It.Is<OrganizationStaffingQuery>(q => q.HrAudience && q.WithHeads && q.AsOf == Today.AddDays(-400)), It.IsAny<CancellationToken>()), Times.Once);
        hrSender.Verify(s => s.Send(It.Is<OrganizationUnitPeopleQuery>(q => q.HrAudience && q.AsOf == Today.AddDays(30)), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Heads_and_unit_pages_need_the_whole_companys_chart()
    {
        var (branch, branchSender) = Controller(OrgView, Branch);
        Assert.IsType<OkObjectResult>(await branch.GetStaffing(null, default));
        branchSender.Verify(s => s.Send(It.Is<OrganizationStaffingQuery>(q => !q.WithHeads && !q.HrAudience), It.IsAny<CancellationToken>()), Times.Once);
        Assert.IsType<ForbidResult>(await branch.GetUnit(Guid.NewGuid(), null, default));

        var (noChart, noChartSender) = Controller(OrgView);
        Assert.IsType<OkObjectResult>(await noChart.GetStaffing(null, default));
        noChartSender.Verify(s => s.Send(It.Is<OrganizationStaffingQuery>(q => !q.WithHeads), It.IsAny<CancellationToken>()), Times.Once);
        Assert.IsType<ForbidResult>(await noChart.GetUnit(Guid.NewGuid(), null, default));

        var (whole, wholeSender) = Controller(OrgView, Everyone);
        Assert.IsType<OkObjectResult>(await whole.GetUnit(Guid.NewGuid(), null, default));
        wholeSender.Verify(s => s.Send(It.Is<OrganizationUnitPeopleQuery>(q => !q.HrAudience && q.AsOf == Today), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task An_unknown_unit_is_not_found()
    {
        var (controller, sender) = Controller(OrgView, Everyone);
        sender.Setup(s => s.Send(It.IsAny<OrganizationUnitPeopleQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<OrganizationUnitPeopleDto>(new Error(OrganizationStaffingErrors.UnitNotFoundCode, "No unit")));
        Assert.IsType<NotFoundObjectResult>(await controller.GetUnit(Guid.NewGuid(), null, default));
    }
}

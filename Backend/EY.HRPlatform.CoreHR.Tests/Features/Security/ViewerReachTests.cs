using System.Security.Claims;
using EY.HRPlatform.CoreHR.Controllers;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Features.Reports;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;

namespace EY.HRPlatform.CoreHR.Tests.Features.Security;

/// <summary>
/// "Their unit" (B-212): the unit the holder works in and every unit under it, with their team, never a unit beside
/// theirs or another company's people.
/// </summary>
public sealed class ViewerReachTests
{
    private static readonly DateTime Start = DateTime.SpecifyKind(DateTime.UtcNow.Date.AddYears(-1), DateTimeKind.Utc);
    private static readonly DateOnly From = DateOnly.FromDateTime(Start);
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);

    /// <summary>Carthage › Product (Mariam) › Product A (Kais); Carthage › Engineering (Lina, who reports to Mariam; Omar).</summary>
    private sealed record World(Guid Product, Guid ProductA, Guid Mariam, Guid Kais, Guid Lina, Guid Omar);

    private static async Task<World> SeedAsync(CoreHRDbContext db, Guid tenantId)
    {
        var company = OrgUnit.Create(tenantId, "CO", "Carthage", "Organization", null);
        var product = OrgUnit.Create(tenantId, "PR", "Product", "Department", null);
        var productA = OrgUnit.Create(tenantId, "PRA", "Product A", "Team", null);
        var engineering = OrgUnit.Create(tenantId, "EN", "Engineering", "Department", null);
        db.AddRange(company, product, productA, engineering);
        db.AddRange(
            OrgUnitEffectiveState.Create(tenantId, company.Id, OrganizationalUnitTypeCatalog.OrganizationId, null, "Carthage", OrgUnitLifecycleState.Active, From),
            OrgUnitEffectiveState.Create(tenantId, product.Id, OrganizationalUnitTypeCatalog.DepartmentId, company.Id, "Product", OrgUnitLifecycleState.Active, From),
            OrgUnitEffectiveState.Create(tenantId, productA.Id, OrganizationalUnitTypeCatalog.TeamId, product.Id, "Product A", OrgUnitLifecycleState.Active, From),
            OrgUnitEffectiveState.Create(tenantId, engineering.Id, OrganizationalUnitTypeCatalog.DepartmentId, company.Id, "Engineering", OrgUnitLifecycleState.Active, From));

        var assignments = new Dictionary<string, (Guid Employee, Guid Assignment)>();
        foreach (var (name, unit) in new[] { ("Mariam", product.Id), ("Kais", productA.Id), ("Lina", engineering.Id), ("Omar", engineering.Id) })
        {
            var person = Employee.Create(tenantId, name, "Test", $"{name}.{tenantId:N}@example.test", Start, employeeNumber: TestEmployeeNumbers.Next());
            var employment = Employment.Start(tenantId, person.Id, Start, null, WorkforceSourceType.Manual);
            var assignment = WorkAssignment.Create(tenantId, employment.Id, person.Id, unit, db.Job(tenantId, "Engineer"), null, true, Start, null, WorkforceSourceType.Manual);
            db.AddRange(person, employment, assignment);
            assignments[name] = (person.Id, assignment.Id);
        }

        db.Add(ManagerRelationship.Create(tenantId, assignments["Lina"].Employee, assignments["Mariam"].Employee,
            assignments["Lina"].Assignment, assignments["Mariam"].Assignment, ReportingRelationshipType.PrimaryManager, Start, WorkforceSourceType.Manual));
        await db.SaveChangesAsync();
        return new(product.Id, productA.Id, assignments["Mariam"].Employee, assignments["Kais"].Employee, assignments["Lina"].Employee, assignments["Omar"].Employee);
    }

    private static async Task<(string Database, Guid TenantA, World A, World B)> TwoCompaniesAsync()
    {
        var database = Guid.NewGuid().ToString();
        var (tenantA, tenantB) = (Guid.NewGuid(), Guid.NewGuid());
        World b;
        await using (var seedB = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantB), database))
            b = await SeedAsync(seedB, tenantB);
        await using var seedA = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantA), database);
        var a = await SeedAsync(seedA, tenantA);
        return (database, tenantA, a, b);
    }

    [Fact]
    public async Task Their_unit_is_their_unit_the_units_under_it_and_their_team_but_not_a_unit_beside_it()
    {
        var (database, tenant, a, _) = await TwoCompaniesAsync();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenant), database);

        var unit = await ViewerReach.PeopleAsync(db, a.Mariam, PermissionScopes.OrgUnit, default);
        var team = await ViewerReach.PeopleAsync(db, a.Mariam, PermissionScopes.DirectReports, default);

        Assert.Equal(new[] { a.Kais, a.Lina }.Order(), unit.Order());
        Assert.Equal([a.Lina], team);
        Assert.DoesNotContain(a.Omar, unit);
        Assert.DoesNotContain(a.Mariam, unit);

        var described = await ViewerReach.DescribeAsync(db, a.Mariam, default);
        Assert.Equal([(a.Product, 0, 1), (a.ProductA, 1, 1)], described.Units.Select(u => (u.OrgUnitId, u.Depth, u.People)));
        Assert.Equal(2, described.People);
    }

    [Fact]
    public async Task Their_unit_never_reaches_another_company()
    {
        var (database, tenant, a, b) = await TwoCompaniesAsync();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenant), database);

        var unit = await ViewerReach.PeopleAsync(db, a.Mariam, PermissionScopes.OrgUnit, default);
        Assert.DoesNotContain(b.Kais, unit);
        Assert.DoesNotContain(b.Lina, unit);

        // Another company's person, asked about from here: not found, and nothing about their unit.
        var policy = new Mock<ICoreAccessPolicyService>();
        policy.Setup(p => p.CanManageAccessProfiles(It.IsAny<ClaimsPrincipal>())).Returns(true);
        var controller = new RoleReachController(db, policy.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity("test")) } },
        };
        Assert.IsType<NotFoundObjectResult>(await controller.Get(b.Mariam, default));
        var own = Assert.IsType<OkObjectResult>(await controller.Get(a.Mariam, default));
        Assert.Equal(2, Assert.IsType<ApiResponse<ViewerUnitReachDto>>(own.Value).Data!.People);

        // Only role editors preview it.
        policy.Setup(p => p.CanManageAccessProfiles(It.IsAny<ClaimsPrincipal>())).Returns(false);
        Assert.IsType<ForbidResult>(await controller.Get(a.Mariam, default));
    }

    [Fact]
    public async Task Personal_details_and_job_history_follow_their_unit()
    {
        var (database, tenant, a, b) = await TwoCompaniesAsync();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenant), database);
        var lead = new PeopleViewer(a.Mariam, ManagesPeople: false, ViewsTenant: false, ManagesTeam: true, UpdatesSelf: true,
            PersonalGrant.Unit, PermissionScopes.OrgUnit);

        var inUnit = await PeopleAccess.DecideAsync(db, lead, a.Kais, default);
        Assert.Equal(PersonalAccess.Contact, inUnit.Access);
        Assert.True(inUnit.CanReadJobHistory);

        var beside = await PeopleAccess.DecideAsync(db, lead, a.Omar, default);
        Assert.Equal(PersonalAccess.Directory, beside.Access);
        Assert.False(beside.CanReadJobHistory);

        var elsewhere = await PeopleAccess.DecideAsync(db, lead, b.Kais, default);
        Assert.Equal(PersonalAccess.Directory, elsewhere.Access);
        Assert.False(elsewhere.CanReadJobHistory);

        // The same person with a team reach reads Kais as a colleague.
        var manager = lead with { Personal = PersonalGrant.Team, JobReach = PermissionScopes.DirectReports };
        Assert.Equal(PersonalAccess.Directory, (await PeopleAccess.DecideAsync(db, manager, a.Kais, default)).Access);
    }

    [Fact]
    public async Task Reports_for_their_unit_count_only_their_unit()
    {
        var (database, tenant, a, b) = await TwoCompaniesAsync();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenant), database);
        var settings = new Mock<ITenantSettingsReadService>();
        settings.Setup(s => s.GetCurrentAsync(It.IsAny<CancellationToken>())).ReturnsAsync(new TenantSettingsDto());
        var engine = new ReportEngine(db, settings.Object);
        var keys = db.Employees.ToDictionary(e => e.Id, e => e.StableEmployeeKey);

        var viewer = new ReportViewer(Guid.NewGuid(), a.Mariam, PermissionScopes.OrgUnit, false, false);
        var run = await engine.RunAsync(new("headcount", "division", "date", Today, Today, "year", [], ["name"]), viewer, default);

        Assert.Equal(new[] { keys[a.Kais], keys[a.Lina] }.Order(), run.People.Select(p => p.EmployeeKey).Order());
        Assert.DoesNotContain(run.People, p => p.EmployeeKey == keys[a.Omar]);
        Assert.DoesNotContain(b.Kais, keys.Keys);
    }
}

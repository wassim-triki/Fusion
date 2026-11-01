using System.Security.Claims;
using EY.HRPlatform.CoreHR.Controllers;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Results;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;

namespace EY.HRPlatform.CoreHR.Tests.Features.People;

/// <summary>B-185: the Team page reads the caller's own team only: today's reports, joiners, what's coming, open roles.</summary>
public sealed class MyTeamTests
{
    private static readonly Guid TenantA = Guid.NewGuid();
    private static readonly Guid TenantB = Guid.NewGuid();
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private static DateTime At(DateOnly day) => day.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);

    private sealed record World(string Db, Guid Amira, Guid Mariam, Guid Aicha, Guid Yasmine, Guid Adel, Guid Zed, Guid Far);

    /// <summary>
    /// Amira manages Mariam. Mariam manages Aicha (4 years on day 5), Adel (leaving: last day is day 9), and Yasmine
    /// joins her on day 3; Far joins her in 60 days (outside the window). Tenant B's Zed reports to Mariam's id there.
    /// </summary>
    private static async Task<World> SeedAsync()
    {
        var db = Guid.NewGuid().ToString();
        await using var seed = TestDbContextFactory.CreateWithoutTenant(db);
        Employee Person(Guid tenant, string first, DateOnly start, DateOnly? end = null)
        {
            var employee = Employee.Create(tenant, first, "Test", $"{first}.{Guid.NewGuid():N}@example.com", employeeNumber: $"E-{Guid.NewGuid():N}");
            seed.Employees.Add(employee);
            var employment = Employment.Start(tenant, employee.Id, At(start), null, WorkforceSourceType.Manual);
            if (end is { } e) employment.End(At(e));
            seed.Employments.Add(employment);
            var unit = OrgUnit.Create(tenant, $"U-{Guid.NewGuid():N}"[..10], "Unit", "Department", null);
            seed.OrgUnits.Add(unit);
            seed.WorkAssignments.Add(WorkAssignment.Create(tenant, employment.Id, employee.Id, unit.Id, seed.Job(tenant, $"{first} job"),
                seed.Place(tenant, "Ariana"), true, At(start), end is { } to ? At(to) : null, WorkforceSourceType.Manual));
            return employee;
        }
        void Reports(Guid tenant, Employee who, Employee to, DateOnly from, DateOnly? until = null)
        {
            var line = ManagerRelationship.Create(tenant, who.Id, to.Id, Guid.NewGuid(), Guid.NewGuid(),
                ReportingRelationshipType.PrimaryManager, At(from), WorkforceSourceType.Manual);
            if (until is { } end) line.End(At(end));
            seed.ManagerRelationships.Add(line);
        }

        var amira = Person(TenantA, "Amira", Today.AddYears(-6));
        var mariam = Person(TenantA, "Mariam", Today.AddYears(-5));
        var aicha = Person(TenantA, "Aicha", Today.AddDays(5).AddYears(-4));
        var adel = Person(TenantA, "Adel", Today.AddYears(-2).AddDays(-40), Today.AddDays(10));
        var yasmine = Person(TenantA, "Yasmine", Today.AddDays(3));
        var far = Person(TenantA, "Far", Today.AddDays(60));
        var zed = Person(TenantB, "Zed", Today.AddYears(-1));
        Reports(TenantA, mariam, amira, Today.AddYears(-5));
        Reports(TenantA, aicha, mariam, Today.AddYears(-4));
        Reports(TenantA, adel, mariam, Today.AddYears(-2), Today.AddDays(10));
        Reports(TenantA, yasmine, mariam, Today.AddDays(3));
        Reports(TenantA, far, mariam, Today.AddDays(60));
        // The same manager id presented in tenant B: Zed must never appear on tenant A's page.
        seed.ManagerRelationships.Add(ManagerRelationship.Create(TenantB, zed.Id, mariam.Id, Guid.NewGuid(), Guid.NewGuid(),
            ReportingRelationshipType.PrimaryManager, At(Today.AddYears(-1)), WorkforceSourceType.Manual));
        await seed.SaveChangesAsync();
        return new World(db, amira.Id, mariam.Id, aicha.Id, yasmine.Id, adel.Id, zed.Id, far.Id);
    }

    private static Task<Result<MyTeamDto>> ReadAsync(World world, Guid tenant, Guid employeeId)
        => new MyTeamQueryHandler(TestDbContextFactory.Create(TestTenantContext.WithTenant(tenant), world.Db))
            .Handle(new MyTeamQuery(employeeId, Today), default);

    [Fact]
    public async Task A_manager_sees_todays_reports_and_who_joins_in_the_next_30_days()
    {
        var world = await SeedAsync();
        var team = (await ReadAsync(world, TenantA, world.Mariam)).Value;

        Assert.Equal(world.Mariam, team.Manager.EmployeeId);
        Assert.Equal(world.Amira, team.ReportsTo!.EmployeeId);
        Assert.Equal(["Adel Test", "Aicha Test", "Yasmine Test"], team.Members.Select(item => item.DisplayName));
        Assert.Equal(Today.AddDays(3), team.Members.Single(item => item.EmployeeId == world.Yasmine).JoinsOn);
        Assert.DoesNotContain(team.Members, item => item.EmployeeId == world.Far || item.EmployeeId == world.Zed);
    }

    [Fact]
    public async Task Whats_next_for_each_person_comes_from_their_dates()
    {
        var world = await SeedAsync();
        var team = (await ReadAsync(world, TenantA, world.Mariam)).Value;
        string Key(Guid id) => team.Members.Single(item => item.EmployeeId == id).EmployeeKey;

        Assert.Contains(new TeamEventDto(TeamEventKind.Joins, Today.AddDays(3), Key(world.Yasmine)), team.ComingUp);
        Assert.Contains(new TeamEventDto(TeamEventKind.Anniversary, Today.AddDays(5), Key(world.Aicha), 4), team.ComingUp);
        Assert.Contains(new TeamEventDto(TeamEventKind.Leaves, Today.AddDays(9), Key(world.Adel)), team.ComingUp);
        Assert.Equal(team.ComingUp.OrderBy(item => item.Date), team.ComingUp);
    }

    [Fact]
    public async Task A_report_reads_their_own_team_never_their_managers()
    {
        var world = await SeedAsync();
        var team = (await ReadAsync(world, TenantA, world.Aicha)).Value;
        Assert.Equal(world.Aicha, team.Manager.EmployeeId);
        Assert.Empty(team.Members);
        Assert.Empty(team.ComingUp);
    }

    [Fact]
    public async Task Another_tenants_employee_id_is_not_found_and_shows_no_one()
    {
        var world = await SeedAsync();
        Assert.True((await ReadAsync(world, TenantB, world.Mariam)).IsFailure);
        Assert.True((await ReadAsync(world, TenantA, world.Zed)).IsFailure);
    }

    // ── Controller: the caller's own team, with the team view ─────────────────

    private static MeController Controller(bool canViewTeam, Guid? employeeId, Mock<ISender> sender)
    {
        var claims = new List<Claim> { new(CustomClaimTypes.TenantId, TenantA.ToString()) };
        if (employeeId is { } id) claims.Add(new(CustomClaimTypes.EmployeeId, id.ToString()));
        var policy = new Mock<ICoreAccessPolicyService>();
        policy.Setup(p => p.CanViewTeam(It.IsAny<ClaimsPrincipal>())).Returns(canViewTeam);
        return new MeController(sender.Object, policy.Object)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "Test")) },
            },
        };
    }

    [Fact]
    public async Task The_team_is_read_for_the_caller_in_the_token()
    {
        var mariam = Guid.NewGuid();
        var sender = new Mock<ISender>();
        sender.Setup(s => s.Send(It.IsAny<MyTeamQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new MyTeamDto(new TeamPersonDto(mariam, "k", "Mariam", null, null, null, null, null), null, [], [], [])));

        Assert.IsType<OkObjectResult>(await Controller(true, mariam, sender).GetTeam(default));
        sender.Verify(s => s.Send(It.Is<MyTeamQuery>(q => q.EmployeeId == mariam), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Without_the_team_view_or_an_employee_record_nothing_is_read()
    {
        var sender = new Mock<ISender>(MockBehavior.Strict);
        Assert.IsType<ForbidResult>(await Controller(false, Guid.NewGuid(), sender).GetTeam(default));
        Assert.IsType<NotFoundObjectResult>(await Controller(true, null, sender).GetTeam(default));
    }
}

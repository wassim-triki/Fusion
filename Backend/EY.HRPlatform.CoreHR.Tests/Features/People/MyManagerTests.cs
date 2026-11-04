using System.Security.Claims;
using EY.HRPlatform.CoreHR.Controllers;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Results;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;

namespace EY.HRPlatform.CoreHR.Tests.Features.People;

public class MyManagerTests
{
    private static readonly DateTime Today = new(2026, 11, 3, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Canonical_primary_line_and_job_are_effective_dated_and_tenant_scoped()
    {
        var tenantA = Guid.NewGuid(); var tenantB = Guid.NewGuid(); var database = Guid.NewGuid().ToString();
        await using var seed = TestDbContextFactory.CreateWithoutTenant(database);
        Employee Person(Guid tenant, string name)
        {
            var person = Employee.Create(tenant, name, "Test", $"{Guid.NewGuid()}@example.test", employeeNumber: Guid.NewGuid().ToString());
            seed.Employees.Add(person);
            return person;
        }
        var subject = Person(tenantA, "Joiner"); var manager = Person(tenantA, "Manager"); var foreign = Person(tenantB, "Foreign");
        var unit = OrgUnit.Create(tenantA, "UNIT", "Unit", "Department", null); seed.OrgUnits.Add(unit);
        seed.OrgUnitEffectiveStates.Add(OrgUnitEffectiveState.Create(tenantA, unit.Id, OrganizationalUnitTypeCatalog.DepartmentId, null, "Unit",
            OrgUnitLifecycleState.Active, DateOnly.FromDateTime(Today.AddYears(-3))));
        var employment = Employment.Start(tenantA, subject.Id, Today.AddDays(-1), null, WorkforceSourceType.Manual); seed.Employments.Add(employment);
        var managerEmployment = Employment.Start(tenantA, manager.Id, Today.AddYears(-2), null, WorkforceSourceType.Manual); seed.Employments.Add(managerEmployment);
        var work = WorkAssignment.Create(tenantA, managerEmployment.Id, manager.Id, unit.Id, seed.Job(tenantA, "Current title"), seed.Place(tenantA, null), true, Today.AddYears(-2), Today.AddDays(2), WorkforceSourceType.Manual);
        seed.WorkAssignments.Add(work);
        seed.WorkAssignments.Add(WorkAssignment.Create(tenantA, managerEmployment.Id, manager.Id, unit.Id, seed.Job(tenantA, "Future title"), seed.Place(tenantA, null), true, Today.AddDays(2), null, WorkforceSourceType.Manual));
        seed.ManagerRelationships.Add(ManagerRelationship.Create(tenantA, subject.Id, manager.Id, Guid.NewGuid(), work.Id, ReportingRelationshipType.PrimaryManager, Today, WorkforceSourceType.Manual, Today.AddDays(4)));
        // A foreign manager id in a malformed same-tenant relationship must still disclose nothing.
        seed.ManagerRelationships.Add(ManagerRelationship.Create(tenantA, subject.Id, foreign.Id, Guid.NewGuid(), Guid.NewGuid(), ReportingRelationshipType.PrimaryManager, Today.AddDays(4), WorkforceSourceType.Manual));
        await seed.SaveChangesAsync();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantA), database);
        var handler = new MyManagerQueryHandler(db, new WorkforceCanonicalResolver(db));
        var current = (await handler.Handle(new(subject.Id, Today), default)).Value;
        Assert.Equal(("Manager Test", "Current title", manager.StableEmployeeKey, "Unit"),
            (current.Manager!.DisplayName, current.Manager.JobTitle, current.Manager.EmployeeKey, current.Manager.Unit));
        Assert.True(current.IsFirstWeek);
        Assert.Null((await handler.Handle(new(subject.Id, Today.AddDays(-1)), default)).Value.Manager);
        Assert.Equal("Future title", (await handler.Handle(new(subject.Id, Today.AddDays(2)), default)).Value.Manager!.JobTitle);
        Assert.Null((await handler.Handle(new(subject.Id, Today.AddDays(4)), default)).Value.Manager);
        Assert.False((await handler.Handle(new(subject.Id, Today.AddDays(6)), default)).Value.IsFirstWeek);
        Assert.True((await handler.Handle(new(foreign.Id, Today), default)).IsFailure);
        await using var other = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantB), database);
        Assert.True((await new MyManagerQueryHandler(other, new WorkforceCanonicalResolver(other)).Handle(new(subject.Id, Today), default)).IsFailure);
        await using var unresolved = TestDbContextFactory.Create(TestTenantContext.Unresolved(), database);
        Assert.True((await new MyManagerQueryHandler(unresolved, new WorkforceCanonicalResolver(unresolved)).Handle(new(subject.Id, Today), default)).IsFailure);
    }

    [Fact]
    public async Task First_week_lists_only_todays_employed_teammates_of_the_same_manager_in_the_tenant()
    {
        var tenantA = Guid.NewGuid(); var tenantB = Guid.NewGuid(); var database = Guid.NewGuid().ToString();
        await using var seed = TestDbContextFactory.CreateWithoutTenant(database);
        var unit = OrgUnit.Create(tenantA, "UNIT", "Unit", "Department", null); seed.OrgUnits.Add(unit);
        Employee Person(Guid tenant, string name, DateTime start, DateTime? end = null)
        {
            var person = Employee.Create(tenant, name, "Test", $"{Guid.NewGuid()}@example.test", employeeNumber: Guid.NewGuid().ToString());
            seed.Employees.Add(person);
            var employment = Employment.Start(tenant, person.Id, start, null, WorkforceSourceType.Manual);
            if (end is { } last) employment.End(last);
            seed.Employments.Add(employment);
            seed.WorkAssignments.Add(WorkAssignment.Create(tenant, employment.Id, person.Id, unit.Id, seed.Job(tenant, name + " job"), seed.Place(tenant, null), true, start, null, WorkforceSourceType.Manual));
            return person;
        }
        void Line(Guid tenant, Employee subject, Employee boss, DateTime from, DateTime? to = null) =>
            seed.ManagerRelationships.Add(ManagerRelationship.Create(tenant, subject.Id, boss.Id, Guid.NewGuid(), Guid.NewGuid(), ReportingRelationshipType.PrimaryManager, from, WorkforceSourceType.Manual, to));
        var boss = Person(tenantA, "Boss", Today.AddYears(-3));
        var joiner = Person(tenantA, "Joiner", Today.AddDays(-2));
        var peers = new[] { "Ada", "Bo", "Cy", "Di" }.Select(n => Person(tenantA, n, Today.AddYears(-1))).ToList();
        var moved = Person(tenantA, "Moved", Today.AddYears(-1));
        var left = Person(tenantA, "Left", Today.AddYears(-1), Today.AddDays(-1));
        var foreign = Person(tenantB, "Foreign", Today.AddYears(-1));
        Line(tenantA, joiner, boss, Today.AddDays(-2));
        foreach (var peer in peers) Line(tenantA, peer, boss, Today.AddYears(-1));
        Line(tenantA, moved, boss, Today.AddYears(-1), Today.AddDays(-1));
        Line(tenantA, left, boss, Today.AddYears(-1));
        Line(tenantB, foreign, boss, Today.AddYears(-1));
        await seed.SaveChangesAsync();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantA), database);
        var handler = new MyManagerQueryHandler(db, new WorkforceCanonicalResolver(db));

        var week = (await handler.Handle(new(joiner.Id, Today), default)).Value;
        Assert.Equal(4, week.TeammateCount);
        Assert.Equal(["Ada Test", "Bo Test", "Cy Test"], week.Teammates.Select(p => p.DisplayName));
        Assert.Equal("Ada job", week.Teammates[0].JobTitle);
        var later = (await handler.Handle(new(joiner.Id, Today.AddDays(6)), default)).Value;
        Assert.False(later.IsFirstWeek);
        Assert.Empty(later.Teammates);
        Assert.Equal(0, later.TeammateCount);
        Assert.NotNull(later.Manager);
    }

    [Theory]
    [InlineData(true, true)] [InlineData(true, false)] [InlineData(false, true)]
    public async Task Only_the_token_employee_is_read_without_any_management_permission(bool tenant, bool employee)
    {
        var id = Guid.NewGuid(); var claims = new List<Claim>();
        if (tenant) claims.Add(new(CustomClaimTypes.TenantId, Guid.NewGuid().ToString()));
        if (employee) claims.Add(new(CustomClaimTypes.EmployeeId, id.ToString()));
        var sender = new Mock<ISender>(MockBehavior.Strict);
        sender.Setup(s => s.Send(It.Is<MyManagerQuery>(q => q.EmployeeId == id), It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success(new MyManagerDto(null, true, [], 0)));
        var controller = new MeController(sender.Object, Mock.Of<ICoreAccessPolicyService>(MockBehavior.Strict)) { ControllerContext = new() { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) } } };
        var result = await controller.GetManager(default);
        if (tenant && employee) Assert.IsType<ApiResponse<MyManagerDto>>(Assert.IsType<OkObjectResult>(result).Value);
        else { Assert.IsType<NotFoundObjectResult>(result); sender.VerifyNoOtherCalls(); }
    }
}

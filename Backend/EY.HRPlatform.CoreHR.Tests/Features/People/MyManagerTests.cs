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
        Assert.Equal(new MyManagerCardDto("Manager Test", "Current title"), current.Manager); Assert.True(current.IsFirstWeek);
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

    [Theory]
    [InlineData(true, true)] [InlineData(true, false)] [InlineData(false, true)]
    public async Task Only_the_token_employee_is_read_without_any_management_permission(bool tenant, bool employee)
    {
        var id = Guid.NewGuid(); var claims = new List<Claim>();
        if (tenant) claims.Add(new(CustomClaimTypes.TenantId, Guid.NewGuid().ToString()));
        if (employee) claims.Add(new(CustomClaimTypes.EmployeeId, id.ToString()));
        var sender = new Mock<ISender>(MockBehavior.Strict);
        sender.Setup(s => s.Send(It.Is<MyManagerQuery>(q => q.EmployeeId == id), It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success(new MyManagerDto(null, true)));
        var controller = new MeController(sender.Object, Mock.Of<ICoreAccessPolicyService>(MockBehavior.Strict)) { ControllerContext = new() { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) } } };
        var result = await controller.GetManager(default);
        if (tenant && employee) Assert.IsType<ApiResponse<MyManagerDto>>(Assert.IsType<OkObjectResult>(result).Value);
        else { Assert.IsType<NotFoundObjectResult>(result); sender.VerifyNoOtherCalls(); }
    }
}

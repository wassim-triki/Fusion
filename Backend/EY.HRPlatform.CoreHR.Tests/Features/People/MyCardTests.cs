using EY.HRPlatform.CoreHR.Tests.TestSupport;
using System.Security.Claims;
using EY.HRPlatform.CoreHR.Controllers;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Results;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;

namespace EY.HRPlatform.CoreHR.Tests.Features.People;

/// <summary>workforce-contracts: Core serves the signed-in person's own card (name, job, unit), self-only and tenant-scoped.</summary>
public sealed class MyCardTests
{
    private static readonly Guid TenantA = Guid.NewGuid();
    private static readonly Guid TenantB = Guid.NewGuid();
    private static readonly DateTime Today = DateTime.UtcNow;

    private sealed record World(string Db, Guid Mariam, Guid MariamInB, Guid Unassigned);

    /// <summary>
    /// Mariam works in tenant A as "VP, Product" in Product A; the same person also has a record in tenant B
    /// with another job. A third person in A has no current assignment.
    /// </summary>
    private static async Task<World> SeedAsync()
    {
        var db = Guid.NewGuid().ToString();
        await using var seed = TestDbContextFactory.CreateWithoutTenant(db);
        Guid Person(Guid tenant, string first, string last, string? title, string unitName)
        {
            var employee = Employee.Create(tenant, first, last, $"{first}.{tenant:N}@example.com", employeeNumber: $"E-{Guid.NewGuid():N}");
            seed.Employees.Add(employee);
            if (title is null) return employee.Id;
            var unit = OrgUnit.Create(tenant, $"U-{Guid.NewGuid():N}"[..10], unitName, "Department", null);
            var employment = Employment.Start(tenant, employee.Id, Today.AddYears(-2), null, WorkforceSourceType.Manual);
            seed.OrgUnits.Add(unit);
            seed.Employments.Add(employment);
            seed.WorkAssignments.Add(WorkAssignment.Create(tenant, employment.Id, employee.Id, unit.Id, seed.Job(tenant, title), seed.Place(tenant, null), true,
                Today.AddYears(-2), null, WorkforceSourceType.Manual));
            return employee.Id;
        }
        var mariam = Person(TenantA, "Mariam", "Gharbi", "VP, Product", "Product A");
        var mariamInB = Person(TenantB, "Mariam", "Gharbi", "Advisor", "Board");
        var unassigned = Person(TenantA, "Nadia", "Trabelsi", null, "");
        await seed.SaveChangesAsync();
        return new World(db, mariam, mariamInB, unassigned);
    }

    private static Task<Result<MyCardDto>> ReadAsync(World world, Guid tenant, Guid employeeId)
    {
        var context = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenant), world.Db);
        return new MyCardQueryHandler(context, new WorkforceCanonicalResolver(context))
            .Handle(new MyCardQuery(employeeId, Today), default);
    }

    [Fact]
    public async Task An_employee_reads_their_name_job_and_unit_as_of_today()
    {
        var world = await SeedAsync();
        var card = await ReadAsync(world, TenantA, world.Mariam);
        Assert.True(card.IsSuccess);
        Assert.Equal(new MyCardDto("Mariam Gharbi", "VP, Product", "Product A"), card.Value);
    }

    [Fact]
    public async Task Someone_with_records_in_two_tenants_sees_only_the_current_tenants_job()
    {
        var world = await SeedAsync();
        Assert.Equal("VP, Product", (await ReadAsync(world, TenantA, world.Mariam)).Value.JobTitle);
        Assert.Equal("Advisor", (await ReadAsync(world, TenantB, world.MariamInB)).Value.JobTitle);
        // Tenant B's employee id presented in tenant A resolves to nothing.
        Assert.True((await ReadAsync(world, TenantA, world.MariamInB)).IsFailure);
    }

    [Fact]
    public async Task Without_a_current_assignment_the_card_has_no_job_or_unit()
    {
        var world = await SeedAsync();
        Assert.Equal(new MyCardDto("Nadia Trabelsi", null, null), (await ReadAsync(world, TenantA, world.Unassigned)).Value);
    }

    [Fact]
    public async Task An_unknown_employee_is_not_found()
        => Assert.True((await ReadAsync(await SeedAsync(), TenantA, Guid.NewGuid())).IsFailure);

    // ── Controller: self only ───────────────────────────────────────────────

    private static ClaimsPrincipal Caller(Guid? tenantId, Guid? employeeId)
    {
        var claims = new List<Claim>();
        if (tenantId is { } tenant) claims.Add(new(CustomClaimTypes.TenantId, tenant.ToString()));
        if (employeeId is { } employee) claims.Add(new(CustomClaimTypes.EmployeeId, employee.ToString()));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "Test"));
    }

    private static MeController Controller(ClaimsPrincipal caller, Mock<ISender> sender) => new(sender.Object)
    {
        ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = caller } },
    };

    [Fact]
    public async Task The_card_is_read_for_the_employee_in_the_callers_token()
    {
        var mariam = Guid.NewGuid();
        var sender = new Mock<ISender>();
        sender.Setup(s => s.Send(It.IsAny<MyCardQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new MyCardDto("Mariam Gharbi", "VP, Product", "Product A")));

        var result = await Controller(Caller(TenantA, mariam), sender).GetCard(default);

        var body = Assert.IsType<ApiResponse<MyCardDto>>(Assert.IsType<OkObjectResult>(result).Value);
        Assert.Equal("VP, Product", body.Data!.JobTitle);
        sender.Verify(s => s.Send(It.Is<MyCardQuery>(q => q.EmployeeId == mariam), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task An_account_without_an_employee_record_gets_404_without_a_lookup()
    {
        var sender = new Mock<ISender>(MockBehavior.Strict);
        Assert.IsType<NotFoundObjectResult>(await Controller(Caller(TenantA, null), sender).GetCard(default));
        Assert.IsType<NotFoundObjectResult>(await Controller(Caller(null, Guid.NewGuid()), sender).GetCard(default));
    }

    [Fact]
    public async Task An_employee_id_missing_from_the_tenant_is_404()
    {
        var sender = new Mock<ISender>();
        sender.Setup(s => s.Send(It.IsAny<MyCardQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<MyCardDto>(new Error("Employee.NotFound", "Employee was not found.")));
        Assert.IsType<NotFoundObjectResult>(await Controller(Caller(TenantA, Guid.NewGuid()), sender).GetCard(default));
    }

    [Fact]
    public void The_card_requires_a_signed_in_session_and_takes_no_person_id()
    {
        Assert.NotNull(typeof(MeController).GetCustomAttributes(typeof(AuthorizeAttribute), true).SingleOrDefault());
        Assert.Empty(typeof(MeController).GetMethod(nameof(MeController.GetCard))!.GetParameters()
            .Where(p => p.ParameterType != typeof(CancellationToken)));
    }
}

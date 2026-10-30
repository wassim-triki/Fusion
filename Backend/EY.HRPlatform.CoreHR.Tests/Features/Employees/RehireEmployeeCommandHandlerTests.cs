using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Employees.Commands.RehireEmployee;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Tests.Features.Employees;

public class RehireEmployeeCommandHandlerTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly DateTime Hire = new(2022, 1, 10, 0, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Termination = new(2023, 6, 1, 0, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Rehire = new(2024, 3, 1, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Handle_RehiresTerminatedEmployee_CreatesNewEmploymentAndAssignment()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seed = TestDbContextFactory.CreateWithoutTenant(dbName);
        var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        var employee = Employee.Create(TenantId, "John", "Doe", "john@example.com", Hire, employeeNumber: TestEmployeeNumbers.Next());
        var endedEmployment = Employment.Start(TenantId, employee.Id, Hire, null, WorkforceSourceType.Manual);
        endedEmployment.End(Termination);
        seed.AddRange(orgUnit, employee, endedEmployment);
        await seed.SaveChangesAsync();

        var version = employee.Version;

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = CreateHandler(context, tenantContext);

        var result = await handler.Handle(
            new RehireEmployeeCommand(employee.Id, version, Rehire, orgUnit.Id, context.JobId(TenantId, "Senior Engineer")),
            CancellationToken.None);

        Assert.True(result.IsSuccess);

        var employments = await context.Employments
            .Where(e => e.EmployeeId == employee.Id)
            .ToListAsync();
        Assert.Equal(2, employments.Count);
        Assert.Single(employments, e => e.Status == EmploymentStatus.Active && e.EffectiveFrom == Rehire);
        Assert.Single(employments, e => e.Id == endedEmployment.Id && e.Status == EmploymentStatus.Ended);

        var assignment = await context.WorkAssignments
            .SingleAsync(w => w.EmployeeId == employee.Id && w.IsPrimary && w.EffectiveTo == null);
        Assert.Equal(orgUnit.Id, assignment.OrgUnitId);
        Assert.Equal("Senior Engineer", assignment.JobTitle);
    }

    [Fact]
    public async Task Handle_WhenActiveEmploymentExists_FailsWithoutReopening()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seed = TestDbContextFactory.CreateWithoutTenant(dbName);
        var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        var employee = Employee.Create(TenantId, "John", "Doe", "john@example.com", Hire, employeeNumber: TestEmployeeNumbers.Next());
        var activeEmployment = Employment.Start(TenantId, employee.Id, Hire, null, WorkforceSourceType.Manual);
        seed.AddRange(orgUnit, employee, activeEmployment);
        await seed.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = CreateHandler(context, tenantContext);

        var result = await handler.Handle(
            new RehireEmployeeCommand(employee.Id, employee.Version, Rehire, orgUnit.Id, context.JobId(TenantId, "Engineer")),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Employment.AlreadyActive", result.Error.Code);

        var employmentCount = await context.Employments.CountAsync(e => e.EmployeeId == employee.Id);
        Assert.Equal(1, employmentCount);
    }

    private static RehireEmployeeCommandHandler CreateHandler(
        CoreHRDbContext context,
        ITenantContext tenantContext)
        => new(
            context,
            tenantContext,
            new WorkforceMutationService(context, tenantContext, new WorkforceCanonicalResolver(context)),
            new EmployeeDetailsReadModelService(
                context,
                new WorkforceCanonicalResolver(context),
                new TenantSettingsReadService(context)));
}

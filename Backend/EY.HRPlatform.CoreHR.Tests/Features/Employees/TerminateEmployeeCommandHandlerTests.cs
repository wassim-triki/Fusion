using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Exceptions;
using EY.HRPlatform.CoreHR.Features.Employees.Commands.TerminateEmployee;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Tests.Features.Employees;

public class TerminateEmployeeCommandHandlerTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly DateTime Hire = new(2024, 1, 15, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Handle_WithValidRequest_TerminatesCanonicalEmploymentChain()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        var employee = Employee.Create(TenantId, "John", "Doe", "john@example.com", Hire, employeeNumber: TestEmployeeNumbers.Next());
        var employment = Employment.Start(TenantId, employee.Id, Hire, null, WorkforceSourceType.Manual);
        var assignment = WorkAssignment.Create(
            TenantId,
            employment.Id,
            employee.Id,
            orgUnit.Id,
            TestCatalog.Job(TenantId, "Engineer"),
            TestCatalog.Place(TenantId, "HQ"),
            true,
            Hire,
            null,
            WorkforceSourceType.Manual);
        seedContext.AddRange(orgUnit, employee, employment, assignment);
        await seedContext.SaveChangesAsync();

        var version = employee.Version;
        var terminationDate = Hire.AddMonths(6);

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new TerminateEmployeeCommandHandler(
            context,
            new WorkforceMutationService(context, tenantContext, new WorkforceCanonicalResolver(context)));

        var result = await handler.Handle(
            new TerminateEmployeeCommand(employee.Id, version, terminationDate, "Resigned"),
            CancellationToken.None);

        Assert.True(result.IsSuccess);

        var storedEmployment = await context.Employments.SingleAsync(e => e.Id == employment.Id);
        var storedAssignment = await context.WorkAssignments.SingleAsync(w => w.Id == assignment.Id);

        Assert.Equal(EmploymentStatus.Ended, storedEmployment.Status);
        Assert.Equal(terminationDate, storedEmployment.EffectiveTo);
        Assert.Equal(terminationDate, storedAssignment.EffectiveTo);
    }

    [Fact]
    public async Task Handle_WithStaleVersion_ThrowsConcurrencyException()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var employee = Employee.Create(TenantId, "John", "Doe", "john@example.com", Hire, employeeNumber: TestEmployeeNumbers.Next());
        seedContext.Employees.Add(employee);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new TerminateEmployeeCommandHandler(
            context,
            new WorkforceMutationService(context, tenantContext, new WorkforceCanonicalResolver(context)));

        await Assert.ThrowsAsync<ConcurrencyException>(() => handler.Handle(
            new TerminateEmployeeCommand(employee.Id, 999, Hire.AddMonths(1), null),
            CancellationToken.None));
    }
}

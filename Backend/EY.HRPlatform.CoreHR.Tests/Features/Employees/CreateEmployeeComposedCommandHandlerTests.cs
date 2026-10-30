using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Exceptions;
using EY.HRPlatform.CoreHR.Features.Employees.Commands.CreateEmployee;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Tests.Features.Employees;

public class CreateEmployeeComposedCommandHandlerTests
{
    private static readonly Guid TenantId = Guid.NewGuid();

    [Fact]
    public async Task CreateEmployee_WithOrgUnitJobTitleAndManager_CreatesCanonicalWorkforceFacts()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        var hireDate = DateTime.UtcNow.AddDays(-14);

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
            var manager = Employee.Create(TenantId, "Maya", "Lead", "maya.lead@example.com", DateTime.UtcNow.AddYears(-3), employeeNumber: TestEmployeeNumbers.Next());
            var managerEmployment = Employment.Start(TenantId, manager.Id, DateTime.UtcNow.AddYears(-3), null, WorkforceSourceType.Manual);
            var managerAssignment = WorkAssignment.Create(
                TenantId,
                managerEmployment.Id,
                manager.Id,
                orgUnit.Id,
                TestCatalog.Job(TenantId, "Engineering Manager"),
                TestCatalog.Place(TenantId, "HQ"),
                isPrimary: true,
                effectiveFrom: managerEmployment.EffectiveFrom,
                effectiveTo: null,
                WorkforceSourceType.Manual);

            seedContext.OrgUnits.Add(orgUnit);
            seedContext.Employees.Add(manager);
            seedContext.Employments.Add(managerEmployment);
            seedContext.WorkAssignments.Add(managerAssignment);
            await seedContext.SaveChangesAsync();
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var orgUnitId = await context.OrgUnits.Select(x => x.Id).SingleAsync();
        var managerId = await context.Employees.Where(x => x.Email == "maya.lead@example.com").Select(x => x.Id).SingleAsync();
        var handler = new CreateEmployeeCommandHandler(context, tenantContext);

        var command = new CreateEmployeeCommand(
            "John",
            "Doe",
            "john.doe@example.com",
            hireDate,
            JobId: context.JobId(TenantId, "Software Engineer"),
            ManagerId: managerId,
            OrgUnitId: orgUnitId,
            EmployeeNumber: "EMP-001",
            Phone: "+21600112233",
            PlaceId: context.PlaceId(TenantId, "Tunis"),
            EmploymentTypeId: context.EmploymentType(TenantId, "Full-time").Id);

        var result = await handler.Handle(command, CancellationToken.None);

        Assert.True(result.IsSuccess);

        var employeeId = result.Value.Id;
        var employment = await context.Employments.SingleOrDefaultAsync(x => x.EmployeeId == employeeId);
        var assignment = await context.WorkAssignments.SingleOrDefaultAsync(x => x.EmployeeId == employeeId);
        var relationship = await context.ManagerRelationships.SingleOrDefaultAsync(x => x.SubjectEmployeeId == employeeId);

        Assert.NotNull(employment);
        Assert.Equal(hireDate, employment!.EffectiveFrom);
        Assert.Equal("Full-time", employment.EmploymentType);

        Assert.NotNull(assignment);
        Assert.Equal(orgUnitId, assignment!.OrgUnitId);
        Assert.Equal("Software Engineer", assignment.JobTitle);
        Assert.Equal("Tunis", assignment.WorkLocation);
        Assert.True(assignment.IsPrimary);

        Assert.NotNull(relationship);
        Assert.Equal(managerId, relationship!.ManagerEmployeeId);
        Assert.Equal(assignment.Id, relationship.SubjectWorkAssignmentId);
    }

    [Fact]
    public async Task CreateEmployee_WithoutOrgUnit_ThrowsArgumentException()
    {
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        await using var context = TestDbContextFactory.Create(tenantContext);
        var handler = new CreateEmployeeCommandHandler(context, tenantContext);

        var command = new CreateEmployeeCommand(
            "John",
            "Doe",
            "john.doe@example.com",
            DateTime.UtcNow,
            JobId: context.JobId(TenantId, "Software Engineer"));

        var result = await handler.Handle(command, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("WorkAssignment.OrgUnitRequired", result.Error.Code);
    }

    [Fact]
    public async Task CreateEmployee_WithoutJobTitle_ThrowsArgumentException()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedContext.OrgUnits.Add(OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null));
            await seedContext.SaveChangesAsync();
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var orgUnitId = await context.OrgUnits.Select(x => x.Id).SingleAsync();
        var handler = new CreateEmployeeCommandHandler(context, tenantContext);

        var command = new CreateEmployeeCommand(
            "John",
            "Doe",
            "john.doe@example.com",
            DateTime.UtcNow,
            OrgUnitId: orgUnitId);

        var exception = await Assert.ThrowsAsync<ArgumentException>(() => handler.Handle(command, CancellationToken.None));

        Assert.Contains("job title", exception.Message, StringComparison.OrdinalIgnoreCase);
    }
}

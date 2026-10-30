using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Employees.Commands.UpdateEmployee;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Tests.Features.Employees;

public class UpdateEmployeeComposedCommandHandlerTests
{
    private static readonly Guid TenantId = Guid.NewGuid();

    [Fact]
    public async Task UpdateEmployee_WithProfileEmploymentAndAssignmentChanges_UpdatesCanonicalFacts()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        Guid employeeId;
        Guid sourceOrgUnitId;
        Guid targetOrgUnitId;
        uint version;
        var hireDate = DateTime.UtcNow.AddYears(-2);

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            var sourceOrgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
            var targetOrgUnit = OrgUnit.Create(TenantId, "OPS", "Operations", "Department", null);
            var seededEmployee = Employee.Create(TenantId, "John", "Doe", "john@example.com", hireDate, jobTitle: "Developer", employeeNumber: "EMP-001", phone: "111", workLocation: "Tunis", employmentType: "FullTime");
            seededEmployee.UpdatePreferredName("Johnny");
            var seededEmployment = Employment.Start(TenantId, seededEmployee.Id, hireDate, null, WorkforceSourceType.Manual);
            var seededAssignment = WorkAssignment.Create(
                TenantId,
                seededEmployment.Id,
                seededEmployee.Id,
                sourceOrgUnit.Id,
                TestCatalog.Job(TenantId, "Developer"),
                TestCatalog.Place(TenantId, "Tunis"),
                true,
                seededEmployment.EffectiveFrom,
                null,
                WorkforceSourceType.Manual);

            seedContext.OrgUnits.AddRange(sourceOrgUnit, targetOrgUnit);
            seedContext.Employees.Add(seededEmployee);
            seedContext.Employments.Add(seededEmployment);
            seedContext.WorkAssignments.Add(seededAssignment);
            await seedContext.SaveChangesAsync();

            employeeId = seededEmployee.Id;
            sourceOrgUnitId = sourceOrgUnit.Id;
            targetOrgUnitId = targetOrgUnit.Id;
            version = seededEmployee.Version;
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new UpdateEmployeeCommandHandler(context, tenantContext);
        var command = new UpdateEmployeeCommand(
            employeeId,
            version,
            "Jane",
            "Smith",
            "Janie",
            "jane@example.com",
            context.JobId(TenantId, "Operations Lead"),
            null,
            targetOrgUnitId,
            null,
            "EMP-002",
            "+21699887766",
            context.PlaceId(TenantId, "Sfax"),
            context.EmploymentType(TenantId, "Contractor").Id);

        var result = await handler.Handle(command, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("Jane", result.Value.FirstName);
        Assert.Equal("Smith", result.Value.LastName);
        Assert.Equal("Janie", result.Value.PreferredName);
        Assert.Equal("jane@example.com", result.Value.Email);
        Assert.Equal("+21699887766", result.Value.Phone);
        Assert.NotNull(result.Value.CurrentEmployment);
        Assert.Equal("Contractor", result.Value.CurrentEmployment!.EmploymentType);
        Assert.NotNull(result.Value.CurrentWorkAssignment);
        Assert.Equal(targetOrgUnitId, result.Value.CurrentWorkAssignment!.OrgUnitId);
        Assert.Equal("Operations Lead", result.Value.CurrentWorkAssignment.JobTitle);
        Assert.Equal("Sfax", result.Value.CurrentWorkAssignment.WorkLocation);
        Assert.Equal(1, result.Value.HistorySummary.WorkAssignmentCount);

        var savedEmployee = await context.Employees.IgnoreQueryFilters().SingleAsync(x => x.Id == employeeId);
        var savedEmployment = await context.Employments.IgnoreQueryFilters().SingleAsync(x => x.EmployeeId == employeeId);
        var savedAssignment = await context.WorkAssignments.IgnoreQueryFilters().SingleAsync(x => x.EmployeeId == employeeId);

        Assert.Equal("EMP-002", savedEmployee.EmployeeNumber);
        Assert.Equal("Contractor", savedEmployment.EmploymentType);
        Assert.Equal(targetOrgUnitId, savedAssignment.OrgUnitId);
        Assert.NotEqual(sourceOrgUnitId, savedAssignment.OrgUnitId);
        Assert.Equal("Operations Lead", savedAssignment.JobTitle);
        Assert.Equal("Sfax", savedAssignment.WorkLocation);
    }

    [Fact]
    public async Task UpdateEmployee_WithManagerIdChange_ReturnsFailure()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        Guid employeeId;
        Guid managerId;
        uint version;
        var employeeHireDate = DateTime.UtcNow.AddYears(-2);
        var managerHireDate = DateTime.UtcNow.AddYears(-3);

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
            var employee = Employee.Create(TenantId, "John", "Doe", "john@example.com", employeeHireDate, jobTitle: "Developer", employeeNumber: TestEmployeeNumbers.Next());
            var manager = Employee.Create(TenantId, "Maya", "Lead", "maya@example.com", managerHireDate, jobTitle: "Manager", employeeNumber: TestEmployeeNumbers.Next());
            var employeeEmployment = Employment.Start(TenantId, employee.Id, employeeHireDate, null, WorkforceSourceType.Manual);
            var managerEmployment = Employment.Start(TenantId, manager.Id, managerHireDate, null, WorkforceSourceType.Manual);
            var employeeAssignment = WorkAssignment.Create(TenantId, employeeEmployment.Id, employee.Id, orgUnit.Id, TestCatalog.Job(TenantId, "Developer"), TestCatalog.Place(TenantId, "Tunis"), true, employeeEmployment.EffectiveFrom, null, WorkforceSourceType.Manual);
            var managerAssignment = WorkAssignment.Create(TenantId, managerEmployment.Id, manager.Id, orgUnit.Id, TestCatalog.Job(TenantId, "Manager"), TestCatalog.Place(TenantId, "Tunis"), true, managerEmployment.EffectiveFrom, null, WorkforceSourceType.Manual);

            seedContext.OrgUnits.Add(orgUnit);
            seedContext.Employees.AddRange(employee, manager);
            seedContext.Employments.AddRange(employeeEmployment, managerEmployment);
            seedContext.WorkAssignments.AddRange(employeeAssignment, managerAssignment);
            await seedContext.SaveChangesAsync();

            employeeId = employee.Id;
            managerId = manager.Id;
            version = employee.Version;
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new UpdateEmployeeCommandHandler(context, tenantContext);
        var command = new UpdateEmployeeCommand(
            employeeId,
            version,
            null,
            null,
            null,
            null,
            managerId);

        var result = await handler.Handle(command, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Employee.UpdateManagerRequiresDedicatedAction", result.Error.Code);
    }

    [Fact]
    public async Task UpdateEmployee_WithHireDateChange_ReturnsFailure()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        Guid employeeId;
        uint version;
        var hireDate = DateTime.UtcNow.AddYears(-2);

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
            var employee = Employee.Create(TenantId, "John", "Doe", "john@example.com", hireDate, jobTitle: "Developer", employeeNumber: TestEmployeeNumbers.Next());
            var employment = Employment.Start(TenantId, employee.Id, hireDate, null, WorkforceSourceType.Manual);
            var assignment = WorkAssignment.Create(TenantId, employment.Id, employee.Id, orgUnit.Id, TestCatalog.Job(TenantId, "Developer"), TestCatalog.Place(TenantId, "Tunis"), true, employment.EffectiveFrom, null, WorkforceSourceType.Manual);

            seedContext.OrgUnits.Add(orgUnit);
            seedContext.Employees.Add(employee);
            seedContext.Employments.Add(employment);
            seedContext.WorkAssignments.Add(assignment);
            await seedContext.SaveChangesAsync();

            employeeId = employee.Id;
            version = employee.Version;
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new UpdateEmployeeCommandHandler(context, tenantContext);
        var command = new UpdateEmployeeCommand(
            employeeId,
            version,
            null,
            null,
            null,
            null,
            null,
            null,
            DateTime.UtcNow.AddYears(-1));

        var result = await handler.Handle(command, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Employee.UpdateHireDateRequiresDedicatedAction", result.Error.Code);
    }
}

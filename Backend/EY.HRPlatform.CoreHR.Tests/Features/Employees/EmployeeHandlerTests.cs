using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Exceptions;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.Employees.Queries.GetEmployeeById;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Tests.Features.Employees;

public class EmployeeHandlerTests
{
    private static readonly Guid TenantId = Guid.NewGuid();

    #region CreateEmployeeCommandHandler Tests

    #endregion

    #region GetEmployeeByIdQueryHandler Tests

    [Fact]
    public async Task GetEmployeeById_WhenExists_ReturnsEmployee()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var employee = Employee.Create(TenantId, "John", "Doe", "john@example.com", DateTime.UtcNow, employeeNumber: TestEmployeeNumbers.Next());
        seedContext.Employees.Add(employee);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = CreateGetEmployeeByIdHandler(context);
        var query = new GetEmployeeByIdQuery(employee.Id);

        // Act
        var result = await handler.Handle(query, CancellationToken.None);

        // Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(employee.Id, result.Value.Id);
        Assert.Equal("John", result.Value.FirstName);
    }

    [Fact]
    public async Task GetEmployeeById_WhenEmployeeHasOrgUnit_ReturnsOrgUnitLinkage()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        seedContext.OrgUnits.Add(orgUnit);

        var employee = Employee.Create(TenantId, "John", "Doe", "john@example.com", DateTime.UtcNow, employeeNumber: TestEmployeeNumbers.Next());
        var employment = Employment.Start(TenantId, employee.Id, DateTime.UtcNow.AddMonths(-1), null, WorkforceSourceType.Manual);
        var assignment = WorkAssignment.Create(TenantId, employment.Id, employee.Id, orgUnit.Id, TestCatalog.Job(TenantId, "Engineer"), TestCatalog.Place(TenantId, null), true, employment.EffectiveFrom, null, WorkforceSourceType.Manual);
        seedContext.Employees.Add(employee);
        seedContext.Employments.Add(employment);
        seedContext.WorkAssignments.Add(assignment);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = CreateGetEmployeeByIdHandler(context);
        var query = new GetEmployeeByIdQuery(employee.Id);

        // Act
        var result = await handler.Handle(query, CancellationToken.None);

        // Assert
        Assert.True(result.IsSuccess);
        Assert.NotNull(result.Value.CurrentWorkAssignment);
        Assert.Equal(orgUnit.Id, result.Value.CurrentWorkAssignment!.OrgUnitId);
        Assert.Equal("Engineering", result.Value.CurrentWorkAssignment.OrgUnitName);
    }

    [Fact]
    public async Task GetEmployeeById_WhenLegacyFieldsDiverge_ReturnsCanonicalEmployeeDetails()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);

        var legacyOrgUnit = OrgUnit.Create(TenantId, "LEG", "Legacy", "Department", null);
        var canonicalOrgUnit = OrgUnit.Create(TenantId, "CAN", "Canonical", "Department", null);

        var manager = Employee.Create(TenantId, "Maya", "Lead", "maya@example.com", DateTime.UtcNow.AddYears(-3), employeeNumber: TestEmployeeNumbers.Next());
        var employee = Employee.Create(
            TenantId,
            "John",
            "Doe",
            "john@example.com",
            DateTime.UtcNow.AddYears(-2),
            jobTitle: "Legacy Title",
            employeeNumber: "EMP-001",
            workLocation: "Legacy Site",
            employmentType: "LegacyType");

        var managerEmployment = Employment.Start(TenantId, manager.Id, DateTime.UtcNow.AddYears(-3), null, WorkforceSourceType.Manual);
        var managerAssignment = WorkAssignment.Create(
            TenantId,
            managerEmployment.Id,
            manager.Id,
            canonicalOrgUnit.Id,
            TestCatalog.Job(TenantId, "Engineering Manager"),
            TestCatalog.Place(TenantId, "HQ"),
            true,
            managerEmployment.EffectiveFrom,
            null,
            WorkforceSourceType.Manual);

        var employment = Employment.Start(TenantId, employee.Id, DateTime.UtcNow.AddYears(-1), TestCatalog.EmploymentType(TenantId, "FullTime"), WorkforceSourceType.Manual);
        var assignment = WorkAssignment.Create(
            TenantId,
            employment.Id,
            employee.Id,
            canonicalOrgUnit.Id,
            TestCatalog.Job(TenantId, "Software Engineer"),
            TestCatalog.Place(TenantId, "Tunis"),
            true,
            employment.EffectiveFrom,
            null,
            WorkforceSourceType.Manual);
        var relationship = ManagerRelationship.Create(
            TenantId,
            employee.Id,
            manager.Id,
            assignment.Id,
            managerAssignment.Id,
            ReportingRelationshipType.PrimaryManager,
            employment.EffectiveFrom,
            WorkforceSourceType.Manual);

        seedContext.OrgUnits.AddRange(legacyOrgUnit, canonicalOrgUnit);
        seedContext.Employees.AddRange(manager, employee);
        seedContext.Employments.AddRange(managerEmployment, employment);
        seedContext.WorkAssignments.AddRange(managerAssignment, assignment);
        seedContext.ManagerRelationships.Add(relationship);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = CreateGetEmployeeByIdHandler(context);

        var result = await handler.Handle(new GetEmployeeByIdQuery(employee.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(result.Value.CurrentEmployment);
        Assert.NotNull(result.Value.CurrentWorkAssignment);
        Assert.NotNull(result.Value.CurrentManager);
        Assert.Equal(employment.Id, result.Value.CurrentEmployment!.EmploymentId);
        Assert.Equal("FullTime", result.Value.CurrentEmployment.EmploymentType);
        Assert.Equal(canonicalOrgUnit.Id, result.Value.CurrentWorkAssignment!.OrgUnitId);
        Assert.Equal("Canonical", result.Value.CurrentWorkAssignment.OrgUnitName);
        Assert.Equal("Software Engineer", result.Value.CurrentWorkAssignment.JobTitle);
        Assert.Equal("Tunis", result.Value.CurrentWorkAssignment.WorkLocation);
        Assert.Equal(manager.Id, result.Value.CurrentManager!.ManagerEmployeeId);
    }

    [Fact]
    public async Task GetEmployeeById_WhenNotExists_ReturnsFailure()
    {
        // Arrange
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        await using var context = TestDbContextFactory.Create(tenantContext);

        var handler = CreateGetEmployeeByIdHandler(context);
        var query = new GetEmployeeByIdQuery(Guid.NewGuid());

        // Act
        var result = await handler.Handle(query, CancellationToken.None);

        // Assert
        Assert.True(result.IsFailure);
        Assert.Contains("NotFound", result.Error.Code);
    }

    [Fact]
    public async Task GetEmployeeById_FromDifferentTenant_ReturnsFailure()
    {
        // Arrange - employee in TenantA, query from TenantB
        var dbName = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var employee = Employee.Create(tenantA, "John", "Doe", "john@example.com", DateTime.UtcNow, employeeNumber: TestEmployeeNumbers.Next());
        seedContext.Employees.Add(employee);
        await seedContext.SaveChangesAsync();

        var tenantContext = TestTenantContext.WithTenant(tenantB); // Different tenant
        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = CreateGetEmployeeByIdHandler(context);
        var query = new GetEmployeeByIdQuery(employee.Id);

        // Act
        var result = await handler.Handle(query, CancellationToken.None);

        // Assert - should not find due to tenant filter
        Assert.True(result.IsFailure);
    }

    #endregion

    #region UpdateEmployeeCommandHandler Tests

    #endregion

    private static GetEmployeeByIdQueryHandler CreateGetEmployeeByIdHandler(CoreHRDbContext context)
        => new(context, new EmployeeDetailsReadModelService(
            context,
            new WorkforceCanonicalResolver(context),
            new TenantSettingsReadService(context)));
}

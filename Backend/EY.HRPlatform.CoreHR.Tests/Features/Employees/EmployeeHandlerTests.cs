using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Exceptions;
using EY.HRPlatform.CoreHR.Features.Employees.Commands.CreateEmployee;
using EY.HRPlatform.CoreHR.Features.Employees.Commands.UpdateEmployee;
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

    [Fact]
    public async Task CreateEmployee_WithValidData_ReturnsCreatedEmployee()
    {
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        var dbName = Guid.NewGuid().ToString();
        var hireDate = DateTime.UtcNow.AddDays(-30);

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
            hireDate,
            JobId: context.JobId(TenantId, "Developer"),
            OrgUnitId: orgUnitId);

        var result = await handler.Handle(command, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("John", result.Value.FirstName);
        Assert.Equal("Doe", result.Value.LastName);
        Assert.Equal("john.doe@example.com", result.Value.Email);
        Assert.Equal(TenantId, result.Value.TenantId);
        Assert.NotNull(result.Value.CurrentEmployment);
        Assert.Equal(EmploymentStatus.Active, result.Value.CurrentEmployment!.Status);
        Assert.Equal(hireDate, result.Value.CurrentEmployment.EffectiveFrom);
        Assert.NotNull(result.Value.CurrentWorkAssignment);
        Assert.Equal(orgUnitId, result.Value.CurrentWorkAssignment!.OrgUnitId);
        Assert.Equal("Developer", result.Value.CurrentWorkAssignment.JobTitle);

        var saved = await context.Employees.IgnoreQueryFilters().FirstOrDefaultAsync();
        Assert.NotNull(saved);
        Assert.Equal(result.Value.Id, saved.Id);
    }

    [Fact]
    public async Task CreateEmployee_WithDuplicateEmail_ThrowsDuplicateEntityException()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);

        var existing = Employee.Create(TenantId, "Jane", "Doe", "john.doe@example.com", DateTime.UtcNow, employeeNumber: TestEmployeeNumbers.Next());
        seedContext.Employees.Add(existing);
        // Jane actively occupies the work email, so a new active hire cannot reuse it.
        seedContext.WorkEmailOccupancies.Add(WorkEmailOccupancy.Create(TenantId, existing.Id, "john.doe@example.com"));
        var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        seedContext.OrgUnits.Add(orgUnit);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new CreateEmployeeCommandHandler(context, tenantContext);
        var command = new CreateEmployeeCommand(
            "John",
            "Doe",
            "john.doe@example.com",
            DateTime.UtcNow,
            JobId: context.JobId(TenantId, "Developer"),
            OrgUnitId: orgUnit.Id);

        var result = await handler.Handle(command, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Employee.EmailOccupied", result.Error.Code);
    }

    [Fact]
    public async Task CreateEmployee_WithManager_AssignsManagerCorrectly()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        var manager = Employee.Create(TenantId, "Manager", "Person", "manager@example.com", DateTime.UtcNow, employeeNumber: TestEmployeeNumbers.Next());
        var managerEmployment = Employment.Start(TenantId, manager.Id, DateTime.UtcNow.AddDays(-10), null, WorkforceSourceType.Manual);
        var managerAssignment = WorkAssignment.Create(
            TenantId,
            managerEmployment.Id,
            manager.Id,
            orgUnit.Id,
            TestCatalog.Job(TenantId, "Engineering Manager"),
            TestCatalog.Place(TenantId, "HQ"),
            true,
            managerEmployment.EffectiveFrom,
            null,
            WorkforceSourceType.Manual);
        seedContext.OrgUnits.Add(orgUnit);
        seedContext.Employees.Add(manager);
        seedContext.Employments.Add(managerEmployment);
        seedContext.WorkAssignments.Add(managerAssignment);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new CreateEmployeeCommandHandler(context, tenantContext);
        var command = new CreateEmployeeCommand(
            "John",
            "Doe",
            "john.doe@example.com",
            DateTime.UtcNow,
            JobId: context.JobId(TenantId, "Developer"),
            ManagerId: manager.Id,
            OrgUnitId: orgUnit.Id);

        var result = await handler.Handle(command, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(result.Value.CurrentManager);
        Assert.Equal(manager.Id, result.Value.CurrentManager!.ManagerEmployeeId);
        Assert.Equal("Manager", result.Value.CurrentManager.ManagerFirstName);
    }

    [Fact]
    public async Task CreateEmployee_WithInactiveManager_ThrowsArgumentException()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        var manager = Employee.Create(TenantId, "Manager", "Person", "manager@example.com", DateTime.UtcNow, employeeNumber: TestEmployeeNumbers.Next());
        var managerEmployment = Employment.Start(TenantId, manager.Id, DateTime.UtcNow.AddDays(-10), null, WorkforceSourceType.Manual);
        managerEmployment.End(DateTime.UtcNow.AddDays(-1));
        seedContext.OrgUnits.Add(orgUnit);
        seedContext.Employees.Add(manager);
        seedContext.Employments.Add(managerEmployment);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new CreateEmployeeCommandHandler(context, tenantContext);
        var command = new CreateEmployeeCommand(
            "John",
            "Doe",
            "john.doe@example.com",
            DateTime.UtcNow,
            JobId: context.JobId(TenantId, "Developer"),
            ManagerId: manager.Id,
            OrgUnitId: orgUnit.Id);

        var result = await handler.Handle(command, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Manager.NoManagerAssignment", result.Error.Code);
    }

    [Fact]
    public async Task CreateEmployee_WithManagerFromDifferentTenant_ThrowsEntityNotFoundException()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        var otherTenantId = Guid.NewGuid();

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        var manager = Employee.Create(otherTenantId, "Manager", "Person", "manager@example.com", DateTime.UtcNow, employeeNumber: TestEmployeeNumbers.Next());
        var managerEmployment = Employment.Start(otherTenantId, manager.Id, DateTime.UtcNow.AddDays(-10), null, WorkforceSourceType.Manual);
        var foreignOrgUnit = OrgUnit.Create(otherTenantId, "FIN", "Finance", "Department", null);
        var managerAssignment = WorkAssignment.Create(
            otherTenantId,
            managerEmployment.Id,
            manager.Id,
            foreignOrgUnit.Id,
            TestCatalog.Job(otherTenantId, "Finance Manager"),
            TestCatalog.Place(otherTenantId, "HQ"),
            true,
            managerEmployment.EffectiveFrom,
            null,
            WorkforceSourceType.Manual);
        seedContext.OrgUnits.AddRange(orgUnit, foreignOrgUnit);
        seedContext.Employees.Add(manager);
        seedContext.Employments.Add(managerEmployment);
        seedContext.WorkAssignments.Add(managerAssignment);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new CreateEmployeeCommandHandler(context, tenantContext);
        var command = new CreateEmployeeCommand(
            "John",
            "Doe",
            "john.doe@example.com",
            DateTime.UtcNow,
            JobId: context.JobId(TenantId, "Developer"),
            ManagerId: manager.Id,
            OrgUnitId: orgUnit.Id);

        var result = await handler.Handle(command, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Manager.NoManagerAssignment", result.Error.Code);
    }

    [Fact]
    public async Task CreateEmployee_WithOrgUnit_AssignsOrgUnitCorrectly()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        seedContext.OrgUnits.Add(orgUnit);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new CreateEmployeeCommandHandler(context, tenantContext);
        var command = new CreateEmployeeCommand(
            "John",
            "Doe",
            "john.doe@example.com",
            DateTime.UtcNow,
            JobId: context.JobId(TenantId, "Developer"),
            OrgUnitId: orgUnit.Id);

        var result = await handler.Handle(command, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(result.Value.CurrentWorkAssignment);
        Assert.Equal(orgUnit.Id, result.Value.CurrentWorkAssignment!.OrgUnitId);
        Assert.Equal("Engineering", result.Value.CurrentWorkAssignment.OrgUnitName);

        var saved = await context.Employees.IgnoreQueryFilters().FirstAsync(e => e.Id == result.Value.Id);
        Assert.Equal(result.Value.Id, saved.Id);
    }

    [Fact]
    public async Task CreateEmployee_WithInactiveOrgUnit_ThrowsArgumentException()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        orgUnit.Deactivate();
        seedContext.OrgUnits.Add(orgUnit);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new CreateEmployeeCommandHandler(context, tenantContext);
        var command = new CreateEmployeeCommand(
            "John",
            "Doe",
            "john.doe@example.com",
            DateTime.UtcNow,
            JobId: context.JobId(TenantId, "Developer"),
            OrgUnitId: orgUnit.Id);

        var result = await handler.Handle(command, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("WorkAssignment.OrgUnitInactive", result.Error.Code);
    }

    [Fact]
    public async Task CreateEmployee_WithOrgUnitFromDifferentTenant_ThrowsEntityNotFoundException()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        var otherTenantId = Guid.NewGuid();

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var orgUnit = OrgUnit.Create(otherTenantId, "ENG", "Engineering", "Department", null);
        seedContext.OrgUnits.Add(orgUnit);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new CreateEmployeeCommandHandler(context, tenantContext);
        var command = new CreateEmployeeCommand(
            "John",
            "Doe",
            "john.doe@example.com",
            DateTime.UtcNow,
            JobId: context.JobId(TenantId, "Developer"),
            OrgUnitId: orgUnit.Id);

        var result = await handler.Handle(command, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("WorkAssignment.OrgUnitNotFound", result.Error.Code);
    }

    [Fact]
    public async Task CreateEmployee_WithNonExistentManager_ThrowsEntityNotFoundException()
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
            JobId: context.JobId(TenantId, "Developer"),
            ManagerId: Guid.NewGuid(),
            OrgUnitId: orgUnitId);

        var result = await handler.Handle(command, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Manager.NoManagerAssignment", result.Error.Code);
    }

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

    [Fact]
    public async Task UpdateEmployee_WhenNotExists_ThrowsEntityNotFoundException()
    {
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        await using var context = TestDbContextFactory.Create(tenantContext);

        var handler = new UpdateEmployeeCommandHandler(context, tenantContext);
        var command = new UpdateEmployeeCommand(
            Guid.NewGuid(),
            0,
            "Jane",
            "Smith",
            "jane@example.com",
            null,
            null);

        await Assert.ThrowsAsync<EntityNotFoundException>(
            () => handler.Handle(command, CancellationToken.None));
    }

    [Fact]
    public async Task UpdateEmployee_WithStaleVersion_ThrowsConcurrencyException()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var employee = Employee.Create(TenantId, "John", "Doe", "john@example.com", DateTime.UtcNow, employeeNumber: TestEmployeeNumbers.Next());
        seedContext.Employees.Add(employee);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new UpdateEmployeeCommandHandler(context, tenantContext);
        var command = new UpdateEmployeeCommand(
            employee.Id,
            999,
            "Jane",
            "Smith",
            "jane@example.com",
            null,
            null);

        await Assert.ThrowsAsync<ConcurrencyException>(
            () => handler.Handle(command, CancellationToken.None));
    }

    [Fact]
    public async Task UpdateEmployee_WithManagerChange_ReturnsDedicatedActionFailure()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var employee = Employee.Create(TenantId, "John", "Doe", "john@example.com", DateTime.UtcNow, employeeNumber: TestEmployeeNumbers.Next());
        seedContext.Employees.Add(employee);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new UpdateEmployeeCommandHandler(context, tenantContext);
        var command = new UpdateEmployeeCommand(
            employee.Id,
            employee.Version,
            null,
            null,
            null,
            null,
            managerId: employee.Id);

        var result = await handler.Handle(command, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Employee.UpdateManagerRequiresDedicatedAction", result.Error.Code);
    }

    #endregion

    private static GetEmployeeByIdQueryHandler CreateGetEmployeeByIdHandler(CoreHRDbContext context)
        => new(context, new EmployeeDetailsReadModelService(
            context,
            new WorkforceCanonicalResolver(context),
            new TenantSettingsReadService(context)));

    private static async Task SeedTenantSettingsAsync(string dbName, string overridesJson)
    {
        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        seedContext.TenantSettings.Add(EY.HRPlatform.CoreHR.Domain.Entities.TenantSettings.Create(TenantId, overridesJson));
        await seedContext.SaveChangesAsync();
    }
}

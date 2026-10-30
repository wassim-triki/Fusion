using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Exceptions;
using EY.HRPlatform.CoreHR.Features.Employees.Queries.GetEmployees;
using EY.HRPlatform.CoreHR.Features.OrgUnits.Commands.CreateOrgUnit;
using EY.HRPlatform.CoreHR.Features.OrgUnits.Commands.DeleteOrgUnit;
using EY.HRPlatform.CoreHR.Features.OrgUnits.Commands.UpdateOrgUnit;
using EY.HRPlatform.CoreHR.Features.OrgUnits.Queries.GetOrgUnitById;
using EY.HRPlatform.CoreHR.Features.OrgUnits.Queries.GetOrgUnits;
using EY.HRPlatform.CoreHR.Features.OrgUnits.Queries.GetOrgUnitTree;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Tests.Features.OrgUnits;

public class OrgUnitHandlerTests
{
    private static readonly Guid TenantId = Guid.NewGuid();

    private static EY.HRPlatform.CoreHR.Features.OrgUnits.Services.ResponsibleManagerService Rms(
        EY.HRPlatform.CoreHR.Infrastructure.Persistence.CoreHRDbContext context)
        => new(
            context,
            TestTenantContext.WithTenant(TenantId),
            new EY.HRPlatform.CoreHR.Features.Workforce.Services.WorkforceCanonicalResolver(context),
            new Microsoft.AspNetCore.Http.HttpContextAccessor());

    #region CreateOrgUnitCommandHandler Tests

    [Fact]
    public async Task CreateOrgUnit_WithValidData_ReturnsCreatedOrgUnit()
    {
        // Arrange
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        await using var context = TestDbContextFactory.Create(tenantContext);

        // Seed tenant settings with orgUnitTypes
        var settings = EY.HRPlatform.CoreHR.Domain.Entities.TenantSettings.Create(TenantId, """{"orgUnitTypes":["Department","Team"]}""");
        context.TenantSettings.Add(settings);
        await context.SaveChangesAsync();

        var handler = new CreateOrgUnitCommandHandler(context, tenantContext, Rms(context));
        var command = new CreateOrgUnitCommand("ENG", "Engineering", "Department", null);

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("ENG", result.Value.Code);
        Assert.Equal("Engineering", result.Value.Name);
        Assert.Equal("Department", result.Value.Type);
        Assert.Null(result.Value.ParentId);
        Assert.True(result.Value.IsActive);

        // Verify persisted
        var saved = await context.OrgUnits.IgnoreQueryFilters().FirstOrDefaultAsync();
        Assert.NotNull(saved);
        Assert.Equal(result.Value.Id, saved.Id);
    }

    [Fact]
    public async Task CreateOrgUnit_NormalizesCode_ToUppercase()
    {
        // Arrange
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        await using var context = TestDbContextFactory.Create(tenantContext);

        var settings = EY.HRPlatform.CoreHR.Domain.Entities.TenantSettings.Create(TenantId, """{"orgUnitTypes":["Department"]}""");
        context.TenantSettings.Add(settings);
        await context.SaveChangesAsync();

        var handler = new CreateOrgUnitCommandHandler(context, tenantContext, Rms(context));
        var command = new CreateOrgUnitCommand("eng-001", "Engineering", "Department", null);

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("ENG-001", result.Value.Code); // Normalized to uppercase
    }

    [Fact]
    public async Task CreateOrgUnit_WithParent_AssignsParentCorrectly()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        // Seed parent org unit
        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var parent = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        seedContext.OrgUnits.Add(parent);
        var settings = EY.HRPlatform.CoreHR.Domain.Entities.TenantSettings.Create(TenantId, """{"orgUnitTypes":["Department","Team"]}""");
        seedContext.TenantSettings.Add(settings);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new CreateOrgUnitCommandHandler(context, tenantContext, Rms(context));
        var command = new CreateOrgUnitCommand("ENG-TEAM1", "Platform Team", "Team", parent.Id);

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(parent.Id, result.Value.ParentId);
        Assert.Equal("Engineering", result.Value.ParentName);
    }

    [Fact]
    public async Task CreateOrgUnit_WithInvalidType_ThrowsArgumentException()
    {
        // Arrange
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        await using var context = TestDbContextFactory.Create(tenantContext);

        var settings = EY.HRPlatform.CoreHR.Domain.Entities.TenantSettings.Create(TenantId, """{"orgUnitTypes":["Department","Team"]}""");
        context.TenantSettings.Add(settings);
        await context.SaveChangesAsync();

        var handler = new CreateOrgUnitCommandHandler(context, tenantContext, Rms(context));
        var command = new CreateOrgUnitCommand("DIV", "Division", "Division", null); // Invalid type

        // Act & Assert
        var ex = await Assert.ThrowsAsync<ArgumentException>(
            () => handler.Handle(command, CancellationToken.None));
        Assert.Contains("Division", ex.Message);
        Assert.Contains("Invalid", ex.Message); // Check for "Invalid org unit type"
    }

    [Fact]
    public async Task CreateOrgUnit_WithDuplicateCode_ThrowsDuplicateEntityException()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var existing = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        seedContext.OrgUnits.Add(existing);
        var settings = EY.HRPlatform.CoreHR.Domain.Entities.TenantSettings.Create(TenantId, """{"orgUnitTypes":["Department"]}""");
        seedContext.TenantSettings.Add(settings);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new CreateOrgUnitCommandHandler(context, tenantContext, Rms(context));
        var command = new CreateOrgUnitCommand("ENG", "Engineering 2", "Department", null);

        // Act & Assert
        var ex = await Assert.ThrowsAsync<DuplicateEntityException>(
            () => handler.Handle(command, CancellationToken.None));
        Assert.Contains("code", ex.Message);
    }

    [Fact]
    public async Task CreateOrgUnit_WithDuplicateName_ThrowsDuplicateEntityException()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var existing = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        seedContext.OrgUnits.Add(existing);
        var settings = EY.HRPlatform.CoreHR.Domain.Entities.TenantSettings.Create(TenantId, """{"orgUnitTypes":["Department"]}""");
        seedContext.TenantSettings.Add(settings);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new CreateOrgUnitCommandHandler(context, tenantContext, Rms(context));
        var command = new CreateOrgUnitCommand("ENG2", "Engineering", "Department", null); // Same name

        // Act & Assert
        var ex = await Assert.ThrowsAsync<DuplicateEntityException>(
            () => handler.Handle(command, CancellationToken.None));
        Assert.Contains("name", ex.Message);
    }

    [Fact]
    public async Task CreateOrgUnit_WithNonExistentParent_ThrowsEntityNotFoundException()
    {
        // Arrange
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        await using var context = TestDbContextFactory.Create(tenantContext);

        var settings = EY.HRPlatform.CoreHR.Domain.Entities.TenantSettings.Create(TenantId, """{"orgUnitTypes":["Team"]}""");
        context.TenantSettings.Add(settings);
        await context.SaveChangesAsync();

        var handler = new CreateOrgUnitCommandHandler(context, tenantContext, Rms(context));
        var command = new CreateOrgUnitCommand("TEAM", "Team", "Team", Guid.NewGuid());

        // Act & Assert
        var ex = await Assert.ThrowsAsync<EntityNotFoundException>(
            () => handler.Handle(command, CancellationToken.None));
        Assert.Contains("Parent", ex.Message);
    }

    [Fact]
    public async Task CreateOrgUnit_WithInactiveParent_ThrowsArgumentException()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var parent = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        parent.Deactivate(); // Inactive parent
        seedContext.OrgUnits.Add(parent);
        var settings = EY.HRPlatform.CoreHR.Domain.Entities.TenantSettings.Create(TenantId, """{"orgUnitTypes":["Department","Team"]}""");
        seedContext.TenantSettings.Add(settings);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new CreateOrgUnitCommandHandler(context, tenantContext, Rms(context));
        var command = new CreateOrgUnitCommand("TEAM", "Team", "Team", parent.Id);

        // Act & Assert
        var ex = await Assert.ThrowsAsync<ArgumentException>(
            () => handler.Handle(command, CancellationToken.None));
        Assert.Contains("inactive", ex.Message);
    }

    #endregion

    #region GetOrgUnitByIdQueryHandler Tests

    [Fact]
    public async Task GetOrgUnitById_WhenExists_ReturnsOrgUnit()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        seedContext.OrgUnits.Add(orgUnit);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new GetOrgUnitByIdQueryHandler(context);
        var query = new GetOrgUnitByIdQuery(orgUnit.Id);

        // Act
        var result = await handler.Handle(query, CancellationToken.None);

        // Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(orgUnit.Id, result.Value.Id);
        Assert.Equal("ENG", result.Value.Code);
        Assert.Equal("Engineering", result.Value.Name);
    }

    [Fact]
    public async Task GetOrgUnitById_WhenNotExists_ReturnsFailure()
    {
        // Arrange
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        await using var context = TestDbContextFactory.Create(tenantContext);

        var handler = new GetOrgUnitByIdQueryHandler(context);
        var query = new GetOrgUnitByIdQuery(Guid.NewGuid());

        // Act
        var result = await handler.Handle(query, CancellationToken.None);

        // Assert
        Assert.True(result.IsFailure);
        Assert.Contains("NotFound", result.Error.Code);
    }

    [Fact]
    public async Task GetOrgUnitById_FromDifferentTenant_ReturnsFailure()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var orgUnit = OrgUnit.Create(tenantA, "ENG", "Engineering", "Department", null);
        seedContext.OrgUnits.Add(orgUnit);
        await seedContext.SaveChangesAsync();

        var tenantContext = TestTenantContext.WithTenant(tenantB); // Different tenant
        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new GetOrgUnitByIdQueryHandler(context);
        var query = new GetOrgUnitByIdQuery(orgUnit.Id);

        // Act
        var result = await handler.Handle(query, CancellationToken.None);

        // Assert - should not find due to tenant filter
        Assert.True(result.IsFailure);
    }

    #endregion

    #region GetOrgUnitsQueryHandler Tests

    [Fact]
    public async Task GetOrgUnits_ReturnsPagedList()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        seedContext.OrgUnits.AddRange(
            OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null),
            OrgUnit.Create(TenantId, "HR", "Human Resources", "Department", null),
            OrgUnit.Create(TenantId, "SALES", "Sales", "Department", null));
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new GetOrgUnitsQueryHandler(context);
        var query = new GetOrgUnitsQuery(null, null, null, true, OrgUnitSortField.Name, SortDirection.Asc, 1, 10);

        // Act
        var result = await handler.Handle(query, CancellationToken.None);

        // Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(3, result.Value.TotalCount);
        Assert.Equal(3, result.Value.Items.Count);
        Assert.Equal("Engineering", result.Value.Items[0].Name); // Sorted by name
    }

    [Fact]
    public async Task GetOrgUnitTree_IncludesDirectAndRolledUpMemberCounts()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using (var seed = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            var root = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
            seed.OrgUnits.Add(root);
            await seed.SaveChangesAsync();
            var child = OrgUnit.Create(TenantId, "ENG-PLT", "Platform", "Team", root.Id);
            seed.OrgUnits.Add(child);
            await seed.SaveChangesAsync();

            var rootMember = Employee.Create(TenantId, "Root", "Member", "rootm@example.com", DateTime.UtcNow, employeeNumber: "T-1");
            var childA = Employee.Create(TenantId, "Child", "Alpha", "ca@example.com", DateTime.UtcNow, employeeNumber: "T-2");
            var childB = Employee.Create(TenantId, "Child", "Beta", "cb@example.com", DateTime.UtcNow, employeeNumber: "T-3");
            var childGone = Employee.Create(TenantId, "Child", "Gone", "cg@example.com", DateTime.UtcNow, employeeNumber: "T-4");
            var rootEmployment = Employment.Start(TenantId, rootMember.Id, DateTime.UtcNow.AddMonths(-6), null, WorkforceSourceType.Manual);
            var childAEmployment = Employment.Start(TenantId, childA.Id, DateTime.UtcNow.AddMonths(-6), null, WorkforceSourceType.Manual);
            var childBEmployment = Employment.Start(TenantId, childB.Id, DateTime.UtcNow.AddMonths(-6), null, WorkforceSourceType.Manual);
            var childGoneEmployment = Employment.Start(TenantId, childGone.Id, DateTime.UtcNow.AddMonths(-6), null, WorkforceSourceType.Manual);
            childGoneEmployment.End(DateTime.UtcNow.AddDays(-1));
            var rootAssignment = WorkAssignment.Create(TenantId, rootEmployment.Id, rootMember.Id, root.Id, TestCatalog.Job(TenantId, "Lead"), TestCatalog.Place(TenantId, null), true, rootEmployment.EffectiveFrom, null, WorkforceSourceType.Manual);
            var childAAssignment = WorkAssignment.Create(TenantId, childAEmployment.Id, childA.Id, child.Id, TestCatalog.Job(TenantId, "Engineer"), TestCatalog.Place(TenantId, null), true, childAEmployment.EffectiveFrom, null, WorkforceSourceType.Manual);
            var childBAssignment = WorkAssignment.Create(TenantId, childBEmployment.Id, childB.Id, child.Id, TestCatalog.Job(TenantId, "Engineer"), TestCatalog.Place(TenantId, null), true, childBEmployment.EffectiveFrom, null, WorkforceSourceType.Manual);
            var childGoneAssignment = WorkAssignment.Create(TenantId, childGoneEmployment.Id, childGone.Id, child.Id, TestCatalog.Job(TenantId, "Engineer"), TestCatalog.Place(TenantId, null), true, childGoneEmployment.EffectiveFrom, childGoneEmployment.EffectiveTo, WorkforceSourceType.Manual);
            seed.Employees.AddRange(rootMember, childA, childB, childGone);
            seed.Employments.AddRange(rootEmployment, childAEmployment, childBEmployment, childGoneEmployment);
            seed.WorkAssignments.AddRange(rootAssignment, childAAssignment, childBAssignment, childGoneAssignment);
            await seed.SaveChangesAsync();
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new GetOrgUnitTreeQueryHandler(context);

        var result = await handler.Handle(new GetOrgUnitTreeQuery(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var rootNode = Assert.Single(result.Value);
        Assert.Equal("ENG", rootNode.Code);
        Assert.Equal(1, rootNode.MemberCount);
        Assert.Equal(3, rootNode.TotalMemberCount);
        var childNode = Assert.Single(rootNode.Children);
        Assert.Equal(2, childNode.MemberCount);
        Assert.Equal(2, childNode.TotalMemberCount);
    }

    [Fact]
    public async Task GetOrgUnits_FiltersInactiveByDefault()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var activeUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        var inactiveUnit = OrgUnit.Create(TenantId, "HR", "Human Resources", "Department", null);
        inactiveUnit.Deactivate();
        seedContext.OrgUnits.AddRange(activeUnit, inactiveUnit);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new GetOrgUnitsQueryHandler(context);
        var query = new GetOrgUnitsQuery(null, null, null, true, OrgUnitSortField.Name, SortDirection.Asc, 1, 10);

        // Act
        var result = await handler.Handle(query, CancellationToken.None);

        // Assert
        Assert.True(result.IsSuccess);
        Assert.Single(result.Value.Items);
        Assert.Equal("Engineering", result.Value.Items[0].Name);
    }

    [Fact]
    public async Task GetOrgUnits_CanFilterByType()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var dept = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        seedContext.OrgUnits.Add(dept);
        await seedContext.SaveChangesAsync();
        var team = OrgUnit.Create(TenantId, "ENG-TEAM", "Platform Team", "Team", dept.Id);
        seedContext.OrgUnits.Add(team);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new GetOrgUnitsQueryHandler(context);
        var query = new GetOrgUnitsQuery(null, "Team", null, true, OrgUnitSortField.Name, SortDirection.Asc, 1, 10);

        // Act
        var result = await handler.Handle(query, CancellationToken.None);

        // Assert
        Assert.True(result.IsSuccess);
        Assert.Single(result.Value.Items);
        Assert.Equal("Platform Team", result.Value.Items[0].Name);
    }

    [Fact]
    public async Task GetOrgUnits_CanSearchByCodeOrName()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        seedContext.OrgUnits.AddRange(
            OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null),
            OrgUnit.Create(TenantId, "HR", "Human Resources", "Department", null));
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new GetOrgUnitsQueryHandler(context);
        var query = new GetOrgUnitsQuery("human", null, null, true, OrgUnitSortField.Name, SortDirection.Asc, 1, 10);

        // Act
        var result = await handler.Handle(query, CancellationToken.None);

        // Assert
        Assert.True(result.IsSuccess);
        Assert.Single(result.Value.Items);
        Assert.Equal("Human Resources", result.Value.Items[0].Name);
    }

    #endregion

    #region GetOrgUnitTreeQueryHandler Tests

    [Fact]
    public async Task GetOrgUnitTree_ReturnsHierarchy()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var eng = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        seedContext.OrgUnits.Add(eng);
        await seedContext.SaveChangesAsync();
        
        var team1 = OrgUnit.Create(TenantId, "ENG-T1", "Team 1", "Team", eng.Id);
        var team2 = OrgUnit.Create(TenantId, "ENG-T2", "Team 2", "Team", eng.Id);
        seedContext.OrgUnits.AddRange(team1, team2);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new GetOrgUnitTreeQueryHandler(context);
        var query = new GetOrgUnitTreeQuery(null, 10, false);

        // Act
        var result = await handler.Handle(query, CancellationToken.None);

        // Assert
        Assert.True(result.IsSuccess);
        Assert.Single(result.Value); // One root
        Assert.Equal("Engineering", result.Value[0].Name);
        Assert.Equal(0, result.Value[0].Level);
        Assert.Equal(2, result.Value[0].Children.Count); // Two children
        Assert.Equal(1, result.Value[0].Children[0].Level);
    }

    [Fact]
    public async Task GetOrgUnitTree_HandlesOrphans()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var parent = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        seedContext.OrgUnits.Add(parent);
        await seedContext.SaveChangesAsync();
        
        var child = OrgUnit.Create(TenantId, "ENG-T1", "Team 1", "Team", parent.Id);
        seedContext.OrgUnits.Add(child);
        await seedContext.SaveChangesAsync();

        // Deactivate parent to create orphan
        parent.Deactivate();
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new GetOrgUnitTreeQueryHandler(context);
        var query = new GetOrgUnitTreeQuery(null, 10, false);

        // Act
        var result = await handler.Handle(query, CancellationToken.None);

        // Assert
        Assert.True(result.IsSuccess);
        Assert.Single(result.Value); // Orphan surfaced as root
        Assert.Equal("Team 1", result.Value[0].Name);
        Assert.True(result.Value[0].IsOrphaned);
    }

    #endregion

    #region UpdateOrgUnitCommandHandler Tests

    [Fact]
    public async Task UpdateOrgUnit_WithValidData_UpdatesOrgUnit()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        seedContext.OrgUnits.Add(orgUnit);
        await seedContext.SaveChangesAsync();
        var version = orgUnit.Version;

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new UpdateOrgUnitCommandHandler(context, Rms(context));
        // Use a valid default type (Team is in defaults along with Department)
        var command = new UpdateOrgUnitCommand(orgUnit.Id, "Engineering Team", "Team", null, version);

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("Engineering Team", result.Value.Name);
        Assert.Equal("Team", result.Value.Type);
        Assert.Equal("ENG", result.Value.Code); // Code is immutable
    }

    [Fact]
    public async Task UpdateOrgUnit_WithStaleVersion_ThrowsConcurrencyException()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        seedContext.OrgUnits.Add(orgUnit);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new UpdateOrgUnitCommandHandler(context, Rms(context));
        var command = new UpdateOrgUnitCommand(orgUnit.Id, "Updated Name", "Department", null, 999);

        // Act & Assert
        await Assert.ThrowsAsync<ConcurrencyException>(
            () => handler.Handle(command, CancellationToken.None));
    }

    [Fact]
    public async Task UpdateOrgUnit_DetectsCycle()
    {
        // Arrange - Create A -> B -> C hierarchy, then try to make A -> C (C becomes parent of A)
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        
        var a = OrgUnit.Create(TenantId, "A", "A", "Department", null);
        seedContext.OrgUnits.Add(a);
        await seedContext.SaveChangesAsync();
        
        var b = OrgUnit.Create(TenantId, "B", "B", "Department", a.Id);
        seedContext.OrgUnits.Add(b);
        await seedContext.SaveChangesAsync();
        
        var c = OrgUnit.Create(TenantId, "C", "C", "Department", b.Id);
        seedContext.OrgUnits.Add(c);
        await seedContext.SaveChangesAsync();
        var aVersion = a.Version;

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new UpdateOrgUnitCommandHandler(context, Rms(context));
        
        // Try to set A's parent to C (creates cycle: C -> B -> A -> C)
        var command = new UpdateOrgUnitCommand(a.Id, "A", "Department", c.Id, aVersion);

        // Act & Assert
        var ex = await Assert.ThrowsAsync<ArgumentException>(
            () => handler.Handle(command, CancellationToken.None));
        Assert.Contains("cycle", ex.Message.ToLower());
    }

    [Fact]
    public async Task UpdateOrgUnit_WhenNotExists_ThrowsEntityNotFoundException()
    {
        // Arrange
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        await using var context = TestDbContextFactory.Create(tenantContext);

        var handler = new UpdateOrgUnitCommandHandler(context, Rms(context));
        var command = new UpdateOrgUnitCommand(Guid.NewGuid(), "Name", "Department", null, 0);

        // Act & Assert
        await Assert.ThrowsAsync<EntityNotFoundException>(
            () => handler.Handle(command, CancellationToken.None));
    }

    #endregion

    #region DeleteOrgUnitCommandHandler Tests

    [Fact]
    public async Task DeleteOrgUnit_WhenNoChildren_Deactivates()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        seedContext.OrgUnits.Add(orgUnit);
        await seedContext.SaveChangesAsync();
        var version = orgUnit.Version;

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new DeleteOrgUnitCommandHandler(context);
        var command = new DeleteOrgUnitCommand(orgUnit.Id, version);

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        Assert.True(result.IsSuccess);

        var updated = await context.OrgUnits.IgnoreQueryFilters().FirstAsync(o => o.Id == orgUnit.Id);
        Assert.False(updated.IsActive);
    }

    [Fact]
    public async Task DeleteOrgUnit_WithActiveChildren_ReturnsConflict()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var parent = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        seedContext.OrgUnits.Add(parent);
        await seedContext.SaveChangesAsync();
        
        var child = OrgUnit.Create(TenantId, "ENG-T1", "Team 1", "Team", parent.Id);
        seedContext.OrgUnits.Add(child);
        await seedContext.SaveChangesAsync();
        var parentVersion = parent.Version;

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new DeleteOrgUnitCommandHandler(context);
        var command = new DeleteOrgUnitCommand(parent.Id, parentVersion);

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        Assert.True(result.IsFailure);
        Assert.Equal("Conflict", result.Error.Code);
        Assert.Contains("child", result.Error.Message.ToLower());
    }

    [Fact]
    public async Task DeleteOrgUnit_WithAssignedActiveEmployees_ReturnsConflict()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        seedContext.OrgUnits.Add(orgUnit);
        await seedContext.SaveChangesAsync();

        var employee = Employee.Create(TenantId, "John", "Doe", "john@example.com", DateTime.UtcNow, employeeNumber: TestEmployeeNumbers.Next());
        var employment = Employment.Start(TenantId, employee.Id, DateTime.UtcNow.AddMonths(-1), null, WorkforceSourceType.Manual);
        var assignment = WorkAssignment.Create(TenantId, employment.Id, employee.Id, orgUnit.Id, TestCatalog.Job(TenantId, "Engineer"), TestCatalog.Place(TenantId, null), true, employment.EffectiveFrom, null, WorkforceSourceType.Manual);
        seedContext.Employees.Add(employee);
        seedContext.Employments.Add(employment);
        seedContext.WorkAssignments.Add(assignment);
        await seedContext.SaveChangesAsync();

        var version = orgUnit.Version;

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new DeleteOrgUnitCommandHandler(context);
        var command = new DeleteOrgUnitCommand(orgUnit.Id, version);

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        Assert.True(result.IsFailure);
        Assert.Equal("Conflict", result.Error.Code);
        Assert.Contains("employees", result.Error.Message.ToLower());
    }

    [Fact]
    public async Task DeleteOrgUnit_WhenNotExists_ThrowsEntityNotFoundException()
    {
        // Arrange
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        await using var context = TestDbContextFactory.Create(tenantContext);

        var handler = new DeleteOrgUnitCommandHandler(context);
        var command = new DeleteOrgUnitCommand(Guid.NewGuid(), 0);

        // Act & Assert
        await Assert.ThrowsAsync<EntityNotFoundException>(
            () => handler.Handle(command, CancellationToken.None));
    }

    [Fact]
    public async Task DeleteOrgUnit_WithStaleVersion_ThrowsConcurrencyException()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName);
        var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        seedContext.OrgUnits.Add(orgUnit);
        await seedContext.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new DeleteOrgUnitCommandHandler(context);
        var command = new DeleteOrgUnitCommand(orgUnit.Id, 999);

        // Act & Assert
        await Assert.ThrowsAsync<ConcurrencyException>(
            () => handler.Handle(command, CancellationToken.None));
    }

    #endregion
}



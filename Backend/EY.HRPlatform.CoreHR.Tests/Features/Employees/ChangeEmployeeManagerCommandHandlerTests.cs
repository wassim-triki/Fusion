using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Employees.Commands.ChangeEmployeeManager;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Tests.Features.Employees;

public class ChangeEmployeeManagerCommandHandlerTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly DateTime Hire = new(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Change = new(2024, 9, 1, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Handle_FirstManagerAssignment_CreatesPrimaryRelationship()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seed = TestDbContextFactory.CreateWithoutTenant(dbName);
        var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        var (subject, _, _) = SeedEmployed(seed, orgUnit, "Sub", "Ject", "subject@example.com");
        var (manager, _, _) = SeedEmployed(seed, orgUnit, "Man", "Ager", "manager@example.com");
        seed.Add(orgUnit);
        await seed.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = CreateHandler(context, tenantContext);

        var result = await handler.Handle(
            new ChangeEmployeeManagerCommand(subject.Id, subject.Version, manager.Id, Change),
            CancellationToken.None);

        Assert.True(result.IsSuccess);

        var relationship = await context.ManagerRelationships.SingleAsync(
            m => m.SubjectEmployeeId == subject.Id && m.EffectiveTo == null);
        Assert.Equal(manager.Id, relationship.ManagerEmployeeId);
        Assert.Equal(ReportingRelationshipType.PrimaryManager, relationship.Type);
        Assert.Equal(Change, relationship.EffectiveFrom);
    }

    [Fact]
    public async Task Handle_SelfManager_Fails()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using var seed = TestDbContextFactory.CreateWithoutTenant(dbName);
        var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
        var (subject, _, _) = SeedEmployed(seed, orgUnit, "Sub", "Ject", "subject@example.com");
        seed.Add(orgUnit);
        await seed.SaveChangesAsync();

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = CreateHandler(context, tenantContext);

        var result = await handler.Handle(
            new ChangeEmployeeManagerCommand(subject.Id, subject.Version, subject.Id, Change),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Manager.Self", result.Error.Code);
    }

    private static (Employee Employee, Employment Employment, WorkAssignment Assignment) SeedEmployed(
        CoreHRDbContext seed, OrgUnit orgUnit, string first, string last, string email)
    {
        var employee = Employee.Create(TenantId, first, last, email, Hire, employeeNumber: TestEmployeeNumbers.Next());
        var employment = Employment.Start(TenantId, employee.Id, Hire, null, WorkforceSourceType.Manual);
        var assignment = WorkAssignment.Create(
            TenantId, employment.Id, employee.Id, orgUnit.Id, TestCatalog.Job(TenantId, "Engineer"), TestCatalog.Place(TenantId, "HQ"), true, Hire, null, WorkforceSourceType.Manual);
        seed.AddRange(employee, employment, assignment);
        return (employee, employment, assignment);
    }

    private static ChangeEmployeeManagerCommandHandler CreateHandler(
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

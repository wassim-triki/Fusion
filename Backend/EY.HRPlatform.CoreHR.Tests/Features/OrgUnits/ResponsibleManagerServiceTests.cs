using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Exceptions;
using EY.HRPlatform.CoreHR.Features.OrgUnits.Services;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Tests.Features.OrgUnits;

public class ResponsibleManagerServiceTests
{
    private static readonly Guid Tenant = Guid.NewGuid();
    private static readonly Guid OtherTenant = Guid.NewGuid();
    private static readonly DateTime Hire = new(2024, 1, 15, 0, 0, 0, DateTimeKind.Utc);

    private static (CoreHRDbContext Context, ResponsibleManagerService Service) NewService(Guid? tenant = null)
    {
        var tenantContext = TestTenantContext.WithTenant(tenant ?? Tenant);
        var context = TestDbContextFactory.Create(tenantContext);
        var resolver = new WorkforceCanonicalResolver(context);
        return (context, new ResponsibleManagerService(context, tenantContext, resolver, new HttpContextAccessor()));
    }

    private static Employee SeedEmployedManager(CoreHRDbContext context, Guid tenant)
    {
        var employee = Employee.Create(tenant, "Manager", "Doe", $"mgr-{Guid.NewGuid():N}@ey-hr.com", Hire, employeeNumber: TestEmployeeNumbers.Next());
        var employment = Employment.Start(tenant, employee.Id, Hire, null, WorkforceSourceType.Manual);
        context.AddRange(employee, employment);
        return employee;
    }

    [Fact]
    public async Task Validate_NullResponsibleManager_DoesNotThrow()
    {
        var (context, service) = NewService();
        await service.ValidateAsync(null, CancellationToken.None);
        await service.ValidateAsync(Guid.Empty, CancellationToken.None);
        Assert.Equal(0, await context.WorkforceAuditEntries.CountAsync());
    }

    [Fact]
    public async Task Validate_EmployeeWithActiveEmployment_Passes()
    {
        var (context, service) = NewService();
        var manager = SeedEmployedManager(context, Tenant);
        await context.SaveChangesAsync();

        await service.ValidateAsync(manager.Id, CancellationToken.None);
    }

    [Fact]
    public async Task Validate_UnknownEmployee_ThrowsNotFound()
    {
        var (_, service) = NewService();
        await Assert.ThrowsAsync<EntityNotFoundException>(
            () => service.ValidateAsync(Guid.NewGuid(), CancellationToken.None));
    }

    [Fact]
    public async Task Validate_EmployeeWithoutActiveEmployment_ThrowsArgument()
    {
        var (context, service) = NewService();
        var employee = Employee.Create(Tenant, "NoEmp", "Doe", "noemp@ey-hr.com", Hire, employeeNumber: TestEmployeeNumbers.Next());
        context.Add(employee);
        await context.SaveChangesAsync();

        await Assert.ThrowsAsync<ArgumentException>(
            () => service.ValidateAsync(employee.Id, CancellationToken.None));
    }

    [Fact]
    public async Task Validate_CrossTenantEmployee_IsNotFound()
    {
        // Seed an employed manager in another tenant, then validate from this tenant's context.
        var (context, service) = NewService();
        var foreignManager = SeedEmployedManager(context, OtherTenant);
        await context.SaveChangesAsync();

        await Assert.ThrowsAsync<EntityNotFoundException>(
            () => service.ValidateAsync(foreignManager.Id, CancellationToken.None));
    }

    [Fact]
    public async Task StageChangeAudit_WhenChanged_WritesResponsibleManagerChanged()
    {
        var (context, service) = NewService();
        var orgUnitId = Guid.NewGuid();
        var newManager = Guid.NewGuid();

        service.StageChangeAudit(orgUnitId, previous: null, next: newManager);
        await context.SaveChangesAsync();

        var audit = await context.WorkforceAuditEntries.SingleAsync();
        Assert.Equal(WorkforceAuditAction.ResponsibleManagerChanged, audit.Action);
        Assert.Equal("OrgUnit", audit.EntityType);
        Assert.Equal(orgUnitId, audit.EntityId);
    }

    [Fact]
    public async Task StageChangeAudit_WhenUnchanged_WritesNothing()
    {
        var (context, service) = NewService();
        var manager = Guid.NewGuid();

        service.StageChangeAudit(Guid.NewGuid(), previous: manager, next: manager);
        await context.SaveChangesAsync();

        Assert.Equal(0, await context.WorkforceAuditEntries.CountAsync());
    }
}

using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Employees.Dtos;
using EY.HRPlatform.CoreHR.Features.Employees.Queries.GetEmployees;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;

namespace EY.HRPlatform.CoreHR.Tests.Features.Employees;

public class GetEmployeesCanonicalQueryHandlerTests
{
    private static readonly Guid TenantId = Guid.NewGuid();

    [Fact]
    public async Task GetEmployees_UsesCanonicalWorkAssignmentAndManagerFacts()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        var effectiveFrom = DateTime.UtcNow.AddYears(-1);
        Guid managerId;

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
            var manager = Employee.Create(TenantId, "Alex", "Manager", "alex.manager@example.com", employeeNumber: TestEmployeeNumbers.Next());
            var report = Employee.Create(TenantId, "Sam", "Report", "sam.report@example.com", employeeNumber: TestEmployeeNumbers.Next());

            var managerEmployment = Employment.Start(TenantId, manager.Id, effectiveFrom.AddMonths(-3), null, WorkforceSourceType.Manual);
            var reportEmployment = Employment.Start(TenantId, report.Id, effectiveFrom, null, WorkforceSourceType.Manual);
            var managerAssignment = WorkAssignment.Create(TenantId, managerEmployment.Id, manager.Id, orgUnit.Id, TestCatalog.Job(TenantId, "Engineering Manager"), TestCatalog.Place(TenantId, "HQ"), true, managerEmployment.EffectiveFrom, null, WorkforceSourceType.Manual);
            var reportAssignment = WorkAssignment.Create(TenantId, reportEmployment.Id, report.Id, orgUnit.Id, TestCatalog.Job(TenantId, "Engineer"), TestCatalog.Place(TenantId, "Tunis"), true, reportEmployment.EffectiveFrom, null, WorkforceSourceType.Manual);
            var relationship = ManagerRelationship.Create(TenantId, report.Id, manager.Id, reportAssignment.Id, managerAssignment.Id, ReportingRelationshipType.PrimaryManager, effectiveFrom, WorkforceSourceType.Manual);

            seedContext.OrgUnits.Add(orgUnit);
            seedContext.Employees.AddRange(manager, report);
            seedContext.Employments.AddRange(managerEmployment, reportEmployment);
            seedContext.WorkAssignments.AddRange(managerAssignment, reportAssignment);
            seedContext.ManagerRelationships.Add(relationship);
            await seedContext.SaveChangesAsync();

            managerId = manager.Id;
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = CreateHandler(context);

        var result = await handler.Handle(new GetEmployeesQuery(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value.TotalCount);

        var reportItem = Assert.Single(result.Value.Items.Where(item => item.Email == "sam.report@example.com"));
        Assert.Equal(EmployeeStatus.Active, reportItem.Status);
        Assert.Equal("Engineer", reportItem.JobTitle);
        Assert.Equal("Engineering", reportItem.OrgUnitName);
        Assert.Equal(managerId, reportItem.ManagerId);
        Assert.Equal("Alex Manager", reportItem.ManagerName);
    }

    [Fact]
    public async Task GetEmployees_WithManagerFilter_UsesCanonicalRelationships()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        var effectiveFrom = DateTime.UtcNow.AddMonths(-6);

        Guid managerId;
        Guid expectedReportId;

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
            var manager = Employee.Create(TenantId, "Alex", "Manager", "alex.manager@example.com", employeeNumber: TestEmployeeNumbers.Next());
            var report = Employee.Create(TenantId, "Sam", "Report", "sam.report@example.com", employeeNumber: TestEmployeeNumbers.Next());
            var outsider = Employee.Create(TenantId, "Riley", "Peer", "riley.peer@example.com", employeeNumber: TestEmployeeNumbers.Next());

            var managerEmployment = Employment.Start(TenantId, manager.Id, effectiveFrom.AddMonths(-3), null, WorkforceSourceType.Manual);
            var reportEmployment = Employment.Start(TenantId, report.Id, effectiveFrom, null, WorkforceSourceType.Manual);
            var outsiderEmployment = Employment.Start(TenantId, outsider.Id, effectiveFrom, null, WorkforceSourceType.Manual);
            var managerAssignment = WorkAssignment.Create(TenantId, managerEmployment.Id, manager.Id, orgUnit.Id, TestCatalog.Job(TenantId, "Engineering Manager"), TestCatalog.Place(TenantId, null), true, managerEmployment.EffectiveFrom, null, WorkforceSourceType.Manual);
            var reportAssignment = WorkAssignment.Create(TenantId, reportEmployment.Id, report.Id, orgUnit.Id, TestCatalog.Job(TenantId, "Engineer"), TestCatalog.Place(TenantId, null), true, reportEmployment.EffectiveFrom, null, WorkforceSourceType.Manual);
            var outsiderAssignment = WorkAssignment.Create(TenantId, outsiderEmployment.Id, outsider.Id, orgUnit.Id, TestCatalog.Job(TenantId, "Analyst"), TestCatalog.Place(TenantId, null), true, outsiderEmployment.EffectiveFrom, null, WorkforceSourceType.Manual);
            var relationship = ManagerRelationship.Create(TenantId, report.Id, manager.Id, reportAssignment.Id, managerAssignment.Id, ReportingRelationshipType.PrimaryManager, effectiveFrom, WorkforceSourceType.Manual);

            seedContext.OrgUnits.Add(orgUnit);
            seedContext.Employees.AddRange(manager, report, outsider);
            seedContext.Employments.AddRange(managerEmployment, reportEmployment, outsiderEmployment);
            seedContext.WorkAssignments.AddRange(managerAssignment, reportAssignment, outsiderAssignment);
            seedContext.ManagerRelationships.Add(relationship);
            await seedContext.SaveChangesAsync();

            managerId = manager.Id;
            expectedReportId = report.Id;
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = CreateHandler(context);

        var result = await handler.Handle(new GetEmployeesQuery(ManagerId: managerId), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var item = Assert.Single(result.Value.Items);
        Assert.Equal(expectedReportId, item.Id);
        Assert.Equal(managerId, item.ManagerId);
    }

    [Fact]
    public async Task GetEmployees_WithInactiveEmployment_ReturnsInactiveStatus()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        var hireDate = DateTime.UtcNow.AddYears(-2);

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            var employee = Employee.Create(TenantId, "Inactive", "User", "inactive@example.com", employeeNumber: TestEmployeeNumbers.Next());
            var employment = Employment.Start(TenantId, employee.Id, hireDate, null, WorkforceSourceType.Manual);
            employment.End(DateTime.UtcNow.AddDays(-1));

            seedContext.Employees.Add(employee);
            seedContext.Employments.Add(employment);
            await seedContext.SaveChangesAsync();
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = CreateHandler(context);

        var result = await handler.Handle(new GetEmployeesQuery(Status: EmployeeStatus.Inactive), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var item = Assert.Single(result.Value.Items);
        Assert.Equal(EmployeeStatus.Inactive, item.Status);
    }

    private static GetEmployeesQueryHandler CreateHandler(CoreHRDbContext context)
        => new(
            context,
            new EmployeeDetailsReadModelService(
                context,
                new WorkforceCanonicalResolver(context),
                new TenantSettingsReadService(context)),
            new StaticWorkforceAccountStatusReader(new Dictionary<Guid, WorkforceAccountStatusDto>()));

    private sealed class StaticWorkforceAccountStatusReader(
        IReadOnlyDictionary<Guid, WorkforceAccountStatusDto> statuses) : IWorkforceAccountStatusReader
    {
        public Task<IReadOnlyDictionary<Guid, WorkforceAccountStatusDto>> GetStatusesAsync(
            IReadOnlyCollection<WorkforceAccountSubjectDto> subjects,
            CancellationToken cancellationToken)
        {
            var result = statuses
                .Where(entry => subjects.Any(subject => subject.EmployeeId == entry.Key))
                .ToDictionary(entry => entry.Key, entry => entry.Value);

            return Task.FromResult<IReadOnlyDictionary<Guid, WorkforceAccountStatusDto>>(result);
        }
    }
}

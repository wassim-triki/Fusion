using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Employees.Queries.GetEmployeeReportingLines;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;

namespace EY.HRPlatform.CoreHR.Tests.Features.Employees;

public class GetEmployeeReportingLinesQueryHandlerTests
{
    private static readonly Guid TenantId = Guid.NewGuid();

    [Fact]
    public async Task GetEmployeeReportingLines_ReturnsCanonicalManagerChainDirectReportsAndDownline()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        var effectiveFrom = DateTime.UtcNow.AddYears(-1);

        Guid managerId;
        Guid executiveId;
        Guid reportOneId;
        Guid reportTwoId;
        Guid indirectReportId;

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
            var executive = Employee.Create(TenantId, "Emma", "Executive", "emma.executive@example.com", employeeNumber: "TEST-EXEC");
            var manager = Employee.Create(TenantId, "Alex", "Manager", "alex.manager@example.com", employeeNumber: "TEST-MANAGER");
            var reportOne = Employee.Create(TenantId, "Sarah", "Chen", "sarah.chen@example.com", employeeNumber: "TEST-REPORT-1");
            var reportTwo = Employee.Create(TenantId, "Jordan", "Ray", "jordan.ray@example.com", employeeNumber: "TEST-REPORT-2");
            var indirectReport = Employee.Create(TenantId, "Priya", "Singh", "priya.singh@example.com", employeeNumber: "TEST-INDIRECT");

            var executiveEmployment = Employment.Start(TenantId, executive.Id, effectiveFrom.AddMonths(-3), null, WorkforceSourceType.Manual);
            var managerEmployment = Employment.Start(TenantId, manager.Id, effectiveFrom.AddMonths(-2), null, WorkforceSourceType.Manual);
            var reportOneEmployment = Employment.Start(TenantId, reportOne.Id, effectiveFrom.AddMonths(-1), null, WorkforceSourceType.Manual);
            var reportTwoEmployment = Employment.Start(TenantId, reportTwo.Id, effectiveFrom.AddMonths(-1), null, WorkforceSourceType.Manual);
            var indirectEmployment = Employment.Start(TenantId, indirectReport.Id, effectiveFrom, null, WorkforceSourceType.Manual);

            var executiveAssignment = WorkAssignment.Create(TenantId, executiveEmployment.Id, executive.Id, orgUnit.Id, TestCatalog.Job(TenantId, "Executive"), TestCatalog.Place(TenantId, null), true, executiveEmployment.EffectiveFrom, null, WorkforceSourceType.Manual);
            var managerAssignment = WorkAssignment.Create(TenantId, managerEmployment.Id, manager.Id, orgUnit.Id, TestCatalog.Job(TenantId, "Manager"), TestCatalog.Place(TenantId, null), true, managerEmployment.EffectiveFrom, null, WorkforceSourceType.Manual);
            var reportOneAssignment = WorkAssignment.Create(TenantId, reportOneEmployment.Id, reportOne.Id, orgUnit.Id, TestCatalog.Job(TenantId, "Engineer"), TestCatalog.Place(TenantId, null), true, reportOneEmployment.EffectiveFrom, null, WorkforceSourceType.Manual);
            var reportTwoAssignment = WorkAssignment.Create(TenantId, reportTwoEmployment.Id, reportTwo.Id, orgUnit.Id, TestCatalog.Job(TenantId, "Engineer"), TestCatalog.Place(TenantId, null), true, reportTwoEmployment.EffectiveFrom, null, WorkforceSourceType.Manual);
            var indirectAssignment = WorkAssignment.Create(TenantId, indirectEmployment.Id, indirectReport.Id, orgUnit.Id, TestCatalog.Job(TenantId, "Analyst"), TestCatalog.Place(TenantId, null), true, indirectEmployment.EffectiveFrom, null, WorkforceSourceType.Manual);

            var managerToExecutive = ManagerRelationship.Create(TenantId, manager.Id, executive.Id, managerAssignment.Id, executiveAssignment.Id, ReportingRelationshipType.PrimaryManager, managerEmployment.EffectiveFrom, WorkforceSourceType.Manual);
            var reportOneToManager = ManagerRelationship.Create(TenantId, reportOne.Id, manager.Id, reportOneAssignment.Id, managerAssignment.Id, ReportingRelationshipType.PrimaryManager, reportOneEmployment.EffectiveFrom, WorkforceSourceType.Manual);
            var reportTwoToManager = ManagerRelationship.Create(TenantId, reportTwo.Id, manager.Id, reportTwoAssignment.Id, managerAssignment.Id, ReportingRelationshipType.PrimaryManager, reportTwoEmployment.EffectiveFrom, WorkforceSourceType.Manual);
            var indirectToReportOne = ManagerRelationship.Create(TenantId, indirectReport.Id, reportOne.Id, indirectAssignment.Id, reportOneAssignment.Id, ReportingRelationshipType.PrimaryManager, indirectEmployment.EffectiveFrom, WorkforceSourceType.Manual);

            seedContext.OrgUnits.Add(orgUnit);
            seedContext.Employees.AddRange(executive, manager, reportOne, reportTwo, indirectReport);
            seedContext.Employments.AddRange(executiveEmployment, managerEmployment, reportOneEmployment, reportTwoEmployment, indirectEmployment);
            seedContext.WorkAssignments.AddRange(executiveAssignment, managerAssignment, reportOneAssignment, reportTwoAssignment, indirectAssignment);
            seedContext.ManagerRelationships.AddRange(managerToExecutive, reportOneToManager, reportTwoToManager, indirectToReportOne);
            await seedContext.SaveChangesAsync();

            managerId = manager.Id;
            executiveId = executive.Id;
            reportOneId = reportOne.Id;
            reportTwoId = reportTwo.Id;
            indirectReportId = indirectReport.Id;
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = CreateHandler(context);

        var result = await handler.Handle(new GetEmployeeReportingLinesQuery(managerId), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(managerId, result.Value.Employee.Id);
        Assert.Equal(2, result.Value.DirectReportCount);
        Assert.Equal(3, result.Value.DownlineCount);

        var managerChainItem = Assert.Single(result.Value.ManagerChain);
        Assert.Equal(executiveId, managerChainItem.Employee.Id);
        Assert.Equal(1, managerChainItem.Depth);

        Assert.Equal(2, result.Value.DirectReports.Count);
        Assert.Contains(result.Value.DirectReports, node => node.Employee.Id == reportOneId && node.Depth == 1);
        Assert.Contains(result.Value.DirectReports, node => node.Employee.Id == reportTwoId && node.Depth == 1);
        Assert.Contains(result.Value.Downline, node => node.Employee.Id == indirectReportId && node.Depth == 2);
    }

    [Fact]
    public async Task GetEmployeeReportingLines_WithoutManager_ReturnsExplicitNoManagerState()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        Guid employeeId;

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            var employee = Employee.Create(TenantId, "Solo", "Leader", "solo.leader@example.com", employeeNumber: "TEST-SOLO");
            seedContext.Employees.Add(employee);
            await seedContext.SaveChangesAsync();
            employeeId = employee.Id;
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = CreateHandler(context);

        var result = await handler.Handle(new GetEmployeeReportingLinesQuery(employeeId), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("NoManagerAssigned", result.Value.Employee.HierarchyStatus);
        Assert.Empty(result.Value.ManagerChain);
        Assert.Empty(result.Value.DirectReports);
        Assert.Empty(result.Value.Downline);
    }

    private static GetEmployeeReportingLinesQueryHandler CreateHandler(CoreHRDbContext context)
        => new(
            context,
            new EmployeeDetailsReadModelService(
                context,
                new WorkforceCanonicalResolver(context),
                new TenantSettingsReadService(context)),
            new WorkforceCanonicalResolver(context));
}

using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Employees.Dtos;

using EY.HRPlatform.CoreHR.Features.Employees.Queries.GetWorkforceReadinessSummary;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;

namespace EY.HRPlatform.CoreHR.Tests.Features.Employees;

public class GetWorkforceReadinessSummaryQueryHandlerTests
{
    private static readonly Guid TenantId = Guid.NewGuid();

    [Fact]
    public async Task GetWorkforceReadinessSummary_ComputesScoreAndCanonicalCounts()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        var now = DateTime.UtcNow;

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            var orgUnit = OrgUnit.Create(TenantId, "EXEC", "Executive", "Department", null);

            // leader: has Employment + primary WorkAssignment, no manager, has 1 direct report
            var leader = Employee.Create(TenantId, "Emma", "Executive", "emma.executive@example.com", now, employeeNumber: TestEmployeeNumbers.Next());
            var leaderEmployment = Employment.Start(TenantId, leader.Id, now.AddMonths(-6), null, WorkforceSourceType.Manual);
            var leaderAssignment = WorkAssignment.Create(
                TenantId, leaderEmployment.Id, leader.Id, orgUnit.Id,
                TestCatalog.Job(TenantId, "Chief People Officer"), TestCatalog.Place(TenantId, null), true,
                now.AddMonths(-6), null, WorkforceSourceType.Manual);

            // report: has Employment + primary WorkAssignment + ManagerRelationship → leader
            var report = Employee.Create(TenantId, "Casey", "Report", "casey.report@example.com", now, employeeNumber: TestEmployeeNumbers.Next());
            var reportEmployment = Employment.Start(TenantId, report.Id, now.AddMonths(-3), null, WorkforceSourceType.Manual);
            var reportAssignment = WorkAssignment.Create(
                TenantId, reportEmployment.Id, report.Id, orgUnit.Id,
                TestCatalog.Job(TenantId, "People Partner"), TestCatalog.Place(TenantId, null), true,
                now.AddMonths(-3), null, WorkforceSourceType.Manual);
            var reportManagerLink = ManagerRelationship.Create(
                TenantId, report.Id, leader.Id,
                reportAssignment.Id, leaderAssignment.Id,
                ReportingRelationshipType.PrimaryManager,
                now.AddMonths(-3), WorkforceSourceType.Manual);

            // missingOrgUnit: has Employment only — no WorkAssignment, no manager → MissingOrgUnit + NoManagerAssigned
            var missingOrgUnit = Employee.Create(TenantId, "Jordan", "Solo", "jordan.solo@example.com", now, employeeNumber: TestEmployeeNumbers.Next());
            var missingOrgUnitEmployment = Employment.Start(TenantId, missingOrgUnit.Id, now.AddMonths(-1), null, WorkforceSourceType.Manual);

            seedContext.OrgUnits.Add(orgUnit);
            seedContext.Employees.AddRange(leader, report, missingOrgUnit);
            seedContext.Employments.AddRange(leaderEmployment, reportEmployment, missingOrgUnitEmployment);
            seedContext.WorkAssignments.AddRange(leaderAssignment, reportAssignment);
            seedContext.ManagerRelationships.Add(reportManagerLink);

            await seedContext.SaveChangesAsync();
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var handler = new GetWorkforceReadinessSummaryQueryHandler(context, new TenantSettingsReadService(context));

        var result = await handler.Handle(new GetWorkforceReadinessSummaryQuery(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(3, result.Value.ActiveEmployeeCount);
        Assert.Equal(2, result.Value.ReadyEmployeeCount);
        Assert.Equal(1, result.Value.EmployeesNeedingAttention);
        Assert.Equal(66.7m, result.Value.ReadinessScore);
        Assert.Equal(1, result.Value.IssueCounts.MissingOrgUnit);
        Assert.Equal(1, result.Value.IssueCounts.NoManagerAssigned);
        Assert.Equal(1, result.Value.IssueCounts.DeactivationBlocked);
        Assert.Equal(0, result.Value.IssueCounts.UnresolvedImportIssues); // legacy import follow-up product retired
    }
}

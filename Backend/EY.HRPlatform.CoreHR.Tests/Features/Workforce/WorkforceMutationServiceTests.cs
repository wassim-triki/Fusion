using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Tests.Features.Workforce;

public class WorkforceMutationServiceTests
{
    private static readonly Guid Tenant = Guid.NewGuid();
    private static readonly DateTime Hire = new(2024, 1, 15, 0, 0, 0, DateTimeKind.Utc);
    private const string Actor = "admin@ey-hr.com";

    private static (CoreHRDbContext Context, WorkforceMutationService Service) NewService()
    {
        var tenantContext = TestTenantContext.WithTenant(Tenant);
        var context = TestDbContextFactory.Create(tenantContext);
        var resolver = new WorkforceCanonicalResolver(context);
        return (context, new WorkforceMutationService(context, tenantContext, resolver));
    }

    private static OrgUnit SeedOrgUnit(string code = "ENG", bool active = true)
    {
        var org = OrgUnit.Create(Tenant, code, $"{code} Unit", "Department", parentId: null);
        if (!active)
            org.Deactivate();
        return org;
    }

    private static Employee SeedEmployee(string first)
        => Employee.Create(Tenant, first, "Doe", $"{first}@ey-hr.com", Hire, employeeNumber: TestEmployeeNumbers.Next());

    /// <summary>Seeds an employee with an active employment + active primary work assignment.</summary>
    private static async Task<(Employee Employee, Employment Employment, WorkAssignment Assignment)> SeedEmployedAsync(
        CoreHRDbContext context, string first, Guid orgUnitId, DateTime? from = null)
    {
        var effectiveFrom = from ?? Hire;
        var employee = SeedEmployee(first);
        var employment = Employment.Start(Tenant, employee.Id, effectiveFrom, null, WorkforceSourceType.Manual);
        var assignment = WorkAssignment.Create(
            Tenant, employment.Id, employee.Id, orgUnitId, TestCatalog.Job(Tenant, "Engineer"), TestCatalog.Place(Tenant, "HQ"),
            isPrimary: true, effectiveFrom, effectiveTo: null, WorkforceSourceType.Manual);
        context.AddRange(employee, employment, assignment);
        await context.SaveChangesAsync();
        return (employee, employment, assignment);
    }

    // --- UpdateEmployeeProfile -----------------------------------------------------------------

    [Fact]
    public async Task UpdateEmployeeProfile_UpdatesIdentityFields_AndWritesAudit()
    {
        var (context, service) = NewService();
        var employee = SeedEmployee("Ada");
        context.Add(employee);
        await context.SaveChangesAsync();

        var result = await service.UpdateEmployeeProfileAsync(
            employee.Id,
            new UpdateEmployeeProfileInput("Augusta", "Lovelace", "AUGUSTA@EY-HR.com", "Ada", "+1 555"),
            Actor, CancellationToken.None);
        await context.SaveChangesAsync();

        Assert.True(result.IsSuccess);
        var stored = await context.Employees.SingleAsync(e => e.Id == employee.Id);
        Assert.Equal("Augusta", stored.FirstName);
        Assert.Equal("augusta@ey-hr.com", stored.Email);
        Assert.Equal("Ada", stored.PreferredName);

        var audit = await context.WorkforceAuditEntries.SingleAsync();
        Assert.Equal(WorkforceAuditAction.EmployeeProfileUpdated, audit.Action);
        Assert.Equal("Employee", audit.EntityType);
        Assert.Equal(Actor, audit.Actor);
    }

    [Fact]
    public async Task UpdateEmployeeProfile_MissingEmployee_Fails()
    {
        var (_, service) = NewService();
        var result = await service.UpdateEmployeeProfileAsync(
            Guid.NewGuid(), new UpdateEmployeeProfileInput("A", "B", "a@b.com", null, null),
            Actor, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Employee.NotFound", result.Error.Code);
    }

    [Fact]
    public async Task UpdateEmployeeProfile_DuplicateEmail_Fails()
    {
        var (context, service) = NewService();
        var first = SeedEmployee("Grace");
        var second = SeedEmployee("Edsger");
        // Grace actively occupies grace@ey-hr.com; Edsger is actively employed so his email change is subject to occupancy.
        var secondEmployment = Employment.Start(Tenant, second.Id, Hire, null, WorkforceSourceType.Manual);
        context.AddRange(first, second, secondEmployment);
        context.WorkEmailOccupancies.Add(WorkEmailOccupancy.Create(Tenant, first.Id, "grace@ey-hr.com"));
        await context.SaveChangesAsync();

        var result = await service.UpdateEmployeeProfileAsync(
            second.Id, new UpdateEmployeeProfileInput("Edsger", "Dijkstra", "grace@ey-hr.com", null, null),
            Actor, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Employee.EmailOccupied", result.Error.Code);
    }

    // --- StartEmployment -----------------------------------------------------------------------

    [Fact]
    public async Task StartEmployment_CreatesActiveEmployment_AndWritesAudit()
    {
        var (context, service) = NewService();
        var employee = SeedEmployee("Linus");
        context.Add(employee);
        await context.SaveChangesAsync();

        var result = await service.StartEmploymentAsync(
            employee.Id, new StartEmploymentInput(Hire, null), Actor, CancellationToken.None);
        await context.SaveChangesAsync();

        Assert.True(result.IsSuccess);
        Assert.Equal(EmploymentStatus.Active, result.Value.Status);
        Assert.Null(result.Value.EffectiveTo);

        var audit = await context.WorkforceAuditEntries.SingleAsync();
        Assert.Equal(WorkforceAuditAction.EmploymentStarted, audit.Action);
        Assert.Equal(Hire, audit.EffectiveDate);
    }

    [Fact]
    public async Task StartEmployment_WhenAlreadyActive_Fails()
    {
        var (context, service) = NewService();
        var org = SeedOrgUnit();
        context.Add(org);
        await context.SaveChangesAsync();
        var (employee, _, _) = await SeedEmployedAsync(context, "Ken", org.Id);

        var result = await service.StartEmploymentAsync(
            employee.Id, new StartEmploymentInput(Hire.AddYears(1), null), Actor, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Employment.AlreadyActive", result.Error.Code);
    }

    // --- EndEmployment -------------------------------------------------------------------------

    [Fact]
    public async Task EndEmployment_ClosesActiveEmployment_AndWritesAudit()
    {
        var (context, service) = NewService();
        var org = SeedOrgUnit();
        context.Add(org);
        await context.SaveChangesAsync();
        var (employee, employment, _) = await SeedEmployedAsync(context, "Dennis", org.Id);
        var endDate = Hire.AddYears(1);

        var result = await service.EndEmploymentAsync(employee.Id, endDate, Actor, CancellationToken.None);
        await context.SaveChangesAsync();

        Assert.True(result.IsSuccess);
        var stored = await context.Employments.SingleAsync(e => e.Id == employment.Id);
        Assert.Equal(EmploymentStatus.Ended, stored.Status);
        Assert.Equal(endDate, stored.EffectiveTo);

        var audit = await context.WorkforceAuditEntries.SingleAsync();
        Assert.Equal(WorkforceAuditAction.EmploymentEnded, audit.Action);
    }

    [Fact]
    public async Task EndEmployment_WithNoActiveEmployment_Fails()
    {
        var (context, service) = NewService();
        var employee = SeedEmployee("Brian");
        context.Add(employee);
        await context.SaveChangesAsync();

        var result = await service.EndEmploymentAsync(employee.Id, Hire.AddYears(1), Actor, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Employment.NoActive", result.Error.Code);
    }

    [Fact]
    public async Task TerminateEmployee_EndsEmploymentAssignmentAndSubjectSideManagerLink_WithoutClosingManagerSideLinks()
    {
        var (context, service) = NewService();
        var org = SeedOrgUnit();
        context.Add(org);
        await context.SaveChangesAsync();

        var (manager, _, managerAssignment) = await SeedEmployedAsync(context, "Manager", org.Id);
        var (employee, employment, assignment) = await SeedEmployedAsync(context, "Employee", org.Id);
        var (report, _, reportAssignment) = await SeedEmployedAsync(context, "Report", org.Id);

        var employeeManagerRelationship = ManagerRelationship.Create(
            Tenant,
            employee.Id,
            manager.Id,
            assignment.Id,
            managerAssignment.Id,
            ReportingRelationshipType.PrimaryManager,
            Hire.AddMonths(1),
            WorkforceSourceType.Manual);
        var reportRelationship = ManagerRelationship.Create(
            Tenant,
            report.Id,
            employee.Id,
            reportAssignment.Id,
            assignment.Id,
            ReportingRelationshipType.PrimaryManager,
            Hire.AddMonths(2),
            WorkforceSourceType.Manual);
        reportRelationship.End(Hire.AddMonths(5));
        context.ManagerRelationships.AddRange(employeeManagerRelationship, reportRelationship);
        await context.SaveChangesAsync();

        var terminationDate = Hire.AddMonths(6);
        var result = await service.TerminateEmployeeAsync(
            employee.Id,
            new TerminateEmployeeInput(terminationDate, "Voluntary termination"),
            Actor,
            CancellationToken.None);
        await context.SaveChangesAsync();

        Assert.True(result.IsSuccess);

        var storedEmployment = await context.Employments.SingleAsync(e => e.Id == employment.Id);
        var storedAssignment = await context.WorkAssignments.SingleAsync(w => w.Id == assignment.Id);
        var storedEmployeeRelationship = await context.ManagerRelationships.SingleAsync(m => m.Id == employeeManagerRelationship.Id);
        var storedReportRelationship = await context.ManagerRelationships.SingleAsync(m => m.Id == reportRelationship.Id);
        var audit = await context.WorkforceAuditEntries.SingleAsync();

        Assert.Equal(terminationDate, storedEmployment.EffectiveTo);
        Assert.Equal(EmploymentStatus.Ended, storedEmployment.Status);
        Assert.Equal(terminationDate, storedAssignment.EffectiveTo);
        Assert.Equal(terminationDate, storedEmployeeRelationship.EffectiveTo);
        Assert.Equal(Hire.AddMonths(5), storedReportRelationship.EffectiveTo);
        Assert.Equal(WorkforceAuditAction.EmploymentEnded, audit.Action);
        Assert.Contains("Voluntary termination", audit.ChangeDetails, StringComparison.Ordinal);
    }

    [Fact]
    public async Task TerminateEmployee_WithActiveDirectReports_FailsAndIdentifiesBlockedEmployees()
    {
        var (context, service) = NewService();
        var org = SeedOrgUnit();
        context.Add(org);
        await context.SaveChangesAsync();

        var (manager, _, managerAssignment) = await SeedEmployedAsync(context, "Manager", org.Id);
        var (reportA, _, reportAssignmentA) = await SeedEmployedAsync(context, "Alice", org.Id);
        var (reportB, _, reportAssignmentB) = await SeedEmployedAsync(context, "Ben", org.Id);

        context.ManagerRelationships.AddRange(
            ManagerRelationship.Create(
                Tenant,
                reportA.Id,
                manager.Id,
                reportAssignmentA.Id,
                managerAssignment.Id,
                ReportingRelationshipType.PrimaryManager,
                Hire.AddMonths(1),
                WorkforceSourceType.Manual),
            ManagerRelationship.Create(
                Tenant,
                reportB.Id,
                manager.Id,
                reportAssignmentB.Id,
                managerAssignment.Id,
                ReportingRelationshipType.PrimaryManager,
                Hire.AddMonths(2),
                WorkforceSourceType.Manual));
        await context.SaveChangesAsync();

        var terminationDate = Hire.AddMonths(6);
        var result = await service.TerminateEmployeeAsync(
            manager.Id,
            new TerminateEmployeeInput(terminationDate),
            Actor,
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Employment.TerminationBlockedByDirectReports", result.Error.Code);
        Assert.Contains("Alice Doe", result.Error.Message, StringComparison.Ordinal);
        Assert.Contains("Ben Doe", result.Error.Message, StringComparison.Ordinal);
        Assert.Equal(0, await context.WorkforceAuditEntries.CountAsync());
    }

    [Fact]
    public async Task TerminateEmployee_AfterDirectReportsReassignedEffectiveSameDate_Succeeds()
    {
        var (context, service) = NewService();
        var org = SeedOrgUnit();
        context.Add(org);
        await context.SaveChangesAsync();

        var (terminatingManager, _, terminatingAssignment) = await SeedEmployedAsync(context, "Manager", org.Id);
        var (replacementManager, _, replacementAssignment) = await SeedEmployedAsync(context, "Replacement", org.Id);
        var (report, employment, reportAssignment) = await SeedEmployedAsync(context, "Report", org.Id);

        var originalRelationship = ManagerRelationship.Create(
            Tenant,
            report.Id,
            terminatingManager.Id,
            reportAssignment.Id,
            terminatingAssignment.Id,
            ReportingRelationshipType.PrimaryManager,
            Hire.AddMonths(1),
            WorkforceSourceType.Manual);
        context.ManagerRelationships.Add(originalRelationship);
        await context.SaveChangesAsync();

        var reassignmentDate = Hire.AddMonths(6);
        originalRelationship.End(reassignmentDate);
        context.ManagerRelationships.Add(ManagerRelationship.Create(
            Tenant,
            report.Id,
            replacementManager.Id,
            reportAssignment.Id,
            replacementAssignment.Id,
            ReportingRelationshipType.PrimaryManager,
            reassignmentDate,
            WorkforceSourceType.Manual));
        await context.SaveChangesAsync();

        var result = await service.TerminateEmployeeAsync(
            terminatingManager.Id,
            new TerminateEmployeeInput(reassignmentDate),
            Actor,
            CancellationToken.None);
        await context.SaveChangesAsync();

        Assert.True(result.IsSuccess);

        var storedEmployment = await context.Employments.SingleAsync(e => e.EmployeeId == terminatingManager.Id);
        Assert.Equal(reassignmentDate, storedEmployment.EffectiveTo);
    }

    [Fact]
    public async Task TerminateEmployee_WithNoActiveEmployment_FailsWithoutAudit()
    {
        var (context, service) = NewService();
        var employee = SeedEmployee("Former");
        context.Add(employee);
        await context.SaveChangesAsync();

        var result = await service.TerminateEmployeeAsync(
            employee.Id,
            new TerminateEmployeeInput(Hire.AddYears(1)),
            Actor,
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Employment.NoActive", result.Error.Code);
        Assert.Equal(0, await context.WorkforceAuditEntries.CountAsync());
    }

    // --- ChangeWorkAssignment ------------------------------------------------------------------

    [Fact]
    public async Task ChangeWorkAssignment_FirstAssignment_RecordsCreated()
    {
        var (context, service) = NewService();
        var org = SeedOrgUnit();
        var employee = SeedEmployee("Margaret");
        var employment = Employment.Start(Tenant, employee.Id, Hire, null, WorkforceSourceType.Manual);
        context.AddRange(org, employee, employment);
        await context.SaveChangesAsync();

        var result = await service.ChangeWorkAssignmentAsync(
            employee.Id, new ChangeWorkAssignmentInput(org.Id, context.JobId(Tenant, "Engineer"), context.PlaceId(Tenant, "HQ"), Hire),
            Actor, CancellationToken.None);
        await context.SaveChangesAsync();

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.IsPrimary);
        var audit = await context.WorkforceAuditEntries.SingleAsync();
        Assert.Equal(WorkforceAuditAction.WorkAssignmentCreated, audit.Action);
    }

    [Fact]
    public async Task ChangeWorkAssignment_ClosesCurrentAndSucceeds()
    {
        var (context, service) = NewService();
        var org = SeedOrgUnit();
        var newOrg = SeedOrgUnit("OPS");
        context.AddRange(org, newOrg);
        await context.SaveChangesAsync();
        var (employee, _, original) = await SeedEmployedAsync(context, "Tim", org.Id);
        var changeDate = Hire.AddMonths(6);

        var result = await service.ChangeWorkAssignmentAsync(
            employee.Id, new ChangeWorkAssignmentInput(newOrg.Id, context.JobId(Tenant, "Lead Engineer"), context.PlaceId(Tenant, "Remote"), changeDate),
            Actor, CancellationToken.None);
        await context.SaveChangesAsync();

        Assert.True(result.IsSuccess);
        var closed = await context.WorkAssignments.SingleAsync(w => w.Id == original.Id);
        Assert.Equal(changeDate, closed.EffectiveTo);
        Assert.Equal(changeDate, result.Value.EffectiveFrom);
        Assert.Equal(newOrg.Id, result.Value.OrgUnitId);

        var audit = await context.WorkforceAuditEntries
            .SingleAsync(a => a.Action == WorkforceAuditAction.WorkAssignmentChanged);
        Assert.Equal(changeDate, audit.EffectiveDate);
    }

    [Fact]
    public async Task ChangeWorkAssignment_InactiveOrgUnit_Fails()
    {
        var (context, service) = NewService();
        var inactiveOrg = SeedOrgUnit("DEAD", active: false);
        var employee = SeedEmployee("Vint");
        var employment = Employment.Start(Tenant, employee.Id, Hire, null, WorkforceSourceType.Manual);
        context.AddRange(inactiveOrg, employee, employment);
        await context.SaveChangesAsync();

        var result = await service.ChangeWorkAssignmentAsync(
            employee.Id, new ChangeWorkAssignmentInput(inactiveOrg.Id, context.JobId(Tenant, "Engineer"), context.PlaceId(Tenant, null), Hire),
            Actor, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("WorkAssignment.OrgUnitInactive", result.Error.Code);
    }

    [Fact]
    public async Task ChangeWorkAssignment_NoActiveEmployment_Fails()
    {
        var (context, service) = NewService();
        var org = SeedOrgUnit();
        var employee = SeedEmployee("Robert");
        context.AddRange(org, employee);
        await context.SaveChangesAsync();

        var result = await service.ChangeWorkAssignmentAsync(
            employee.Id, new ChangeWorkAssignmentInput(org.Id, context.JobId(Tenant, "Engineer"), context.PlaceId(Tenant, null), Hire),
            Actor, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("WorkAssignment.NoActiveEmployment", result.Error.Code);
    }

    // --- ChangeManager -------------------------------------------------------------------------

    [Fact]
    public async Task ChangeManager_FirstManager_RecordsManagerChanged()
    {
        var (context, service) = NewService();
        var org = SeedOrgUnit();
        context.Add(org);
        await context.SaveChangesAsync();
        var (manager, _, _) = await SeedEmployedAsync(context, "Sheryl", org.Id);
        var (report, _, _) = await SeedEmployedAsync(context, "Mark", org.Id);

        var result = await service.ChangeManagerAsync(
            report.Id, new ChangeManagerInput(manager.Id, Hire.AddMonths(1)), Actor, CancellationToken.None);
        await context.SaveChangesAsync();

        Assert.True(result.IsSuccess);
        Assert.Equal(manager.Id, result.Value.ManagerEmployeeId);
        Assert.Equal(ReportingRelationshipType.PrimaryManager, result.Value.Type);
        var audit = await context.WorkforceAuditEntries.SingleAsync();
        Assert.Equal(WorkforceAuditAction.ManagerChanged, audit.Action);
    }

    [Fact]
    public async Task ChangeManager_ClosesCurrentAndReassigns()
    {
        var (context, service) = NewService();
        var org = SeedOrgUnit();
        context.Add(org);
        await context.SaveChangesAsync();
        var (firstMgr, _, _) = await SeedEmployedAsync(context, "Alan", org.Id);
        var (secondMgr, _, _) = await SeedEmployedAsync(context, "Barbara", org.Id);
        var (report, _, _) = await SeedEmployedAsync(context, "Clara", org.Id);

        await service.ChangeManagerAsync(report.Id, new ChangeManagerInput(firstMgr.Id, Hire.AddMonths(1)), Actor, CancellationToken.None);
        await context.SaveChangesAsync();

        var changeDate = Hire.AddMonths(3);
        var result = await service.ChangeManagerAsync(report.Id, new ChangeManagerInput(secondMgr.Id, changeDate), Actor, CancellationToken.None);
        await context.SaveChangesAsync();

        Assert.True(result.IsSuccess);
        var relationships = await context.ManagerRelationships
            .Where(m => m.SubjectEmployeeId == report.Id)
            .OrderBy(m => m.EffectiveFrom)
            .ToListAsync();
        Assert.Equal(2, relationships.Count);
        Assert.Equal(changeDate, relationships[0].EffectiveTo);
        Assert.Null(relationships[1].EffectiveTo);
        Assert.Equal(secondMgr.Id, relationships[1].ManagerEmployeeId);
    }

    [Fact]
    public async Task ChangeManager_Self_Fails()
    {
        var (context, service) = NewService();
        var org = SeedOrgUnit();
        context.Add(org);
        await context.SaveChangesAsync();
        var (employee, _, _) = await SeedEmployedAsync(context, "Self", org.Id);

        var result = await service.ChangeManagerAsync(
            employee.Id, new ChangeManagerInput(employee.Id, Hire.AddMonths(1)), Actor, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Manager.Self", result.Error.Code);
    }

    [Fact]
    public async Task ChangeManager_Cycle_Fails()
    {
        var (context, service) = NewService();
        var org = SeedOrgUnit();
        context.Add(org);
        await context.SaveChangesAsync();
        var (top, _, _) = await SeedEmployedAsync(context, "Top", org.Id);
        var (bottom, _, _) = await SeedEmployedAsync(context, "Bottom", org.Id);

        // bottom -> top exists; now try top -> bottom, which would form a cycle.
        await service.ChangeManagerAsync(bottom.Id, new ChangeManagerInput(top.Id, Hire.AddMonths(1)), Actor, CancellationToken.None);
        await context.SaveChangesAsync();

        var result = await service.ChangeManagerAsync(
            top.Id, new ChangeManagerInput(bottom.Id, Hire.AddMonths(2)), Actor, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Manager.Cycle", result.Error.Code);
    }

    [Fact]
    public async Task ChangeManager_ManagerWithoutAssignment_Fails()
    {
        var (context, service) = NewService();
        var org = SeedOrgUnit();
        context.Add(org);
        await context.SaveChangesAsync();
        var (report, _, _) = await SeedEmployedAsync(context, "Report", org.Id);
        var unassignedManager = SeedEmployee("Ghost");
        context.Add(unassignedManager);
        await context.SaveChangesAsync();

        var result = await service.ChangeManagerAsync(
            report.Id, new ChangeManagerInput(unassignedManager.Id, Hire.AddMonths(1)), Actor, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Manager.NoManagerAssignment", result.Error.Code);
    }

    [Fact]
    public async Task FailedOperation_StagesNoAuditEntry()
    {
        var (context, service) = NewService();
        var employee = SeedEmployee("NoAudit");
        context.Add(employee);
        await context.SaveChangesAsync();

        var result = await service.EndEmploymentAsync(employee.Id, Hire.AddYears(1), Actor, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(0, await context.WorkforceAuditEntries.CountAsync());
    }
}

using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Controllers;
using EY.HRPlatform.CoreHR.Features.Workforce.Dtos;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Security;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.CoreHR.Tests.Features.Workforce;

public sealed class InternalWorkforceSnapshotServiceTests
{
    [Fact]
    public async Task ResolveEmployeesAsync_ResolvesJobOrgAndManagerFromCanonicalFactsAsOfDate()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));
        var start = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var changeDate = new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc);
        var asOf = changeDate.AddDays(-1);

        var engineering = OrgUnit.Create(tenantId, "ENG", "Engineering", "Department", null);
        var operations = OrgUnit.Create(tenantId, "OPS", "Operations", "Department", null);
        var managerA = Employee.Create(tenantId, "Maya", "Lead", "maya@example.com", start, employeeNumber: TestEmployeeNumbers.Next());
        var managerB = Employee.Create(tenantId, "Omar", "Director", "omar@example.com", start, employeeNumber: TestEmployeeNumbers.Next());
        var employee = Employee.Create(tenantId, "Alice", "Adams", "alice@example.com", start, employeeNumber: TestEmployeeNumbers.Next());
        db.AddRange(engineering, operations, managerA, managerB, employee);
        await db.SaveChangesAsync();

        var managerAEmployment = Employment.Start(tenantId, managerA.Id, start, null, WorkforceSourceType.Manual);
        var managerBEmployment = Employment.Start(tenantId, managerB.Id, start, null, WorkforceSourceType.Manual);
        var employeeEmployment = Employment.Start(tenantId, employee.Id, start, null, WorkforceSourceType.Manual);
        db.AddRange(managerAEmployment, managerBEmployment, employeeEmployment);
        await db.SaveChangesAsync();

        var managerAAssignment = WorkAssignment.Create(tenantId, managerAEmployment.Id, managerA.Id, engineering.Id, TestCatalog.Job(tenantId, "Manager"), TestCatalog.Place(tenantId, null), true, start, null, WorkforceSourceType.Manual);
        var managerBAssignment = WorkAssignment.Create(tenantId, managerBEmployment.Id, managerB.Id, operations.Id, TestCatalog.Job(tenantId, "Director"), TestCatalog.Place(tenantId, null), true, start, null, WorkforceSourceType.Manual);
        var employeeOriginalAssignment = WorkAssignment.Create(tenantId, employeeEmployment.Id, employee.Id, engineering.Id, TestCatalog.Job(tenantId, "Engineer"), TestCatalog.Place(tenantId, null), true, start, changeDate, WorkforceSourceType.Manual);
        var employeeFutureAssignment = WorkAssignment.Create(tenantId, employeeEmployment.Id, employee.Id, operations.Id, TestCatalog.Job(tenantId, "Senior Engineer"), TestCatalog.Place(tenantId, null), true, changeDate, null, WorkforceSourceType.Manual);
        db.AddRange(managerAAssignment, managerBAssignment, employeeOriginalAssignment, employeeFutureAssignment);
        await db.SaveChangesAsync();

        var originalManager = ManagerRelationship.Create(
            tenantId,
            employee.Id,
            managerA.Id,
            employeeOriginalAssignment.Id,
            managerAAssignment.Id,
            ReportingRelationshipType.PrimaryManager,
            start,
            WorkforceSourceType.Manual,
            effectiveTo: changeDate);
        var futureManager = ManagerRelationship.Create(
            tenantId,
            employee.Id,
            managerB.Id,
            employeeFutureAssignment.Id,
            managerBAssignment.Id,
            ReportingRelationshipType.PrimaryManager,
            changeDate,
            WorkforceSourceType.Manual);
        db.AddRange(originalManager, futureManager);
        await db.SaveChangesAsync();

        var snapshots = await new InternalWorkforceSnapshotService(db)
            .ResolveEmployeesAsync(asOf, [employee.Id], CancellationToken.None);

        var snapshot = Assert.Single(snapshots);
        Assert.True(snapshot.IsActive);
        Assert.Equal("Engineer", snapshot.JobTitle);
        Assert.Equal(engineering.Id, snapshot.OrgUnit!.OrgUnitId);
        Assert.Equal("Engineering", snapshot.OrgUnit.Name);
        Assert.Equal(managerA.Id, snapshot.Manager!.EmployeeId);
        Assert.Equal("Maya Lead", snapshot.Manager.DisplayName);
    }

    [Fact]
    public async Task GetAllActiveAsOfAsync_ReturnsActiveEmployeeWithNoPrimaryAssignment_WithNullOrgUnit()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));
        var start = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var asOf = new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc);

        var engineering = OrgUnit.Create(tenantId, "ENG", "Engineering", "Department", null);
        var assigned = Employee.Create(tenantId, "Ava", "Assigned", "ava@example.com", start, employeeNumber: TestEmployeeNumbers.Next());
        var unassigned = Employee.Create(tenantId, "Ben", "Broken", "ben@example.com", start, employeeNumber: TestEmployeeNumbers.Next());
        db.AddRange(engineering, assigned, unassigned);
        await db.SaveChangesAsync();

        var assignedEmployment = Employment.Start(tenantId, assigned.Id, start, null, WorkforceSourceType.Manual);
        var unassignedEmployment = Employment.Start(tenantId, unassigned.Id, start, null, WorkforceSourceType.Manual);
        db.AddRange(assignedEmployment, unassignedEmployment);
        await db.SaveChangesAsync();

        // Only the first employee has a primary assignment; the second has active employment but none.
        var assignment = WorkAssignment.Create(tenantId, assignedEmployment.Id, assigned.Id, engineering.Id, TestCatalog.Job(tenantId, "Engineer"), TestCatalog.Place(tenantId, null), true, start, null, WorkforceSourceType.Manual);
        db.Add(assignment);
        await db.SaveChangesAsync();

        var snapshots = await new InternalWorkforceSnapshotService(db)
            .GetAllActiveAsOfAsync(asOf, includeInactive: false, CancellationToken.None);

        // The broken-assignment employee is still returned so the gap can be surfaced as a
        // readiness issue, with a null org unit rather than dropping out of the population.
        Assert.Equal(2, snapshots.Count);
        var broken = snapshots.Single(snapshot => snapshot.EmployeeId == unassigned.Id);
        Assert.True(broken.IsActive);
        Assert.Null(broken.OrgUnit);
        var ok = snapshots.Single(snapshot => snapshot.EmployeeId == assigned.Id);
        Assert.NotNull(ok.OrgUnit);
    }

    private static readonly DateTime Start = new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime AsOf = new(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc);

    private sealed record Hired(Employee Employee, WorkAssignment Assignment);

    /// <summary>One employee with a primary assignment from <see cref="Start"/>, optionally ended, optionally reporting to a manager.</summary>
    private static async Task<Hired> HireAsync(CoreHRDbContext db, Guid tenantId, OrgUnit unit, string first, string last,
        Hired? manager = null, DateTime? endedAt = null, DateTime? managerUntil = null)
    {
        var employee = Employee.Create(tenantId, first, last, $"{first.ToLowerInvariant()}.{last.ToLowerInvariant()}@example.com", Start,
            employeeNumber: TestEmployeeNumbers.Next());
        db.Add(employee);
        await db.SaveChangesAsync();
        var employment = Employment.Start(tenantId, employee.Id, Start, null, WorkforceSourceType.Manual);
        db.Add(employment);
        await db.SaveChangesAsync();
        var assignment = WorkAssignment.Create(tenantId, employment.Id, employee.Id, unit.Id, TestCatalog.Job(tenantId, "Engineer"), TestCatalog.Place(tenantId, null), true, Start, null, WorkforceSourceType.Manual);
        db.Add(assignment);
        await db.SaveChangesAsync();
        if (endedAt is DateTime end)
        {
            employment.End(end);
            await db.SaveChangesAsync();
        }
        if (manager is not null)
        {
            db.Add(ManagerRelationship.Create(tenantId, employee.Id, manager.Employee.Id, assignment.Id, manager.Assignment.Id,
                ReportingRelationshipType.PrimaryManager, Start, WorkforceSourceType.Manual, effectiveTo: managerUntil));
            await db.SaveChangesAsync();
        }
        return new Hired(employee, assignment);
    }

    private static async Task<OrgUnit> UnitAsync(CoreHRDbContext db, Guid tenantId)
    {
        var unit = OrgUnit.Create(tenantId, "ENG", "Engineering", "Department", null);
        db.Add(unit);
        await db.SaveChangesAsync();
        return unit;
    }

    [Fact]
    public async Task GetDirectReportsAsync_ReturnsActiveReportsByCurrentPrimaryManager()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));
        var unit = await UnitAsync(db, tenantId);
        var karim = await HireAsync(db, tenantId, unit, "Karim", "Haddad");
        var sana = await HireAsync(db, tenantId, unit, "Sana", "Other");
        var nour = await HireAsync(db, tenantId, unit, "Nour", "Trabelsi", karim);
        var amine = await HireAsync(db, tenantId, unit, "Amine", "Jaziri", karim);
        await HireAsync(db, tenantId, unit, "Moved", "Away", karim, managerUntil: new DateTime(2026, 3, 1, 0, 0, 0, DateTimeKind.Utc));
        await HireAsync(db, tenantId, unit, "Left", "Company", karim, endedAt: new DateTime(2026, 4, 1, 0, 0, 0, DateTimeKind.Utc));
        await HireAsync(db, tenantId, unit, "Elsewhere", "Report", sana);

        var service = new InternalWorkforceSnapshotService(db);
        var reports = await service.GetDirectReportsAsync(AsOf, [karim.Employee.Id], CancellationToken.None);

        Assert.Equal(new[] { amine.Employee.Id, nour.Employee.Id }.Order(), reports.Select(r => r.EmployeeId).Order());
        Assert.All(reports, r => Assert.Equal(karim.Employee.Id, r.Manager!.EmployeeId));
        Assert.Empty(await service.GetDirectReportsAsync(AsOf, [Guid.NewGuid()], CancellationToken.None));
        Assert.Empty(await service.GetDirectReportsAsync(AsOf, [], CancellationToken.None));
    }

    [Fact]
    public async Task GetDirectReportsAsync_DoesNotCrossTenants()
    {
        var databaseName = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        Guid managerInB;
        await using (var dbB = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantB), databaseName))
        {
            var unit = await UnitAsync(dbB, tenantB);
            var manager = await HireAsync(dbB, tenantB, unit, "Bella", "Boss");
            await HireAsync(dbB, tenantB, unit, "Bob", "Report", manager);
            managerInB = manager.Employee.Id;
        }

        await using var dbA = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantA), databaseName);
        Assert.Empty(await new InternalWorkforceSnapshotService(dbA).GetDirectReportsAsync(AsOf, [managerInB], CancellationToken.None));
        Assert.Empty(await new InternalWorkforceSnapshotService(dbA).SearchActiveAsync(AsOf, "bella", 20, CancellationToken.None));
    }

    [Fact]
    public async Task SearchActiveAsync_MatchesNamesAmongActiveEmployeesWithinTheLimit()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));
        var unit = await UnitAsync(db, tenantId);
        await HireAsync(db, tenantId, unit, "Rim", "Mahjoub");
        await HireAsync(db, tenantId, unit, "Rim", "Bouaziz");
        await HireAsync(db, tenantId, unit, "Karim", "Haddad");
        await HireAsync(db, tenantId, unit, "Rima", "Gone", endedAt: new DateTime(2026, 2, 1, 0, 0, 0, DateTimeKind.Utc));
        await HireAsync(db, tenantId, unit, "Leila", "Baccouche");

        var service = new InternalWorkforceSnapshotService(db);
        var found = await service.SearchActiveAsync(AsOf, "rim", 20, CancellationToken.None);

        Assert.Equal(["Karim Haddad", "Rim Bouaziz", "Rim Mahjoub"], found.Select(f => f.DisplayName).ToArray());
        Assert.Equal(2, (await service.SearchActiveAsync(AsOf, "rim", 2, CancellationToken.None)).Count);
        Assert.Single(await service.SearchActiveAsync(AsOf, "Rim Mah", 20, CancellationToken.None));
        Assert.Empty(await service.SearchActiveAsync(AsOf, "r", 20, CancellationToken.None));
        Assert.Empty(await service.SearchActiveAsync(AsOf, "zzz", 20, CancellationToken.None));
    }

    [Fact]
    public async Task NewSnapshotEndpoints_RejectUnsignedCalls()
    {
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(Guid.NewGuid()));
        var controller = new InternalWorkforceSnapshotsController(new RejectingAuthorizer(), new InternalWorkforceSnapshotService(db))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

        var reports = await controller.GetDirectReports(new InternalWorkforceDirectReportsRequest(AsOf, [Guid.NewGuid()]), CancellationToken.None);
        var search = await controller.Search(new InternalWorkforceSearchRequest(AsOf, "Rim"), CancellationToken.None);

        Assert.IsType<UnauthorizedResult>(reports.Result);
        Assert.IsType<UnauthorizedResult>(search.Result);
    }

    private sealed class RejectingAuthorizer : IInternalServiceRequestAuthorizer
    {
        public Task<bool> AuthorizeAsync(HttpRequest request, CancellationToken cancellationToken = default) => Task.FromResult(false);
    }
}

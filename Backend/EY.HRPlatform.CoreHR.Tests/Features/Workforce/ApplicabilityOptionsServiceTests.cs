using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;

namespace EY.HRPlatform.CoreHR.Tests.Features.Workforce;

public sealed class ApplicabilityOptionsServiceTests
{
    private static readonly DateTime Start = new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task GetAsync_ReturnsActiveOrgUnitsForTenant()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));

        var active = OrgUnit.Create(tenantId, "ENG", "Engineering", "Department", null);
        var archived = OrgUnit.Create(tenantId, "ARC", "Archived Dept", "Department", null);
        archived.Deactivate();
        db.AddRange(active, archived);
        await db.SaveChangesAsync();

        var svc = new ApplicabilityOptionsService(db);
        var result = await svc.GetAsync(CancellationToken.None);

        Assert.Single(result.OrgUnits);
        Assert.Equal(active.Id, result.OrgUnits[0].Id);
        Assert.Equal("Engineering", result.OrgUnits[0].Name);
        Assert.Equal("ENG", result.OrgUnits[0].Code);
    }

    [Fact]
    public async Task GetAsync_OrgUnitsTenantIsolated()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();

        // seed both tenants without the filter so both rows land in the same in-memory db
        await using var seedDb = TestDbContextFactory.CreateWithoutTenant(dbName);
        var orgA = OrgUnit.Create(tenantA, "A1", "Tenant A Org", "Department", null);
        var orgB = OrgUnit.Create(tenantB, "B1", "Tenant B Org", "Department", null);
        seedDb.AddRange(orgA, orgB);
        await seedDb.SaveChangesAsync();

        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantA), dbName);
        var svc = new ApplicabilityOptionsService(db);
        var result = await svc.GetAsync(CancellationToken.None);

        Assert.Single(result.OrgUnits);
        Assert.Equal(orgA.Id, result.OrgUnits[0].Id);
        Assert.DoesNotContain(result.OrgUnits, u => u.Id == orgB.Id);
    }

    [Fact]
    public async Task GetAsync_ReturnsDistinctJobTitlesFromActivePrimaryAssignments()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));

        var orgUnit = OrgUnit.Create(tenantId, "ENG", "Engineering", "Department", null);
        var emp1 = Employee.Create(tenantId, "Alice", "A", "alice@x.com", Start, employeeNumber: TestEmployeeNumbers.Next());
        var emp2 = Employee.Create(tenantId, "Bob", "B", "bob@x.com", Start, employeeNumber: TestEmployeeNumbers.Next());
        var emp3 = Employee.Create(tenantId, "Carol", "C", "carol@x.com", Start, employeeNumber: TestEmployeeNumbers.Next());
        db.AddRange(orgUnit, emp1, emp2, emp3);
        await db.SaveChangesAsync();

        var empl1 = Employment.Start(tenantId, emp1.Id, Start, TestCatalog.EmploymentType(tenantId, "Full-Time"), WorkforceSourceType.Manual);
        var empl2 = Employment.Start(tenantId, emp2.Id, Start, TestCatalog.EmploymentType(tenantId, "Full-Time"), WorkforceSourceType.Manual);
        var empl3 = Employment.Start(tenantId, emp3.Id, Start, TestCatalog.EmploymentType(tenantId, "Part-Time"), WorkforceSourceType.Manual);
        db.AddRange(empl1, empl2, empl3);
        await db.SaveChangesAsync();

        // emp1 + emp2 share "Engineer" title; emp3 has "Designer"
        var wa1 = WorkAssignment.Create(tenantId, empl1.Id, emp1.Id, orgUnit.Id, TestCatalog.Job(tenantId, "Engineer"), TestCatalog.Place(tenantId, null), true, Start, null, WorkforceSourceType.Manual);
        var wa2 = WorkAssignment.Create(tenantId, empl2.Id, emp2.Id, orgUnit.Id, TestCatalog.Job(tenantId, "Engineer"), TestCatalog.Place(tenantId, null), true, Start, null, WorkforceSourceType.Manual);
        var wa3 = WorkAssignment.Create(tenantId, empl3.Id, emp3.Id, orgUnit.Id, TestCatalog.Job(tenantId, "Designer"), TestCatalog.Place(tenantId, null), true, Start, null, WorkforceSourceType.Manual);
        db.AddRange(wa1, wa2, wa3);
        await db.SaveChangesAsync();

        var svc = new ApplicabilityOptionsService(db);
        var result = await svc.GetAsync(CancellationToken.None);

        Assert.Equal(2, result.JobTitles.Count);
        Assert.Contains("Designer", result.JobTitles);
        Assert.Contains("Engineer", result.JobTitles);
    }

    [Fact]
    public async Task GetAsync_ExcludesExpiredAssignmentsFromJobTitles()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));

        var orgUnit = OrgUnit.Create(tenantId, "ENG", "Engineering", "Department", null);
        var emp = Employee.Create(tenantId, "Alice", "A", "alice@x.com", Start, employeeNumber: TestEmployeeNumbers.Next());
        db.AddRange(orgUnit, emp);
        await db.SaveChangesAsync();

        var empl = Employment.Start(tenantId, emp.Id, Start, null, WorkforceSourceType.Manual);
        db.Add(empl);
        await db.SaveChangesAsync();

        var yesterday = DateTime.UtcNow.Date.AddDays(-1);
        var expired = WorkAssignment.Create(tenantId, empl.Id, emp.Id, orgUnit.Id, TestCatalog.Job(tenantId, "OldRole"), TestCatalog.Place(tenantId, null), true, Start, yesterday, WorkforceSourceType.Manual);
        var active = WorkAssignment.Create(tenantId, empl.Id, emp.Id, orgUnit.Id, TestCatalog.Job(tenantId, "CurrentRole"), TestCatalog.Place(tenantId, null), true, DateTime.UtcNow.Date, null, WorkforceSourceType.Manual);
        db.AddRange(expired, active);
        await db.SaveChangesAsync();

        var svc = new ApplicabilityOptionsService(db);
        var result = await svc.GetAsync(CancellationToken.None);

        Assert.DoesNotContain("OldRole", result.JobTitles);
        Assert.Contains("CurrentRole", result.JobTitles);
    }

    [Fact]
    public async Task GetAsync_ReturnsDistinctWorkLocations()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));

        var orgUnit = OrgUnit.Create(tenantId, "OFF", "Office", "Department", null);
        var emp1 = Employee.Create(tenantId, "Alice", "A", "alice@x.com", Start, employeeNumber: TestEmployeeNumbers.Next());
        var emp2 = Employee.Create(tenantId, "Bob", "B", "bob@x.com", Start, employeeNumber: TestEmployeeNumbers.Next());
        db.AddRange(orgUnit, emp1, emp2);
        await db.SaveChangesAsync();

        var empl1 = Employment.Start(tenantId, emp1.Id, Start, null, WorkforceSourceType.Manual);
        var empl2 = Employment.Start(tenantId, emp2.Id, Start, null, WorkforceSourceType.Manual);
        db.AddRange(empl1, empl2);
        await db.SaveChangesAsync();

        var wa1 = WorkAssignment.Create(tenantId, empl1.Id, emp1.Id, orgUnit.Id, TestCatalog.Job(tenantId, "Engineer"), TestCatalog.Place(tenantId, "Tunis"), true, Start, null, WorkforceSourceType.Manual);
        var wa2 = WorkAssignment.Create(tenantId, empl2.Id, emp2.Id, orgUnit.Id, TestCatalog.Job(tenantId, "Manager"), TestCatalog.Place(tenantId, "Tunis"), true, Start, null, WorkforceSourceType.Manual);
        db.AddRange(wa1, wa2);
        await db.SaveChangesAsync();

        var svc = new ApplicabilityOptionsService(db);
        var result = await svc.GetAsync(CancellationToken.None);

        Assert.Single(result.WorkLocations);
        Assert.Equal("Tunis", result.WorkLocations[0]);
    }

    [Fact]
    public async Task GetAsync_ReturnsDistinctEmploymentTypesFromActiveEmployments()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));

        var orgUnit = OrgUnit.Create(tenantId, "ENG", "Engineering", "Department", null);
        var emp1 = Employee.Create(tenantId, "Alice", "A", "alice@x.com", Start, employeeNumber: TestEmployeeNumbers.Next());
        var emp2 = Employee.Create(tenantId, "Bob", "B", "bob@x.com", Start, employeeNumber: TestEmployeeNumbers.Next());
        var emp3 = Employee.Create(tenantId, "Carol", "C", "carol@x.com", Start, employeeNumber: TestEmployeeNumbers.Next());
        db.AddRange(orgUnit, emp1, emp2, emp3);
        await db.SaveChangesAsync();

        var empl1 = Employment.Start(tenantId, emp1.Id, Start, TestCatalog.EmploymentType(tenantId, "Full-Time"), WorkforceSourceType.Manual);
        var empl2 = Employment.Start(tenantId, emp2.Id, Start, TestCatalog.EmploymentType(tenantId, "Full-Time"), WorkforceSourceType.Manual);
        var empl3 = Employment.Start(tenantId, emp3.Id, Start, TestCatalog.EmploymentType(tenantId, "Contractor"), WorkforceSourceType.Manual);
        db.AddRange(empl1, empl2, empl3);
        await db.SaveChangesAsync();

        var svc = new ApplicabilityOptionsService(db);
        var result = await svc.GetAsync(CancellationToken.None);

        Assert.Equal(2, result.EmploymentTypes.Count);
        Assert.Contains("Full-Time", result.EmploymentTypes);
        Assert.Contains("Contractor", result.EmploymentTypes);
    }

    [Fact]
    public async Task GetAsync_ReturnsEmptyListsWhenNoData()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));

        var svc = new ApplicabilityOptionsService(db);
        var result = await svc.GetAsync(CancellationToken.None);

        Assert.Empty(result.OrgUnits);
        Assert.Empty(result.JobTitles);
        Assert.Empty(result.WorkLocations);
        Assert.Empty(result.EmploymentTypes);
    }
}

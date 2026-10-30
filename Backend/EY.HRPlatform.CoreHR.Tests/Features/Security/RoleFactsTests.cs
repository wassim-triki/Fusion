using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.CoreHR.Tests.TestSupport;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Tests.Features.Security;

/// <summary>
/// What Identity reads to keep rule-held roles current (B-177): each person's unit and the units above it, job,
/// place and team size, only for the caller's company; and a change to any of them signals the company.
/// </summary>
public sealed class RoleFactsTests
{
    private static readonly DateTime Start = new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime AsOf = new(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc);
    private static readonly DateOnly From = DateOnly.FromDateTime(Start);

    private sealed record World(Guid TenantId, Guid Company, Guid People, Guid Payroll, Guid Nour, Guid Aicha, Guid NourJob, Guid? Tunis);

    private static async Task<World> SeedAsync(CoreHRDbContext db, Guid tenantId)
    {
        var company = OrgUnit.Create(tenantId, "CO", "Carthage", "Organization", null);
        var people = OrgUnit.Create(tenantId, "PG", "People & Growth", "Department", null);
        var payroll = OrgUnit.Create(tenantId, "PAY", "Payroll", "Team", null);
        db.AddRange(company, people, payroll);
        db.AddRange(
            OrgUnitEffectiveState.Create(tenantId, company.Id, OrganizationalUnitTypeCatalog.OrganizationId, null, "Carthage", OrgUnitLifecycleState.Active, From),
            OrgUnitEffectiveState.Create(tenantId, people.Id, OrganizationalUnitTypeCatalog.DepartmentId, company.Id, "People & Growth", OrgUnitLifecycleState.Active, From),
            OrgUnitEffectiveState.Create(tenantId, payroll.Id, OrganizationalUnitTypeCatalog.TeamId, people.Id, "Payroll", OrgUnitLifecycleState.Active, From));

        var nour = Employee.Create(tenantId, "Nour", "Ben Ali", $"nour.{tenantId:N}@example.com", Start, employeeNumber: TestEmployeeNumbers.Next());
        var aicha = Employee.Create(tenantId, "Aicha", "Bouazizi", $"aicha.{tenantId:N}@example.com", Start, employeeNumber: TestEmployeeNumbers.Next());
        db.AddRange(nour, aicha);
        await db.SaveChangesAsync();

        var nourEmployment = Employment.Start(tenantId, nour.Id, Start, null, WorkforceSourceType.Manual);
        var aichaEmployment = Employment.Start(tenantId, aicha.Id, Start, null, WorkforceSourceType.Manual);
        db.AddRange(nourEmployment, aichaEmployment);
        await db.SaveChangesAsync();

        var job = db.Job(tenantId, "Chief People Officer");
        var tunis = db.Place(tenantId, "Tunis");
        var nourAssignment = WorkAssignment.Create(tenantId, nourEmployment.Id, nour.Id, people.Id, job, tunis, true, Start, null, WorkforceSourceType.Manual);
        var aichaAssignment = WorkAssignment.Create(tenantId, aichaEmployment.Id, aicha.Id, payroll.Id, db.Job(tenantId, "Payroll Officer"), null, true, Start, null, WorkforceSourceType.Manual);
        db.AddRange(nourAssignment, aichaAssignment);
        await db.SaveChangesAsync();

        db.Add(ManagerRelationship.Create(tenantId, aicha.Id, nour.Id, aichaAssignment.Id, nourAssignment.Id,
            ReportingRelationshipType.PrimaryManager, Start, WorkforceSourceType.Manual));
        await db.SaveChangesAsync();

        return new World(tenantId, company.Id, people.Id, payroll.Id, nour.Id, aicha.Id, job.Id, tunis?.Id);
    }

    [Fact]
    public async Task Each_person_has_their_unit_chain_job_place_and_team()
    {
        var database = Guid.NewGuid().ToString();
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId), database);
        var world = await SeedAsync(db, tenantId);

        var facts = (await new RoleFactsService(db).GetFactsAsync(AsOf, CancellationToken.None)).ToDictionary(fact => fact.EmployeeId);

        Assert.Equal([world.People, world.Company], facts[world.Nour].UnitChain);
        Assert.Equal(world.NourJob, facts[world.Nour].JobId);
        Assert.Equal(world.Tunis, facts[world.Nour].PlaceId);
        Assert.Equal(1, facts[world.Nour].DirectReports);
        Assert.Equal([world.Payroll, world.People, world.Company], facts[world.Aicha].UnitChain);
        Assert.Equal(0, facts[world.Aicha].DirectReports);
    }

    [Fact]
    public async Task Facts_and_rule_values_stay_inside_the_callers_company()
    {
        var database = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        World other;
        await using (var seedB = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantB), database))
            other = await SeedAsync(seedB, tenantB);
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantA), database);
        var world = await SeedAsync(db, tenantA);
        var service = new RoleFactsService(db);

        var facts = await service.GetFactsAsync(AsOf, CancellationToken.None);
        Assert.DoesNotContain(facts, fact => fact.EmployeeId == other.Nour || fact.EmployeeId == other.Aicha);

        var targets = await service.ResolveTargetsAsync([world.People, world.Payroll, world.NourJob, other.People, other.NourJob], AsOf, CancellationToken.None);
        Assert.Equal([world.People], targets.Departments);
        Assert.Equal(new[] { world.People, world.Payroll }.Order(), targets.Units.Order());
        Assert.Equal([world.NourJob], targets.Jobs);
    }

    [Fact]
    public async Task A_change_to_a_job_unit_or_reporting_line_signals_the_company_once_it_commits()
    {
        var tenantId = Guid.NewGuid();
        var signals = new RoleFactsSignals();
        var options = new DbContextOptionsBuilder<CoreHRDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .AddInterceptors(new RoleFactsChangeInterceptor(signals))
            .Options;
        await using var db = new CoreHRDbContext(options, TestTenantContext.WithTenant(tenantId));

        await SeedAsync(db, tenantId);

        Assert.True(signals.Reader.TryRead(out var signalled));
        Assert.Equal(tenantId, signalled);

        // A save that touches nothing a rule looks at stays quiet.
        while (signals.Reader.TryRead(out _)) { }
        db.Add(Employee.Create(tenantId, "Sami", "Trabelsi", "sami@example.com", Start, employeeNumber: TestEmployeeNumbers.Next()));
        await db.SaveChangesAsync();
        Assert.False(signals.Reader.TryRead(out _));
    }
}

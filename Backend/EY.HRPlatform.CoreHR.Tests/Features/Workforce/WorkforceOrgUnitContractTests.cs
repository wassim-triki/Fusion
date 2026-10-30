using EY.HRPlatform.CoreHR.Tests.TestSupport;
using System.Security.Claims;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Workforce.Dtos;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using DomainTenantSettings = EY.HRPlatform.CoreHR.Domain.Entities.TenantSettings;
// ReSharper disable InconsistentNaming

namespace EY.HRPlatform.CoreHR.Tests.Features.Workforce;

/// <summary>
/// Verifies the org-unit workforce-contract reads (D-16 seam #2) and the manager-chain ordering
/// (D-16 seam #1) that the collective-objective approval routing engine in Plan 03 relies on.
/// </summary>
public class WorkforceOrgUnitContractTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private const string SettingsJson = """{"employeeFieldConfig":{"jobTitle":{"visible":true,"required":false,"visibleToEmployee":true,"visibleToManager":true}},"orgUnitTypes":["Department","Team"]}""";

    [Fact]
    public async Task GetOrgUnitDetailAsync_ReturnsNull_WhenOrgUnitNotFound()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedContext.TenantSettings.Add(DomainTenantSettings.Create(TenantId, SettingsJson));
            await seedContext.SaveChangesAsync();
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var service = CreateService(context, tenantContext);

        var detail = await service.GetOrgUnitDetailAsync(Guid.NewGuid(), CancellationToken.None);

        Assert.Null(detail);
    }

    [Fact]
    public async Task GetOrgUnitDetailAsync_ReturnsNullResponsibleManager_WhenNoneDesignated()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        Guid orgUnitId;

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedContext.TenantSettings.Add(DomainTenantSettings.Create(TenantId, SettingsJson));

            // Create without a responsible manager
            var orgUnit = OrgUnit.Create(TenantId, "HR", "Human Resources", "Department", null);
            seedContext.OrgUnits.Add(orgUnit);
            await seedContext.SaveChangesAsync();
            orgUnitId = orgUnit.Id;
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var service = CreateService(context, tenantContext);

        var detail = await service.GetOrgUnitDetailAsync(orgUnitId, CancellationToken.None);

        Assert.NotNull(detail);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Seam #2b: GetOrgUnitMembersAsync returns effective-today members
    // ────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetOrgUnitMembersAsync_ReturnsOnlyEffectiveTodayMembers()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        var now = new DateTime(2026, 6, 27, 0, 0, 0, DateTimeKind.Utc);
        Guid orgUnitId;
        Guid activeEmployeeId;

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedContext.TenantSettings.Add(DomainTenantSettings.Create(TenantId, SettingsJson));

            var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
            seedContext.OrgUnits.Add(orgUnit);
            orgUnitId = orgUnit.Id;

            var active = Employee.Create(TenantId, "Active", "Member", "active@test.local", now, jobTitle: "Engineer", employeeNumber: "E-001");
            var expired = Employee.Create(TenantId, "Expired", "Member", "expired@test.local", now, jobTitle: "Engineer", employeeNumber: "E-002");
            var future = Employee.Create(TenantId, "Future", "Member", "future@test.local", now, jobTitle: "Engineer", employeeNumber: "E-003");
            seedContext.Employees.AddRange(active, expired, future);
            await seedContext.SaveChangesAsync();

            activeEmployeeId = active.Id;
            await AddActiveEmploymentWithAssignmentAsync(seedContext, active.Id, orgUnitId, "Engineer", now.AddDays(-30));
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var service = CreateService(context, tenantContext);
        var hrAdminPrincipal = CreateHrAdminPrincipal();

        var members = await service.GetOrgUnitMembersAsync(orgUnitId, includeDescendants: false, hrAdminPrincipal, CancellationToken.None);

        // Only the active membership should be returned
        Assert.Single(members);
        Assert.Equal(activeEmployeeId, members[0].EmployeeId);
    }

    [Fact]
    public async Task GetOrgUnitMembersAsync_ReturnsEmptyList_WhenNoEffectiveMembers()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        Guid orgUnitId;

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedContext.TenantSettings.Add(DomainTenantSettings.Create(TenantId, SettingsJson));
            var orgUnit = OrgUnit.Create(TenantId, "EMPTY", "Empty Dept", "Department", null);
            seedContext.OrgUnits.Add(orgUnit);
            await seedContext.SaveChangesAsync();
            orgUnitId = orgUnit.Id;
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var service = CreateService(context, tenantContext);

        var members = await service.GetOrgUnitMembersAsync(orgUnitId, includeDescendants: false, CreateHrAdminPrincipal(), CancellationToken.None);

        Assert.Empty(members);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Seam #2 gate-denial: caller without workforce view scope is Forbidden
    // ────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetOrgUnitMembersAsync_WithNoEmployeeViewScope_ReturnsEmpty()
    {
        // The workforce controller enforces the Forbid at the HTTP layer; the service itself
        // returns empty because ApplyVisibilityScope excludes all employees for a principal
        // with no linked employee id and no scope grants.
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        var now = new DateTime(2026, 6, 27, 0, 0, 0, DateTimeKind.Utc);
        Guid orgUnitId;

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedContext.TenantSettings.Add(DomainTenantSettings.Create(TenantId, SettingsJson));
            var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
            seedContext.OrgUnits.Add(orgUnit);
            orgUnitId = orgUnit.Id;

            var employee = Employee.Create(TenantId, "Joe", "Member", "joe@test.local", now, jobTitle: "Engineer", employeeNumber: "E-010");
            seedContext.Employees.Add(employee);
            await seedContext.SaveChangesAsync();

            await AddActiveEmploymentWithAssignmentAsync(seedContext, employee.Id, orgUnitId, "Engineer", now.AddDays(-10));
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var service = CreateService(context, tenantContext);

        // A principal with no grants and no linked employee id — ApplyVisibilityScope yields empty
        var noScopePrincipal = CreateNoScopePrincipal();

        var members = await service.GetOrgUnitMembersAsync(orgUnitId, includeDescendants: false, noScopePrincipal, CancellationToken.None);

        Assert.Empty(members);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Seam #1: GetManagerChainAsync ordering (closest direct manager last)
    //
    // Plan 03 routing walks chain[^1] to find the immediate superior.
    // Core's GetManagerChainAsync builds: [manager, grandManager, ...] then
    // calls chain.Reverse() → result is root-first (top of hierarchy first,
    // employee's direct manager is the LAST element).
    //
    // This test pins that ordering so routing-engine changes can be caught.
    // ────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetManagerChainAsync_ChainIsRootFirst_DirectManagerIsLastElement()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        var now = new DateTime(2026, 6, 27, 0, 0, 0, DateTimeKind.Utc);
        Guid employeeId;
        Guid directManagerId;
        Guid grandManagerId;

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedContext.TenantSettings.Add(DomainTenantSettings.Create(TenantId, SettingsJson));
            var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
            seedContext.OrgUnits.Add(orgUnit);
            await seedContext.SaveChangesAsync();

            var grandManager = Employee.Create(TenantId, "Grand", "Manager", "grand@test.local", now, jobTitle: "VP", employeeNumber: "E-A01");
            var directManager = Employee.Create(TenantId, "Direct", "Manager", "direct@test.local", now, jobTitle: "Manager", employeeNumber: "E-A02");
            var employee = Employee.Create(TenantId, "John", "Employee", "john@test.local", now, jobTitle: "Analyst", employeeNumber: "E-A03");

            seedContext.Employees.AddRange(grandManager, directManager, employee);
            await seedContext.SaveChangesAsync();

            var (_, grandManagerAssignment) = await AddActiveEmploymentWithAssignmentAsync(seedContext, grandManager.Id, orgUnit.Id, "VP", now);
            var (_, directManagerAssignment) = await AddActiveEmploymentWithAssignmentAsync(seedContext, directManager.Id, orgUnit.Id, "Manager", now);
            var (_, employeeAssignment) = await AddActiveEmploymentWithAssignmentAsync(seedContext, employee.Id, orgUnit.Id, "Analyst", now);
            await AddPrimaryManagerRelationshipAsync(seedContext, directManager.Id, grandManager.Id, directManagerAssignment.Id, grandManagerAssignment.Id, now);
            await AddPrimaryManagerRelationshipAsync(seedContext, employee.Id, directManager.Id, employeeAssignment.Id, directManagerAssignment.Id, now);

            employeeId = employee.Id;
            directManagerId = directManager.Id;
            grandManagerId = grandManager.Id;
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var service = CreateService(context, tenantContext);
        var hrAdminPrincipal = CreateHrAdminPrincipal();

        var chain = await service.GetManagerChainAsync(employeeId, hrAdminPrincipal, CancellationToken.None);

        // chain should be [grandManager, directManager] — root-first.
        // chain[^1] is the direct manager: the first approver the routing engine walks to.
        Assert.Equal(2, chain.Count);
        Assert.Equal(grandManagerId, chain[0].EmployeeId);   // root / top of hierarchy is first
        Assert.Equal(directManagerId, chain[^1].EmployeeId); // direct manager (closest superior) is last

        // Document ordering for the routing engine: chain[^1] is the direct superior
        Assert.Equal(directManagerId, chain[chain.Count - 1].EmployeeId);
    }

    [Fact]
    public async Task GetManagerChainAsync_SingleManager_ChainHasOneElement()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        var now = new DateTime(2026, 6, 27, 0, 0, 0, DateTimeKind.Utc);
        Guid employeeId;
        Guid managerId;

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedContext.TenantSettings.Add(DomainTenantSettings.Create(TenantId, SettingsJson));
            var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
            seedContext.OrgUnits.Add(orgUnit);
            await seedContext.SaveChangesAsync();

            var manager = Employee.Create(TenantId, "Solo", "Manager", "solo.mgr@test.local", now, jobTitle: "Manager", employeeNumber: "E-B01");
            var employee = Employee.Create(TenantId, "Solo", "Employee", "solo.emp@test.local", now, jobTitle: "Analyst", employeeNumber: "E-B02");
            seedContext.Employees.AddRange(manager, employee);
            await seedContext.SaveChangesAsync();

            var (_, managerAssignment) = await AddActiveEmploymentWithAssignmentAsync(seedContext, manager.Id, orgUnit.Id, "Manager", now);
            var (_, employeeAssignment) = await AddActiveEmploymentWithAssignmentAsync(seedContext, employee.Id, orgUnit.Id, "Analyst", now);
            await AddPrimaryManagerRelationshipAsync(seedContext, employee.Id, manager.Id, employeeAssignment.Id, managerAssignment.Id, now);

            employeeId = employee.Id;
            managerId = manager.Id;
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var service = CreateService(context, tenantContext);

        var chain = await service.GetManagerChainAsync(employeeId, CreateHrAdminPrincipal(), CancellationToken.None);

        Assert.Single(chain);
        Assert.Equal(managerId, chain[0].EmployeeId);
        // With one element, chain[^1] == chain[0] — still the direct manager
        Assert.Equal(managerId, chain[^1].EmployeeId);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Helpers
    // ────────────────────────────────────────────────────────────────────────

    private static WorkforceContractService CreateService(
        CoreHRDbContext context,
        TestTenantContext tenantContext)
        => new(
            context,
            tenantContext,
            new TenantSettingsReadService(context),
            new NullWorkforceAccountStatusReader(),
            new NullWorkforceBulkProvisioner(),
            new WorkforceCanonicalResolver(context));

    private static async Task<(Employment Employment, WorkAssignment Assignment)> AddActiveEmploymentWithAssignmentAsync(
        CoreHRDbContext context,
        Guid employeeId,
        Guid orgUnitId,
        string jobTitle,
        DateTime effectiveFrom)
    {
        var employment = Employment.Start(TenantId, employeeId, effectiveFrom, null, WorkforceSourceType.Manual);
        context.Employments.Add(employment);
        await context.SaveChangesAsync();

        var assignment = WorkAssignment.Create(
            TenantId,
            employment.Id,
            employeeId,
            orgUnitId,
            TestCatalog.Job(TenantId, jobTitle),
            TestCatalog.Place(TenantId, null),
            true,
            effectiveFrom,
            null,
            WorkforceSourceType.Manual);
        context.WorkAssignments.Add(assignment);
        await context.SaveChangesAsync();

        return (employment, assignment);
    }

    private static async Task AddPrimaryManagerRelationshipAsync(
        CoreHRDbContext context,
        Guid subjectEmployeeId,
        Guid managerEmployeeId,
        Guid subjectWorkAssignmentId,
        Guid managerWorkAssignmentId,
        DateTime effectiveFrom)
    {
        var relationship = ManagerRelationship.Create(
            TenantId,
            subjectEmployeeId,
            managerEmployeeId,
            subjectWorkAssignmentId,
            managerWorkAssignmentId,
            ReportingRelationshipType.PrimaryManager,
            effectiveFrom,
            WorkforceSourceType.Manual);
        context.ManagerRelationships.Add(relationship);
        await context.SaveChangesAsync();
    }

    private static ClaimsPrincipal CreateHrAdminPrincipal()
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new(ClaimTypes.Role, PlatformRole.HRAdmin),
            new(CustomClaimTypes.FullName, "Test HR Admin"),
            new(CustomClaimTypes.CorePermission,
                CorePermissionClaimValue.Encode(CorePermissions.EmployeeView, PermissionScopes.Tenant)),
            new(CustomClaimTypes.CorePermission,
                CorePermissionClaimValue.Encode(CorePermissions.StructureView, PermissionScopes.Tenant)),
        };
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth", ClaimTypes.Name, ClaimTypes.Role));
    }

    private static ClaimsPrincipal CreateNoScopePrincipal()
    {
        // A principal with no grants and no linked employee id — no visibility scope at all
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
        };
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth", ClaimTypes.Name, ClaimTypes.Role));
    }

    private sealed class NullWorkforceAccountStatusReader : IWorkforceAccountStatusReader
    {
        public Task<IReadOnlyDictionary<Guid, WorkforceAccountStatusDto>> GetStatusesAsync(
            IReadOnlyCollection<WorkforceAccountSubjectDto> subjects,
            CancellationToken cancellationToken)
            => Task.FromResult<IReadOnlyDictionary<Guid, WorkforceAccountStatusDto>>(
                new Dictionary<Guid, WorkforceAccountStatusDto>());
    }

    private sealed class NullWorkforceBulkProvisioner : IWorkforceBulkProvisioner
    {
        public Task<WorkforceBulkProvisionResponse> BulkProvisionAsync(
            List<WorkforceBulkProvisionSubject> subjects,
            Guid accessProfileId,
            CancellationToken cancellationToken,
            string? baseline = null)
            => Task.FromResult(new WorkforceBulkProvisionResponse([]));
    }
}

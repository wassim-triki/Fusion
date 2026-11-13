using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Infrastructure.Persistence.Interceptors;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace EY.HRPlatform.Performance.Tests.TestHelpers;

public sealed class TestTenantContext(Guid? tenantId = null) : ITenantContext
{
    public Guid TenantId => tenantId ?? throw new InvalidOperationException("Tenant not resolved.");
    public bool IsResolved => tenantId.HasValue;
    public Guid? TenantIdOrDefault => tenantId;

    public static TestTenantContext WithTenant(Guid id) => new(id);
    public static TestTenantContext Unresolved() => new(null);
}

/// <summary>
/// A shared InMemory store fronted by a factory that hands out a fresh DbContext per call — so
/// tests exercise handlers the way production does (one scoped context per request) instead of
/// reusing a single long-lived context, which InMemory mistracks across saves.
/// </summary>
public sealed class TestStore(Guid tenantId)
{
    private readonly InMemoryDatabaseRoot _root = new();
    private readonly string _name = Guid.NewGuid().ToString();

    public Guid TenantId { get; } = tenantId;
    public ITenantContext Tenant { get; } = TestTenantContext.WithTenant(tenantId);

    public PerformanceDbContext NewContext() => NewContext(Tenant);

    public PerformanceDbContext NewContext(ITenantContext tenant)
    {
        var options = new DbContextOptionsBuilder<PerformanceDbContext>()
            .UseInMemoryDatabase(_name, _root)
            .AddInterceptors(new TenantSaveChangesInterceptor(tenant), new AuditAppendOnlyInterceptor(), new DemoClockStampInterceptor())
            .Options;
        return new PerformanceDbContext(options, tenant);
    }

    public static TestStore ForNewTenant() => new(Guid.NewGuid());
}

/// <summary>
/// A configurable stand-in for the Core internal snapshot contract. Tests set what each mode
/// returns for a given as-of date so eligibility resolution can be exercised deterministically.
/// </summary>
public sealed class FakeCoreWorkforceClient : ICoreWorkforceClient
{
    public List<WorkforceSnapshot> AllActive { get; } = [];
    public Dictionary<Guid, WorkforceSnapshot> ById { get; } = [];
    public Dictionary<Guid, WorkforceOrgUnitContext> OrgUnits { get; } = [];
    public DateTime? LastAsOf { get; private set; }
    /// <summary>Every as-of date asked, in order.</summary>
    public List<DateTime> AsOfs { get; } = [];

    private void Record(DateTime asOf)
    {
        LastAsOf = asOf;
        AsOfs.Add(asOf);
    }

    public Task<IReadOnlyList<WorkforceOrgUnitContext>> ResolveOrgUnitsAsync(
        DateTime asOf, IReadOnlyCollection<Guid> orgUnitIds, CancellationToken cancellationToken)
    {
        Record(asOf);
        return Task.FromResult<IReadOnlyList<WorkforceOrgUnitContext>>(
            orgUnitIds.Where(OrgUnits.ContainsKey).Select(id => OrgUnits[id]).ToList());
    }

    public Task<IReadOnlyList<WorkforceSnapshot>> GetAllActiveAsOfAsync(DateTime asOf, CancellationToken cancellationToken)
    {
        Record(asOf);
        return Task.FromResult<IReadOnlyList<WorkforceSnapshot>>(AllActive.ToList());
    }

    public Task<IReadOnlyList<WorkforceSnapshot>> GetByScopeAsync(
        DateTime asOf, IReadOnlyCollection<Guid> orgUnitIds, bool includeDescendants, CancellationToken cancellationToken)
    {
        Record(asOf);
        var inScope = AllActive
            .Where(snapshot => snapshot.OrgUnit is not null && orgUnitIds.Contains(snapshot.OrgUnit.OrgUnitId))
            .ToList();
        return Task.FromResult<IReadOnlyList<WorkforceSnapshot>>(inScope);
    }

    /// <summary>When set, every call fails as Core being unreachable.</summary>
    public bool Unavailable { get; set; }

    private void ThrowIfUnavailable()
    {
        if (Unavailable) throw new HttpRequestException("Core HR is unreachable.");
    }

    /// <summary>Known people (by id) whose manager is one of the listed managers and who are active.</summary>
    public Task<IReadOnlyList<WorkforceSnapshot>> GetDirectReportsAsync(
        DateTime asOf, IReadOnlyCollection<Guid> managerEmployeeIds, CancellationToken cancellationToken)
    {
        ThrowIfUnavailable();
        Record(asOf);
        var managers = managerEmployeeIds.ToHashSet();
        return Task.FromResult<IReadOnlyList<WorkforceSnapshot>>(ById.Values
            .Where(snapshot => snapshot.IsActive && snapshot.Manager is not null && managers.Contains(snapshot.Manager.EmployeeId))
            .ToList());
    }

    public int SearchCalls { get; private set; }

    public Task<IReadOnlyList<WorkforceSnapshot>> SearchAsync(
        DateTime asOf, string term, int limit, CancellationToken cancellationToken)
    {
        ThrowIfUnavailable();
        SearchCalls++;
        Record(asOf);
        return Task.FromResult<IReadOnlyList<WorkforceSnapshot>>(ById.Values
            .Where(snapshot => snapshot.IsActive && snapshot.DisplayName.Contains(term, StringComparison.OrdinalIgnoreCase))
            .OrderBy(snapshot => snapshot.DisplayName, StringComparer.OrdinalIgnoreCase)
            .Take(Math.Clamp(limit, 1, 20))
            .ToList());
    }

    public Task<IReadOnlyList<WorkforceSnapshot>> ResolveAsync(
        DateTime asOf, IReadOnlyCollection<Guid> employeeIds, CancellationToken cancellationToken)
    {
        ThrowIfUnavailable();
        Record(asOf);
        var resolved = employeeIds
            .Where(ById.ContainsKey)
            .Select(id => ById[id])
            .ToList();
        return Task.FromResult<IReadOnlyList<WorkforceSnapshot>>(resolved);
    }

    /// <summary>The company's job families and levels, as Core HR lists them.</summary>
    public JobCatalogue Catalogue { get; set; } = new([], [], []);

    public Task<JobCatalogue> GetJobCatalogueAsync(CancellationToken cancellationToken)
    {
        ThrowIfUnavailable();
        return Task.FromResult(Catalogue);
    }

    public WorkforceSnapshot Add(
        string name,
        bool isActive = true,
        Guid? orgUnitId = null,
        string orgUnitName = "Engineering",
        Guid? managerId = null,
        bool managerActive = true,
        bool managerIsSelf = false)
    {
        var employeeId = Guid.NewGuid();
        var reviewerId = managerIsSelf ? employeeId : managerId;
        var snapshot = new WorkforceSnapshot(
            employeeId,
            $"KEY-{name}",
            name,
            name,
            $"{name}@demo.local",
            "Engineer",
            isActive,
            orgUnitId is not null ? new WorkforceOrgSnapshot(orgUnitId.Value, orgUnitName) : null,
            reviewerId is not null ? new WorkforceManagerSnapshot(reviewerId.Value, "Manager", managerActive) : null);
        AllActive.Add(snapshot);
        ById[snapshot.EmployeeId] = snapshot;
        return snapshot;
    }

    /// <summary>Puts a changed copy of someone already added in their place.</summary>
    public WorkforceSnapshot Replace(WorkforceSnapshot changed)
    {
        AllActive[AllActive.FindIndex(snapshot => snapshot.EmployeeId == changed.EmployeeId)] = changed;
        ById[changed.EmployeeId] = changed;
        return changed;
    }

    public void AddIneligible(string name, bool inactive, bool noAssignment, out Guid id)
    {
        var snapshot = new WorkforceSnapshot(
            Guid.NewGuid(),
            $"KEY-{name}",
            name,
            name,
            null,
            null,
            !inactive,
            noAssignment ? null : new WorkforceOrgSnapshot(Guid.NewGuid(), "Engineering"),
            null);
        id = snapshot.EmployeeId;
        ById[snapshot.EmployeeId] = snapshot; // resolvable by id, but NOT in the all-active base set
    }
}

/// <summary>Stands in for Identity's permission-holder lookup; tests list who holds the grant.</summary>
public sealed class FakePermissionHoldersClient : EY.HRPlatform.Performance.Infrastructure.Identity.IPermissionHoldersClient
{
    public List<EY.HRPlatform.SharedKernel.Auth.PermissionHolder> Holders { get; } = [];

    public Task<IReadOnlyList<EY.HRPlatform.SharedKernel.Auth.PermissionHolder>> GetHoldersAsync(
        string permissionKey, string scope, CancellationToken cancellationToken)
        => Task.FromResult<IReadOnlyList<EY.HRPlatform.SharedKernel.Auth.PermissionHolder>>(Holders.ToArray());
}

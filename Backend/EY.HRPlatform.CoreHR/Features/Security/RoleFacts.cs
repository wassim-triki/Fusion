using System.Runtime.CompilerServices;
using System.Threading.Channels;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Security;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace EY.HRPlatform.CoreHR.Features.Security;

/// <summary>What a role's rule can look at for one person today (B-177): their unit and every unit above it, job, place, team size.</summary>
public sealed record RoleFactDto(Guid EmployeeId, IReadOnlyList<Guid> UnitChain, Guid? JobId, Guid? PlaceId, int DirectReports);

public sealed record RoleTargetsRequest(IReadOnlyList<Guid> Ids);

/// <summary>Of the ids asked about, the tenant's departments (units of the Department type), units, jobs and places.</summary>
public sealed record RoleTargetsDto(IReadOnlyList<Guid> Departments, IReadOnlyList<Guid> Units, IReadOnlyList<Guid> Jobs, IReadOnlyList<Guid> Places);

public interface IRoleFactsService
{
    Task<IReadOnlyList<RoleFactDto>> GetFactsAsync(DateTime asOf, CancellationToken cancellationToken);
    Task<RoleTargetsDto> ResolveTargetsAsync(IReadOnlyCollection<Guid> ids, DateTime asOf, CancellationToken cancellationToken);
}

/// <summary>Identity's view of who matches a role's rule. Every set is the caller's tenant through the query filters.</summary>
public sealed class RoleFactsService(CoreHRDbContext dbContext) : IRoleFactsService
{
    public async Task<IReadOnlyList<RoleFactDto>> GetFactsAsync(DateTime asOf, CancellationToken cancellationToken)
    {
        var at = asOf;
        var day = DateOnly.FromDateTime(at);

        var active = await dbContext.Employments.AsNoTracking()
            .Where(employment => employment.Status == EmploymentStatus.Active
                && employment.EffectiveFrom <= at
                && (employment.EffectiveTo == null || at < employment.EffectiveTo))
            .Select(employment => employment.EmployeeId)
            .Distinct()
            .ToListAsync(cancellationToken);
        var activeSet = active.ToHashSet();

        var assignments = (await dbContext.WorkAssignments.AsNoTracking()
                .Where(assignment => assignment.IsPrimary
                    && assignment.EffectiveFrom <= at
                    && (assignment.EffectiveTo == null || at < assignment.EffectiveTo))
                .OrderByDescending(assignment => assignment.EffectiveFrom)
                .Select(assignment => new { assignment.EmployeeId, assignment.OrgUnitId, assignment.JobId, assignment.PlaceId })
                .ToListAsync(cancellationToken))
            .GroupBy(assignment => assignment.EmployeeId)
            .ToDictionary(group => group.Key, group => group.First());

        var parents = await ParentsAsync(day, cancellationToken);

        var reports = (await dbContext.ManagerRelationships.AsNoTracking()
                .Where(relationship => relationship.Type == ReportingRelationshipType.PrimaryManager
                    && relationship.EffectiveFrom <= at
                    && (relationship.EffectiveTo == null || at < relationship.EffectiveTo))
                .Select(relationship => new { relationship.ManagerEmployeeId, relationship.SubjectEmployeeId })
                .ToListAsync(cancellationToken))
            .Where(link => activeSet.Contains(link.SubjectEmployeeId))
            .GroupBy(link => link.ManagerEmployeeId)
            .ToDictionary(group => group.Key, group => group.Select(link => link.SubjectEmployeeId).Distinct().Count());

        return active.Select(employeeId =>
        {
            var assignment = assignments.GetValueOrDefault(employeeId);
            return new RoleFactDto(
                employeeId,
                assignment is null ? [] : Chain(assignment.OrgUnitId, parents),
                assignment?.JobId,
                assignment?.PlaceId,
                reports.GetValueOrDefault(employeeId));
        }).ToList();
    }

    public async Task<RoleTargetsDto> ResolveTargetsAsync(IReadOnlyCollection<Guid> ids, DateTime asOf, CancellationToken cancellationToken)
    {
        var asked = ids.Distinct().Take(200).ToList();
        var day = DateOnly.FromDateTime(asOf);
        var units = await dbContext.OrgUnitEffectiveStates.AsNoTracking()
            .Where(state => asked.Contains(state.OrgUnitId)
                && state.EffectiveFrom <= day
                && (state.EffectiveTo == null || day < state.EffectiveTo))
            .Select(state => new { state.OrgUnitId, state.OrganizationalUnitTypeId })
            .ToListAsync(cancellationToken);
        var jobs = await dbContext.Jobs.AsNoTracking().Where(job => asked.Contains(job.Id)).Select(job => job.Id).ToListAsync(cancellationToken);
        var places = await dbContext.Places.AsNoTracking().Where(place => asked.Contains(place.Id)).Select(place => place.Id).ToListAsync(cancellationToken);

        return new RoleTargetsDto(
            units.Where(unit => unit.OrganizationalUnitTypeId == OrganizationalUnitTypeCatalog.DepartmentId).Select(unit => unit.OrgUnitId).Distinct().ToList(),
            units.Select(unit => unit.OrgUnitId).Distinct().ToList(),
            jobs,
            places);
    }

    private async Task<Dictionary<Guid, Guid?>> ParentsAsync(DateOnly day, CancellationToken cancellationToken)
        => (await dbContext.OrgUnitEffectiveStates.AsNoTracking()
                .Where(state => state.EffectiveFrom <= day && (state.EffectiveTo == null || day < state.EffectiveTo))
                .Select(state => new { state.OrgUnitId, state.ParentOrgUnitId })
                .ToListAsync(cancellationToken))
            .GroupBy(state => state.OrgUnitId)
            .ToDictionary(group => group.Key, group => group.First().ParentOrgUnitId);

    private static IReadOnlyList<Guid> Chain(Guid unitId, IReadOnlyDictionary<Guid, Guid?> parents)
    {
        var chain = new List<Guid> { unitId };
        var seen = new HashSet<Guid> { unitId };
        var parent = parents.GetValueOrDefault(unitId);
        while (parent is Guid id && seen.Add(id))
        {
            chain.Add(id);
            parent = parents.GetValueOrDefault(id);
        }

        return chain;
    }
}

/// <summary>Tenants whose role facts changed and that Identity should hear about.</summary>
public sealed class RoleFactsSignals
{
    private readonly Channel<Guid> _tenants = Channel.CreateBounded<Guid>(
        new BoundedChannelOptions(1024) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });

    public void Raise(Guid tenantId)
    {
        if (tenantId != Guid.Empty)
            _tenants.Writer.TryWrite(tenantId);
    }

    public ChannelReader<Guid> Reader => _tenants.Reader;
}

/// <summary>
/// Watches every save for a change a role's rule can see (a work assignment, a reporting line, an employment, a
/// unit) and, once it commits, signals the tenant. Covers every path that moves a person or a unit, imports included.
/// </summary>
public sealed class RoleFactsChangeInterceptor(RoleFactsSignals signals) : SaveChangesInterceptor
{
    private readonly ConditionalWeakTable<DbContext, HashSet<Guid>> _pending = new();

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        Capture(eventData.Context);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        Capture(eventData.Context);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
    {
        Flush(eventData.Context);
        return base.SavedChangesAsync(eventData, result, cancellationToken);
    }

    public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
    {
        Flush(eventData.Context);
        return base.SavedChanges(eventData, result);
    }

    public override void SaveChangesFailed(DbContextErrorEventData eventData)
    {
        if (eventData.Context is not null)
            _pending.Remove(eventData.Context);
        base.SaveChangesFailed(eventData);
    }

    public override Task SaveChangesFailedAsync(DbContextErrorEventData eventData, CancellationToken cancellationToken = default)
    {
        if (eventData.Context is not null)
            _pending.Remove(eventData.Context);
        return base.SaveChangesFailedAsync(eventData, cancellationToken);
    }

    private void Capture(DbContext? context)
    {
        if (context is null)
            return;

        var tenants = context.ChangeTracker.Entries()
            .Where(entry => entry.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
            .Select(entry => entry.Entity switch
            {
                WorkAssignment assignment => assignment.TenantId,
                ManagerRelationship relationship => relationship.TenantId,
                Employment employment => employment.TenantId,
                OrgUnitEffectiveState state => state.TenantId,
                _ => Guid.Empty,
            })
            .Where(tenantId => tenantId != Guid.Empty)
            .ToHashSet();
        if (tenants.Count > 0)
            _pending.AddOrUpdate(context, tenants);
    }

    // A save inside a transaction that later rolls back still signals: the recompute reads the committed truth
    // and changes nothing, so an extra signal costs a recompute, never a wrong role.
    private void Flush(DbContext? context)
    {
        if (context is null || !_pending.TryGetValue(context, out var tenants))
            return;
        _pending.Remove(context);
        foreach (var tenantId in tenants)
            signals.Raise(tenantId);
    }
}

/// <summary>Tells Identity, signed, which tenants' role facts changed; coalesces bursts (an import) into one call per tenant.</summary>
public sealed class RoleFactsNotifier(
    RoleFactsSignals signals,
    IHttpClientFactory httpClients,
    IInternalServiceRequestSigner signer,
    IConfiguration configuration,
    ILogger<RoleFactsNotifier> logger) : BackgroundService
{
    public const string ClientName = "role-facts-identity";
    private const string RecomputePath = "internal/identity/roles/recompute";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var first in signals.Reader.ReadAllAsync(stoppingToken))
        {
            // Let a burst settle, then send each tenant once.
            await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
            var batch = new HashSet<Guid> { first };
            while (signals.Reader.TryRead(out var next))
                batch.Add(next);

            foreach (var tenantId in batch)
                await NotifyAsync(tenantId, stoppingToken);
        }
    }

    private async Task NotifyAsync(Guid tenantId, CancellationToken stoppingToken)
    {
        var baseUrl = configuration["ServiceUrls:IdentityApiBaseUrl"];
        if (string.IsNullOrWhiteSpace(baseUrl))
            return;

        for (var attempt = 1; attempt <= 3; attempt++)
        {
            try
            {
                var uri = new Uri(new Uri(baseUrl.EndsWith('/') ? baseUrl : $"{baseUrl}/"), RecomputePath);
                using var request = new HttpRequestMessage(HttpMethod.Post, uri);
                request.Headers.TryAddWithoutValidation("X-Tenant-Id", tenantId.ToString());
                await signer.SignAsync(request, stoppingToken);
                using var response = await httpClients.CreateClient(ClientName).SendAsync(request, stoppingToken);
                if (response.IsSuccessStatusCode)
                    return;
            }
            catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException && !stoppingToken.IsCancellationRequested)
            {
            }

            await Task.Delay(TimeSpan.FromSeconds(5 * attempt), stoppingToken);
        }

        // Identity also sweeps every tenant on start-up and every six hours, so a missed signal is late, not lost.
        logger.LogWarning("Identity didn't take the role recompute for tenant {TenantId}", tenantId);
    }
}

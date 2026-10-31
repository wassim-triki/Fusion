using System.Threading.Channels;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.Identity.Infrastructure.Core;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Features.Roles;

/// <summary>Whether a person's Core HR facts put them among a role's holders.</summary>
public static class RoleHolderRules
{
    public static bool Matches(string holderKind, IReadOnlyCollection<AccessProfileRuleCondition> conditions, CoreRoleFact? fact)
        => holderKind switch
        {
            AccessProfileHolderKinds.Everyone => true,
            AccessProfileHolderKinds.Team => fact is { DirectReports: > 0 },
            AccessProfileHolderKinds.Rule => fact is not null
                && conditions.Count > 0
                && conditions.GroupBy(condition => condition.Kind).All(kind => kind.Any(condition => MatchesOne(condition, fact))),
            _ => false,
        };

    /// <summary>The conditions this person meets, for "why they have it".</summary>
    public static IReadOnlyList<AccessProfileRuleCondition> Met(IEnumerable<AccessProfileRuleCondition> conditions, CoreRoleFact fact)
        => conditions.Where(condition => MatchesOne(condition, fact)).ToList();

    private static bool MatchesOne(AccessProfileRuleCondition condition, CoreRoleFact fact)
        => condition.Kind switch
        {
            AccessProfileRuleKinds.Department or AccessProfileRuleKinds.Unit => fact.UnitChain.Contains(condition.TargetId),
            AccessProfileRuleKinds.Job => fact.JobId == condition.TargetId,
            AccessProfileRuleKinds.Place => fact.PlaceId == condition.TargetId,
            _ => false,
        };
}

public interface IRoleHolderService
{
    /// <summary>
    /// Brings every role's holders in line with today's facts: people the role's holders include are marked held
    /// by rule, people no longer included lose it unless they were chosen. Throws when Core HR can't answer, so
    /// nothing changes on a partial picture.
    /// </summary>
    Task RecomputeAsync(Guid tenantId, CancellationToken cancellationToken);
}

public sealed class RoleHolderService(
    AppIdentityDbContext dbContext,
    ICoreRoleFacts coreFacts,
    IAccessProfileService accessProfiles) : IRoleHolderService
{
    public async Task RecomputeAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        var profiles = await dbContext.AccessProfiles.IgnoreQueryFilters().AsNoTracking()
            .Include(profile => profile.RuleConditions)
            .Where(profile => profile.TenantId == tenantId && profile.InternalKey != TenantAdministratorAuthority.InternalKey)
            .ToListAsync(cancellationToken);
        if (profiles.Count == 0)
        {
            return;
        }

        // Facts first and outside the lock: a slow Core HR never holds the tenant's recompute lock.
        var needsFacts = profiles.Any(profile => profile.HolderKind is AccessProfileHolderKinds.Team or AccessProfileHolderKinds.Rule);
        var facts = needsFacts
            ? (await coreFacts.GetFactsAsync(tenantId, cancellationToken)).ToDictionary(fact => fact.EmployeeId)
            : [];

        var relational = dbContext.Database.IsRelational();
        await using var transaction = relational ? await dbContext.Database.BeginTransactionAsync(cancellationToken) : null;
        if (relational)
        {
            // One recompute per tenant at a time, so two can't both add the same person.
            await dbContext.Database.ExecuteSqlRawAsync(
                "SELECT pg_advisory_xact_lock(hashtextextended({0}, 177))", [tenantId.ToString()], cancellationToken);
        }

        var members = await dbContext.TenantMemberships.IgnoreQueryFilters().AsNoTracking()
            .Where(membership => membership.TenantId == tenantId
                && membership.Status == TenantMembershipStatus.Active
                && membership.EmployeeId != null)
            .Select(membership => new { membership.Id, membership.UserId, EmployeeId = membership.EmployeeId!.Value })
            .ToListAsync(cancellationToken);
        var rows = await dbContext.UserAccessProfiles.IgnoreQueryFilters()
            .Where(assignment => assignment.TenantId == tenantId)
            .ToListAsync(cancellationToken);

        var changedUsers = new HashSet<Guid>();
        foreach (var profile in profiles)
        {
            var matched = profile.HolderKind == AccessProfileHolderKinds.Chosen
                ? []
                : members
                    .Where(member => RoleHolderRules.Matches(profile.HolderKind, profile.RuleConditions, facts.GetValueOrDefault(member.EmployeeId)))
                    .ToDictionary(member => member.UserId, member => member.Id);

            foreach (var row in rows.Where(row => row.AccessProfileId == profile.Id))
            {
                var byRule = matched.ContainsKey(row.UserId);
                if (row.ByRule == byRule)
                {
                    continue;
                }

                row.SetByRule(byRule);
                changedUsers.Add(row.UserId);
                if (!row.IsHeld)
                {
                    dbContext.UserAccessProfiles.Remove(row);
                }
            }

            var holding = rows.Where(row => row.AccessProfileId == profile.Id).Select(row => row.UserId).ToHashSet();
            foreach (var (userId, membershipId) in matched.Where(match => !holding.Contains(match.Key)))
            {
                dbContext.UserAccessProfiles.Add(UserAccessProfile.MatchedByRule(tenantId, userId, profile.Id, membershipId));
                changedUsers.Add(userId);
            }
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        if (changedUsers.Count == 0)
        {
            return;
        }

        await accessProfiles.RefreshAccessAsync(tenantId, changedUsers, cancellationToken);
    }
}

/// <summary>Tenants whose role holders should be recomputed soon; a background worker drains it.</summary>
public sealed class RoleRecomputeQueue
{
    private readonly Channel<Guid> _tenants = Channel.CreateBounded<Guid>(
        new BoundedChannelOptions(1024) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });

    public void Enqueue(Guid tenantId)
    {
        if (tenantId != Guid.Empty)
        {
            _tenants.Writer.TryWrite(tenantId);
        }
    }

    public ChannelReader<Guid> Reader => _tenants.Reader;
}

/// <summary>
/// Keeps rule-held roles current: drains the queue (Core HR changes, accepted invitations), and sweeps every
/// tenant at start-up and every six hours so dated changes that took effect on their own day are caught.
/// A tenant whose recompute fails (Core HR down) is retried after a minute; its rows stay as they were.
/// </summary>
public sealed class RoleRecomputeWorker(
    RoleRecomputeQueue queue,
    IServiceScopeFactory scopes,
    ILogger<RoleRecomputeWorker> logger) : BackgroundService
{
    private static readonly TimeSpan SweepEvery = TimeSpan.FromHours(6);
    private static readonly TimeSpan RetryAfter = TimeSpan.FromMinutes(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _ = SweepLoopAsync(stoppingToken);

        await foreach (var tenantId in queue.Reader.ReadAllAsync(stoppingToken))
        {
            // Coalesce: a burst of changes to one tenant is one recompute.
            var batch = new HashSet<Guid> { tenantId };
            while (queue.Reader.TryRead(out var next))
            {
                batch.Add(next);
            }

            foreach (var id in batch)
            {
                await RecomputeAsync(id, stoppingToken);
            }
        }
    }

    private async Task SweepLoopAsync(CancellationToken stoppingToken)
    {
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                await using (var scope = scopes.CreateAsyncScope())
                {
                    var db = scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>();
                    var tenantIds = await db.Tenants.IgnoreQueryFilters().AsNoTracking()
                        .Where(tenant => tenant.IsActive && !tenant.IsArchived)
                        .Select(tenant => tenant.Id)
                        .ToListAsync(stoppingToken);
                    tenantIds.ForEach(queue.Enqueue);
                }

                await Task.Delay(SweepEvery, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Role holder sweep stopped");
        }
    }

    private async Task RecomputeAsync(Guid tenantId, CancellationToken stoppingToken)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<IRoleHolderService>().RecomputeAsync(tenantId, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogWarning("Role holders for tenant {TenantId} not recomputed ({ErrorType}); retrying", tenantId, exception.GetType().Name);
            _ = Task.Delay(RetryAfter, stoppingToken).ContinueWith(_ => queue.Enqueue(tenantId), TaskScheduler.Default);
        }
    }
}

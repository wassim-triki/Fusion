using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Features.TenantAdministration;

/// <summary>Where a tenant's Platform-assisted recovery stands.</summary>
public enum RecoveryStatus
{
    /// <summary>The tenant administers itself. Nothing for Platform to do.</summary>
    NotRequired = 0,

    /// <summary>Bootstrap is incomplete; bootstrap remediation remains authoritative.</summary>
    AwaitingAdministratorActivation,

    /// <summary>No usable administrator remains and no recovery is in flight.</summary>
    Required,

    /// <summary>A recovery invitation is outstanding.</summary>
    Pending,

    /// <summary>A recovery invitation was accepted and administration is restored.</summary>
    Completed,

    /// <summary>The last recovery attempt ended without restoring administration.</summary>
    Failed,
}

/// <summary>
/// What Platform can see about a customer tenant's administration.
/// <para>
/// Counts and status only. No administrator names' HR context, no employee
/// records, and no business data: Platform needs to know whether a customer can
/// administer their tenant, not who they are or what they do.
/// </para>
/// </summary>
public sealed record TenantContinuityHealthDto
{
    public int UsableAdministrators { get; init; }
    public int ActiveAdministrators { get; init; }
    public int SuspendedAdministrators { get; init; }
    public string RecoveryStatus { get; init; } = string.Empty;

    /// <summary>The outstanding or most recent recovery attempt, when there is one.</summary>
    public RecoveryAttemptDto? LatestRecoveryAttempt { get; init; }
}

public sealed record RecoveryAttemptDto
{
    public Guid InvitationId { get; init; }
    public string RecipientEmail { get; init; } = string.Empty;
    public DateTime InitiatedAt { get; init; }
    public Guid? InitiatedByUserId { get; init; }
    public string State { get; init; } = string.Empty;
    public string? DeliveryStatus { get; init; }
}

public interface ITenantContinuityHealthProjection
{
    Task<TenantContinuityHealthDto> GetAsync(Guid tenantId, CancellationToken cancellationToken = default);
}

public sealed class TenantContinuityHealthProjection(AppIdentityDbContext dbContext)
    : ITenantContinuityHealthProjection
{
    public async Task<TenantContinuityHealthDto> GetAsync(
        Guid tenantId, CancellationToken cancellationToken = default)
    {
        // Computed through the same predicate the commands enforce, so the
        // Platform view can never offer recovery the server would refuse.
        var usable = await UsableTenantAdministrator.CountAsync(dbContext, tenantId, cancellationToken);
        var activationStatus = await dbContext.Tenants
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(tenant => tenant.Id == tenantId)
            .Select(tenant => tenant.AdministratorActivationStatus)
            .SingleAsync(cancellationToken);

        var byStatus = await dbContext.TenantAdministratorAssignments
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(assignment => assignment.TenantId == tenantId && assignment.RevokedAt == null)
            .GroupBy(assignment => assignment.TenantMembership!.Status)
            .Select(group => new { Status = group.Key, Count = group.Count() })
            .ToListAsync(cancellationToken);

        var recovery = await dbContext.InviteTokens
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item => item.TenantId == tenantId
                && item.Purpose == InvitationPurpose.TenantAdministratorRecovery)
            .OrderByDescending(item => item.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);

        var attempt = recovery is null
            ? null
            : new RecoveryAttemptDto
            {
                InvitationId = recovery.Id,
                RecipientEmail = recovery.Email,
                InitiatedAt = recovery.CreatedAt,
                InitiatedByUserId = recovery.CreatedByUserId,
                State = recovery.State.ToString(),
                DeliveryStatus = recovery.DeliveryStatus,
            };

        return new TenantContinuityHealthDto
        {
            UsableAdministrators = usable,
            ActiveAdministrators = byStatus
                .Where(item => item.Status == TenantMembershipStatus.Active).Sum(item => item.Count),
            SuspendedAdministrators = byStatus
                .Where(item => item.Status == TenantMembershipStatus.Suspended).Sum(item => item.Count),
            RecoveryStatus = ResolveStatus(activationStatus, usable, recovery?.State).ToString(),
            LatestRecoveryAttempt = attempt,
        };
    }

    /// <summary>
    /// Recovery status follows the tenant's actual state, not a stored flag that
    /// could drift from it.
    /// </summary>
    private static RecoveryStatus ResolveStatus(
        TenantAdministratorActivationStatus activationStatus,
        int usable,
        InvitationState? latestRecoveryState)
    {
        if (activationStatus != TenantAdministratorActivationStatus.Active)
        {
            return RecoveryStatus.AwaitingAdministratorActivation;
        }

        if (usable > 0)
        {
            // Administration exists again. If a recovery got it there, say so;
            // otherwise the tenant restored itself and Platform has nothing to
            // report.
            return latestRecoveryState == InvitationState.Accepted
                ? RecoveryStatus.Completed
                : RecoveryStatus.NotRequired;
        }

        return latestRecoveryState switch
        {
            InvitationState.Pending => RecoveryStatus.Pending,

            // A recovery was issued and is now unusable, yet the tenant still has
            // no administrator: the attempt did not achieve what it was for.
            InvitationState.Expired or InvitationState.Revoked or InvitationState.Superseded
                => RecoveryStatus.Failed,

            _ => RecoveryStatus.Required,
        };
    }
}

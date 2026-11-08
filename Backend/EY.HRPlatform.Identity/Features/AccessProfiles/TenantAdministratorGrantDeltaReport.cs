using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace EY.HRPlatform.Identity.Features.AccessProfiles;

/// <summary>
/// Reports what migrating to the canonical Tenant Administrator authority changed
/// about each tenant's administrator permissions.
/// <para>
/// Migrated administrators move from the pre-canonical <c>org-admin</c> grant set
/// to the fuller Tenant Administrator set. That broadening is the locked intent,
/// but it is a real permission change, so it is reported per tenant rather than
/// applied silently.
/// </para>
/// <para>
/// The comparison lives here rather than in the migration because both grant sets
/// are composed from the permission catalogue and the tenant's module
/// entitlements, which are code, not schema. Restating them in SQL would let the
/// two drift.
/// </para>
/// </summary>
public sealed class TenantAdministratorGrantDeltaReport(
    AppIdentityDbContext dbContext,
    ILogger<TenantAdministratorGrantDeltaReport> logger)
{
    public async Task ReportAsync(CancellationToken cancellationToken = default)
    {
        var tenantIds = await dbContext.TenantAdministratorAssignments
            .IgnoreQueryFilters()
            .Where(assignment => assignment.RevokedAt == null)
            .Select(assignment => assignment.TenantId)
            .Distinct()
            .ToListAsync(cancellationToken);

        foreach (var tenantId in tenantIds)
        {
            var previous = await dbContext.AccessProfiles
                .IgnoreQueryFilters()
                .Include(profile => profile.Grants)
                .Where(profile => profile.TenantId == tenantId && profile.InternalKey == "org-admin")
                .SelectMany(profile => profile.Grants)
                .Select(grant => grant.PermissionKey + ":" + grant.Scope)
                .ToListAsync(cancellationToken);

            var current = await dbContext.AccessProfiles
                .IgnoreQueryFilters()
                .Include(profile => profile.Grants)
                .Where(profile => profile.TenantId == tenantId
                    && profile.InternalKey == TenantAdministratorAuthority.InternalKey)
                .SelectMany(profile => profile.Grants)
                .Select(grant => grant.PermissionKey + ":" + grant.Scope)
                .ToListAsync(cancellationToken);

            var added = current.Except(previous, StringComparer.Ordinal).OrderBy(g => g, StringComparer.Ordinal).ToList();
            var removed = previous.Except(current, StringComparer.Ordinal).OrderBy(g => g, StringComparer.Ordinal).ToList();

            var administrators = await dbContext.TenantAdministratorAssignments
                .IgnoreQueryFilters()
                .CountAsync(assignment => assignment.TenantId == tenantId && assignment.RevokedAt == null, cancellationToken);

            logger.LogInformation(
                "Administrator grant delta for tenant {TenantId}: {AdministratorCount} administrator(s); "
                + "{AddedCount} grant(s) added [{Added}]; {RemovedCount} grant(s) removed [{Removed}].",
                tenantId,
                administrators,
                added.Count,
                string.Join(", ", added),
                removed.Count,
                string.Join(", ", removed));
        }
    }
}

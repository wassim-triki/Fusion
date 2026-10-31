using System.Linq.Expressions;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Features.TenantAdministration;

/// <summary>
/// The one authoritative answer to "can this tenant still be administered".
/// <para>
/// Commands, the customer workspace, and the Platform continuity view all read
/// this predicate. There is deliberately no second copy in a projection query or
/// in raw SQL: two definitions of usable would eventually disagree, and the
/// disagreement would decide whether a tenant can be locked out or whether
/// Platform can act on a live tenant.
/// </para>
/// </summary>
public static class UsableTenantAdministrator
{
    /// <summary>
    /// A company keeps at least two administrators once it has two (D-25): a command that would take it below this
    /// is refused, so one person leaving or losing access never leaves the company without a way back.
    /// </summary>
    public const int Minimum = 2;

    /// <summary>
    /// An administrator is usable when the tenant is live, the account is active,
    /// the membership is Active, and the canonical authority is unrevoked.
    /// </summary>
    /// <remarks>
    /// Deliberately excluded, so a later reader does not "fix" this by adding them:
    /// <list type="bullet">
    /// <item><description>
    /// A sign-in lockout in the future. Lockout is transient and self-clearing, and
    /// anyone able to trigger repeated failed sign-ins could otherwise manufacture
    /// Platform recovery eligibility against a tenant that still has a real
    /// administrator.
    /// </description></item>
    /// <item><description>
    /// A missing password hash, an unconfirmed email, or a stale last sign-in.
    /// None of these is durable evidence that authority is gone.
    /// </description></item>
    /// </list>
    /// An administrator whose account is usable but who cannot personally reach it
    /// — a lost mailbox, forgotten credentials — still counts here. Restoring that
    /// person is verified account recovery, which is a separate capability; it is
    /// not a reason to let Platform take over a live tenant.
    /// </remarks>
    public static Expression<Func<TenantAdministratorAssignment, bool>> Predicate =>
        assignment =>
            assignment.RevokedAt == null
            && assignment.TenantMembership!.Status == TenantMembershipStatus.Active
            && assignment.User!.IsActive
            && assignment.TenantMembership!.Tenant!.IsActive
            && !assignment.TenantMembership!.Tenant!.IsArchived;

    /// <summary>
    /// Every usable administrator assignment for one tenant.
    /// Callers inside the continuity transaction must have taken the tenant lock
    /// first; a count read outside the lock is advisory only.
    /// </summary>
    public static IQueryable<TenantAdministratorAssignment> ForTenant(
        AppIdentityDbContext dbContext,
        Guid tenantId)
        => dbContext.TenantAdministratorAssignments
            .IgnoreQueryFilters()
            .Include(assignment => assignment.TenantMembership)
                .ThenInclude(membership => membership!.Tenant)
            .Include(assignment => assignment.User)
            .Where(assignment => assignment.TenantId == tenantId)
            .Where(Predicate);

    public static Task<int> CountAsync(
        AppIdentityDbContext dbContext,
        Guid tenantId,
        CancellationToken cancellationToken = default)
        => ForTenant(dbContext, tenantId).CountAsync(cancellationToken);

    /// <summary>
    /// The usable count excluding one membership, which is how a command asks
    /// "would the tenant still be administered if I committed this?" before the
    /// mutation is applied.
    /// </summary>
    public static Task<int> CountExcludingAsync(
        AppIdentityDbContext dbContext,
        Guid tenantId,
        Guid excludedMembershipId,
        CancellationToken cancellationToken = default)
        => ForTenant(dbContext, tenantId)
            .Where(assignment => assignment.TenantMembershipId != excludedMembershipId)
            .CountAsync(cancellationToken);
}

using System.Text.Json;
using EY.HRPlatform.Identity.Features.Notifications;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Features.TenantAdministration;

/// <summary>
/// Identifies the administrator a command acts on, together with the version of
/// their state the caller was looking at.
/// <para>
/// The tenant lock prevents corruption; it does not prevent a person acting on a
/// screen that is half a minute stale. <see cref="ExpectedVersion"/> is how the
/// second problem is caught, so an administrator is never surprised by what their
/// click actually did.
/// </para>
/// </summary>
public sealed record AdministratorCommand(
    Guid TenantId,
    Guid MembershipId,
    Guid ActorUserId,
    uint? ExpectedVersion = null,
    string? Reason = null);

public interface ITenantAdministratorLifecycleService
{
    Task<ContinuityResult<Guid>> SuspendAsync(AdministratorCommand command, CancellationToken cancellationToken = default);

    Task<ContinuityResult<Guid>> ReactivateAsync(AdministratorCommand command, CancellationToken cancellationToken = default);

    Task<ContinuityResult<Guid>> GrantAuthorityAsync(AdministratorCommand command, CancellationToken cancellationToken = default);

    Task<ContinuityResult<Guid>> RevokeAuthorityAsync(AdministratorCommand command, CancellationToken cancellationToken = default);
}

/// <summary>
/// The administrator lifecycle: suspension, reactivation, and the granting and
/// revoking of canonical Tenant Administrator authority.
/// <para>
/// Every command runs inside the tenant continuity boundary, so none of them can
/// be the one that leaves a tenant with nobody able to administer it — including
/// an administrator removing their own authority.
/// </para>
/// </summary>
public sealed class TenantAdministratorLifecycleService(
    AppIdentityDbContext dbContext,
    ITenantContinuityCommandExecutor continuity,
    IAdministratorRoleMail? roleMail = null) : ITenantAdministratorLifecycleService
{
    public Task<ContinuityResult<Guid>> SuspendAsync(
        AdministratorCommand command, CancellationToken cancellationToken = default)
        => continuity.ExecuteAsync(command.TenantId, command.ActorUserId, async context =>
        {
            var membership = await LoadMembershipAsync(context, command, cancellationToken);

            if (membership is null)
            {
                return ContinuityResult<Guid>.Refused(ContinuityFailure.NotFound);
            }

            if (!VersionMatches(membership, command))
            {
                return ContinuityResult<Guid>.Refused(ContinuityFailure.StaleState);
            }

            if (membership.Status == TenantMembershipStatus.Suspended)
            {
                return ContinuityResult<Guid>.Refused(
                    ContinuityFailure.NotApplicable, "Access is already suspended.");
            }

            // Suspension is a tenant-scoped decision. It never touches the global
            // Identity account, which belongs to the person rather than to this
            // tenant's administration.
            membership.Suspend(command.ActorUserId, command.Reason);
            context.InvalidateTenantAccess(membership);

            context.Audit(Event(
                command, AccessAuditActions.MembershipSuspended, membership,
                "Tenant access suspended. Account, membership, authority, and history are preserved.",
                before: nameof(TenantMembershipStatus.Active),
                after: nameof(TenantMembershipStatus.Suspended)));

            return ContinuityResult<Guid>.Ok(membership.Id);
        }, cancellationToken);

    public Task<ContinuityResult<Guid>> ReactivateAsync(
        AdministratorCommand command, CancellationToken cancellationToken = default)
        => continuity.ExecuteAsync(command.TenantId, command.ActorUserId, async context =>
        {
            var membership = await LoadMembershipAsync(context, command, cancellationToken);

            if (membership is null)
            {
                return ContinuityResult<Guid>.Refused(ContinuityFailure.NotFound);
            }

            if (!VersionMatches(membership, command))
            {
                return ContinuityResult<Guid>.Refused(ContinuityFailure.StaleState);
            }

            if (membership.Status == TenantMembershipStatus.Active)
            {
                return ContinuityResult<Guid>.Refused(
                    ContinuityFailure.NotApplicable, "Access is already active.");
            }

            // Restores access from the authority this membership already holds. No
            // account, membership, or assignment is created.
            membership.Reactivate(command.ActorUserId);

            // Reactivation bumps the revision too, so an access token issued before
            // the suspension cannot come back to life. The person signs in again
            // and receives a token carrying the current revision.
            context.InvalidateTenantAccess(membership);

            context.Audit(Event(
                command, AccessAuditActions.MembershipReactivated, membership,
                "Tenant access reactivated using existing Tenant Administrator authority.",
                before: nameof(TenantMembershipStatus.Suspended),
                after: nameof(TenantMembershipStatus.Active)));

            return ContinuityResult<Guid>.Ok(membership.Id);
        }, cancellationToken);

    public async Task<ContinuityResult<Guid>> GrantAuthorityAsync(
        AdministratorCommand command, CancellationToken cancellationToken = default)
    {
        Guid? grantedTo = null;
        var result = await continuity.ExecuteAsync(command.TenantId, command.ActorUserId, async context =>
        {
            var membership = await LoadMembershipAsync(context, command, cancellationToken);

            if (membership is null)
            {
                return ContinuityResult<Guid>.Refused(ContinuityFailure.NotFound);
            }

            if (!VersionMatches(membership, command))
            {
                return ContinuityResult<Guid>.Refused(ContinuityFailure.StaleState);
            }

            var existing = await ActiveAssignmentAsync(context, membership.Id, cancellationToken);

            // Idempotent: granting authority someone already holds is not an error,
            // and must not create a second active assignment.
            if (existing is not null)
            {
                return ContinuityResult<Guid>.Ok(existing.Id);
            }

            // Re-granting after a revocation adds a new active assignment alongside
            // the preserved revoked one, so grant → revoke → re-grant reads as a
            // sequence rather than as a single mutated row.
            var assignment = TenantAdministratorAssignment.Grant(
                membership,
                TenantAdministratorGrantActor.TenantAdministrator,
                grantedByUserId: command.ActorUserId);

            context.Db.TenantAdministratorAssignments.Add(assignment);
            context.InvalidateTenantAccess(membership, endSessions: false);

            context.Audit(Event(
                command, AccessAuditActions.AuthorityGranted, membership,
                "Tenant Administrator authority granted.",
                before: "None", after: TenantAdministratorAuthority.DisplayName));

            grantedTo = membership.UserId;
            return ContinuityResult<Guid>.Ok(assignment.Id);
        }, cancellationToken);
        await TellAsync(result, grantedTo, gained: true, command, cancellationToken);
        return result;
    }

    public async Task<ContinuityResult<Guid>> RevokeAuthorityAsync(
        AdministratorCommand command, CancellationToken cancellationToken = default)
    {
        Guid? revokedFrom = null;
        var result = await continuity.ExecuteAsync(command.TenantId, command.ActorUserId, async context =>
        {
            var membership = await LoadMembershipAsync(context, command, cancellationToken);

            if (membership is null)
            {
                return ContinuityResult<Guid>.Refused(ContinuityFailure.NotFound);
            }

            if (!VersionMatches(membership, command))
            {
                return ContinuityResult<Guid>.Refused(ContinuityFailure.StaleState);
            }

            var assignment = await ActiveAssignmentAsync(context, membership.Id, cancellationToken);

            if (assignment is null)
            {
                return ContinuityResult<Guid>.Refused(
                    ContinuityFailure.NotApplicable, "This person does not hold Tenant Administrator authority.");
            }

            // The row is kept, not deleted: revoked authority is history a tenant
            // needs to be able to read back.
            assignment.Revoke(command.ActorUserId, command.Reason);
            context.InvalidateTenantAccess(membership);

            // Self-removal is the same command with the actor as target. It is
            // audited distinctly because "I gave up my own administration" and
            // "someone removed mine" are different events to read later.
            var isSelfRemoval = membership.UserId == command.ActorUserId;

            context.Audit(Event(
                command,
                isSelfRemoval ? AccessAuditActions.AuthoritySelfRemoved : AccessAuditActions.AuthorityRevoked,
                membership,
                isSelfRemoval
                    ? "Tenant Administrator authority removed by the administrator themselves. Account, membership, and history remain."
                    : "Tenant Administrator authority removed. Account, membership, and history remain.",
                before: TenantAdministratorAuthority.DisplayName, after: "None"));

            revokedFrom = membership.UserId;
            return ContinuityResult<Guid>.Ok(assignment.Id);
        }, cancellationToken);
        await TellAsync(result, revokedFrom, gained: false, command, cancellationToken);
        return result;
    }

    /// <summary>Account mail once the change has committed; nothing when it was refused or changed nothing.</summary>
    private async Task TellAsync(ContinuityResult<Guid> result, Guid? userId, bool gained, AdministratorCommand command,
        CancellationToken cancellationToken)
    {
        if (roleMail is null || !result.Succeeded || userId is not { } target) return;
        await roleMail.SendAsync(new AdministratorRoleChange(command.TenantId, target, TenantAdministratorAuthority.DisplayName,
            gained, command.ActorUserId), cancellationToken);
    }

    // ── plumbing ─────────────────────────────────────────

    /// <summary>
    /// Loads the membership under the tenant lock. Scoped by tenant, so a command
    /// naming a membership in another tenant finds nothing rather than acting on it.
    /// </summary>
    private static Task<TenantMembership?> LoadMembershipAsync(
        TenantContinuityContext context, AdministratorCommand command, CancellationToken cancellationToken)
        => context.Db.TenantMemberships
            .IgnoreQueryFilters()
            .Include(membership => membership.User)
            .FirstOrDefaultAsync(membership => membership.Id == command.MembershipId
                && membership.TenantId == command.TenantId, cancellationToken);

    private static Task<TenantAdministratorAssignment?> ActiveAssignmentAsync(
        TenantContinuityContext context, Guid membershipId, CancellationToken cancellationToken)
        => context.Db.TenantAdministratorAssignments
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(assignment => assignment.TenantMembershipId == membershipId
                && assignment.RevokedAt == null, cancellationToken);

    /// <summary>
    /// Compares the caller's expected version against the state read under the
    /// lock. A caller that supplies no version is not making a claim about what
    /// they saw, so there is nothing to conflict with.
    /// </summary>
    private static bool VersionMatches(TenantMembership membership, AdministratorCommand command)
    {
        if (command.ExpectedVersion is null)
        {
            return true;
        }

        return membership.Version == command.ExpectedVersion.Value;
    }

    private static AccessAuditEvent Event(
        AdministratorCommand command,
        string action,
        TenantMembership membership,
        string summary,
        string before,
        string after)
        => AccessAuditEvent.Create(
            command.TenantId,
            command.ActorUserId,
            actorName: string.Empty,
            actorRole: TenantAdministratorAuthority.DisplayName,
            action: action,
            resourceType: AccessAuditActions.ResourceTypeAdministrator,
            resourceId: membership.Id.ToString(),
            summary: summary,
            // The person is named in the record so Change history can say who was made or stopped being an
            // administrator, even after the account is renamed or gone.
            beforeJson: JsonSerializer.Serialize(new { state = before, person = membership.User?.FullName.Trim() }),
            afterJson: JsonSerializer.Serialize(new { state = after, person = membership.User?.FullName.Trim() }),
            correlationId: null);
}

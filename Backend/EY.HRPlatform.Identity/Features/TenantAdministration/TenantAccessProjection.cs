using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Features.TenantAdministration;

/// <summary>
/// How the tenant's administrative continuity reads right now.
/// <para>
/// <see cref="ContinuityState"/> is derived from the same usable-administrator
/// predicate the commands enforce, so the workspace can never encourage an action
/// the server is about to refuse.
/// </para>
/// </summary>
public enum ContinuityState
{
    /// <summary>More than one usable administrator. Nothing to raise.</summary>
    Healthy = 0,

    /// <summary>
    /// Exactly one usable administrator remains. Worth surfacing, but it does not
    /// block anything: this is a recommendation, not an onboarding gate.
    /// </summary>
    AtRisk,

    /// <summary>No usable administrator. Only Platform-assisted recovery restores this.</summary>
    RecoveryRequired,
}

public sealed record TenantAccessSummary(
    /// <summary>
    /// The tenant as the customer knows it. Carried here because the locked
    /// consequence copy names the tenant, and a session token does not.
    /// </summary>
    string TenantName,
    int ActiveAdministrators,
    int SuspendedAdministrators,
    int PendingInvitations,
    int UsableAdministrators,
    string Continuity);

/// <summary>
/// One established administrator, as the workspace lists them.
/// <para>
/// <see cref="BlockedReason"/> is populated when this person is the tenant's only
/// usable administrator, so the maintenance experience can state why suspension
/// and authority removal are unavailable <em>before</em> anyone tries.
/// </para>
/// </summary>
public sealed record TenantAdministratorListItem(
    Guid MembershipId,
    Guid UserId,
    string Name,
    string Email,
    string Status,
    DateTime AccessEstablishedAt,
    bool IsUsable,
    string? BlockedReason,
    uint Version,
    /// <summary>
    /// Who established this authority, resolved to a person's name where one acted
    /// and to a stable system phrase where none did. The maintenance panel shows it
    /// as provenance, so "how did this access come to exist" is answerable without
    /// opening the activity log.
    /// </summary>
    string AddedBy,
    /// <summary>How the authority came: <c>activation</c>, <c>invitation</c>, <c>recovery</c> or <c>administrator</c>.</summary>
    string AddedByKind = AdministratorOrigins.Administrator,
    /// <summary>The administrator who added them, when one did.</summary>
    string? AddedByName = null,
    Guid? EmployeeId = null);

public static class AdministratorOrigins
{
    public const string Activation = "activation";
    public const string Invitation = "invitation";
    public const string Recovery = "recovery";
    public const string Administrator = "administrator";

    public static string Of(TenantAdministratorGrantActor actor) => actor switch
    {
        TenantAdministratorGrantActor.BootstrapActivation => Activation,
        TenantAdministratorGrantActor.PlatformRecovery => Recovery,
        TenantAdministratorGrantActor.InvitationAcceptance => Invitation,
        _ => Administrator,
    };
}

/// <summary>
/// One grant or removal of administrator authority, newest first. Read from the assignments themselves, which are
/// never deleted, so every grant is kept.
/// </summary>
/// <param name="Kind">An <see cref="AdministratorOrigins"/> value for a grant; <c>removed</c> or <c>stepped-down</c> for a removal.</param>
public sealed record AdministratorHistoryItem(DateTime At, string Kind, string PersonName, string? ActorName);

/// <summary>Someone in the company who could be made an administrator; only people who already sign in can be.</summary>
public sealed record AdministratorCandidate(Guid UserId, Guid? EmployeeId, string Name, string? JobTitle, bool SignsIn);

/// <summary>
/// An administrator whose authority has been revoked and not re-granted. Kept as a
/// distinct read because a removed administrator is history the tenant needs to
/// account for, not an operational row that can be acted on.
/// </summary>
public sealed record RemovedAdministratorListItem(
    Guid MembershipId,
    Guid UserId,
    string Name,
    string Email,
    DateTime RemovedAt,
    string RemovedBy,
    string? Reason);

public sealed record AdministratorInvitationListItem(
    Guid InvitationId,
    string Email,
    /// <summary>
    /// The recipient's name as captured on the invitation, or empty when it was
    /// issued without one. Unconfirmed until acceptance, but shown so the pending
    /// list reads the same as the administrator list.
    /// </summary>
    string Name,
    string State,
    string Purpose,
    DateTime IssuedAt,
    DateTime ExpiresAt,
    string? DeliveryStatus);

public sealed record AccessActivityItem(
    Guid Id,
    DateTime OccurredAt,
    string Action,
    string ActorName,
    string ActorRole,
    string Summary,
    string? ResourceId)
{
    /// <summary>Carried so the reader can name the person; never serialized.</summary>
    internal Guid? ActorUserId { get; init; }
}

public sealed record AccessActivityPage(
    IReadOnlyList<AccessActivityItem> Items,
    DateTime? NextCursorOccurredAt,
    Guid? NextCursorId);

public interface ITenantAccessProjection
{
    Task<TenantAccessSummary> GetSummaryAsync(Guid tenantId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<TenantAdministratorListItem>> GetAdministratorsAsync(
        Guid tenantId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<RemovedAdministratorListItem>> GetRemovedAdministratorsAsync(
        Guid tenantId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<AdministratorHistoryItem>> GetAdministratorHistoryAsync(
        Guid tenantId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<AdministratorCandidate>> GetAdministratorCandidatesAsync(
        Guid tenantId, string? search, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<AdministratorInvitationListItem>> GetInvitationsAsync(
        Guid tenantId, bool includeHistorical = false, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<AccessActivityItem>> GetRecentActivityAsync(
        Guid tenantId, int take = 5, CancellationToken cancellationToken = default);

    Task<AccessActivityPage> GetActivityPageAsync(
        Guid tenantId,
        DateTime? cursorOccurredAt,
        Guid? cursorId,
        DateTime? from,
        DateTime? to,
        string? actionCategory,
        int pageSize = 25,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Read models for the customer Access workspace.
/// <para>
/// Continuity is computed only through <see cref="UsableTenantAdministrator"/>.
/// A second definition here would eventually disagree with the one the commands
/// enforce, and the workspace would start offering actions that fail.
/// </para>
/// </summary>
public sealed class TenantAccessProjection(AppIdentityDbContext dbContext) : ITenantAccessProjection
{
    /// <summary>
    /// The locked reason a final administrator cannot be suspended or have their
    /// authority removed. Shown before interaction rather than after a refusal.
    /// </summary>
    public const string FinalAdministratorReason =
        "A company keeps at least two administrators. Add another before removing or suspending one.";

    public async Task<TenantAccessSummary> GetSummaryAsync(
        Guid tenantId, CancellationToken cancellationToken = default)
    {
        var usable = await UsableTenantAdministrator.CountAsync(dbContext, tenantId, cancellationToken);

        var tenantName = await dbContext.Tenants
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(tenant => tenant.Id == tenantId)
            .Select(tenant => tenant.Name)
            .FirstOrDefaultAsync(cancellationToken) ?? string.Empty;

        var byStatus = await dbContext.TenantAdministratorAssignments
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(assignment => assignment.TenantId == tenantId && assignment.RevokedAt == null)
            .GroupBy(assignment => assignment.TenantMembership!.Status)
            .Select(group => new { Status = group.Key, Count = group.Count() })
            .ToListAsync(cancellationToken);

        var pending = await dbContext.InviteTokens
            .IgnoreQueryFilters()
            .AsNoTracking()
            .CountAsync(item => item.TenantId == tenantId
                && item.Purpose == InvitationPurpose.TenantAdministrator
                && item.AcceptedAt == null
                && !item.IsRevoked
                && item.SupersededAt == null
                && item.ExpiresAt > DateTime.UtcNow, cancellationToken);

        return new TenantAccessSummary(
            TenantName: tenantName,
            ActiveAdministrators: byStatus
                .Where(item => item.Status == TenantMembershipStatus.Active)
                .Sum(item => item.Count),
            SuspendedAdministrators: byStatus
                .Where(item => item.Status == TenantMembershipStatus.Suspended)
                .Sum(item => item.Count),
            PendingInvitations: pending,
            UsableAdministrators: usable,
            Continuity: (usable switch
            {
                0 => ContinuityState.RecoveryRequired,
                1 => ContinuityState.AtRisk,
                _ => ContinuityState.Healthy,
            }).ToString());
    }

    public async Task<IReadOnlyList<TenantAdministratorListItem>> GetAdministratorsAsync(
        Guid tenantId, CancellationToken cancellationToken = default)
    {
        // Usability is decided by the one authoritative predicate, evaluated in the
        // database. Recomputing the same rule here would be a second definition of
        // "usable" that could drift from the one the commands enforce — and the
        // workspace would start offering actions the server refuses, or hide the
        // final-administrator reason when it matters most.
        var usableMembershipIds = await UsableTenantAdministrator
            .ForTenant(dbContext, tenantId)
            .AsNoTracking()
            .Select(assignment => assignment.TenantMembershipId)
            .ToListAsync(cancellationToken);

        var usable = usableMembershipIds.ToHashSet();

        // Only people who currently hold authority. Someone whose authority was
        // removed is history, not an administrator with an empty role, so they
        // belong in activity rather than in this operational list.
        var administrators = await dbContext.TenantAdministratorAssignments
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(assignment => assignment.TenantId == tenantId && assignment.RevokedAt == null)
            .Select(assignment => new
            {
                assignment.TenantMembershipId,
                assignment.UserId,
                assignment.GrantedAt,
                assignment.GrantedByActorType,
                assignment.GrantedByUserId,
                Status = assignment.TenantMembership!.Status,
                Version = assignment.TenantMembership!.Version,
                EmployeeId = assignment.TenantMembership!.EmployeeId,
                FirstName = assignment.User!.FirstName,
                LastName = assignment.User!.LastName,
                Email = assignment.User!.Email,
            })
            .OrderBy(item => item.FirstName)
            .ThenBy(item => item.LastName)
            .ToListAsync(cancellationToken);

        var grantorNames = await ResolveNamesAsync(
            administrators.Where(item => item.GrantedByUserId.HasValue)
                .Select(item => item.GrantedByUserId!.Value),
            cancellationToken);

        return administrators.Select(item =>
        {
            var isUsable = usable.Contains(item.TenantMembershipId);

            return new TenantAdministratorListItem(
                item.TenantMembershipId,
                item.UserId,
                $"{item.FirstName} {item.LastName}".Trim(),
                item.Email ?? string.Empty,
                item.Status.ToString(),
                item.GrantedAt,
                isUsable,
                // A pending invitation does not satisfy continuity: nobody has
                // accepted it, so it cannot administer anything yet.
                isUsable && usable.Count <= UsableTenantAdministrator.Minimum ? FinalAdministratorReason : null,
                item.Version,
                DescribeAddedBy(item.GrantedByActorType, item.GrantedByUserId, grantorNames),
                AdministratorOrigins.Of(item.GrantedByActorType),
                item.GrantedByUserId is { } grantor && grantorNames.TryGetValue(grantor, out var grantorName)
                    && !string.IsNullOrWhiteSpace(grantorName) ? grantorName : null,
                item.EmployeeId);
        }).ToList();
    }

    public async Task<IReadOnlyList<RemovedAdministratorListItem>> GetRemovedAdministratorsAsync(
        Guid tenantId, CancellationToken cancellationToken = default)
    {
        // A membership with any unrevoked authority is not removed — a grant that
        // followed a revocation makes the person a current administrator again.
        var stillActive = await dbContext.TenantAdministratorAssignments
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(assignment => assignment.TenantId == tenantId && assignment.RevokedAt == null)
            .Select(assignment => assignment.TenantMembershipId)
            .Distinct()
            .ToListAsync(cancellationToken);

        var revoked = await dbContext.TenantAdministratorAssignments
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(assignment => assignment.TenantId == tenantId
                && assignment.RevokedAt != null
                && !stillActive.Contains(assignment.TenantMembershipId))
            .Select(assignment => new
            {
                assignment.TenantMembershipId,
                assignment.UserId,
                assignment.RevokedAt,
                assignment.RevokedByUserId,
                assignment.RevocationReason,
                FirstName = assignment.User!.FirstName,
                LastName = assignment.User!.LastName,
                Email = assignment.User!.Email,
            })
            .ToListAsync(cancellationToken);

        // The most recent revocation per membership is the one that ended their
        // access; earlier revoked grants are part of the same person's history.
        var latest = revoked
            .GroupBy(item => item.TenantMembershipId)
            .Select(group => group.OrderByDescending(item => item.RevokedAt).First())
            .OrderByDescending(item => item.RevokedAt)
            .ToList();

        var revokerNames = await ResolveNamesAsync(
            latest.Where(item => item.RevokedByUserId.HasValue && item.RevokedByUserId != item.UserId)
                .Select(item => item.RevokedByUserId!.Value),
            cancellationToken);

        return latest.Select(item => new RemovedAdministratorListItem(
            item.TenantMembershipId,
            item.UserId,
            $"{item.FirstName} {item.LastName}".Trim(),
            item.Email ?? string.Empty,
            item.RevokedAt!.Value,
            item.RevokedByUserId == item.UserId
                ? "Removed themselves"
                : item.RevokedByUserId is { } id
                    && revokerNames.TryGetValue(id, out var name)
                    && !string.IsNullOrWhiteSpace(name)
                        ? name
                        : "An administrator",
            string.IsNullOrWhiteSpace(item.RevocationReason) ? null : item.RevocationReason))
            .ToList();
    }

    /// <summary>Resolves a set of account ids to display names in one query.</summary>
    private async Task<Dictionary<Guid, string>> ResolveNamesAsync(
        IEnumerable<Guid> userIds, CancellationToken cancellationToken)
    {
        var ids = userIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            return [];
        }

        return await dbContext.Users
            .AsNoTracking()
            .IgnoreQueryFilters()
            .Where(user => ids.Contains(user.Id))
            .ToDictionaryAsync(
                user => user.Id,
                user => $"{user.FirstName} {user.LastName}".Trim(),
                cancellationToken);
    }

    /// <summary>
    /// The human answer to "who added this administrator". A person's name where an
    /// account acted; a stable system phrase where the grant came from the tenant's
    /// own activation or from Platform recovery, which have no acting administrator.
    /// </summary>
    private static string DescribeAddedBy(
        TenantAdministratorGrantActor actorType,
        Guid? grantorId,
        IReadOnlyDictionary<Guid, string> names)
    {
        var grantorName = grantorId is { } id
            && names.TryGetValue(id, out var name)
            && !string.IsNullOrWhiteSpace(name)
                ? name
                : null;

        return actorType switch
        {
            TenantAdministratorGrantActor.BootstrapActivation => "System (tenant activation)",
            TenantAdministratorGrantActor.PlatformRecovery => "Platform recovery",
            TenantAdministratorGrantActor.InvitationAcceptance => grantorName ?? "Invitation accepted",
            _ => grantorName ?? "An administrator",
        };
    }

    public async Task<IReadOnlyList<AdministratorHistoryItem>> GetAdministratorHistoryAsync(
        Guid tenantId, CancellationToken cancellationToken = default)
    {
        var rows = await dbContext.TenantAdministratorAssignments
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(assignment => assignment.TenantId == tenantId)
            .Select(assignment => new
            {
                assignment.UserId,
                assignment.GrantedAt,
                assignment.GrantedByUserId,
                assignment.GrantedByActorType,
                assignment.RevokedAt,
                assignment.RevokedByUserId,
                FirstName = assignment.User!.FirstName,
                LastName = assignment.User!.LastName,
            })
            .ToListAsync(cancellationToken);

        var names = await ResolveNamesAsync(
            rows.SelectMany(row => new[] { row.GrantedByUserId, row.RevokedByUserId })
                .Where(id => id.HasValue).Select(id => id!.Value),
            cancellationToken);
        string? NameOf(Guid? id) => id is { } value && names.TryGetValue(value, out var name) && !string.IsNullOrWhiteSpace(name) ? name : null;

        var history = new List<AdministratorHistoryItem>();
        foreach (var row in rows)
        {
            var person = $"{row.FirstName} {row.LastName}".Trim();
            var origin = AdministratorOrigins.Of(row.GrantedByActorType);
            history.Add(new AdministratorHistoryItem(row.GrantedAt, origin, person,
                origin is AdministratorOrigins.Administrator or AdministratorOrigins.Invitation ? NameOf(row.GrantedByUserId) : null));
            if (row.RevokedAt is { } revokedAt)
            {
                var self = row.RevokedByUserId == row.UserId;
                history.Add(new AdministratorHistoryItem(revokedAt, self ? "stepped-down" : "removed", person,
                    self ? null : NameOf(row.RevokedByUserId)));
            }
        }

        return history.OrderByDescending(item => item.At).ToList();
    }

    public async Task<IReadOnlyList<AdministratorCandidate>> GetAdministratorCandidatesAsync(
        Guid tenantId, string? search, CancellationToken cancellationToken = default)
    {
        var term = search?.Trim().ToUpperInvariant() ?? string.Empty;

        // Fusion's own staff never appear inside a company, even if an account were somehow both.
        var operators = from userRole in dbContext.UserRoles
                        join role in dbContext.Roles on userRole.RoleId equals role.Id
                        where role.Name == PlatformRole.PlatformAdmin
                        select userRole.UserId;
        var administrators = dbContext.TenantAdministratorAssignments.IgnoreQueryFilters()
            .Where(assignment => assignment.TenantId == tenantId && assignment.RevokedAt == null)
            .Select(assignment => assignment.TenantMembershipId);

        var members = dbContext.TenantMemberships.IgnoreQueryFilters().AsNoTracking()
            .Where(membership => membership.TenantId == tenantId
                && membership.Status == TenantMembershipStatus.Active
                && membership.User!.IsActive
                && !administrators.Contains(membership.Id)
                && !operators.Contains(membership.UserId));
        if (term.Length > 0)
        {
            members = members.Where(membership => (membership.User!.FirstName + " " + membership.User!.LastName).ToUpper().Contains(term)
                || (membership.User!.NormalizedEmail != null && membership.User!.NormalizedEmail.Contains(term)));
        }

        var signedUp = await members
            .OrderBy(membership => membership.User!.FirstName).ThenBy(membership => membership.User!.LastName)
            .Take(30)
            .Select(membership => new AdministratorCandidate(
                membership.UserId,
                membership.EmployeeId,
                (membership.User!.FirstName + " " + membership.User!.LastName).Trim(),
                membership.User!.JobTitle,
                membership.User!.PasswordHash != null))
            .ToListAsync(cancellationToken);

        // People invited to sign in who haven't yet: shown so the person adding sees why they can't be chosen.
        var now = DateTime.UtcNow;
        var invited = dbContext.InviteTokens.IgnoreQueryFilters().AsNoTracking()
            .Where(invite => invite.TenantId == tenantId
                && invite.Purpose == InvitationPurpose.WorkforceAccount
                && invite.AcceptedAt == null && !invite.IsRevoked && invite.SupersededAt == null && invite.ExpiresAt > now);
        if (term.Length > 0)
        {
            invited = invited.Where(invite => ((invite.FirstName ?? "") + " " + (invite.LastName ?? "")).ToUpper().Contains(term)
                || invite.Email.ToUpper().Contains(term));
        }

        var pending = await invited
            .OrderBy(invite => invite.FirstName).ThenBy(invite => invite.LastName)
            .Take(10)
            .Select(invite => new { invite.EmployeeId, invite.FirstName, invite.LastName, invite.Email })
            .ToListAsync(cancellationToken);

        return
        [
            .. signedUp,
            .. pending.Select(invite => new AdministratorCandidate(
                Guid.Empty,
                invite.EmployeeId,
                $"{invite.FirstName} {invite.LastName}".Trim() is { Length: > 0 } name ? name : invite.Email,
                null,
                false)),
        ];
    }

    public async Task<IReadOnlyList<AdministratorInvitationListItem>> GetInvitationsAsync(
        Guid tenantId, bool includeHistorical = false, CancellationToken cancellationToken = default)
    {
        var invitations = await dbContext.InviteTokens
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item => item.TenantId == tenantId
                && item.Purpose == InvitationPurpose.TenantAdministrator)
            .OrderByDescending(item => item.CreatedAt)
            .Take(includeHistorical ? 200 : 50)
            .ToListAsync(cancellationToken);

        return invitations
            .Where(item => includeHistorical || item.State == InvitationState.Pending)
            .Select(item => new AdministratorInvitationListItem(
                item.Id,
                item.Email,
                $"{item.FirstName} {item.LastName}".Trim(),
                item.State.ToString(),
                item.Purpose.ToString(),
                item.CredentialIssuedAt ?? item.CreatedAt,
                item.ExpiresAt,
                item.DeliveryStatus))
            .ToList();
    }

    public async Task<IReadOnlyList<AccessActivityItem>> GetRecentActivityAsync(
        Guid tenantId, int take = 5, CancellationToken cancellationToken = default)
        => await NameActorsAsync(
            await ActivityQuery(tenantId)
                .Take(Math.Clamp(take, 1, 25))
                .ToListAsync(cancellationToken),
            cancellationToken);

    public async Task<AccessActivityPage> GetActivityPageAsync(
        Guid tenantId,
        DateTime? cursorOccurredAt,
        Guid? cursorId,
        DateTime? from,
        DateTime? to,
        string? actionCategory,
        int pageSize = 25,
        CancellationToken cancellationToken = default)
    {
        var size = Math.Clamp(pageSize, 1, 100);
        var query = dbContext.AccessAuditEvents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item => item.TenantId == tenantId);

        if (from is not null)
        {
            query = query.Where(item => item.OccurredAt >= from.Value);
        }

        if (to is not null)
        {
            query = query.Where(item => item.OccurredAt <= to.Value);
        }

        if (!string.IsNullOrWhiteSpace(actionCategory))
        {
            query = query.Where(item => item.Action.StartsWith(actionCategory));
        }

        // Cursor on (OccurredAt, Id) so a page boundary between two events written
        // in the same instant cannot drop or repeat one of them.
        if (cursorOccurredAt is not null && cursorId is not null)
        {
            query = query.Where(item => item.OccurredAt < cursorOccurredAt.Value
                || (item.OccurredAt == cursorOccurredAt.Value && item.Id.CompareTo(cursorId.Value) < 0));
        }

        var page = await query
            .OrderByDescending(item => item.OccurredAt)
            .ThenByDescending(item => item.Id)
            .Take(size + 1)
            .Select(item => new AccessActivityItem(
                item.Id, item.OccurredAt, item.Action, item.ActorName,
                item.ActorRole, item.Summary, item.ResourceId)
            {
                ActorUserId = item.ActorUserId,
            })
            .ToListAsync(cancellationToken);

        var hasMore = page.Count > size;
        var items = await NameActorsAsync(hasMore ? page[..size] : page, cancellationToken);
        var last = items.Count > 0 ? items[^1] : null;

        return new AccessActivityPage(
            items,
            hasMore ? last?.OccurredAt : null,
            hasMore ? last?.Id : null);
    }

    /// <summary>
    /// Replaces the stored placeholder with the acting person's name.
    /// <para>
    /// Commands hold a user id, not an account, so most events are written with
    /// no name at all. Printing the placeholder would tell a reader we do not
    /// know who acted while the account it points at is sitting in the same
    /// database — so the feed reads people, and resolves them here.
    /// </para>
    /// </summary>
    private async Task<List<AccessActivityItem>> NameActorsAsync(
        List<AccessActivityItem> items,
        CancellationToken cancellationToken)
    {
        var actorIds = items
            .Where(item => item.ActorUserId.HasValue && item.ActorName == AccessAuditEvent.UnresolvedActor)
            .Select(item => item.ActorUserId!.Value)
            .Distinct()
            .ToList();

        if (actorIds.Count == 0)
        {
            return items;
        }

        var names = await dbContext.Users
            .AsNoTracking()
            .IgnoreQueryFilters()
            .Where(user => actorIds.Contains(user.Id))
            .Select(user => new { user.Id, user.FirstName, user.LastName })
            .ToDictionaryAsync(
                user => user.Id,
                user => $"{user.FirstName} {user.LastName}".Trim(),
                cancellationToken);

        return items
            .Select(item => item.ActorUserId is { } actorId
                && item.ActorName == AccessAuditEvent.UnresolvedActor
                && names.TryGetValue(actorId, out var name)
                && !string.IsNullOrWhiteSpace(name)
                    ? item with { ActorName = name }
                    : item)
            .ToList();
    }

    private IQueryable<AccessActivityItem> ActivityQuery(Guid tenantId)
        => dbContext.AccessAuditEvents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item => item.TenantId == tenantId)
            .OrderByDescending(item => item.OccurredAt)
            .ThenByDescending(item => item.Id)
            .Select(item => new AccessActivityItem(
                item.Id, item.OccurredAt, item.Action, item.ActorName,
                item.ActorRole, item.Summary, item.ResourceId)
            {
                ActorUserId = item.ActorUserId,
            });
}

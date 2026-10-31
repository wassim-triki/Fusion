using EY.HRPlatform.Identity.Features.Notifications;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.Identity.Features.TenantAdministration;
using EY.HRPlatform.Identity.Features.TenantProvisioning;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Tests.Features.TenantAdministration;

/// <summary>
/// The final-usable-administrator invariant and the administrator lifecycle,
/// against real PostgreSQL.
/// <para>
/// The rule this protects is a write-skew problem: two commands can each read two
/// usable administrators, each remove a different one, and both commit correctly
/// on their own rows — leaving zero. No in-memory test can observe that, because
/// the failure only exists when two transactions genuinely overlap.
/// </para>
/// </summary>
public sealed class TenantContinuityTests : IAsyncLifetime
{
    private readonly RelationalTestDatabase _databases = new();
    private bool Available => _databases.Available;

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync() => _databases.DisposeAsync().AsTask();

    // ── The invariant ────────────────────────────────────

    [SkippableFact]
    public async Task Suspending_the_only_usable_administrator_is_refused()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();

        var result = await Lifecycle(world.Db).SuspendAsync(
            new AdministratorCommand(world.TenantId, world.FirstMembershipId, world.FirstAccountId));

        Assert.False(result.Succeeded);
        Assert.Equal(ContinuityFailure.TooFewAdministrators, result.Failure);

        // Refused means nothing happened — not "happened, then reported".
        world.Db.ChangeTracker.Clear();
        var membership = await world.Db.TenantMemberships.IgnoreQueryFilters()
            .SingleAsync(item => item.Id == world.FirstMembershipId);
        Assert.Equal(TenantMembershipStatus.Active, membership.Status);
    }

    [SkippableFact]
    public async Task Removing_the_only_usable_administrators_authority_is_refused()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();

        var result = await Lifecycle(world.Db).RevokeAuthorityAsync(
            new AdministratorCommand(world.TenantId, world.FirstMembershipId, world.FirstAccountId));

        Assert.Equal(ContinuityFailure.TooFewAdministrators, result.Failure);

        world.Db.ChangeTracker.Clear();
        Assert.Equal(1, await UsableTenantAdministrator.CountAsync(world.Db, world.TenantId));
    }

    [SkippableFact]
    public async Task Removing_or_suspending_one_of_two_administrators_is_refused()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync(administrators: 2);
        var second = world.SecondMembershipId!.Value;

        var removed = await Lifecycle(world.Db).RevokeAuthorityAsync(
            new AdministratorCommand(world.TenantId, second, world.FirstAccountId));
        var suspended = await Lifecycle(world.Db).SuspendAsync(
            new AdministratorCommand(world.TenantId, second, world.FirstAccountId));
        var steppedDown = await Lifecycle(world.Db).RevokeAuthorityAsync(
            new AdministratorCommand(world.TenantId, world.FirstMembershipId, world.FirstAccountId));

        // A company keeps at least two administrators once it has two (D-25).
        Assert.Equal(ContinuityFailure.TooFewAdministrators, removed.Failure);
        Assert.Equal(ContinuityFailure.TooFewAdministrators, suspended.Failure);
        Assert.Equal(ContinuityFailure.TooFewAdministrators, steppedDown.Failure);
        world.Db.ChangeTracker.Clear();
        Assert.Equal(2, await UsableTenantAdministrator.CountAsync(world.Db, world.TenantId));
    }

    [SkippableFact]
    public async Task A_company_with_one_administrator_can_still_add_a_second()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync(administrators: 2);
        var second = world.SecondMembershipId!.Value;
        world.Db.TenantAdministratorAssignments.IgnoreQueryFilters()
            .Single(item => item.TenantMembershipId == second && item.RevokedAt == null)
            .Revoke(world.FirstAccountId, "arranged");
        await world.Db.SaveChangesAsync();
        world.Db.ChangeTracker.Clear();

        var result = await Lifecycle(world.Db).GrantAuthorityAsync(
            new AdministratorCommand(world.TenantId, second, world.FirstAccountId));

        // Short of the minimum is not a reason to refuse the step towards it.
        Assert.True(result.Succeeded);
        world.Db.ChangeTracker.Clear();
        Assert.Equal(2, await UsableTenantAdministrator.CountAsync(world.Db, world.TenantId));
    }

    [SkippableFact]
    public async Task A_refused_final_administrator_action_is_still_recorded()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();

        await Lifecycle(world.Db).SuspendAsync(
            new AdministratorCommand(world.TenantId, world.FirstMembershipId, world.FirstAccountId));

        world.Db.ChangeTracker.Clear();

        // An attempt to remove a tenant's last administrator is security-relevant
        // evidence. Losing it with the rollback would be the wrong trade.
        Assert.Contains(
            await world.Db.AccessAuditEvents.IgnoreQueryFilters().ToListAsync(),
            item => item.Action == AccessAuditActions.FinalAdministratorActionBlocked);
    }

    [SkippableFact]
    public async Task Self_removal_by_the_only_administrator_is_refused()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();

        // Self-removal is the same command path with the actor as target, so it
        // cannot be a way around the rule.
        var result = await Lifecycle(world.Db).RevokeAuthorityAsync(
            new AdministratorCommand(world.TenantId, world.FirstMembershipId, world.FirstAccountId));

        Assert.Equal(ContinuityFailure.TooFewAdministrators, result.Failure);
    }

    [SkippableFact]
    public async Task Two_concurrent_removals_cannot_both_commit()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync(administrators: 3);

        var second = _databases.Connect(world.Db);

        // Each command reads three usable administrators and removes a different
        // one. Their rows are disjoint, so row versioning cannot see the conflict;
        // only the per-tenant serialization can keep the company at two.
        var outcomes = await Task.WhenAll(
            ObserveAsync(() => Lifecycle(world.Db).RevokeAuthorityAsync(
                new AdministratorCommand(world.TenantId, world.FirstMembershipId, world.FirstAccountId))),
            ObserveAsync(() => Lifecycle(second).RevokeAuthorityAsync(
                new AdministratorCommand(world.TenantId, world.SecondMembershipId!.Value, world.FirstAccountId))));

        Assert.Single(outcomes, outcome => outcome.Succeeded);

        // The loser must be refused with the typed reason, not by throwing. An
        // implementation that surfaced a database conflict here would leave the
        // API returning 500 where the experience needs a specific, recoverable
        // message — so accepting an exception would let this test pass against
        // exactly the behaviour it exists to prevent.
        var loser = outcomes.Single(outcome => !outcome.Succeeded);
        Assert.Null(loser.Exception);
        Assert.Equal(ContinuityFailure.TooFewAdministrators, loser.Failure);

        world.Db.ChangeTracker.Clear();
        Assert.Equal(2, await UsableTenantAdministrator.CountAsync(world.Db, world.TenantId));
    }

    // ── Lifecycle ────────────────────────────────────────

    [SkippableFact]
    public async Task Suspension_preserves_the_account_membership_authority_and_history()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync(administrators: 3);

        var result = await Lifecycle(world.Db).SuspendAsync(new AdministratorCommand(
            world.TenantId, world.SecondMembershipId!.Value, world.FirstAccountId, Reason: "Leave of absence"));

        Assert.True(result.Succeeded);
        world.Db.ChangeTracker.Clear();

        var membership = await world.Db.TenantMemberships.IgnoreQueryFilters()
            .SingleAsync(item => item.Id == world.SecondMembershipId);

        Assert.Equal(TenantMembershipStatus.Suspended, membership.Status);
        Assert.NotNull(membership.SuspendedAt);
        Assert.Equal("Leave of absence", membership.SuspensionReason);

        // Everything that made this person an administrator survives, so
        // reactivation restores access rather than rebuilding it.
        Assert.NotNull(await world.Db.Users.IgnoreQueryFilters()
            .FirstOrDefaultAsync(user => user.Id == membership.UserId));
        Assert.True(await world.Db.TenantAdministratorAssignments.IgnoreQueryFilters()
            .AnyAsync(item => item.TenantMembershipId == membership.Id && item.RevokedAt == null));

        // A tenant-scoped decision never disables the global Identity account.
        var account = await world.Db.Users.IgnoreQueryFilters().SingleAsync(user => user.Id == membership.UserId);
        Assert.True(account.IsActive);
    }

    [SkippableFact]
    public async Task Reactivation_restores_access_without_recreating_anything()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync(administrators: 3);
        var membershipId = world.SecondMembershipId!.Value;

        await Lifecycle(world.Db).SuspendAsync(
            new AdministratorCommand(world.TenantId, membershipId, world.FirstAccountId));

        var assignmentsBefore = await world.Db.TenantAdministratorAssignments.IgnoreQueryFilters()
            .CountAsync(item => item.TenantMembershipId == membershipId);

        var result = await Lifecycle(world.Db).ReactivateAsync(
            new AdministratorCommand(world.TenantId, membershipId, world.FirstAccountId));

        Assert.True(result.Succeeded);
        world.Db.ChangeTracker.Clear();

        var membership = await world.Db.TenantMemberships.IgnoreQueryFilters()
            .SingleAsync(item => item.Id == membershipId);
        Assert.Equal(TenantMembershipStatus.Active, membership.Status);

        Assert.Equal(assignmentsBefore, await world.Db.TenantAdministratorAssignments.IgnoreQueryFilters()
            .CountAsync(item => item.TenantMembershipId == membershipId));
    }

    [SkippableFact]
    public async Task Grant_revoke_and_re_grant_read_back_as_a_sequence()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync(administrators: 3);
        var membershipId = world.SecondMembershipId!.Value;
        var lifecycle = Lifecycle(world.Db);

        await lifecycle.RevokeAuthorityAsync(
            new AdministratorCommand(world.TenantId, membershipId, world.FirstAccountId));
        await lifecycle.GrantAuthorityAsync(
            new AdministratorCommand(world.TenantId, membershipId, world.FirstAccountId));

        world.Db.ChangeTracker.Clear();
        var history = await world.Db.TenantAdministratorAssignments.IgnoreQueryFilters()
            .Where(item => item.TenantMembershipId == membershipId)
            .OrderBy(item => item.GrantedAt)
            .ToListAsync();

        // Revocation preserves the row, so the full sequence is queryable rather
        // than something a reader has to reconstruct from an audit log.
        Assert.Equal(2, history.Count);
        Assert.NotNull(history[0].RevokedAt);
        Assert.Null(history[1].RevokedAt);
    }

    [SkippableFact]
    public async Task Granting_authority_someone_already_holds_changes_nothing()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync(administrators: 2);
        var membershipId = world.SecondMembershipId!.Value;

        var result = await Lifecycle(world.Db).GrantAuthorityAsync(
            new AdministratorCommand(world.TenantId, membershipId, world.FirstAccountId));

        Assert.True(result.Succeeded);

        world.Db.ChangeTracker.Clear();
        Assert.Single(await world.Db.TenantAdministratorAssignments.IgnoreQueryFilters()
            .Where(item => item.TenantMembershipId == membershipId && item.RevokedAt == null)
            .ToListAsync());
    }

    // ── Account mail (B-155) ─────────────────────────────

    [SkippableFact]
    public async Task Gaining_or_losing_tenant_administration_mails_the_person_only_when_it_changed()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync(administrators: 3);
        var membershipId = world.SecondMembershipId!.Value;
        var mail = new CapturingRoleMail();
        var lifecycle = new TenantAdministratorLifecycleService(world.Db, new TenantContinuityCommandExecutor(world.Db), mail);
        var second = await world.Db.TenantMemberships.IgnoreQueryFilters().Where(item => item.Id == membershipId)
            .Select(item => item.UserId).SingleAsync();

        // Already held: nothing changes, nobody is told.
        await lifecycle.GrantAuthorityAsync(new AdministratorCommand(world.TenantId, membershipId, world.FirstAccountId));
        Assert.Empty(mail.Changes);

        await lifecycle.RevokeAuthorityAsync(new AdministratorCommand(world.TenantId, membershipId, world.FirstAccountId));
        await lifecycle.GrantAuthorityAsync(new AdministratorCommand(world.TenantId, membershipId, world.FirstAccountId));
        Assert.Equal([(second, false), (second, true)], mail.Changes.Select(change => (change.UserId, change.Gained)).ToList());
        Assert.All(mail.Changes, change => Assert.Equal((world.TenantId, world.FirstAccountId), (change.TenantId, change.ActorUserId)));

        // Refused (the last administrator): nothing committed, nothing mailed.
        await lifecycle.RevokeAuthorityAsync(new AdministratorCommand(world.TenantId, membershipId, world.FirstAccountId));
        mail.Changes.Clear();
        // Two left: removing either would leave one.
        var refused = await lifecycle.RevokeAuthorityAsync(new AdministratorCommand(world.TenantId, world.FirstMembershipId, world.FirstAccountId));
        Assert.Equal(ContinuityFailure.TooFewAdministrators, refused.Failure);
        Assert.Empty(mail.Changes);
    }

    [SkippableFact]
    public async Task Only_administrator_profiles_gained_or_lost_send_account_mail_in_the_persons_language()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync(administrators: 2);
        var second = await world.Db.TenantMemberships.IgnoreQueryFilters().Where(item => item.Id == world.SecondMembershipId)
            .Select(item => item.UserId).SingleAsync();
        var user = await world.Db.Users.IgnoreQueryFilters().SingleAsync(item => item.Id == second);
        user.PreferredLanguage = "fr";
        await world.Db.SaveChangesAsync();
        var profiles = await world.Db.AccessProfiles.IgnoreQueryFilters().Where(item => item.TenantId == world.TenantId)
            .ToDictionaryAsync(item => item.InternalKey ?? item.Name, item => item.Id);
        var sender = new CapturingAccountSender();
        var mail = new AdministratorRoleMail(world.Db, sender,
            new Microsoft.Extensions.Configuration.ConfigurationBuilder().Build(),
            Microsoft.Extensions.Logging.Abstractions.NullLogger<AdministratorRoleMail>.Instance);

        await mail.SendProfileChangesAsync(world.TenantId, world.FirstAccountId,
            [(second, [profiles["employee"]], [profiles["employee"], profiles["manager"]])]);
        Assert.Empty(sender.Sent);

        await mail.SendProfileChangesAsync(world.TenantId, world.FirstAccountId,
            [(second, [profiles["employee"]], [profiles["employee"], profiles["hr-admin"]])]);
        var granted = Assert.Single(sender.Sent);
        Assert.Equal("second.admin@atlas.example", granted.To);
        Assert.Equal("Le rôle HR vous a été attribué", granted.Content.Subject);
        Assert.Contains("Ada Admin", granted.Content.Text);
        Assert.Null(granted.UnsubscribeUrl);

        sender.Sent.Clear();
        await mail.SendProfileChangesAsync(world.TenantId, second, [(second, [profiles["hr-admin"]], [])]);
        Assert.Contains("Vous avez retiré votre propre rôle HR", Assert.Single(sender.Sent).Content.Text);
    }

    private sealed class CapturingRoleMail : IAdministratorRoleMail
    {
        public List<AdministratorRoleChange> Changes { get; } = [];
        public Task SendAsync(AdministratorRoleChange change, CancellationToken cancellationToken = default)
        {
            Changes.Add(change);
            return Task.CompletedTask;
        }
        public Task SendProfileChangesAsync(Guid tenantId, Guid actorUserId,
            IReadOnlyList<(Guid UserId, IReadOnlyCollection<Guid> Before, IReadOnlyCollection<Guid> After)> people,
            CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class CapturingAccountSender : IAccountMailSender
    {
        public List<EY.HRPlatform.SharedKernel.Notifications.FusionOutgoingEmail> Sent { get; } = [];
        public Task SendAsync(EY.HRPlatform.SharedKernel.Notifications.FusionOutgoingEmail email, CancellationToken cancellationToken)
        {
            Sent.Add(email);
            return Task.CompletedTask;
        }
    }

    // ── Immediate enforcement ────────────────────────────

    [SkippableFact]
    public async Task Suspension_invalidates_the_current_access_token_and_refresh_grants()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync(administrators: 3);
        var membershipId = world.SecondMembershipId!.Value;

        var before = await world.Db.TenantMemberships.IgnoreQueryFilters()
            .Where(item => item.Id == membershipId)
            .Select(item => item.AccessRevision)
            .SingleAsync();

        var userId = await world.Db.TenantMemberships.IgnoreQueryFilters()
            .Where(item => item.Id == membershipId).Select(item => item.UserId).SingleAsync();

        world.Db.RefreshTokens.Add(new RefreshToken
        {
            UserId = userId,
            Token = Guid.NewGuid().ToString("N"),
            ExpiresAt = DateTime.UtcNow.AddDays(7),
        });
        await world.Db.SaveChangesAsync();
        world.Db.ChangeTracker.Clear();

        await Lifecycle(world.Db).SuspendAsync(
            new AdministratorCommand(world.TenantId, membershipId, world.FirstAccountId));

        world.Db.ChangeTracker.Clear();
        var after = await world.Db.TenantMemberships.IgnoreQueryFilters()
            .Where(item => item.Id == membershipId).Select(item => item.AccessRevision).SingleAsync();

        // The revision moved, so a token minted before this commit no longer
        // matches and the next request carrying it fails closed.
        Assert.True(after > before);

        // And the refresh token cannot be traded for a fresh one, which is what
        // would otherwise make "immediate" mean "within an hour".
        Assert.Empty(await world.Db.RefreshTokens
            .Where(token => token.UserId == userId && token.RevokedAt == null).ToListAsync());
    }

    [SkippableFact]
    public async Task Becoming_an_administrator_refreshes_the_token_without_ending_the_session()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync(administrators: 3);
        var membershipId = world.SecondMembershipId!.Value;
        var lifecycle = Lifecycle(world.Db);
        await lifecycle.RevokeAuthorityAsync(new AdministratorCommand(world.TenantId, membershipId, world.FirstAccountId));

        var userId = await world.Db.TenantMemberships.IgnoreQueryFilters()
            .Where(item => item.Id == membershipId).Select(item => item.UserId).SingleAsync();
        world.Db.RefreshTokens.Add(new RefreshToken { UserId = userId, Token = Guid.NewGuid().ToString("N"), ExpiresAt = DateTime.UtcNow.AddDays(7) });
        await world.Db.SaveChangesAsync();
        var before = await RevisionAsync(world.Db, membershipId);

        await lifecycle.GrantAuthorityAsync(new AdministratorCommand(world.TenantId, membershipId, world.FirstAccountId));

        // The old token is turned away, and the refresh brings the new authority (B-213): gaining it never signs out.
        Assert.True(await RevisionAsync(world.Db, membershipId) > before);
        Assert.NotEmpty(await world.Db.RefreshTokens.Where(token => token.UserId == userId && token.RevokedAt == null).ToListAsync());
    }

    [SkippableFact]
    public async Task Reactivation_does_not_revive_the_old_token()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync(administrators: 3);
        var membershipId = world.SecondMembershipId!.Value;
        var lifecycle = Lifecycle(world.Db);

        var original = await RevisionAsync(world.Db, membershipId);

        await lifecycle.SuspendAsync(new AdministratorCommand(world.TenantId, membershipId, world.FirstAccountId));
        await lifecycle.ReactivateAsync(new AdministratorCommand(world.TenantId, membershipId, world.FirstAccountId));

        // Reactivation moves the revision too, so a token issued before the
        // suspension stays rejected. The person signs in again and receives one
        // carrying the current revision.
        Assert.True(await RevisionAsync(world.Db, membershipId) > original);
    }

    // ── Stale state ──────────────────────────────────────

    [SkippableFact]
    public async Task Acting_on_a_stale_view_of_an_administrator_is_refused()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync(administrators: 3);
        var membershipId = world.SecondMembershipId!.Value;

        // What the drawer was rendered from.
        var staleVersion = await VersionAsync(world.Db, membershipId);

        // Someone else acts in between.
        await Lifecycle(world.Db).SuspendAsync(
            new AdministratorCommand(world.TenantId, membershipId, world.FirstAccountId));

        var result = await Lifecycle(world.Db).ReactivateAsync(new AdministratorCommand(
            world.TenantId, membershipId, world.FirstAccountId, ExpectedVersion: staleVersion));

        Assert.Equal(ContinuityFailure.StaleState, result.Failure);
    }

    // ── Tenant isolation ─────────────────────────────────

    [SkippableFact]
    public async Task A_membership_in_another_tenant_cannot_be_acted_on()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync(administrators: 2);

        // Naming a real membership under the wrong tenant finds nothing rather
        // than acting on it, so a forged tenant identifier is not a way in.
        var result = await Lifecycle(world.Db).SuspendAsync(new AdministratorCommand(
            Guid.NewGuid(), world.SecondMembershipId!.Value, world.FirstAccountId));

        Assert.Equal(ContinuityFailure.NotFound, result.Failure);
    }

    // ── Projection ───────────────────────────────────────

    [SkippableFact]
    public async Task The_summary_reports_continuity_from_the_same_predicate_the_commands_enforce()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();
        var projection = new TenantAccessProjection(world.Db);

        var atRisk = await projection.GetSummaryAsync(world.TenantId);
        Assert.Equal(nameof(ContinuityState.AtRisk), atRisk.Continuity);
        Assert.Equal(1, atRisk.UsableAdministrators);

        // The workspace must state the final-administrator reason before anyone
        // interacts, not after the server refuses them.
        var administrators = await projection.GetAdministratorsAsync(world.TenantId);
        Assert.Equal(
            TenantAccessProjection.FinalAdministratorReason,
            Assert.Single(administrators).BlockedReason);
    }

    [SkippableFact]
    public async Task Activity_names_the_person_who_acted()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync(administrators: 3);

        await Lifecycle(world.Db).SuspendAsync(new AdministratorCommand(
            world.TenantId, world.SecondMembershipId!.Value, world.FirstAccountId));

        var recent = await new TenantAccessProjection(world.Db).GetRecentActivityAsync(world.TenantId);
        var suspension = recent.First(item => item.Action == AccessAuditActions.MembershipSuspended);

        // Commands hold a user id, not an account, so the stored name is a
        // placeholder. Showing it would tell the reader we do not know who acted
        // while the account it points at is in the same database.
        Assert.Equal("Ada Admin", suspension.ActorName);
    }

    [SkippableFact]
    public async Task A_second_administrator_clears_the_continuity_risk()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync(administrators: 2);

        var summary = await new TenantAccessProjection(world.Db).GetSummaryAsync(world.TenantId);

        Assert.Equal(nameof(ContinuityState.Healthy), summary.Continuity);
        Assert.Equal(2, summary.UsableAdministrators);

        // At two, neither can go, and the page says so before anyone tries.
        var administrators = await new TenantAccessProjection(world.Db).GetAdministratorsAsync(world.TenantId);
        Assert.All(administrators, item => Assert.Equal(TenantAccessProjection.FinalAdministratorReason, item.BlockedReason));
    }

    [SkippableFact]
    public async Task A_pending_invitation_does_not_satisfy_continuity()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();

        await new AdministratorInvitationService(
                world.Db, RelationalTestDatabase.CreateUserManager(world.Db), new SilentDelivery())
            .IssueAsync(world.TenantId, "pending.admin@atlas.example", world.FirstAccountId);

        world.Db.ChangeTracker.Clear();
        var summary = await new TenantAccessProjection(world.Db).GetSummaryAsync(world.TenantId);

        // Nobody has accepted it, so it administers nothing. Counting it would let
        // a tenant lock itself out on the strength of an unopened email.
        Assert.Equal(1, summary.PendingInvitations);
        Assert.Equal(nameof(ContinuityState.AtRisk), summary.Continuity);
    }

    // ── plumbing ─────────────────────────────────────────

    /// <summary>
    /// Records exactly what a concurrent command did, including whether it threw.
    /// Deliberately not collapsing a throw into "did not commit": a refusal and a
    /// crash look the same to the database and completely different to the person
    /// who pressed the button.
    /// </summary>
    private sealed record Observed(bool Succeeded, ContinuityFailure Failure, Exception? Exception);

    private static async Task<Observed> ObserveAsync(Func<Task<ContinuityResult<Guid>>> command)
    {
        try
        {
            var result = await command();
            return new Observed(result.Succeeded, result.Failure, null);
        }
        catch (Exception exception)
        {
            return new Observed(false, ContinuityFailure.None, exception);
        }
    }

    private static Task<int> RevisionAsync(AppIdentityDbContext db, Guid membershipId)
    {
        db.ChangeTracker.Clear();
        return db.TenantMemberships.IgnoreQueryFilters()
            .Where(item => item.Id == membershipId).Select(item => item.AccessRevision).SingleAsync();
    }

    private static async Task<uint> VersionAsync(AppIdentityDbContext db, Guid membershipId)
    {
        db.ChangeTracker.Clear();
        var membership = await db.TenantMemberships.IgnoreQueryFilters()
            .SingleAsync(item => item.Id == membershipId);
        return membership.Version;
    }

    private static ITenantAdministratorLifecycleService Lifecycle(AppIdentityDbContext db)
        => new TenantAdministratorLifecycleService(db, new TenantContinuityCommandExecutor(db));

    private sealed record World(
        AppIdentityDbContext Db,
        Guid TenantId,
        Guid FirstAccountId,
        Guid FirstMembershipId,
        Guid? SecondMembershipId,
        Guid? ThirdMembershipId = null);

    /// <summary>
    /// A real provisioned and activated tenant, with further administrators
    /// established through the real invitation flow — so the arrangement
    /// exercises the same paths the product does.
    /// </summary>
    private async Task<World> ArrangeAsync(int administrators = 1)
    {
        var db = await _databases.CreateAsync("fusion_continuity");
        var bootstrap = new CapturingBootstrapDelivery();

        var provisioned = await new TenantProvisioningService(db, bootstrap).ProvisionAsync(
            new ProvisionTenantRequest
            {
                Name = "Atlas Group",
                TimeZone = "Europe/Paris",
                AdministratorEmail = "first.admin@atlas.example",
                IdempotencyKey = $"continuity-{Guid.NewGuid():N}",
            },
            Guid.NewGuid());

        Assert.True(provisioned.IsSuccess);
        db.ChangeTracker.Clear();

        var users = RelationalTestDatabase.CreateUserManager(db);
        var activation = await new BootstrapActivationService(db, users, new AccessProfileService(db, users))
            .ActivateAsync(new BootstrapActivationRequest
            {
                Credential = bootstrap.Credential!.RawValue,
                Email = "first.admin@atlas.example",
                Password = "Bootstrap@123456",
                FirstName = "Ada",
                LastName = "Admin",
            });

        Assert.Equal(BootstrapActivationOutcome.Activated, activation.Outcome);
        db.ChangeTracker.Clear();

        var tenantId = provisioned.Value.TenantId;
        var firstAccountId = activation.AccountId!.Value;
        var firstMembershipId = await db.TenantMemberships.IgnoreQueryFilters()
            .Where(item => item.UserId == firstAccountId).Select(item => item.Id).SingleAsync();

        var more = new List<Guid>();
        foreach (var (email, first) in new[] { ("second.admin@atlas.example", "Bea"), ("third.admin@atlas.example", "Cleo") }.Take(administrators - 1))
        {
            var delivery = new SilentDelivery();
            await new AdministratorInvitationService(db, users, delivery)
                .IssueAsync(tenantId, email, firstAccountId);
            db.ChangeTracker.Clear();

            var accepted = await new AdministrativeInvitationAcceptanceService(
                    db, users, new AccessProfileService(db, users))
                .AcceptAsync(new AdministrativeAcceptanceRequest
                {
                    Credential = delivery.Credential!.RawValue,
                    Email = email,
                    Password = "Administrator@123456",
                    FirstName = first,
                    LastName = "Admin",
                });

            Assert.Equal(AdministrativeAcceptanceOutcome.Accepted, accepted.Outcome);
            db.ChangeTracker.Clear();

            more.Add(await db.TenantMemberships.IgnoreQueryFilters()
                .Where(item => item.UserId == accepted.AccountId).Select(item => item.Id).SingleAsync());
        }

        return new World(db, tenantId, firstAccountId, firstMembershipId,
            more.Count > 0 ? more[0] : null, more.Count > 1 ? more[1] : null);
    }

    private sealed class CapturingBootstrapDelivery : IBootstrapInvitationDelivery
    {
        public BootstrapCredential? Credential { get; private set; }

        public Task DeliverAsync(Guid invitationId, string email, BootstrapCredential credential,
            Guid initiatedByAccountId, CancellationToken cancellationToken = default)
        {
            Credential = credential;
            return Task.CompletedTask;
        }
    }

    private sealed class SilentDelivery : IAdministrativeInvitationDelivery
    {
        public BootstrapCredential? Credential { get; private set; }

        public Task DeliverAsync(Guid invitationId, string email, BootstrapCredential credential,
            InvitationPurpose purpose, Guid initiatedByAccountId, CancellationToken cancellationToken = default)
        {
            Credential = credential;
            return Task.CompletedTask;
        }
    }
}

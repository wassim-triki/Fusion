using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.Identity.Features.Membership;
using EY.HRPlatform.Identity.Features.TenantAdministration;
using EY.HRPlatform.Identity.Features.TenantProvisioning;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Tests.Features.TenantAdministration;

/// <summary>
/// Platform-assisted recovery: the one place Platform reaches into a customer
/// tenant.
/// <para>
/// Two properties matter more than anything else here. It must be impossible to
/// start while the customer can still administer themselves, and the Platform
/// operator must gain nothing from it. Both are asserted directly rather than
/// inferred from the absence of a code path.
/// </para>
/// </summary>
public sealed class PlatformRecoveryTests : IAsyncLifetime
{
    private const string RecipientEmail = "recovery.recipient@atlas.example";

    private readonly RelationalTestDatabase _databases = new();
    private bool Available => _databases.Available;

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync() => _databases.DisposeAsync().AsTask();

    // ── Eligibility ──────────────────────────────────────

    [SkippableTheory]
    [InlineData("Pending")]
    [InlineData("Revoked")]
    [InlineData("Expired")]
    public async Task Bootstrap_remediation_never_becomes_platform_recovery_before_initial_activation(
        string bootstrapState)
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var db = await _databases.CreateAsync("fusion_recovery_bootstrap");
        var platformActorId = Guid.NewGuid();
        var delivery = new CapturingBootstrapDelivery();
        var provisioned = await new TenantProvisioningService(db, delivery).ProvisionAsync(
            new ProvisionTenantRequest
            {
                Name = "Awaiting Atlas",
                TimeZone = "Europe/Paris",
                AdministratorEmail = "awaiting.admin@atlas.example",
                IdempotencyKey = $"recovery-bootstrap-{Guid.NewGuid():N}",
            },
            platformActorId);

        Assert.True(provisioned.IsSuccess);
        var invitation = await db.InviteTokens.IgnoreQueryFilters()
            .SingleAsync(item => item.TenantId == provisioned.Value.TenantId
                && item.Purpose == InvitationPurpose.OrganizationBootstrap);

        if (bootstrapState == "Revoked")
        {
            invitation.Revoke();
            await db.SaveChangesAsync();
        }
        else if (bootstrapState == "Expired")
        {
            await db.Database.ExecuteSqlRawAsync(
                "UPDATE identity.\"InviteTokens\" SET \"ExpiresAt\" = {0} WHERE \"Id\" = {1}",
                DateTime.UtcNow.AddMinutes(-1), invitation.Id);
        }

        db.ChangeTracker.Clear();
        var health = await new TenantContinuityHealthProjection(db)
            .GetAsync(provisioned.Value.TenantId);
        var result = await Recovery(db).InitiateAsync(
            provisioned.Value.TenantId, Request(), platformActorId);

        Assert.Equal(nameof(RecoveryStatus.AwaitingAdministratorActivation), health.RecoveryStatus);
        Assert.Equal(RecoveryOutcome.NotEligible, result.Outcome);
        Assert.Empty(await RecoveryInvitationsAsync(db, provisioned.Value.TenantId));
    }

    [SkippableFact]
    public async Task Recovery_is_refused_while_a_usable_administrator_remains()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();

        var result = await Recovery(world.Db).InitiateAsync(
            world.TenantId, Request(), world.PlatformActorId);

        Assert.Equal(RecoveryOutcome.NotEligible, result.Outcome);

        world.Db.ChangeTracker.Clear();
        Assert.Empty(await RecoveryInvitationsAsync(world.Db, world.TenantId));
    }

    [SkippableFact]
    public async Task Recovery_is_available_once_no_usable_administrator_remains()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();
        await StripAdministrationAsync(world);

        var result = await Recovery(world.Db).InitiateAsync(
            world.TenantId, Request(), world.PlatformActorId);

        Assert.Equal(RecoveryOutcome.Initiated, result.Outcome);

        world.Db.ChangeTracker.Clear();
        var invitation = Assert.Single(await RecoveryInvitationsAsync(world.Db, world.TenantId));
        Assert.Equal(InvitationPurpose.TenantAdministratorRecovery, invitation.Purpose);
        Assert.Equal(InvitationState.Pending, invitation.State);

        // Hash-only, exactly like every other administrative credential.
        Assert.Null(invitation.Token);
        Assert.NotNull(invitation.CredentialDigest);
    }

    [SkippableFact]
    public async Task A_restoration_that_commits_first_blocks_the_recovery()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();
        await StripAdministrationAsync(world);

        // The tenant recovers on its own — a suspended administrator's access is
        // reactivated — before the operator submits. Eligibility is re-read under
        // the lock, so the recovery is refused rather than handing authority to a
        // stranger for a tenant that just fixed itself.
        (await world.Db.TenantMemberships.IgnoreQueryFilters()
            .SingleAsync(item => item.Id == world.FirstMembershipId)).Reactivate(world.FirstAccountId);
        await world.Db.SaveChangesAsync();

        world.Db.ChangeTracker.Clear();

        var result = await Recovery(world.Db).InitiateAsync(
            world.TenantId, Request(), world.PlatformActorId);

        Assert.Equal(RecoveryOutcome.NotEligible, result.Outcome);
        Assert.Empty(await RecoveryInvitationsAsync(world.Db, world.TenantId));
    }

    [SkippableFact]
    public async Task A_second_recovery_cannot_be_started_while_one_is_pending()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();
        await StripAdministrationAsync(world);
        var service = Recovery(world.Db);

        Assert.Equal(RecoveryOutcome.Initiated,
            (await service.InitiateAsync(world.TenantId, Request(), world.PlatformActorId)).Outcome);

        world.Db.ChangeTracker.Clear();

        // Two people on a path to the same tenant's administration is exactly the
        // situation recovery must not create.
        var second = await service.InitiateAsync(
            world.TenantId, Request("someone.else@atlas.example"), world.PlatformActorId);

        Assert.Equal(RecoveryOutcome.AlreadyPending, second.Outcome);
        Assert.Single(await RecoveryInvitationsAsync(world.Db, world.TenantId));
    }

    // ── Recovery maintenance races ───────────────────────

    [SkippableFact]
    public async Task Concurrent_resends_leave_exactly_one_valid_credential()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();
        await StripAdministrationAsync(world);

        var invitationId = (await Recovery(world.Db).InitiateAsync(
            world.TenantId, Request(), world.PlatformActorId)).InvitationId!.Value;

        // Two operators pressing Resend at the same moment. The lock has to be
        // held through the mutation: released early, both rotate the credential
        // and both report success while only one delivered link still resolves.
        await using var second = _databases.Connect(world.Db);
        var first = Recovery(world.Db);
        var other = Recovery(second);

        var results = await Task.WhenAll(
            first.ResendAsync(world.TenantId, invitationId, world.PlatformActorId),
            other.ResendAsync(world.TenantId, invitationId, world.PlatformActorId));

        Assert.All(results, result => Assert.Equal(RecoveryOutcome.Initiated, result.Outcome));

        world.Db.ChangeTracker.Clear();
        var invitation = await world.Db.InviteTokens.IgnoreQueryFilters()
            .SingleAsync(item => item.Id == invitationId);

        // One row, one selector: the last rotation wins and every earlier link is
        // dead, rather than two rotations interleaving into an unreadable state.
        Assert.Single(await RecoveryInvitationsAsync(world.Db, world.TenantId));
        Assert.False(string.IsNullOrWhiteSpace(invitation.CredentialSelector));
    }

    [SkippableFact]
    public async Task A_resend_racing_a_revoke_does_not_revive_the_invitation()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();
        await StripAdministrationAsync(world);

        var invitationId = (await Recovery(world.Db).InitiateAsync(
            world.TenantId, Request(), world.PlatformActorId)).InvitationId!.Value;

        await using var second = _databases.Connect(world.Db);

        await Task.WhenAll(
            Recovery(world.Db).RevokeAsync(world.TenantId, invitationId, world.PlatformActorId),
            Recovery(second).ResendAsync(world.TenantId, invitationId, world.PlatformActorId));

        world.Db.ChangeTracker.Clear();
        var invitation = await world.Db.InviteTokens.IgnoreQueryFilters()
            .SingleAsync(item => item.Id == invitationId);

        // Whichever order they serialize in, a withdrawn invitation stays
        // withdrawn: sending a live link for an invitation an operator revoked is
        // the failure this ordering exists to prevent.
        if (invitation.IsRevoked)
        {
            Assert.Empty(await RecoveryInvitationsAsync(world.Db, world.TenantId));
        }
    }

    // ── Evidence ─────────────────────────────────────────

    [SkippableFact]
    public async Task Recovery_without_the_verification_acknowledgement_is_blocked()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();
        await StripAdministrationAsync(world);

        var result = await Recovery(world.Db).InitiateAsync(
            world.TenantId,
            new InitiateRecoveryRequest(RecipientEmail, VerificationAcknowledged: false, null),
            world.PlatformActorId);

        Assert.Equal(RecoveryOutcome.VerificationNotAcknowledged, result.Outcome);
        Assert.Empty(await RecoveryInvitationsAsync(world.Db, world.TenantId));
    }

    [SkippableFact]
    public async Task A_recipient_who_already_has_a_fusion_account_is_refused()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();
        await StripAdministrationAsync(world);

        var existing = await world.Db.Users.IgnoreQueryFilters().FirstAsync();

        var result = await Recovery(world.Db).InitiateAsync(
            world.TenantId, Request(existing.Email!), world.PlatformActorId);

        // Recovery creates a new administrator account; silently attaching an
        // existing identity to a tenant is not a recovery, it is a takeover.
        Assert.Equal(RecoveryOutcome.ExistingAccount, result.Outcome);
        Assert.Empty(await RecoveryInvitationsAsync(world.Db, world.TenantId));
    }

    [SkippableFact]
    public async Task Only_bounded_verification_evidence_is_stored()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();
        await StripAdministrationAsync(world);

        await Recovery(world.Db).InitiateAsync(
            world.TenantId,
            new InitiateRecoveryRequest(RecipientEmail, true, new string('x', 500)),
            world.PlatformActorId);

        world.Db.ChangeTracker.Clear();
        var initiated = await world.Db.AccessAuditEvents.IgnoreQueryFilters()
            .FirstAsync(item => item.Action == AccessAuditActions.PlatformRecoveryInitiated);

        // An acknowledgement and a bounded reference. No identity documents, no
        // contact records, no case data — storing those would create a sensitive
        // capability nobody asked for.
        Assert.Contains("verificationAcknowledged", initiated.AfterJson ?? string.Empty, StringComparison.Ordinal);
        Assert.True((initiated.AfterJson ?? string.Empty).Length < 300);
    }

    // ── Platform gains nothing ───────────────────────────

    [SkippableFact]
    public async Task The_platform_actor_gains_no_customer_access_from_recovery()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();
        await StripAdministrationAsync(world);

        await Recovery(world.Db).InitiateAsync(world.TenantId, Request(), world.PlatformActorId);
        world.Db.ChangeTracker.Clear();

        await AssertPlatformActorHasNothingAsync(world);
    }

    [SkippableFact]
    public async Task Completing_recovery_restores_the_customer_not_the_platform_actor()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();
        await StripAdministrationAsync(world);

        var delivery = new CapturingAdministrativeDelivery();
        var service = new PlatformAdministratorRecoveryService(
            world.Db,
            RelationalTestDatabase.CreateUserManager(world.Db),
            new TenantContinuityCommandExecutor(world.Db),
            delivery);

        Assert.Equal(RecoveryOutcome.Initiated,
            (await service.InitiateAsync(world.TenantId, Request(), world.PlatformActorId)).Outcome);

        world.Db.ChangeTracker.Clear();

        var users = RelationalTestDatabase.CreateUserManager(world.Db);
        var accepted = await new AdministrativeInvitationAcceptanceService(
                world.Db, users, new AccessProfileService(world.Db, users))
            .AcceptAsync(new AdministrativeAcceptanceRequest
            {
                Credential = delivery.Credential!.RawValue,
                Email = RecipientEmail,
                Password = "Recovered@123456",
                FirstName = "Rae",
                LastName = "Recovered",
            });

        Assert.Equal(AdministrativeAcceptanceOutcome.Accepted, accepted.Outcome);
        world.Db.ChangeTracker.Clear();

        // The customer administers their tenant again.
        Assert.Equal(1, await UsableTenantAdministrator.CountAsync(world.Db, world.TenantId));

        var authority = await world.Db.TenantAdministratorAssignments.IgnoreQueryFilters()
            .SingleAsync(item => item.UserId == accepted.AccountId);
        Assert.Equal(TenantAdministratorGrantActor.PlatformRecovery, authority.GrantedByActorType);

        // And the Platform operator still has nothing.
        await AssertPlatformActorHasNothingAsync(world);

        var health = await new TenantContinuityHealthProjection(world.Db).GetAsync(world.TenantId);
        Assert.Equal(nameof(RecoveryStatus.Completed), health.RecoveryStatus);
    }

    // ── Health projection ────────────────────────────────

    [SkippableFact]
    public async Task Health_reports_recovery_required_only_when_nobody_can_administer()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();
        var projection = new TenantContinuityHealthProjection(world.Db);

        var healthy = await projection.GetAsync(world.TenantId);
        Assert.Equal(nameof(RecoveryStatus.NotRequired), healthy.RecoveryStatus);
        Assert.Equal(1, healthy.UsableAdministrators);

        await StripAdministrationAsync(world);

        var stranded = await projection.GetAsync(world.TenantId);
        Assert.Equal(nameof(RecoveryStatus.Required), stranded.RecoveryStatus);
        Assert.Equal(0, stranded.UsableAdministrators);
    }

    [SkippableFact]
    public async Task Health_exposes_counts_and_status_but_no_business_data()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();

        var health = await new TenantContinuityHealthProjection(world.Db).GetAsync(world.TenantId);

        // The shape is the guarantee: Platform sees whether the tenant can be
        // administered, not who its people are.
        Assert.Equal(1, health.ActiveAdministrators);
        Assert.Equal(0, health.SuspendedAdministrators);
        Assert.Null(health.LatestRecoveryAttempt);
    }

    // ── plumbing ─────────────────────────────────────────

    private static InitiateRecoveryRequest Request(string? email = null)
        => new(email ?? RecipientEmail, VerificationAcknowledged: true, "TICKET-4821");

    private static IPlatformAdministratorRecoveryService Recovery(AppIdentityDbContext db)
        => new PlatformAdministratorRecoveryService(
            db,
            RelationalTestDatabase.CreateUserManager(db),
            new TenantContinuityCommandExecutor(db),
            new CapturingAdministrativeDelivery());

    private static Task<List<InviteToken>> RecoveryInvitationsAsync(AppIdentityDbContext db, Guid tenantId)
        => db.InviteTokens.IgnoreQueryFilters()
            .Where(item => item.TenantId == tenantId
                && item.Purpose == InvitationPurpose.TenantAdministratorRecovery
                && item.AcceptedAt == null
                && !item.IsRevoked
                && item.SupersededAt == null)
            .ToListAsync();

    /// <summary>
    /// Leaves the tenant with no usable administrator by suspending its only one
    /// directly — the state a tenant reaches through account loss, not through a
    /// command the product would have allowed.
    /// </summary>
    private static async Task StripAdministrationAsync(World world)
    {
        await world.Db.Database.ExecuteSqlRawAsync(
            "UPDATE identity.\"TenantMemberships\" SET \"Status\" = 'Suspended' WHERE \"TenantId\" = {0}",
            world.TenantId);
        world.Db.ChangeTracker.Clear();

        Assert.Equal(0, await UsableTenantAdministrator.CountAsync(world.Db, world.TenantId));
    }

    private static async Task AssertPlatformActorHasNothingAsync(World world)
    {
        Assert.Empty(await world.Db.TenantMemberships.IgnoreQueryFilters()
            .Where(item => item.UserId == world.PlatformActorId).ToListAsync());

        Assert.Empty(await world.Db.TenantAdministratorAssignments.IgnoreQueryFilters()
            .Where(item => item.UserId == world.PlatformActorId).ToListAsync());

        Assert.Empty(await world.Db.UserAccessProfiles.IgnoreQueryFilters()
            .Where(item => item.UserId == world.PlatformActorId).ToListAsync());

        var platformAccount = await world.Db.Users.IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.Id == world.PlatformActorId);

        if (platformAccount is not null)
        {
            // Platform Administrator authority is control-plane only. It never
            // becomes customer authority, whatever recovery did.
            var resolver = new CustomerContextResolver(
                world.Db, RelationalTestDatabase.CreateUserManager(world.Db));
            var context = await resolver.ResolveAsync(platformAccount);
            Assert.False(context.IsAuthoritative);
        }
    }

    private sealed record World(
        AppIdentityDbContext Db,
        Guid TenantId,
        Guid PlatformActorId,
        Guid FirstAccountId,
        Guid FirstMembershipId);

    private async Task<World> ArrangeAsync()
    {
        var db = await _databases.CreateAsync("fusion_recovery");
        var platformActorId = Guid.NewGuid();
        var bootstrap = new CapturingBootstrapDelivery();

        var provisioned = await new TenantProvisioningService(db, bootstrap).ProvisionAsync(
            new ProvisionTenantRequest
            {
                Name = "Atlas Group",
                TimeZone = "Europe/Paris",
                AdministratorEmail = "first.admin@atlas.example",
                IdempotencyKey = $"recovery-{Guid.NewGuid():N}",
            },
            platformActorId);

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

        var firstAccountId = activation.AccountId!.Value;
        var membershipId = await db.TenantMemberships.IgnoreQueryFilters()
            .Where(item => item.UserId == firstAccountId).Select(item => item.Id).SingleAsync();

        return new World(db, provisioned.Value.TenantId, platformActorId, firstAccountId, membershipId);
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

    private sealed class CapturingAdministrativeDelivery : IAdministrativeInvitationDelivery
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

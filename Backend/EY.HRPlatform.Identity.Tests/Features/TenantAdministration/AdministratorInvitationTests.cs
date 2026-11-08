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
/// The administrative invitation lifecycle against real PostgreSQL.
/// <para>
/// Every rule here is transactional or constraint-backed: rotation invalidates a
/// link the moment it commits, pending uniqueness is a filtered index, and
/// acceptance must produce exactly one account, membership, and authority or
/// nothing at all. None of that can be observed in memory.
/// </para>
/// </summary>
public sealed class AdministratorInvitationTests : IAsyncLifetime
{
    private const string InvitedEmail = "second.admin@atlas.example";

    private readonly RelationalTestDatabase _databases = new();
    private bool Available => _databases.Available;

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync() => _databases.DisposeAsync().AsTask();

    // ── What a link opens onto ───────────────────────────

    [SkippableFact]
    public async Task A_revoked_invitation_is_terminal_and_says_so()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var (db, tenantId, actor, sent) = await ArrangeAsync();
        var service = Service(db, sent);

        var issued = await service.IssueAsync(tenantId, InvitedEmail, actor);
        var link = sent.Credential!.RawValue;

        await service.RevokeAsync(issued.InvitationId);

        Assert.Equal(
            AdministrativeInvitationEntryState.Revoked,
            (await service.InspectAsync(link)).State);
    }

    [SkippableFact]
    public async Task An_expired_invitation_reports_expiry_rather_than_invalidity()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var (db, tenantId, actor, sent) = await ArrangeAsync();
        var service = Service(db, sent);

        var issued = await service.IssueAsync(tenantId, InvitedEmail, actor);
        var link = sent.Credential!.RawValue;
        await ExpireAsync(db, issued.InvitationId);

        // Expired and invalid mean different things to the recipient: one can be
        // resolved by asking for another invitation, the other cannot.
        Assert.Equal(
            AdministrativeInvitationEntryState.Expired,
            (await service.InspectAsync(link)).State);
    }

    // ── Purpose separation ───────────────────────────────

    [SkippableFact]
    public async Task A_bootstrap_credential_cannot_be_used_through_the_administrative_route()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var (db, _, _, sent) = await ArrangeAsync();

        var bootstrapCredential = await db.InviteTokens.IgnoreQueryFilters()
            .Where(item => item.Purpose == InvitationPurpose.OrganizationBootstrap)
            .Select(item => item.CredentialSelector)
            .FirstOrDefaultAsync();

        Skip.If(bootstrapCredential is null, "Arrangement produced no bootstrap invitation.");

        // Purpose is bound at creation and never inferred, so a credential issued
        // for one journey is refused by the other — and refused indistinguishably
        // from an unknown one.
        var entry = await Service(db, sent).InspectAsync($"{bootstrapCredential}.whatever-secret");
        Assert.Equal(AdministrativeInvitationEntryState.Invalid, entry.State);
    }

    [SkippableTheory]
    [InlineData("")]
    [InlineData("garbage")]
    [InlineData("unknown-selector.unknown-secret")]
    public async Task An_unusable_credential_discloses_nothing(string credential)
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var (db, _, _, sent) = await ArrangeAsync();

        var entry = await Service(db, sent).InspectAsync(credential);

        Assert.Equal(AdministrativeInvitationEntryState.Invalid, entry.State);
        Assert.Null(entry.TenantName);
        Assert.Null(entry.InvitedEmail);
    }

    // ── Acceptance ───────────────────────────────────────

    [SkippableFact]
    public async Task Acceptance_establishes_exactly_one_account_membership_and_authority()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var (db, tenantId, actor, sent) = await ArrangeAsync();

        var issued = await Service(db, sent).IssueAsync(tenantId, InvitedEmail, actor);
        var link = sent.Credential!.RawValue;
        db.ChangeTracker.Clear();

        var result = await Acceptance(db).AcceptAsync(new AdministrativeAcceptanceRequest
        {
            Credential = link,
            Email = InvitedEmail,
            Password = "Administrator@123456",
            FirstName = "Bea",
            LastName = "Admin",
        });

        Assert.Equal(AdministrativeAcceptanceOutcome.Accepted, result.Outcome);

        db.ChangeTracker.Clear();
        var account = await db.Users.IgnoreQueryFilters()
            .SingleAsync(user => user.NormalizedEmail == InvitedEmail.ToUpperInvariant());

        var membership = await db.TenantMemberships.IgnoreQueryFilters()
            .SingleAsync(item => item.UserId == account.Id);
        Assert.True(membership.IsActive);
        Assert.Equal(tenantId, membership.TenantId);

        var authority = await db.TenantAdministratorAssignments.IgnoreQueryFilters()
            .SingleAsync(item => item.UserId == account.Id);
        Assert.True(authority.IsActive);
        Assert.Equal(issued.InvitationId, authority.SourceInvitationId);
        Assert.Equal(TenantAdministratorGrantActor.PlatformRecovery, authority.GrantedByActorType);

        // The tenant was already active; acceptance is not a second activation.
        var tenant = await db.Tenants.IgnoreQueryFilters().SingleAsync(item => item.Id == tenantId);
        Assert.True(tenant.IsActive);
    }

    [SkippableFact]
    public async Task Replaying_an_accepted_invitation_is_neutral_and_duplicates_nothing()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var (db, tenantId, actor, sent) = await ArrangeAsync();

        await Service(db, sent).IssueAsync(tenantId, InvitedEmail, actor);
        var link = sent.Credential!.RawValue;
        db.ChangeTracker.Clear();

        var request = new AdministrativeAcceptanceRequest
        {
            Credential = link, Email = InvitedEmail, Password = "Administrator@123456",
            FirstName = "Bea", LastName = "Admin",
        };

        Assert.Equal(AdministrativeAcceptanceOutcome.Accepted,
            (await Acceptance(db).AcceptAsync(request)).Outcome);

        db.ChangeTracker.Clear();
        var replay = await Acceptance(db).AcceptAsync(request);

        // Stable and deliberately silent about who accepted it.
        Assert.Equal(AdministrativeAcceptanceOutcome.AlreadyAccepted, replay.Outcome);
        Assert.Null(replay.AccountId);

        db.ChangeTracker.Clear();
        Assert.Single(await db.Users.IgnoreQueryFilters()
            .Where(user => user.NormalizedEmail == InvitedEmail.ToUpperInvariant()).ToListAsync());
    }

    [SkippableFact]
    public async Task Concurrent_acceptance_of_the_same_link_establishes_access_once()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var (db, tenantId, actor, sent) = await ArrangeAsync();

        await Service(db, sent).IssueAsync(tenantId, InvitedEmail, actor);
        var link = sent.Credential!.RawValue;
        db.ChangeTracker.Clear();

        var second = _databases.Connect(db);

        var request = new AdministrativeAcceptanceRequest
        {
            Credential = link, Email = InvitedEmail, Password = "Administrator@123456",
            FirstName = "Bea", LastName = "Admin",
        };

        var outcomes = await Task.WhenAll(
            SafeAcceptAsync(Acceptance(db), request),
            SafeAcceptAsync(Acceptance(second), request));

        // The invitation row lock serializes the two attempts.
        Assert.Single(outcomes, outcome => outcome == AdministrativeAcceptanceOutcome.Accepted);

        db.ChangeTracker.Clear();
        Assert.Single(await db.Users.IgnoreQueryFilters()
            .Where(user => user.NormalizedEmail == InvitedEmail.ToUpperInvariant()).ToListAsync());
        Assert.Single(await db.TenantAdministratorAssignments.IgnoreQueryFilters()
            .Where(item => item.TenantId == tenantId
                && item.GrantedByActorType == TenantAdministratorGrantActor.PlatformRecovery)
            .ToListAsync());
    }

    [SkippableFact]
    public async Task A_refused_acceptance_leaves_no_partial_access()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var (db, tenantId, actor, sent) = await ArrangeAsync();

        var issued = await Service(db, sent).IssueAsync(tenantId, InvitedEmail, actor);
        var link = sent.Credential!.RawValue;

        await Service(db, sent).RevokeAsync(issued.InvitationId);
        db.ChangeTracker.Clear();

        var result = await Acceptance(db).AcceptAsync(new AdministrativeAcceptanceRequest
        {
            Credential = link, Email = InvitedEmail, Password = "Administrator@123456",
            FirstName = "Bea", LastName = "Admin",
        });

        Assert.Equal(AdministrativeAcceptanceOutcome.NotAcceptable, result.Outcome);

        db.ChangeTracker.Clear();
        Assert.Empty(await db.Users.IgnoreQueryFilters()
            .Where(user => user.NormalizedEmail == InvitedEmail.ToUpperInvariant()).ToListAsync());
        Assert.Empty(await db.TenantAdministratorAssignments.IgnoreQueryFilters()
            .Where(item => item.GrantedByActorType == TenantAdministratorGrantActor.PlatformRecovery)
            .ToListAsync());
    }

    [SkippableFact]
    public async Task An_acceptance_refused_for_an_existing_account_still_records_why()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var (db, tenantId, actor, sent) = await ArrangeAsync();

        var issued = await Service(db, sent).IssueAsync(tenantId, InvitedEmail, actor);
        var link = sent.Credential!.RawValue;

        // The address is claimed after the invitation was issued — the realistic
        // race, and the only case where an administrator sees a valid invitation
        // simply never complete.
        await db.Database.ExecuteSqlRawAsync($"""
            INSERT INTO identity."AspNetUsers"
                ("Id","UserName","NormalizedUserName","Email","NormalizedEmail","EmailConfirmed",
                 "PasswordHash","SecurityStamp","ConcurrencyStamp","PhoneNumberConfirmed",
                 "TwoFactorEnabled","LockoutEnabled","AccessFailedCount",
                 "FirstName","LastName","IsActive","HireDate","CreatedAt")
            VALUES ('{Guid.NewGuid()}','{InvitedEmail}','{InvitedEmail.ToUpperInvariant()}','{InvitedEmail}',
                    '{InvitedEmail.ToUpperInvariant()}',true,'x','{Guid.NewGuid()}','{Guid.NewGuid()}',false,
                    false,true,0,'Someone','Else',true,now(),now());
            """);
        db.ChangeTracker.Clear();

        var result = await Acceptance(db).AcceptAsync(new AdministrativeAcceptanceRequest
        {
            Credential = link, Email = InvitedEmail, Password = "Administrator@123456",
            FirstName = "Bea", LastName = "Admin",
        });

        Assert.Equal(AdministrativeAcceptanceOutcome.ExistingAccountConflict, result.Outcome);

        db.ChangeTracker.Clear();

        // The refusal must survive the rolled-back acceptance. Without it, the
        // administrator who issued the invitation has no way to learn why it
        // never completed.
        Assert.Single(await db.AccessAuditEvents.IgnoreQueryFilters()
            .Where(item => item.Action == AccessAuditActions.InvitationRejectedExistingAccount)
            .ToListAsync());

        // And the invitation itself is untouched, so replacing the email is still
        // an available recovery.
        var invitation = await db.InviteTokens.IgnoreQueryFilters()
            .SingleAsync(item => item.Id == issued.InvitationId);
        Assert.Equal(InvitationState.Pending, invitation.State);
    }

    [SkippableFact]
    public async Task The_invited_address_cannot_be_altered_by_editing_the_request()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var (db, tenantId, actor, sent) = await ArrangeAsync();

        await Service(db, sent).IssueAsync(tenantId, InvitedEmail, actor);
        var link = sent.Credential!.RawValue;
        db.ChangeTracker.Clear();

        var result = await Acceptance(db).AcceptAsync(new AdministrativeAcceptanceRequest
        {
            Credential = link, Email = "someone.else@atlas.example",
            Password = "Administrator@123456", FirstName = "Bea", LastName = "Admin",
        });

        Assert.Equal(AdministrativeAcceptanceOutcome.NotAcceptable, result.Outcome);
    }

    // ── Delivery ─────────────────────────────────────────

    // ── plumbing ─────────────────────────────────────────

    private static async Task<AdministrativeAcceptanceOutcome> SafeAcceptAsync(
        IAdministrativeInvitationAcceptanceService service, AdministrativeAcceptanceRequest request)
    {
        try
        {
            return (await service.AcceptAsync(request)).Outcome;
        }
        catch (Exception)
        {
            // A losing concurrent attempt may surface as a database conflict rather
            // than a domain outcome. Either is acceptable; what matters is that it
            // did not establish access.
            return AdministrativeAcceptanceOutcome.NotAcceptable;
        }
    }

    private static Task<List<InviteToken>> PendingAdministrativeAsync(AppIdentityDbContext db, Guid tenantId)
        => db.InviteTokens.IgnoreQueryFilters()
            .Where(item => item.TenantId == tenantId
                && item.Purpose == InvitationPurpose.TenantAdministratorRecovery
                && item.AcceptedAt == null
                && !item.IsRevoked
                && item.SupersededAt == null)
            .ToListAsync();

    private static async Task ExpireAsync(AppIdentityDbContext db, Guid invitationId)
    {
        await db.Database.ExecuteSqlRawAsync(
            "UPDATE identity.\"InviteTokens\" SET \"ExpiresAt\" = now() - interval '1 day' WHERE \"Id\" = {0}",
            invitationId);
        db.ChangeTracker.Clear();
    }

    private static Invitations Service(AppIdentityDbContext db, SentLink sent) => new(db, sent);

    private static IAdministrativeInvitationAcceptanceService Acceptance(AppIdentityDbContext db)
    {
        var users = RelationalTestDatabase.CreateUserManager(db);
        return new AdministrativeInvitationAcceptanceService(db, users, new AccessProfileService(db, users));
    }

    /// <summary>
    /// Provisions and activates a tenant, so the arrangement is a real tenant with
    /// a real first administrator rather than hand-built rows.
    /// </summary>
    private async Task<(AppIdentityDbContext Db, Guid TenantId, Guid Actor, SentLink Sent)>
        ArrangeAsync()
    {
        var db = await _databases.CreateAsync("fusion_admin_invite");
        var platformActor = Guid.NewGuid();
        var bootstrap = new CapturingBootstrapDelivery();

        var provisioned = await new TenantProvisioningService(db, bootstrap).ProvisionAsync(
            new ProvisionTenantRequest
            {
                Name = "Atlas Group",
                TimeZone = "Europe/Paris",
                AdministratorEmail = "first.admin@atlas.example",
                IdempotencyKey = $"admin-invite-{Guid.NewGuid():N}",
            },
            platformActor);

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

        return (db, provisioned.Value.TenantId, activation.AccountId!.Value, new SentLink());
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

    /// <summary>The link the recipient would have received.</summary>
    private sealed class SentLink
    {
        public BootstrapCredential? Credential { get; set; }
    }

    private sealed record Issued(Guid InvitationId);

    private sealed class Invitations(AppIdentityDbContext db, SentLink sent)
    {
        public Task<AdministrativeInvitationEntry> InspectAsync(string credential)
            => new AdministratorInvitationService(db, RelationalTestDatabase.CreateUserManager(db)).InspectAsync(credential);

        public async Task<Issued> IssueAsync(Guid tenantId, string email, Guid actor)
        {
            var (id, credential) = await AdministrativeInvitations.IssueAsync(db, tenantId, email, actor);
            sent.Credential = credential;
            return new Issued(id);
        }

        public async Task RevokeAsync(Guid invitationId)
        {
            var invitation = await db.InviteTokens.IgnoreQueryFilters().SingleAsync(item => item.Id == invitationId);
            invitation.Revoke();
            await db.SaveChangesAsync();
            db.ChangeTracker.Clear();
        }
    }
}

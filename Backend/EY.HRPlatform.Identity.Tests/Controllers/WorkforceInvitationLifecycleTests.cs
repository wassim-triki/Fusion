using EY.HRPlatform.Identity.Controllers;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.Identity.Features.TenantAdministration;
using EY.HRPlatform.Identity.Features.TenantProvisioning;
using EY.HRPlatform.Identity.Features.WorkforceAccounts;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Models.Responses;
using EY.HRPlatform.Identity.Models.WorkforceAccounts;
using EY.HRPlatform.Identity.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Security;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace EY.HRPlatform.Identity.Tests.Controllers;

public sealed class WorkforceInvitationLifecycleTests : IAsyncLifetime
{
    private readonly RelationalTestDatabase _databases = new();
    public Task InitializeAsync() => Task.CompletedTask;
    public Task DisposeAsync() => _databases.DisposeAsync().AsTask();

    [SkippableTheory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Withdrawal_persists_and_prevents_account_creation_for_both_credential_schemes(bool legacy)
    {
        Skip.IfNot(_databases.Available, "No PostgreSQL connection configured.");
        var (db, invite, credential) = await ArrangeAsync(legacy);
        var controller = Controller(db, invite.TenantId);

        var response = await controller.WithdrawInvite(invite.EmployeeId!.Value, CancellationToken.None);
        var status = Status(response);
        Assert.Equal("InviteRevoked", status.ProvisioningState);
        db.ChangeTracker.Clear();
        var stored = await db.InviteTokens.IgnoreQueryFilters().SingleAsync();
        Assert.Equal(InvitationState.Revoked, stored.State);
        Assert.NotNull(stored.RevokedAt);

        // A new request must see the persisted revocation, not a tracked test fixture.
        var recipientDb = _databases.Connect(db);
        var acceptance = await Acceptance(recipientDb).AcceptAsync(
            new WorkforceAcceptanceRequest(credential, null, null, null, "LifecyclePass123"));
        Assert.Equal(WorkforceAcceptanceOutcome.NotAcceptable, acceptance.Outcome);
        Assert.Empty(await recipientDb.Users.ToListAsync());
        Assert.Empty(await recipientDb.TenantMemberships.IgnoreQueryFilters().ToListAsync());

        // Withdrawing twice remains safe and does not resurrect or replace the invitation.
        Assert.Equal("InviteRevoked", Status(await Controller(recipientDb, invite.TenantId)
            .WithdrawInvite(invite.EmployeeId.Value, CancellationToken.None)).ProvisioningState);
        Assert.Equal(1, await recipientDb.InviteTokens.IgnoreQueryFilters().CountAsync());
    }

    [SkippableFact]
    public async Task Resend_persists_rotated_credential_and_reinviting_a_withdrawn_invite_creates_a_fresh_one()
    {
        Skip.IfNot(_databases.Available, "No PostgreSQL connection configured.");
        var (db, invite, oldCredential) = await ArrangeAsync();
        var sender = new CaptureSender();
        var controller = Controller(db, invite.TenantId, sender);
        Status(await controller.ResendInvite(invite.EmployeeId!.Value, CancellationToken.None));
        var resentCredential = sender.Credential;
        Assert.NotEqual(oldCredential, resentCredential);
        db.ChangeTracker.Clear();
        var stored = await db.InviteTokens.IgnoreQueryFilters().SingleAsync();
        Assert.True(BootstrapCredential.TryParse(resentCredential, out var selector, out var secret));
        Assert.Equal(selector, stored.CredentialSelector);
        Assert.True(stored.MatchesCredentialDigest(BootstrapCredential.Digest(secret)));
        Assert.Equal(WorkforceAcceptanceOutcome.NotAcceptable, (await Acceptance(_databases.Connect(db))
            .AcceptAsync(new WorkforceAcceptanceRequest(oldCredential, null, null, null, "LifecyclePass123"))).Outcome);

        db.ChangeTracker.Clear();
        Status(await controller.WithdrawInvite(invite.EmployeeId.Value, CancellationToken.None));
        db.ChangeTracker.Clear();
        var replacement = Status(await controller.ResendInvite(invite.EmployeeId.Value, CancellationToken.None));
        Assert.NotEqual(invite.Id, replacement.InviteId);
        Assert.Equal("InvitePending", replacement.ProvisioningState);
        db.ChangeTracker.Clear();
        Assert.Equal(InvitationState.Revoked, (await db.InviteTokens.IgnoreQueryFilters().SingleAsync(i => i.Id == invite.Id)).State);
        var recipient = _databases.Connect(db);
        Assert.Equal(WorkforceAcceptanceOutcome.NotAcceptable, (await Acceptance(recipient)
            .AcceptAsync(new WorkforceAcceptanceRequest(resentCredential, null, null, null, "LifecyclePass123"))).Outcome);
        Assert.Equal(WorkforceAcceptanceOutcome.Accepted, (await Acceptance(recipient)
            .AcceptAsync(new WorkforceAcceptanceRequest(sender.Credential, null, null, null, "LifecyclePass123"))).Outcome);
    }

    [SkippableFact]
    public async Task Another_tenant_cannot_withdraw_the_invitation()
    {
        Skip.IfNot(_databases.Available, "No PostgreSQL connection configured.");
        var (db, invite, _) = await ArrangeAsync();
        var response = await Controller(db, Guid.NewGuid()).WithdrawInvite(invite.EmployeeId!.Value, CancellationToken.None);
        Assert.IsType<NotFoundObjectResult>(response.Result);
        db.ChangeTracker.Clear();
        Assert.Equal(InvitationState.Pending, (await db.InviteTokens.IgnoreQueryFilters().SingleAsync()).State);
        Assert.Empty(await db.AccessAuditEvents.IgnoreQueryFilters().ToListAsync());
    }

    [SkippableFact]
    public async Task Acceptance_and_withdrawal_serialize_to_one_terminal_state()
    {
        Skip.IfNot(_databases.Available, "No PostgreSQL connection configured.");
        var (db, invite, credential) = await ArrangeAsync();
        var recipient = _databases.Connect(db);
        var withdrawal = Controller(db, invite.TenantId).WithdrawInvite(invite.EmployeeId!.Value, CancellationToken.None);
        var acceptance = Acceptance(recipient).AcceptAsync(
            new WorkforceAcceptanceRequest(credential, null, null, null, "LifecyclePass123"));
        await Task.WhenAll(withdrawal, acceptance);
        db.ChangeTracker.Clear();
        var stored = await db.InviteTokens.IgnoreQueryFilters().SingleAsync();
        if (acceptance.Result.Outcome == WorkforceAcceptanceOutcome.Accepted)
        {
            Assert.IsType<BadRequestObjectResult>(withdrawal.Result.Result);
            Assert.Equal(InvitationState.Accepted, stored.State);
            Assert.False(stored.IsRevoked);
        }
        else
        {
            Assert.Equal(WorkforceAcceptanceOutcome.NotAcceptable, acceptance.Result.Outcome);
            Assert.Equal("InviteRevoked", Status(withdrawal.Result).ProvisioningState);
            Assert.Equal(InvitationState.Revoked, stored.State);
            Assert.Empty(await db.Users.ToListAsync());
        }
    }

    [SkippableFact]
    public async Task History_tells_the_account_story_newest_first_with_names_and_only_inside_its_tenant()
    {
        Skip.IfNot(_databases.Available, "No PostgreSQL connection configured.");
        var (db, invite, _) = await ArrangeAsync();
        var hrId = Guid.NewGuid();
        db.Users.AddRange(
            new ApplicationUser { Id = invite.CreatedByUserId, FirstName = "Amira", LastName = "Khelifi", Email = "amira@example.test", UserName = "amira@example.test" },
            new ApplicationUser { Id = hrId, FirstName = "Mouna", LastName = "Kooli", Email = "mouna@example.test", UserName = "mouna@example.test" });
        await db.SaveChangesAsync();
        var employeeId = invite.EmployeeId!.Value;
        var sender = new CaptureSender();
        Status(await Controller(db, invite.TenantId, sender, hrId).WithdrawInvite(employeeId, CancellationToken.None));
        db.ChangeTracker.Clear();
        Status(await Controller(db, invite.TenantId, sender, hrId).ResendInvite(employeeId, CancellationToken.None));
        var recipient = _databases.Connect(db);
        Assert.Equal(WorkforceAcceptanceOutcome.Accepted, (await Acceptance(recipient)
            .AcceptAsync(new WorkforceAcceptanceRequest(sender.Credential, null, null, null, "LifecyclePass123"))).Outcome);
        var signedIn = DateTime.UtcNow.AddMinutes(5);
        await recipient.Users.Where(user => user.Email == "lifecycle@example.test")
            .ExecuteUpdateAsync(set => set.SetProperty(user => user.LastLoginAt, signedIn));
        db.ChangeTracker.Clear();

        var story = History(await Controller(db, invite.TenantId).GetHistory(employeeId, CancellationToken.None));
        Assert.Equal(
            [WorkforceAccountHistoryKinds.SignedIn, WorkforceAccountHistoryKinds.Accepted, WorkforceAccountHistoryKinds.Delivered,
                WorkforceAccountHistoryKinds.SentAgain, WorkforceAccountHistoryKinds.Withdrawn, WorkforceAccountHistoryKinds.Invited],
            story.Select(item => item.Kind));
        Assert.Equal("Amira Khelifi", story[^1].ActorName);
        Assert.Equal("Mouna Kooli", story[4].ActorName);
        Assert.Equal("Mouna Kooli", story[3].ActorName);
        Assert.Equal("lifecycle@example.test", story[2].Email);

        // Another company's signed caller hears nothing about this person.
        Assert.Empty(History(await Controller(db, Guid.NewGuid()).GetHistory(employeeId, CancellationToken.None)));
    }

    private static List<WorkforceAccountHistoryEventDto> History(ActionResult<ApiResponse<List<WorkforceAccountHistoryEventDto>>> response)
        => Assert.IsType<ApiResponse<List<WorkforceAccountHistoryEventDto>>>(Assert.IsType<OkObjectResult>(response.Result).Value).Data!;

    private async Task<(AppIdentityDbContext Db, InviteToken Invite, string Credential)> ArrangeAsync(bool legacy = false)
    {
        var db = await _databases.CreateAsync("fusion_withdraw");
        var tenantId = Guid.NewGuid();
        db.Tenants.Add(Tenant.Create(tenantId, "Lifecycle Company"));
        var profile = AccessProfile.Create(tenantId, "Employee", null, AccessProfileTypes.SystemSeeded, true, "employee");
        db.AccessProfiles.Add(profile);
        var invite = legacy
            ? InviteToken.Create("lifecycle@example.test", tenantId, PlatformRole.Employee, Guid.NewGuid(), "Test", "Person", Guid.NewGuid())
            : InviteToken.CreateWorkforce("lifecycle@example.test", tenantId, PlatformRole.Employee, Guid.NewGuid(), "Test", "Person", Guid.NewGuid());
        var credential = BootstrapCredential.Issue();
        if (!legacy) invite.IssueCredential(credential.Selector, BootstrapCredential.Digest(credential.Secret));
        db.InviteTokens.Add(invite);
        db.InviteAccessProfiles.Add(InviteAccessProfile.Create(tenantId, invite.Id, profile.Id));
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        return (db, invite, legacy ? invite.Token! : credential.RawValue);
    }

    private static WorkforceInvitationAcceptanceService Acceptance(AppIdentityDbContext db)
        => new(db, RelationalTestDatabase.CreateUserManager(db), Profiles(db));

    private static AccessProfileService Profiles(AppIdentityDbContext db)
        => new(db, RelationalTestDatabase.CreateUserManager(db));

    private static WorkforceAccountsController Controller(AppIdentityDbContext db, Guid tenantId, CaptureSender? sender = null,
        Guid? actingUserId = null)
    {
        var context = new DefaultHttpContext();
        context.Request.Headers["X-Tenant-Id"] = tenantId.ToString();
        context.Request.Headers["X-Acting-User-Id"] = (actingUserId ?? Guid.NewGuid()).ToString();
        return new(db, Profiles(db), new ConfigurationBuilder().Build(), new TenantContinuityCommandExecutor(db),
            new AuthorizedCaller(), sender ?? new CaptureSender())
        {
            ControllerContext = new ControllerContext { HttpContext = context }
        };
    }

    private static WorkforceAccountStatusDto Status(ActionResult<ApiResponse<WorkforceAccountStatusDto>> response)
        => Assert.IsType<ApiResponse<WorkforceAccountStatusDto>>(Assert.IsType<OkObjectResult>(response.Result).Value).Data!;

    private sealed class AuthorizedCaller : IInternalServiceRequestAuthorizer
    {
        public Task<bool> AuthorizeAsync(HttpRequest request, CancellationToken cancellationToken = default) => Task.FromResult(true);
    }

    private sealed class CaptureSender : IWorkforceInvitationEmailSender
    {
        public string Credential { get; private set; } = string.Empty;
        public Task<WorkforceInvitationDeliveryResult> SendInviteAsync(WorkforceInvitationEmailMessage invitation, CancellationToken cancellationToken)
        {
            Credential = Uri.UnescapeDataString(invitation.InviteLink.Split("token=")[1].Split('&')[0]);
            return Task.FromResult(WorkforceInvitationDeliveryResult.Sent());
        }
    }
}

using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.TenantProvisioning;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace EY.HRPlatform.Identity.Features.TenantAdministration;

/// <summary>
/// A Platform Administrator's request to restore customer-controlled
/// administration to a tenant that has none.
/// </summary>
/// <param name="RecipientEmail">
/// The customer representative whose control of this address was verified
/// outside Fusion.
/// </param>
/// <param name="VerificationAcknowledged">
/// An explicit statement that the external verification process was completed.
/// Required: recovery hands a stranger the keys to a customer's tenant, so it
/// cannot be a single unconsidered click.
/// </param>
/// <param name="VerificationReference">
/// An optional bounded note pointing at that verification. Deliberately just a
/// reference — identity documents, contact records, and case data are not
/// collected here, because storing them would create a sensitive-data
/// capability nobody asked for.
/// </param>
public sealed record InitiateRecoveryRequest(
    string RecipientEmail,
    bool VerificationAcknowledged,
    string? VerificationReference);

public enum RecoveryOutcome
{
    Initiated = 0,

    /// <summary>A usable administrator remains, so recovery does not apply.</summary>
    NotEligible,

    /// <summary>A recovery is already in flight for this tenant.</summary>
    AlreadyPending,

    /// <summary>The verification acknowledgement was absent.</summary>
    VerificationNotAcknowledged,

    InvalidRecipient,

    /// <summary>The recipient address already belongs to a Fusion account.</summary>
    ExistingAccount,

    TenantNotFound,
}

public sealed record RecoveryResult(
    RecoveryOutcome Outcome,
    Guid? InvitationId = null,
    bool DeliveryFailed = false);

public interface IPlatformAdministratorRecoveryService
{
    Task<RecoveryResult> InitiateAsync(
        Guid tenantId,
        InitiateRecoveryRequest request,
        Guid platformActorId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Reissues the recovery link, rotating the credential so the previous one
    /// stops working. The realistic case is a message that never arrived.
    /// </summary>
    Task<RecoveryResult> ResendAsync(
        Guid tenantId, Guid invitationId, Guid platformActorId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Withdraws a recovery attempt — an address entered wrongly, or a
    /// verification that turned out not to hold. Terminal for that invitation.
    /// </summary>
    Task<RecoveryResult> RevokeAsync(
        Guid tenantId, Guid invitationId, Guid platformActorId, CancellationToken cancellationToken = default);
}

/// <summary>
/// Platform-assisted administrator recovery.
/// <para>
/// This is the one place Platform reaches into a customer tenant, so it is
/// deliberately narrow. It issues an invitation to a verified customer
/// representative and nothing else: no Tenant Membership, no access assignment,
/// and no session is created for the Platform actor, who cannot see or enter the
/// tenant before or after.
/// </para>
/// <para>
/// Eligibility is re-evaluated <em>under the tenant continuity lock</em>
/// immediately before issuing. Checking it beforehand would leave a window where
/// a tenant-side restoration commits at the same moment and Platform hands out
/// authority to a tenant that had just recovered on its own.
/// </para>
/// </summary>
public sealed class PlatformAdministratorRecoveryService(
    AppIdentityDbContext dbContext,
    UserManager<ApplicationUser> userManager,
    ITenantContinuityCommandExecutor continuity,
    IAdministrativeInvitationDelivery delivery) : IPlatformAdministratorRecoveryService
{
    private const int ExpiryDays = 7;
    private const int VerificationReferenceMaxLength = 128;

    public async Task<RecoveryResult> InitiateAsync(
        Guid tenantId,
        InitiateRecoveryRequest request,
        Guid platformActorId,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (!request.VerificationAcknowledged)
        {
            return new RecoveryResult(RecoveryOutcome.VerificationNotAcknowledged);
        }

        var email = request.RecipientEmail?.Trim().ToLowerInvariant() ?? string.Empty;

        if (!LooksLikeEmail(email))
        {
            return new RecoveryResult(RecoveryOutcome.InvalidRecipient);
        }

        var normalized = userManager.NormalizeEmail(email);

        // Recovery establishes a new administrator account. Attaching an existing
        // one would silently join a person's identity to a tenant they were never
        // shown joining.
        if (await dbContext.Users.IgnoreQueryFilters()
            .AnyAsync(user => user.NormalizedEmail == normalized, cancellationToken))
        {
            return new RecoveryResult(RecoveryOutcome.ExistingAccount);
        }

        BootstrapCredential? credential = null;

        // The continuity executor gives this the same per-tenant serialization
        // every authority-affecting command runs under, which is what makes the
        // zero check meaningful rather than advisory.
        var result = await continuity.ExecuteAsync<Guid>(
            tenantId,
            platformActorId,
            async context =>
            {
                var tenant = await context.Db.Tenants
                    .IgnoreQueryFilters()
                    .FirstOrDefaultAsync(item => item.Id == tenantId, cancellationToken);

                if (tenant is null || !tenant.IsActive || tenant.IsArchived)
                {
                    return ContinuityResult<Guid>.Refused(ContinuityFailure.NotFound);
                }

                // Re-read under the lock. Anything observed before entering the
                // executor is stale by definition.
                if (!await TenantAdministratorRecoveryEligibility.IsEligibleAsync(
                        context.Db, tenantId, cancellationToken))
                {
                    return ContinuityResult<Guid>.Refused(
                        ContinuityFailure.NotApplicable,
                        "Recovery applies only after bootstrap is complete and no usable administrator remains.");
                }

                var pendingRecovery = await context.Db.InviteTokens
                    .IgnoreQueryFilters()
                    .AnyAsync(item => item.TenantId == tenantId
                        && item.Purpose == InvitationPurpose.TenantAdministratorRecovery
                        && item.AcceptedAt == null
                        && !item.IsRevoked
                        && item.SupersededAt == null, cancellationToken);

                if (pendingRecovery)
                {
                    return ContinuityResult<Guid>.Refused(
                        ContinuityFailure.NotApplicable,
                        "A recovery invitation is already pending for this tenant.");
                }

                var invitation = InviteToken.CreateAdministrative(
                    email, tenantId, platformActorId,
                    InvitationPurpose.TenantAdministratorRecovery, ExpiryDays);

                credential = BootstrapCredential.Issue();
                invitation.IssueCredential(
                    credential.Selector, BootstrapCredential.Digest(credential.Secret));

                context.Db.InviteTokens.Add(invitation);

                // Written into the tenant's own activity, so the customer can see
                // that Platform acted on their tenant and when.
                context.Audit(AccessAuditEvent.Create(
                    tenantId,
                    platformActorId,
                    actorName: string.Empty,
                    actorRole: PlatformRole.PlatformAdmin,
                    action: AccessAuditActions.PlatformRecoveryInitiated,
                    resourceType: AccessAuditActions.ResourceTypeInvitation,
                    resourceId: invitation.Id.ToString(),
                    summary: $"Platform-assisted administrator recovery started for {email}.",
                    beforeJson: null,
                    afterJson: BuildEvidence(request),
                    correlationId: invitation.Id.ToString()));

                return ContinuityResult<Guid>.Ok(invitation.Id);
            },
            cancellationToken);

        if (!result.Succeeded)
        {
            return result.Failure switch
            {
                ContinuityFailure.NotFound => new RecoveryResult(RecoveryOutcome.TenantNotFound),
                ContinuityFailure.NotApplicable when result.Reason?.Contains("pending") == true =>
                    new RecoveryResult(RecoveryOutcome.AlreadyPending),
                _ => new RecoveryResult(RecoveryOutcome.NotEligible),
            };
        }

        // Strictly after commit, like every other invitation.
        await delivery.DeliverAsync(
            result.Value, email, credential!,
            InvitationPurpose.TenantAdministratorRecovery, platformActorId, cancellationToken);

        var deliveryStatus = await dbContext.InviteTokens
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item => item.Id == result.Value)
            .Select(item => item.DeliveryStatus)
            .FirstOrDefaultAsync(cancellationToken);

        return new RecoveryResult(
            RecoveryOutcome.Initiated,
            result.Value,
            string.Equals(deliveryStatus, "Failed", StringComparison.OrdinalIgnoreCase));
    }

    public async Task<RecoveryResult> ResendAsync(
        Guid tenantId, Guid invitationId, Guid platformActorId, CancellationToken cancellationToken = default)
    {
        await using var transaction = await BeginAsync(cancellationToken);

        var invitation = await LoadPendingRecoveryAsync(tenantId, invitationId, cancellationToken);

        if (invitation is null)
        {
            if (transaction is not null)
            {
                await transaction.RollbackAsync(cancellationToken);
            }

            return new RecoveryResult(RecoveryOutcome.TenantNotFound);
        }

        // Rotating the credential is what makes the previously delivered link stop
        // resolving. Extending expiry alone would leave two live links to the same
        // tenant's administration.
        var credential = BootstrapCredential.Issue();
        invitation.IssueCredential(credential.Selector, BootstrapCredential.Digest(credential.Secret));
        invitation.ExtendExpiry(ExpiryDays);

        dbContext.AccessAuditEvents.Add(RecoveryEvent(
            tenantId, platformActorId, AccessAuditActions.InvitationResent, invitation.Id,
            $"Platform recovery invitation resent to {invitation.Email}."));

        await dbContext.SaveChangesAsync(cancellationToken);

        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        // Sent only after the rotation is durable. Delivering first would mean a
        // rolled-back resend still puts a live-looking link in someone's inbox,
        // and a committed one could be superseded by a concurrent resend the
        // recipient never sees.
        await delivery.DeliverAsync(
            invitation.Id, invitation.Email, credential,
            InvitationPurpose.TenantAdministratorRecovery, platformActorId, cancellationToken);

        return new RecoveryResult(RecoveryOutcome.Initiated, invitation.Id);
    }

    public async Task<RecoveryResult> RevokeAsync(
        Guid tenantId, Guid invitationId, Guid platformActorId, CancellationToken cancellationToken = default)
    {
        await using var transaction = await BeginAsync(cancellationToken);

        var invitation = await LoadPendingRecoveryAsync(tenantId, invitationId, cancellationToken);

        if (invitation is null)
        {
            if (transaction is not null)
            {
                await transaction.RollbackAsync(cancellationToken);
            }

            return new RecoveryResult(RecoveryOutcome.TenantNotFound);
        }

        invitation.Revoke();

        dbContext.AccessAuditEvents.Add(RecoveryEvent(
            tenantId, platformActorId, AccessAuditActions.PlatformRecoveryFailed, invitation.Id,
            $"Platform recovery invitation to {invitation.Email} was withdrawn before it was accepted."));

        await dbContext.SaveChangesAsync(cancellationToken);

        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        return new RecoveryResult(RecoveryOutcome.Initiated, invitation.Id);
    }

    private async Task<IDbContextTransaction?> BeginAsync(CancellationToken cancellationToken)
        => dbContext.Database.IsRelational()
            ? await dbContext.Database.BeginTransactionAsync(cancellationToken)
            : null;

    /// <summary>
    /// Locks and loads a recovery invitation that can still be acted on. Scoped by
    /// tenant and purpose, so a Platform operator cannot reach an administrative
    /// invitation the customer owns through this route.
    /// <para>
    /// The caller must already hold a transaction. A row lock taken outside one is
    /// released the moment the statement returns, so the invitation would be read
    /// and mutated unprotected: two concurrent resends could each rotate the
    /// credential and both report success while only one delivered link still
    /// resolves, and a resend could race an acceptance into sending a link that is
    /// already terminal.
    /// </para>
    /// </summary>
    private async Task<InviteToken?> LoadPendingRecoveryAsync(
        Guid tenantId, Guid invitationId, CancellationToken cancellationToken)
    {
        if (dbContext.Database.IsRelational())
        {
            if (dbContext.Database.CurrentTransaction is null)
            {
                throw new InvalidOperationException(
                    "A recovery invitation must be locked and mutated inside one transaction.");
            }

            await dbContext.Database.ExecuteSqlRawAsync(
                "SELECT 1 FROM identity.\"InviteTokens\" WHERE \"Id\" = {0} FOR UPDATE",
                [invitationId], cancellationToken);
        }

        dbContext.ChangeTracker.Clear();

        var invitation = await dbContext.InviteTokens
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.Id == invitationId
                && item.TenantId == tenantId
                && item.Purpose == InvitationPurpose.TenantAdministratorRecovery, cancellationToken);

        return invitation?.State is InvitationState.Pending or InvitationState.Expired ? invitation : null;
    }

    private static AccessAuditEvent RecoveryEvent(
        Guid tenantId, Guid actorId, string action, Guid invitationId, string summary)
        => AccessAuditEvent.Create(
            tenantId, actorId, actorName: string.Empty, actorRole: PlatformRole.PlatformAdmin,
            action: action, resourceType: AccessAuditActions.ResourceTypeInvitation,
            resourceId: invitationId.ToString(), summary: summary,
            beforeJson: null, afterJson: null, correlationId: invitationId.ToString());

    /// <summary>
    /// The bounded evidence the locked specification asks for, and nothing more.
    /// </summary>
    private static string BuildEvidence(InitiateRecoveryRequest request)
    {
        var reference = request.VerificationReference?.Trim();

        if (!string.IsNullOrEmpty(reference) && reference.Length > VerificationReferenceMaxLength)
        {
            reference = reference[..VerificationReferenceMaxLength];
        }

        var escaped = string.IsNullOrEmpty(reference)
            ? "null"
            : System.Text.Json.JsonSerializer.Serialize(reference);

        return $"{{\"verificationAcknowledged\":true,\"verificationReference\":{escaped}}}";
    }

    private static bool LooksLikeEmail(string email)
    {
        if (email.Length is 0 or > 256 || email.Contains(' '))
        {
            return false;
        }

        var at = email.IndexOf('@');
        return at > 0 && at < email.Length - 1 && email.IndexOf('.', at) > at + 1 && !email.EndsWith('.');
    }
}

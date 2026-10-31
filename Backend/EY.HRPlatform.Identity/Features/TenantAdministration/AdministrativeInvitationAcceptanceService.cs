using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.Identity.Features.Accounts;
using EY.HRPlatform.Identity.Features.TenantProvisioning;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace EY.HRPlatform.Identity.Features.TenantAdministration;

public interface IAdministrativeInvitationAcceptanceService
{
    Task<AdministrativeAcceptanceResult> AcceptAsync(
        AdministrativeAcceptanceRequest request, CancellationToken cancellationToken = default);
}

/// <summary>
/// Turns a valid administrative or recovery credential into durable Tenant
/// Administrator access, in one transaction.
/// <para>
/// Structurally parallel to bootstrap activation but deliberately not the same
/// transition: this runs against a tenant that is already active, performs no
/// tenant activation, and answers to different uniqueness rules.
/// </para>
/// <para>
/// Lock order is fixed: the invitation row first, then the tenant continuity row.
/// Every other continuity command takes only the tenant lock, so no pair of
/// commands can deadlock against each other.
/// </para>
/// </summary>
public sealed class AdministrativeInvitationAcceptanceService(
    AppIdentityDbContext dbContext,
    UserManager<ApplicationUser> userManager,
    IAccessProfileService accessProfiles) : IAdministrativeInvitationAcceptanceService
{
    public async Task<AdministrativeAcceptanceResult> AcceptAsync(
        AdministrativeAcceptanceRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (!BootstrapCredential.TryParse(request.Credential, out var selector, out var secret))
        {
            return new AdministrativeAcceptanceResult(AdministrativeAcceptanceOutcome.NotAcceptable);
        }

        var relational = dbContext.Database.IsRelational();

        await using var transaction = relational
            ? await dbContext.Database.BeginTransactionAsync(cancellationToken)
            : null;

        // Invitation lock first — see the class remarks on acquisition order.
        if (relational)
        {
            await dbContext.Database.ExecuteSqlRawAsync(
                "SELECT 1 FROM identity.\"InviteTokens\" WHERE \"CredentialSelector\" = {0} FOR UPDATE",
                [selector], cancellationToken);
        }

        var invitation = await dbContext.InviteTokens
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.CredentialSelector == selector, cancellationToken);

        // Unknown selector, wrong purpose, and a secret that does not verify give
        // one answer, so a caller cannot probe for valid selectors.
        if (invitation is null
            || !InvitationPurposes.IsAdministrative(invitation.Purpose)
            || !invitation.MatchesCredentialDigest(BootstrapCredential.Digest(secret)))
        {
            return new AdministrativeAcceptanceResult(AdministrativeAcceptanceOutcome.NotAcceptable);
        }

        // Replay is a stable outcome, not a failure: a double submit or a reopened
        // link must not look like something went wrong. It says nothing about who
        // accepted it.
        if (invitation.State == InvitationState.Accepted)
        {
            return new AdministrativeAcceptanceResult(
                AdministrativeAcceptanceOutcome.AlreadyAccepted, Purpose: invitation.Purpose);
        }

        if (invitation.State != InvitationState.Pending)
        {
            return new AdministrativeAcceptanceResult(
                AdministrativeAcceptanceOutcome.NotAcceptable, Purpose: invitation.Purpose);
        }

        // The invited address is the invitation's, never the submitted one. A
        // recipient cannot redirect an invitation by editing the request.
        if (!string.Equals(
                request.Email?.Trim(), invitation.Email, StringComparison.OrdinalIgnoreCase))
        {
            return new AdministrativeAcceptanceResult(
                AdministrativeAcceptanceOutcome.NotAcceptable, Purpose: invitation.Purpose);
        }

        var tenant = await dbContext.Tenants
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.Id == invitation.TenantId, cancellationToken);

        if (tenant is null || !tenant.IsActive || tenant.IsArchived)
        {
            return new AdministrativeAcceptanceResult(
                AdministrativeAcceptanceOutcome.NotAcceptable, Purpose: invitation.Purpose);
        }

        // Tenant continuity lock, taken second and held for the rest of the
        // transaction, so this acceptance serializes against every other command
        // that can change who administers this tenant.
        if (relational)
        {
            await dbContext.Database.ExecuteSqlRawAsync(
                "SELECT 1 FROM identity.\"Tenants\" WHERE \"Id\" = {0} FOR UPDATE",
                [tenant.Id], cancellationToken);
        }

        var normalizedEmail = userManager.NormalizeEmail(invitation.Email);
        var addressIsTaken = await dbContext.Users
            .IgnoreQueryFilters()
            .AnyAsync(user => user.NormalizedEmail == normalizedEmail, cancellationToken);

        if (addressIsTaken)
        {
            return await RefuseForExistingAccountAsync(invitation, transaction, cancellationToken);
        }

        var creation = await CreateAccountAsync(request, invitation.Email);

        if (creation.ConflictedOnAddress)
        {
            return await RefuseForExistingAccountAsync(invitation, transaction, cancellationToken);
        }

        if (creation.Account is null)
        {
            return new AdministrativeAcceptanceResult(
                AdministrativeAcceptanceOutcome.InvalidAccountDetails,
                Purpose: invitation.Purpose,
                FieldErrors: creation.FieldErrors);
        }

        var account = creation.Account;

        // Exactly one new Active membership. Acceptance never reactivates an old
        // membership or moves an account between tenants.
        var membership = TenantMembership.Create(account.Id, tenant.Id);
        dbContext.TenantMemberships.Add(membership);
        await dbContext.SaveChangesAsync(cancellationToken);

        await accessProfiles.EnsureTenantAccessProfilesAsync(tenant.Id, cancellationToken);

        // Exactly one active canonical authority, carrying where it came from.
        dbContext.TenantAdministratorAssignments.Add(
            TenantAdministratorAssignment.Grant(
                membership,
                invitation.Purpose == InvitationPurpose.TenantAdministratorRecovery
                    ? TenantAdministratorGrantActor.PlatformRecovery
                    : TenantAdministratorGrantActor.InvitationAcceptance,
                grantedByUserId: invitation.CreatedByUserId,
                sourceInvitationId: invitation.Id));

        invitation.MarkAccepted(account.Id);

        var isRecovery = invitation.Purpose == InvitationPurpose.TenantAdministratorRecovery;

        dbContext.AccessAuditEvents.Add(AccessAuditEvent.Create(
            tenantId: tenant.Id,
            // The recipient is the actor here, not the Platform Administrator who
            // initiated a recovery; the initiation event already records them.
            actorUserId: account.Id,
            // Left blank so the reader resolves the person's name. Stamping the
            // email here would put a raw address in an activity feed that names
            // people everywhere else.
            actorName: string.Empty,
            actorRole: TenantAdministratorAuthority.DisplayName,
            action: isRecovery
                ? AccessAuditActions.PlatformRecoveryInvitationAccepted
                : AccessAuditActions.InvitationAccepted,
            resourceType: AccessAuditActions.ResourceTypeAdministrator,
            resourceId: membership.Id.ToString(),
            summary: isRecovery
                ? "Customer-controlled Tenant Administrator access restored through Platform recovery."
                : "Tenant Administrator access established by accepting an administrator invitation.",
            beforeJson: null,
            afterJson: null,
            correlationId: invitation.Id.ToString()));

        if (isRecovery)
        {
            dbContext.AccessAuditEvents.Add(AccessAuditEvent.Create(
                tenant.Id, account.Id, account.Email ?? string.Empty,
                TenantAdministratorAuthority.DisplayName,
                AccessAuditActions.PlatformRecoveryCompleted,
                AccessAuditActions.ResourceTypeAdministrator,
                membership.Id.ToString(),
                "Platform-assisted administrator recovery completed.",
                null, null, invitation.Id.ToString()));
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        // Session establishment happens after commit. A committed acceptance whose
        // session could not be established stays successful and offers a sign-in
        // path rather than repeating acceptance.
        return new AdministrativeAcceptanceResult(
            AdministrativeAcceptanceOutcome.Accepted, tenant.Id, account.Id, invitation.Purpose);
    }

    /// <summary>
    /// Records the refusal against the tenant's activity so an administrator can
    /// see why an invitation they issued never completed, then returns the
    /// conflict. Nothing about the account behind the address is disclosed.
    /// <para>
    /// The acceptance transaction is rolled back <em>first</em>. Writing the event
    /// inside it would discard the evidence along with the refused acceptance, and
    /// the only record explaining why a valid invitation could not complete would
    /// silently disappear.
    /// </para>
    /// </summary>
    private async Task<AdministrativeAcceptanceResult> RefuseForExistingAccountAsync(
        InviteToken invitation,
        IDbContextTransaction? transaction,
        CancellationToken cancellationToken)
    {
        if (transaction is not null)
        {
            await transaction.RollbackAsync(cancellationToken);
        }

        dbContext.ChangeTracker.Clear();

        dbContext.AccessAuditEvents.Add(AccessAuditEvent.Create(
            invitation.TenantId,
            actorUserId: null,
            actorName: "Invitation recipient",
            actorRole: "Recipient",
            AccessAuditActions.InvitationRejectedExistingAccount,
            AccessAuditActions.ResourceTypeInvitation,
            invitation.Id.ToString(),
            "Administrator invitation could not be accepted: the invited address already belongs to a Fusion account.",
            null, null, invitation.Id.ToString()));

        await dbContext.SaveChangesAsync(cancellationToken);

        return new AdministrativeAcceptanceResult(
            AdministrativeAcceptanceOutcome.ExistingAccountConflict, Purpose: invitation.Purpose);
    }

    private sealed record AccountCreation(
        ApplicationUser? Account,
        IReadOnlyList<AdministrativeAcceptanceFieldError> FieldErrors,
        bool ConflictedOnAddress);

    /// <summary>
    /// Creates the administrator account, keeping each rejection attached to the
    /// field that caused it. A weak password and an address taken mid-submission
    /// are different problems with different recoveries.
    /// </summary>
    private async Task<AccountCreation> CreateAccountAsync(
        AdministrativeAcceptanceRequest request, string email)
    {
        var errors = new List<AdministrativeAcceptanceFieldError>();

        var firstName = request.FirstName?.Trim() ?? string.Empty;
        var lastName = request.LastName?.Trim() ?? string.Empty;

        if (firstName.Length == 0)
        {
            errors.Add(new AdministrativeAcceptanceFieldError("firstName", "First name is required."));
        }

        if (lastName.Length == 0)
        {
            errors.Add(new AdministrativeAcceptanceFieldError("lastName", "Last name is required."));
        }

        if (string.IsNullOrWhiteSpace(request.Password))
        {
            errors.Add(new AdministrativeAcceptanceFieldError("password", "A password is required."));
        }

        if (errors.Count > 0)
        {
            return new AccountCreation(null, errors, false);
        }

        var account = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = email,
            Email = email,
            FirstName = firstName,
            LastName = lastName,
            IsActive = true,
            EmailConfirmed = true,
        };

        var created = await userManager.CreateAsync(account, request.Password!);

        if (created.Succeeded)
        {
            return new AccountCreation(account, [], false);
        }

        var conflicted = created.Errors.Any(error =>
            error.Code is "DuplicateEmail" or "DuplicateUserName");

        if (conflicted)
        {
            return new AccountCreation(null, [], true);
        }

        foreach (var error in created.Errors)
        {
            errors.Add(new AdministrativeAcceptanceFieldError(
                error.Code.StartsWith("Password", StringComparison.Ordinal) ? "password" : "account",
                error.Description));
        }

        return new AccountCreation(null, errors, false);
    }
}

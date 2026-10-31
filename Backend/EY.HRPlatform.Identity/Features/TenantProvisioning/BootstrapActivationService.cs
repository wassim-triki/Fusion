using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.Identity.Features.TenantAdministration;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Features.TenantProvisioning;

/// <summary>
/// What a submitted credential means, without disclosing anything about the
/// tenant or account behind it.
/// </summary>
public enum BootstrapActivationOutcome
{
    /// <summary>Activation completed and the tenant is now Active.</summary>
    Activated = 0,

    /// <summary>
    /// Already accepted. Deliberately terminal-but-neutral: a replayed link must
    /// not reveal whether it was this recipient who accepted it.
    /// </summary>
    AlreadyAccepted = 1,

    /// <summary>Invalid, expired, revoked, superseded, wrong-purpose, or mismatched.</summary>
    NotActivatable = 2,

    /// <summary>
    /// A Fusion account already uses the invited address. Bootstrap creates the
    /// first administrator account and never adopts an existing one, so this is a
    /// refusal the Platform Administrator resolves by replacing the invited email.
    /// </summary>
    ExistingAccountConflict = 3,

    /// <summary>
    /// The submitted account details did not satisfy the service's own password or
    /// name rules. Distinct from a refused invitation: the invitation stays valid
    /// and the recipient can correct the field and submit again.
    /// </summary>
    InvalidAccountDetails = 4,
}

/// <summary>
/// One correctable problem, named against the form field that caused it so the
/// recipient is not told "something was wrong" about a whole submission.
/// </summary>
public sealed record BootstrapActivationFieldError(string Field, string Message);

public sealed record BootstrapActivationRequest
{
    /// <summary>The raw selector.secret from the delivery link.</summary>
    public string Credential { get; init; } = string.Empty;

    /// <summary>Proven email control. Must equal the invited address.</summary>
    public string Email { get; init; } = string.Empty;

    public string? Password { get; init; }

    public string? FirstName { get; init; }
    public string? LastName { get; init; }
}

public sealed record BootstrapActivationResult(
    BootstrapActivationOutcome Outcome,
    Guid? TenantId = null,
    Guid? AccountId = null,
    IReadOnlyList<BootstrapActivationFieldError>? FieldErrors = null);

/// <summary>
/// What the recipient's link opens onto. Exactly one state renders the
/// account-creation form; every other state is terminal or blocked and must say
/// plainly what happened.
/// </summary>
public enum BootstrapEntryState
{
    /// <summary>Valid and Pending: the account-creation form opens directly.</summary>
    AccountCreation = 0,

    /// <summary>Unknown, malformed, wrong purpose, or a secret that does not verify.</summary>
    Invalid = 1,

    Expired = 2,
    Revoked = 3,

    /// <summary>Replaced by a newer invitation for this tenant.</summary>
    Superseded = 4,

    AlreadyAccepted = 5,

    /// <summary>A Fusion account already uses the invited address.</summary>
    ExistingAccountConflict = 6,
}

/// <summary>
/// Tenant, address and expiry are populated only for
/// <see cref="BootstrapEntryState.AccountCreation" />. A refused credential is
/// told nothing about the tenant or the account behind it.
/// </summary>
public sealed record BootstrapEntry(
    BootstrapEntryState State,
    string? TenantName = null,
    string? InvitedEmail = null,
    DateTime? ExpiresAtUtc = null,
    string? FirstName = null,
    string? LastName = null,
    string? Role = null);

public interface IBootstrapActivationService
{
    /// <summary>
    /// Decides what the credential opens onto, without creating or changing
    /// anything. A read must never mutate state.
    /// </summary>
    Task<BootstrapEntry> InspectAsync(string credential, CancellationToken cancellationToken = default);

    Task<BootstrapActivationResult> ActivateAsync(
        BootstrapActivationRequest request,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Turns a valid bootstrap credential into durable tenant access, in one
/// transaction.
///
/// Failure responses are deliberately coarse. A caller holding a wrong credential
/// learns only that it will not work — not whether the tenant exists, whether the
/// address is registered, or which rule rejected them.
/// </summary>
public sealed class BootstrapActivationService(
    AppIdentityDbContext dbContext,
    UserManager<ApplicationUser> userManager,
    IAccessProfileService accessProfiles) : IBootstrapActivationService
{
    public async Task<BootstrapEntry> InspectAsync(
        string credential, CancellationToken cancellationToken = default)
    {
        if (!BootstrapCredential.TryParse(credential, out var selector, out var secret))
        {
            return new BootstrapEntry(BootstrapEntryState.Invalid);
        }

        var invitation = await dbContext.InviteTokens
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.CredentialSelector == selector, cancellationToken);

        // Unknown selector, wrong purpose and a secret that does not verify are
        // one answer, so a caller cannot probe for valid selectors.
        if (invitation is null
            || invitation.Purpose != InvitationPurpose.OrganizationBootstrap
            || !BootstrapCredential.MatchesDigest(secret, invitation.CredentialDigest))
        {
            return new BootstrapEntry(BootstrapEntryState.Invalid);
        }

        var terminal = invitation.State switch
        {
            InvitationState.Accepted => BootstrapEntryState.AlreadyAccepted,
            InvitationState.Expired => BootstrapEntryState.Expired,
            InvitationState.Revoked => BootstrapEntryState.Revoked,
            InvitationState.Superseded => BootstrapEntryState.Superseded,
            _ => (BootstrapEntryState?)null,
        };

        if (terminal is not null)
        {
            return new BootstrapEntry(terminal.Value);
        }

        var tenant = await dbContext.Tenants
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == invitation.TenantId, cancellationToken);

        // A withdrawn or already-activated tenant cannot be reopened by an old
        // link. The recipient learns only that the link no longer works.
        if (tenant is null
            || !tenant.IsActive
            || tenant.IsArchived
            || tenant.AdministratorActivationStatus == TenantAdministratorActivationStatus.Active)
        {
            return new BootstrapEntry(BootstrapEntryState.Revoked);
        }

        // Surfaced before the form rather than after a filled-in submission: the
        // recipient cannot resolve this themselves, so asking them to type a name
        // and choose a password first would waste the only effort they can make.
        var addressIsTaken = await dbContext.Users
            .IgnoreQueryFilters()
            .AnyAsync(user => user.NormalizedEmail == invitation.Email.ToUpperInvariant(), cancellationToken);

        if (addressIsTaken)
        {
            return new BootstrapEntry(BootstrapEntryState.ExistingAccountConflict);
        }

        return new BootstrapEntry(
            BootstrapEntryState.AccountCreation,
            tenant.Name,
            invitation.Email,
            invitation.ExpiresAt,
            invitation.FirstName,
            invitation.LastName,
            invitation.Role);
    }

    public async Task<BootstrapActivationResult> ActivateAsync(
        BootstrapActivationRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!BootstrapCredential.TryParse(request.Credential, out var selector, out var secret))
        {
            return new BootstrapActivationResult(BootstrapActivationOutcome.NotActivatable);
        }

        var email = request.Email?.Trim().ToLowerInvariant() ?? string.Empty;
        if (email.Length == 0)
        {
            return new BootstrapActivationResult(BootstrapActivationOutcome.NotActivatable);
        }

        await using var transaction = dbContext.Database.IsRelational()
            ? await dbContext.Database.BeginTransactionAsync(cancellationToken)
            : null;

        // Lock the invitation for the whole transaction so two submissions of the
        // same link cannot both pass the Pending check and each create a membership.
        if (dbContext.Database.IsRelational())
        {
            await dbContext.Database.ExecuteSqlRawAsync(
                "SELECT 1 FROM identity.\"InviteTokens\" WHERE \"CredentialSelector\" = {0} FOR UPDATE",
                [selector], cancellationToken);
        }

        var invitation = await dbContext.InviteTokens
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.CredentialSelector == selector, cancellationToken);

        // Unknown selector, wrong purpose, or a secret that does not verify are
        // all the same answer. Verification is constant-time.
        if (invitation is null
            || invitation.Purpose != InvitationPurpose.OrganizationBootstrap
            || !BootstrapCredential.MatchesDigest(secret, invitation.CredentialDigest))
        {
            return new BootstrapActivationResult(BootstrapActivationOutcome.NotActivatable);
        }

        if (invitation.State == InvitationState.Accepted)
        {
            // Neutral replay: no membership, access or audit is duplicated.
            return new BootstrapActivationResult(BootstrapActivationOutcome.AlreadyAccepted);
        }

        if (invitation.State != InvitationState.Pending
            || !string.Equals(invitation.Email, email, StringComparison.OrdinalIgnoreCase))
        {
            await RecordRejectionAsync(invitation, "not_activatable", cancellationToken);
            return new BootstrapActivationResult(BootstrapActivationOutcome.NotActivatable);
        }

        var tenant = await dbContext.Tenants
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.Id == invitation.TenantId, cancellationToken);

        // A suspended or offboarded tenant must not be reopened by an old
        // invitation: activating it would restore customer authority that was
        // administratively withdrawn.
        if (tenant is null
            || !tenant.IsActive
            || tenant.IsArchived
            || tenant.AdministratorActivationStatus == TenantAdministratorActivationStatus.Active)
        {
            await RecordRejectionAsync(invitation, "tenant_not_activatable", cancellationToken);
            return new BootstrapActivationResult(BootstrapActivationOutcome.NotActivatable);
        }

        // Bootstrap creates the tenant's first administrator account. It never
        // adopts an account that already exists on the invited address, whatever
        // that account's state, memberships or roles are — including a Platform
        // Administrator. The Platform Administrator resolves this by replacing the
        // invited email.
        var addressIsTaken = await dbContext.Users
            .IgnoreQueryFilters()
            .AnyAsync(user => user.NormalizedEmail == email.ToUpperInvariant(), cancellationToken);

        if (addressIsTaken)
        {
            await RecordRejectionAsync(invitation, "existing_account_conflict", cancellationToken);
            return new BootstrapActivationResult(BootstrapActivationOutcome.ExistingAccountConflict);
        }

        var creation = await CreateAccountAsync(request, email);

        // The uniqueness check above is not a lock. Two submissions racing on the
        // same address both pass it, and the loser is told the same thing a late
        // recipient is told, rather than seeing a raw constraint failure.
        if (creation.ConflictedOnAddress)
        {
            await RecordRejectionAsync(invitation, "existing_account_conflict", cancellationToken);
            return new BootstrapActivationResult(BootstrapActivationOutcome.ExistingAccountConflict);
        }

        // A correctable submission problem leaves the invitation Pending: nothing
        // is committed, and no rejection is recorded, because the recipient has not
        // been refused — they have been asked to fix a field.
        if (creation.Account is null)
        {
            return new BootstrapActivationResult(
                BootstrapActivationOutcome.InvalidAccountDetails,
                FieldErrors: creation.FieldErrors);
        }

        var account = creation.Account;

        // Exactly one new Active membership. Bootstrap never reactivates an old
        // membership or moves an account between tenants.
        var membership = TenantMembership.Create(account.Id, tenant.Id);
        dbContext.TenantMemberships.Add(membership);
        await dbContext.SaveChangesAsync(cancellationToken);

        // A freshly provisioned tenant has no access profiles yet.
        await accessProfiles.EnsureTenantAccessProfilesAsync(tenant.Id, cancellationToken);

        var administratorDefinitionId = await dbContext.AccessProfiles
            .IgnoreQueryFilters()
            .Where(profile => profile.TenantId == tenant.Id
                && profile.InternalKey == TenantAdministratorAuthority.InternalKey)
            .Select(profile => profile.Id)
            .FirstOrDefaultAsync(cancellationToken);

        if (administratorDefinitionId == Guid.Empty)
        {
            throw new InvalidOperationException(
                $"Tenant {tenant.Id} has no {TenantAdministratorAuthority.InternalKey} definition; "
                + "bootstrap cannot establish administration.");
        }

        // One correlation identifier ties the access audit and the bootstrap
        // outcome together.
        var correlationId = Guid.NewGuid();

        // The canonical authority record — the same one later administrator
        // management reads and writes. A tenant therefore has exactly one
        // administrator concept from its first minute.
        dbContext.TenantAdministratorAssignments.Add(
            TenantAdministratorAssignment.Grant(
                membership,
                TenantAdministratorGrantActor.BootstrapActivation,
                grantedByUserId: account.Id,
                sourceInvitationId: invitation.Id));

        // The detailed permission change belongs in the existing access audit;
        // bootstrap history records only the outcome. Written inside the same
        // transaction so the grant and its trail cannot diverge.
        dbContext.AccessAuditEvents.Add(AccessAuditEvent.Create(
            tenantId: tenant.Id,
            actorUserId: account.Id,
            // Blank so the reader names the person; the raw address would be the
            // only email in a feed that otherwise shows people.
            actorName: string.Empty,
            actorRole: TenantAdministratorAuthority.DisplayName,
            action: AccessAuditActions.AuthorityRecognized,
            resourceType: AccessAuditActions.ResourceTypeAdministrator,
            resourceId: membership.Id.ToString(),
            summary: "Initial Tenant Administrator authority established through bootstrap activation.",
            beforeJson: null,
            afterJson: null,
            correlationId: correlationId.ToString()));

        invitation.MarkAccepted(account.Id);
        tenant.CompleteAdministratorActivation();

        dbContext.TenantBootstrapAuditEvents.Add(TenantBootstrapAuditEvent.Create(
            TenantBootstrapAuditEventType.BootstrapCompleted,
            tenant.Id,
            correlationId,
            outcome: "Succeeded",
            invitationId: invitation.Id,
            actorAccountId: account.Id));

        await dbContext.SaveChangesAsync(cancellationToken);

        // Detailed permission history stays in the existing access audit; bootstrap
        // history records only the outcome.
        await dbContext.SaveChangesAsync(cancellationToken);

        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        return new BootstrapActivationResult(
            BootstrapActivationOutcome.Activated, tenant.Id, account.Id);
    }

    private sealed record AccountCreation(
        ApplicationUser? Account,
        IReadOnlyList<BootstrapActivationFieldError> FieldErrors,
        bool ConflictedOnAddress);

    /// <summary>
    /// Creates the new administrator account, keeping each rejection attached to
    /// the field that caused it. A weak password and an address that was taken
    /// mid-submission are different problems with different recoveries, so they
    /// are never collapsed into one result.
    /// </summary>
    private async Task<AccountCreation> CreateAccountAsync(BootstrapActivationRequest request, string email)
    {
        var errors = new List<BootstrapActivationFieldError>();

        var firstName = request.FirstName?.Trim() ?? string.Empty;
        var lastName = request.LastName?.Trim() ?? string.Empty;

        if (firstName.Length == 0)
        {
            errors.Add(new BootstrapActivationFieldError("firstName", "Enter a first name."));
        }

        if (lastName.Length == 0)
        {
            errors.Add(new BootstrapActivationFieldError("lastName", "Enter a last name."));
        }

        if (string.IsNullOrWhiteSpace(request.Password))
        {
            errors.Add(new BootstrapActivationFieldError("password", "Enter a password."));
        }

        if (errors.Count > 0)
        {
            return new AccountCreation(null, errors, false);
        }

        var account = new ApplicationUser
        {
            UserName = email,
            Email = email,
            FirstName = firstName,
            LastName = lastName,
            // Email control was proven by possession of the invitation link.
            EmailConfirmed = true,
            IsActive = true,
            // No hire date: this is a tenant administrator identity, not Core
            // workforce truth. Core owns employment dates if this person is later
            // represented as an employee.
        };

        IdentityResult result;
        try
        {
            result = await userManager.CreateAsync(account, request.Password!);
        }
        catch (DbUpdateException exception)
            when (exception.Entries.Any(entry => entry.Entity is ApplicationUser))
        {
            // Identity's duplicate validators run as a read before the insert, so
            // two submissions racing on the same address can both pass them and
            // the loser fails on the unique normalized-address index instead of
            // returning DuplicateEmail. The caller already knows how to report
            // that as a conflict; without this the race escaped as an unhandled
            // exception and the anonymous endpoint answered it with a 500.
            //
            // The failed entity has to leave the change tracker, or a later
            // SaveChanges on this scoped context retries the same doomed insert.
            dbContext.Entry(account).State = EntityState.Detached;
            return new AccountCreation(null, [], true);
        }

        if (result.Succeeded)
        {
            return new AccountCreation(account, [], false);
        }

        var conflicted = result.Errors.Any(error =>
            error.Code is "DuplicateEmail" or "DuplicateUserName");

        if (conflicted)
        {
            return new AccountCreation(null, [], true);
        }

        foreach (var error in result.Errors)
        {
            errors.Add(new BootstrapActivationFieldError(FieldFor(error.Code), error.Description));
        }

        return new AccountCreation(null, errors, false);
    }

    /// <summary>
    /// Maps an ASP.NET Identity error code onto the form field the recipient can
    /// actually change. Password-policy codes all share the `Password` prefix.
    /// </summary>
    private static string FieldFor(string code)
        => code.StartsWith("Password", StringComparison.Ordinal) ? "password" : "form";

    /// <summary>
    /// Records a bounded, sanitized rejection. The reason is a code, never the
    /// submitted credential or address.
    /// </summary>
    private async Task RecordRejectionAsync(
        InviteToken invitation,
        string reason,
        CancellationToken cancellationToken)
    {
        dbContext.TenantBootstrapAuditEvents.Add(TenantBootstrapAuditEvent.Create(
            TenantBootstrapAuditEventType.ActivationRejected,
            invitation.TenantId,
            correlationId: Guid.NewGuid(),
            outcome: "Rejected",
            invitationId: invitation.Id,
            reason: reason));

        await dbContext.SaveChangesAsync(cancellationToken);

        // The caller returns immediately after this, so the surrounding
        // transaction would otherwise roll back and discard the very record that
        // explains why activation was refused.
        if (dbContext.Database.CurrentTransaction is { } active)
        {
            await active.CommitAsync(cancellationToken);
        }
    }
}

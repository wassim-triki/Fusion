using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.Identity.Features.TenantProvisioning;
using EY.HRPlatform.Identity.Features.WorkforceAccess;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

// The reviewed workforce baseline for an accepted invitation is the invitation's access
// profiles (set and reviewed at issue time), applied through the access-profile service.

namespace EY.HRPlatform.Identity.Features.WorkforceAccounts;

public enum WorkforceAcceptanceOutcome
{
    /// <summary>The account was created, activated, membership-bound, and the invitation accepted.</summary>
    Accepted,

    /// <summary>The invitation was already accepted — a replay, not a failure.</summary>
    AlreadyAccepted,

    /// <summary>Unknown credential, wrong purpose, wrong email, expired/revoked, or bad secret — one indistinct answer.</summary>
    NotAcceptable,

    /// <summary>The invited address now belongs to an account; this is administrator review, not duplication.</summary>
    ExistingAccountConflict,

    /// <summary>The Employee is already bound to a membership here; this is administrator review, not duplication.</summary>
    EmployeeAlreadyLinked,

    /// <summary>The submitted account details (name/password) were rejected.</summary>
    InvalidAccountDetails,
}

public sealed record WorkforceAcceptanceFieldError(string Field, string Message);

public sealed record WorkforceAcceptanceRequest(
    string Credential,
    string? Email,
    string? FirstName,
    string? LastName,
    string Password);

public sealed record WorkforceAcceptanceResult(
    WorkforceAcceptanceOutcome Outcome,
    Guid? TenantId = null,
    Guid? AccountId = null,
    IReadOnlyList<WorkforceAcceptanceFieldError>? FieldErrors = null);

public interface IWorkforceInvitationAcceptanceService
{
    Task<WorkforceAcceptanceResult> AcceptAsync(
        WorkforceAcceptanceRequest request, CancellationToken cancellationToken = default);
}

/// <summary>
/// Turns a valid Workforce credential into an active, membership-bound Fusion account in
/// one transaction. Structurally parallel to administrative acceptance: the invitation row
/// is locked first, then the tenant continuity row, so no pair of commands deadlocks.
/// <para>
/// Acceptance re-validates purpose, credential, state, expiry, the invited email, the
/// canonical Employee, tenant state, and global-account state, then atomically creates the
/// account, one Active membership, the authoritative <see cref="TenantMembership"/> Employee
/// binding, the reviewed baseline (the invitation's access profiles), the accepted
/// invitation, and the append-only audit. A concurrent account creation becomes administrator
/// review, never a duplicate account or membership.
/// </para>
/// <para>
/// New invitations carry a selector/secret credential (hash-only at rest). A bounded
/// transitional path still accepts a pre-cutover raw token so links already delivered keep
/// working until they expire; nothing new is issued that way.
/// </para>
/// </summary>
public sealed class WorkforceInvitationAcceptanceService(
    AppIdentityDbContext dbContext,
    UserManager<ApplicationUser> userManager,
    IAccessProfileService accessProfiles) : IWorkforceInvitationAcceptanceService
{
    public async Task<WorkforceAcceptanceResult> AcceptAsync(
        WorkforceAcceptanceRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var relational = dbContext.Database.IsRelational();
        await using var transaction = relational
            ? await dbContext.Database.BeginTransactionAsync(cancellationToken)
            : null;

        var invitation = await LockAndResolveInvitationAsync(request.Credential, relational, cancellationToken);

        // Unknown selector, wrong purpose, and a secret that does not verify all give one
        // answer, so a caller cannot probe for valid credentials.
        if (invitation is null)
        {
            return new WorkforceAcceptanceResult(WorkforceAcceptanceOutcome.NotAcceptable);
        }

        if (invitation.State == InvitationState.Accepted)
        {
            return new WorkforceAcceptanceResult(WorkforceAcceptanceOutcome.AlreadyAccepted);
        }

        if (invitation.State != InvitationState.Pending || invitation.EmployeeId is not { } employeeId)
        {
            return new WorkforceAcceptanceResult(WorkforceAcceptanceOutcome.NotAcceptable);
        }

        // The account is always created with the invitation's address, so a recipient can
        // never redirect it. When a client does submit an email, it must match — defense in
        // depth against a mis-delivered link — but it is not required.
        if (!string.IsNullOrWhiteSpace(request.Email)
            && !string.Equals(request.Email.Trim(), invitation.Email, StringComparison.OrdinalIgnoreCase))
        {
            return new WorkforceAcceptanceResult(WorkforceAcceptanceOutcome.NotAcceptable);
        }

        var tenant = await dbContext.Tenants
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.Id == invitation.TenantId, cancellationToken);

        if (tenant is null || !tenant.IsActive || tenant.IsArchived)
        {
            return new WorkforceAcceptanceResult(WorkforceAcceptanceOutcome.NotAcceptable);
        }

        // Tenant continuity lock, taken second and held for the rest of the transaction.
        if (relational)
        {
            await dbContext.Database.ExecuteSqlRawAsync(
                "SELECT 1 FROM identity.\"Tenants\" WHERE \"Id\" = {0} FOR UPDATE",
                [tenant.Id], cancellationToken);
        }

        // The Employee may have been bound to a membership here since the invitation was
        // issued (an admin linked another account). That is administrator review, not a
        // second binding — the filtered unique index would reject it anyway.
        var employeeAlreadyBound = await dbContext.TenantMemberships
            .IgnoreQueryFilters()
            .AnyAsync(m => m.TenantId == tenant.Id && m.EmployeeId == employeeId, cancellationToken);

        if (employeeAlreadyBound)
        {
            return await RefuseAsync(
                invitation, WorkforceAcceptanceOutcome.EmployeeAlreadyLinked, transaction,
                "Workforce invitation could not be accepted: this employee is already linked to a Fusion account.",
                cancellationToken);
        }

        var normalizedEmail = userManager.NormalizeEmail(invitation.Email);
        var addressTaken = await dbContext.Users
            .IgnoreQueryFilters()
            .AnyAsync(user => user.NormalizedEmail == normalizedEmail, cancellationToken);

        if (addressTaken)
        {
            return await RefuseAsync(
                invitation, WorkforceAcceptanceOutcome.ExistingAccountConflict, transaction,
                "Workforce invitation could not be accepted: the invited address already belongs to a Fusion account.",
                cancellationToken);
        }

        var creation = await CreateAccountAsync(request, invitation, employeeId);

        if (creation.ConflictedOnAddress)
        {
            return await RefuseAsync(
                invitation, WorkforceAcceptanceOutcome.ExistingAccountConflict, transaction,
                "Workforce invitation could not be accepted: the invited address already belongs to a Fusion account.",
                cancellationToken);
        }

        if (creation.Account is null)
        {
            return new WorkforceAcceptanceResult(
                WorkforceAcceptanceOutcome.InvalidAccountDetails, FieldErrors: creation.FieldErrors);
        }

        var account = creation.Account;

        // Exactly one new Active membership, and the authoritative Employee binding on it —
        // the membership-scoped binding is what claims and authorization read (2.1/2.2),
        // not the compatibility scalar on the account.
        var membership = TenantMembership.Create(account.Id, tenant.Id);
        membership.BindEmployee(employeeId);
        dbContext.TenantMemberships.Add(membership);
        await dbContext.SaveChangesAsync(cancellationToken);

        // The reviewed baseline is the invitation's access profiles; apply them, then keep
        // the compatibility role in sync.
        await accessProfiles.ApplyInviteProfilesAsync(invitation, account);

        invitation.MarkAccepted(account.Id);

        dbContext.AccessAuditEvents.Add(AccessAuditEvent.Create(
            tenantId: tenant.Id,
            actorUserId: account.Id,
            actorName: string.Empty,
            actorRole: "Workforce",
            action: WorkforceAccessAuditActions.AccountActivated,
            resourceType: WorkforceAccessAuditActions.ResourceTypeWorkforceAccount,
            resourceId: membership.Id.ToString(),
            summary: "Workforce access activated by accepting an invitation.",
            beforeJson: null,
            afterJson: null,
            correlationId: invitation.Id.ToString()));

        await dbContext.SaveChangesAsync(cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        return new WorkforceAcceptanceResult(
            WorkforceAcceptanceOutcome.Accepted, tenant.Id, account.Id);
    }

    /// <summary>
    /// Locks and resolves the invitation from a presented credential. A selector/secret
    /// credential is verified by digest; a bare legacy token is the bounded transitional
    /// path for links delivered before the cutover.
    /// </summary>
    private async Task<InviteToken?> LockAndResolveInvitationAsync(
        string? presented, bool relational, CancellationToken cancellationToken)
    {
        if (BootstrapCredential.TryParse(presented, out var selector, out var secret))
        {
            if (relational)
            {
                await dbContext.Database.ExecuteSqlRawAsync(
                    "SELECT 1 FROM identity.\"InviteTokens\" WHERE \"CredentialSelector\" = {0} FOR UPDATE",
                    [selector], cancellationToken);
            }

            var bySelector = await dbContext.InviteTokens
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(item => item.CredentialSelector == selector, cancellationToken);

            if (bySelector is null
                || bySelector.Purpose != InvitationPurpose.WorkforceAccount
                || !bySelector.MatchesCredentialDigest(BootstrapCredential.Digest(secret)))
            {
                return null;
            }

            return bySelector;
        }

        // Transitional: a pre-cutover raw token carries no selector. Nothing new is ever
        // issued this way; it only lets an already-delivered link finish.
        if (string.IsNullOrWhiteSpace(presented))
        {
            return null;
        }

        if (relational)
        {
            await dbContext.Database.ExecuteSqlRawAsync(
                "SELECT 1 FROM identity.\"InviteTokens\" WHERE \"Token\" = {0} FOR UPDATE",
                [presented], cancellationToken);
        }

        var byToken = await dbContext.InviteTokens
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.Token == presented, cancellationToken);

        return byToken?.Purpose == InvitationPurpose.WorkforceAccount ? byToken : null;
    }

    /// <summary>
    /// Rolls back the acceptance, then records the refusal against the tenant's activity so
    /// an administrator can see why a valid invitation never completed. Nothing about the
    /// account behind the address is disclosed.
    /// </summary>
    private async Task<WorkforceAcceptanceResult> RefuseAsync(
        InviteToken invitation,
        WorkforceAcceptanceOutcome outcome,
        IDbContextTransaction? transaction,
        string summary,
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
            WorkforceAccessAuditActions.InvitationWithdrawn,
            WorkforceAccessAuditActions.ResourceTypeWorkforceInvitation,
            invitation.Id.ToString(),
            summary,
            null, null, invitation.Id.ToString()));

        await dbContext.SaveChangesAsync(cancellationToken);

        return new WorkforceAcceptanceResult(outcome);
    }

    private sealed record AccountCreation(
        ApplicationUser? Account,
        IReadOnlyList<WorkforceAcceptanceFieldError> FieldErrors,
        bool ConflictedOnAddress);

    private async Task<AccountCreation> CreateAccountAsync(
        WorkforceAcceptanceRequest request, InviteToken invitation, Guid employeeId)
    {
        var errors = new List<WorkforceAcceptanceFieldError>();

        var firstName = (string.IsNullOrWhiteSpace(request.FirstName) ? invitation.FirstName : request.FirstName)?.Trim()
            ?? string.Empty;
        var lastName = (string.IsNullOrWhiteSpace(request.LastName) ? invitation.LastName : request.LastName)?.Trim()
            ?? string.Empty;

        if (firstName.Length == 0)
        {
            errors.Add(new WorkforceAcceptanceFieldError("firstName", "First name is required."));
        }

        if (lastName.Length == 0)
        {
            errors.Add(new WorkforceAcceptanceFieldError("lastName", "Last name is required."));
        }

        if (string.IsNullOrWhiteSpace(request.Password))
        {
            errors.Add(new WorkforceAcceptanceFieldError("password", "A password is required."));
        }

        if (errors.Count > 0)
        {
            return new AccountCreation(null, errors, false);
        }

        var account = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = invitation.Email,
            Email = invitation.Email,
            // Compatibility scalar only. Authority is the membership binding created by the
            // caller; no claims, authorization, or workforce-status path reads this field.
            EmployeeId = employeeId,
            FirstName = firstName,
            LastName = lastName,
            IsActive = true,
            EmailConfirmed = true,
            // No hire date on the identity account: the authoritative employment
            // dates live on the bound CoreHR employee record (EmployeeId above).
        };

        var created = await userManager.CreateAsync(account, request.Password!);

        if (created.Succeeded)
        {
            return new AccountCreation(account, [], false);
        }

        var conflicted = created.Errors.Any(error => error.Code is "DuplicateEmail" or "DuplicateUserName");
        if (conflicted)
        {
            return new AccountCreation(null, [], true);
        }

        foreach (var error in created.Errors)
        {
            errors.Add(new WorkforceAcceptanceFieldError(
                error.Code.StartsWith("Password", StringComparison.Ordinal) ? "password" : "account",
                error.Description));
        }

        return new AccountCreation(null, errors, false);
    }
}

using EY.HRPlatform.Identity.Domain.Enums;

namespace EY.HRPlatform.Identity.Features.TenantAdministration;

/// <summary>
/// What an invitation command did, or why it did nothing. Each value maps to one
/// stable problem type at the API boundary, so the customer experience can tell
/// a duplicate from a conflict from a permission problem instead of showing one
/// generic error.
/// </summary>
public enum InvitationCommandOutcome
{
    Succeeded = 0,

    /// <summary>The address is not a usable email address.</summary>
    InvalidEmail,

    /// <summary>A Fusion account already uses this address.</summary>
    ExistingAccount,

    /// <summary>A pending administrative invitation already exists for this address.</summary>
    DuplicatePending,

    /// <summary>The invitation was not found for this tenant.</summary>
    NotFound,

    /// <summary>The invitation is accepted, revoked, or superseded, so it cannot change.</summary>
    NotPending,

    /// <summary>A recovery is already in flight for this tenant.</summary>
    RecoveryAlreadyPending,

    /// <summary>The tenant still has a usable administrator, so recovery does not apply.</summary>
    RecoveryNotEligible,
}

/// <summary>
/// The result of an invitation command.
/// <para>
/// <see cref="DeliveryFailed"/> is carried alongside success rather than replacing
/// it: the invitation exists and is recoverable by resending, so reporting a
/// delivery problem as a failed command would tell the administrator something
/// untrue about what happened.
/// </para>
/// </summary>
public sealed record InvitationCommandResult(
    InvitationCommandOutcome Outcome,
    Guid? InvitationId = null,
    bool DeliveryFailed = false)
{
    public bool Succeeded => Outcome == InvitationCommandOutcome.Succeeded;

    public static InvitationCommandResult Ok(Guid invitationId, bool deliveryFailed = false)
        => new(InvitationCommandOutcome.Succeeded, invitationId, deliveryFailed);

    public static InvitationCommandResult Refused(InvitationCommandOutcome outcome)
        => new(outcome);
}

/// <summary>
/// What a presented administrative credential opens onto. Exactly one state opens
/// the account-creation form; every other state is terminal and must say plainly
/// what happened without disclosing whether a selector exists.
/// </summary>
public enum AdministrativeInvitationEntryState
{
    /// <summary>Valid and Pending: the account-creation form opens.</summary>
    AccountCreation = 0,

    /// <summary>Unknown, malformed, wrong purpose, or a secret that does not verify.</summary>
    Invalid,

    Expired,
    Revoked,

    /// <summary>Replaced by a newer invitation.</summary>
    Superseded,

    AlreadyAccepted,

    /// <summary>A Fusion account already uses the invited address.</summary>
    ExistingAccountConflict,
}

/// <summary>
/// Tenant, address and expiry are populated only for
/// <see cref="AdministrativeInvitationEntryState.AccountCreation"/>. A refused
/// credential learns nothing about the tenant or account behind it.
/// </summary>
public sealed record AdministrativeInvitationEntry(
    AdministrativeInvitationEntryState State,
    InvitationPurpose? Purpose = null,
    string? TenantName = null,
    string? InvitedEmail = null,
    DateTime? ExpiresAtUtc = null,
    string? FirstName = null,
    string? LastName = null,
    string? Role = null);

public enum AdministrativeAcceptanceOutcome
{
    /// <summary>Account, membership, and Tenant Administrator authority established.</summary>
    Accepted = 0,

    /// <summary>Terminal and deliberately neutral about who accepted it.</summary>
    AlreadyAccepted,

    /// <summary>Invalid, expired, revoked, superseded, wrong purpose, or mismatched.</summary>
    NotAcceptable,

    /// <summary>A Fusion account already uses the invited address.</summary>
    ExistingAccountConflict,

    /// <summary>The submitted account details did not satisfy the password or name rules.</summary>
    InvalidAccountDetails,
}

public sealed record AdministrativeAcceptanceFieldError(string Field, string Message);

public sealed record AdministrativeAcceptanceRequest
{
    /// <summary>The raw selector.secret from the delivery link.</summary>
    public string Credential { get; init; } = string.Empty;

    /// <summary>Proven email control. Must equal the invited address.</summary>
    public string Email { get; init; } = string.Empty;

    public string? Password { get; init; }
    public string? FirstName { get; init; }
    public string? LastName { get; init; }

    /// <summary>Accept through a provider instead of a password (B-191).</summary>
    public SingleSignOn.ExternalLoginGrant? External { get; init; }
}

public sealed record AdministrativeAcceptanceResult(
    AdministrativeAcceptanceOutcome Outcome,
    Guid? TenantId = null,
    Guid? AccountId = null,
    InvitationPurpose? Purpose = null,
    IReadOnlyList<AdministrativeAcceptanceFieldError>? FieldErrors = null);

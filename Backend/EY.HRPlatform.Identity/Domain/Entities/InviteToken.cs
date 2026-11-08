using System.Security.Cryptography;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.Identity.Domain.Entities;

/// <summary>
/// Represents an invitation token for tenant-scoped user onboarding.
/// Tokens are single-use and expire after a configured period (default 7 days).
/// </summary>
public class InviteToken : ITenantEntity
{
    private InviteToken() { } // EF constructor

    public Guid Id { get; private set; }

    /// <summary>
    /// Cryptographically secure token (32-byte, base64url encoded).
    /// Used in the workforce invite link URL. Organization-bootstrap invitations
    /// never use this scheme; they carry a selector plus digest instead.
    /// </summary>
    public string? Token { get; private set; }

    /// <summary>
    /// Explicit purpose, bound at creation. Purpose is never inferred from the
    /// assigned role, so a bootstrap invitation cannot be activated through the
    /// workforce route and a workforce invitation cannot bootstrap a tenant.
    /// </summary>
    public InvitationPurpose Purpose { get; private set; } = InvitationPurpose.WorkforceAccount;

    /// <summary>
    /// Non-secret random lookup handle for an organization-bootstrap credential.
    /// Locating an invitation by selector reveals nothing usable on its own.
    /// </summary>
    public string? CredentialSelector { get; private set; }

    /// <summary>
    /// One-way digest of the bootstrap credential secret, verified in constant
    /// time. The raw secret exists only inside the delivery link.
    /// </summary>
    public string? CredentialDigest { get; private set; }

    /// <summary>When the current bootstrap credential was issued or last rotated.</summary>
    public DateTime? CredentialIssuedAt { get; private set; }

    /// <summary>
    /// Set when this invitation was replaced by another for a different
    /// administrator. Bounded to the direct relationship needed to explain the
    /// current invitation; there is no general causation graph.
    /// </summary>
    public DateTime? SupersededAt { get; private set; }

    /// <summary>Direct replacement created by a replace or reissue action.</summary>
    public Guid? ReplacedByInvitationId { get; private set; }

    /// <summary>Direct predecessor this invitation replaced.</summary>
    public Guid? PredecessorInvitationId { get; private set; }

    public bool IsSuperseded => SupersededAt.HasValue;

    /// <summary>
    /// Canonical state projected from the stored lifecycle facts, so the state and
    /// the underlying timestamps can never disagree.
    /// </summary>
    public InvitationState State
    {
        get
        {
            if (IsUsed) return InvitationState.Accepted;

            // Superseded outranks Revoked: once an invitation has been replaced,
            // it is spent regardless of how it got there. Reporting a superseded
            // predecessor as merely Revoked would keep advertising reissue and let
            // one invitation fork a second successor.
            if (IsSuperseded) return InvitationState.Superseded;
            if (IsRevoked) return InvitationState.Revoked;
            if (IsExpired) return InvitationState.Expired;
            return InvitationState.Pending;
        }
    }

    /// <summary>
    /// Email address the invitation is sent to.
    /// </summary>
    public string Email { get; private set; } = string.Empty;

    /// <summary>
    /// Tenant the invited user will belong to.
    /// </summary>
    public Guid TenantId { get; private set; }

    /// <summary>
    /// Navigation property to the tenant.
    /// </summary>
    public Tenant? Tenant { get; private set; }

    /// <summary>
    /// Role to assign when the invite is accepted.
    /// </summary>
    public string Role { get; private set; } = string.Empty;

    /// <summary>
    /// Optional: pre-filled first name for the invited user.
    /// </summary>
    public string? FirstName { get; private set; }

    /// <summary>
    /// Optional: pre-filled last name for the invited user.
    /// </summary>
    public string? LastName { get; private set; }

    /// <summary>
    /// When the token expires and can no longer be used.
    /// </summary>
    public DateTime ExpiresAt { get; private set; }

    /// <summary>
    /// When the invite was accepted. Null if not yet accepted.
    /// </summary>
    public DateTime? AcceptedAt { get; private set; }

    /// <summary>
    /// The user created when the invite was accepted.
    /// </summary>
    public Guid? AcceptedByUserId { get; private set; }

    /// <summary>
    /// When the invite was created.
    /// </summary>
    public DateTime CreatedAt { get; private set; }

    /// <summary>
    /// The admin who created this invite.
    /// </summary>
    public Guid CreatedByUserId { get; private set; }

    /// <summary>
    /// Optional CoreHR employee record this invite provisions access for.
    /// </summary>
    public Guid? EmployeeId { get; private set; }

    public string? DeliveryStatus { get; private set; }

    public string? DeliveryMessage { get; private set; }

    public DateTime? DeliveryRecordedAt { get; private set; }

    public List<InviteAccessProfile> AccessProfileAssignments { get; private set; } = [];

    /// <summary>
    /// Whether this invite has been revoked (soft-deleted).
    /// </summary>
    public bool IsRevoked { get; private set; }

    /// <summary>
    /// When the invite was revoked. Null if not revoked.
    /// </summary>
    public DateTime? RevokedAt { get; private set; }

    /// <summary>
    /// Whether the token is still valid (not expired, used, revoked, or superseded).
    /// </summary>
    public bool IsValid => !IsExpired && !IsUsed && !IsRevoked && !IsSuperseded;

    /// <summary>
    /// Whether the token has expired.
    /// </summary>
    public bool IsExpired => DateTime.UtcNow >= ExpiresAt;

    /// <summary>
    /// Whether the token has already been used.
    /// </summary>
    public bool IsUsed => AcceptedAt.HasValue;

    /// <summary>
    /// Creates a new invitation token with validation.
    /// </summary>
    /// <param name="email">Email address to send the invite to.</param>
    /// <param name="tenantId">Tenant the user will belong to.</param>
    /// <param name="role">Role to assign on accept.</param>
    /// <param name="createdByUserId">Admin creating the invite.</param>
    /// <param name="firstName">Optional pre-filled first name.</param>
    /// <param name="lastName">Optional pre-filled last name.</param>
    /// <param name="expiryDays">Days until expiration (default 7).</param>
    public static InviteToken Create(
        string email,
        Guid tenantId,
        string role,
        Guid createdByUserId,
        string? firstName = null,
        string? lastName = null,
        Guid? employeeId = null,
        int expiryDays = 7)
    {
        ValidateEmail(email);
        ValidateTenantId(tenantId);
        ValidateRole(role);
        ValidateCreatedBy(createdByUserId);
        ValidateExpiryDays(expiryDays);
        ValidateEmployeeId(employeeId);

        return new InviteToken
        {
            Id = Guid.NewGuid(),
            Token = GenerateSecureToken(),
            Email = email.Trim().ToLowerInvariant(),
            TenantId = tenantId,
            Role = role,
            FirstName = NormalizeOptionalName(firstName),
            LastName = NormalizeOptionalName(lastName),
            EmployeeId = employeeId,
            ExpiresAt = DateTime.UtcNow.AddDays(expiryDays),
            CreatedAt = DateTime.UtcNow,
            CreatedByUserId = createdByUserId
        };
    }

    /// <summary>
    /// Normalizes optional name: trims and converts whitespace-only to null.
    /// </summary>
    private static string? NormalizeOptionalName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name))
            return null;
        return name.Trim();
    }

    /// <summary>
    /// Marks the invite as accepted and records the created user.
    /// </summary>
    /// <param name="userId">The ID of the user created from this invite.</param>
    public void MarkAccepted(Guid userId)
    {
        if (userId == Guid.Empty)
            throw new ArgumentException("User ID cannot be empty.", nameof(userId));

        if (IsUsed)
            throw new InvalidOperationException("Invite has already been accepted.");

        if (IsExpired)
            throw new InvalidOperationException("Invite has expired.");

        AcceptedAt = DateTime.UtcNow;
        AcceptedByUserId = userId;
    }

    /// <summary>
    /// Extends the invitation expiry to a new date (default 7 days from now).
    /// Used when resending an invitation.
    /// </summary>
    /// <param name="days">Days from now to set expiry (default 7, max 90).</param>
    public void ExtendExpiry(int days = 7)
    {
        if (IsUsed)
            throw new InvalidOperationException("Cannot extend an accepted invitation.");
        if (IsRevoked)
            throw new InvalidOperationException("Cannot extend a revoked invitation.");

        ValidateExpiryDays(days);
        ExpiresAt = DateTime.UtcNow.AddDays(days);
    }

    public void LinkEmployee(Guid employeeId)
    {
        ValidateEmployeeId(employeeId);

        if (EmployeeId.HasValue && EmployeeId.Value != employeeId)
            throw new InvalidOperationException("Invitation is already linked to a different employee.");

        EmployeeId = employeeId;
    }

    public void UpdateRole(string role)
    {
        ValidateRole(role);
        Role = role.Trim();
    }

    public void RecordDelivery(string status, string? message = null, DateTime? recordedAt = null)
    {
        ValidateDeliveryStatus(status);

        DeliveryStatus = status.Trim();
        DeliveryMessage = NormalizeDeliveryMessage(message);
        DeliveryRecordedAt = recordedAt ?? DateTime.UtcNow;
    }

    /// <summary>
    /// Soft-revokes this invite so it can no longer be accepted.
    /// </summary>
    public void Revoke()
    {
        if (IsUsed)
            throw new InvalidOperationException("Cannot revoke an accepted invitation.");
        if (IsRevoked)
            throw new InvalidOperationException("Invitation is already revoked.");

        IsRevoked = true;
        RevokedAt = DateTime.UtcNow;
    }

    public void RecordDeliveryAttempt(string status, string message)
    {
        if (string.IsNullOrWhiteSpace(status))
            throw new ArgumentException("Delivery status is required.", nameof(status));

        DeliveryStatus = status.Trim();
        DeliveryMessage = string.IsNullOrWhiteSpace(message) ? null : message.Trim();
        DeliveryRecordedAt = DateTime.UtcNow;
    }

    /// <summary>
    /// Issues or rotates the hash-only credential. Only the selector and digest are
    /// retained; the caller keeps the raw secret just long enough to build the
    /// delivery link.
    /// <para>
    /// Rotating replaces the selector, so the previously delivered link stops
    /// resolving the moment this commits. That is what makes a resend invalidate
    /// the old link rather than merely extending it.
    /// </para>
    /// </summary>
    public void IssueCredential(string selector, string digest, DateTime? issuedAt = null)
    {
        if (!InvitationPurposes.IsCredentialBearing(Purpose))
            throw new InvalidOperationException(
                $"Hash-only credentials do not apply to {Purpose} invitations.");

        if (string.IsNullOrWhiteSpace(selector))
            throw new ArgumentException("Credential selector is required.", nameof(selector));

        if (string.IsNullOrWhiteSpace(digest))
            throw new ArgumentException("Credential digest is required.", nameof(digest));

        CredentialSelector = selector.Trim();
        CredentialDigest = digest.Trim();
        CredentialIssuedAt = issuedAt ?? DateTime.UtcNow;
    }

    /// <summary>
    /// Constant-time verification of a presented bootstrap credential digest.
    /// </summary>
    public bool MatchesCredentialDigest(string presentedDigest)
    {
        if (CredentialDigest is null || string.IsNullOrWhiteSpace(presentedDigest))
            return false;

        return CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.UTF8.GetBytes(CredentialDigest),
            System.Text.Encoding.UTF8.GetBytes(presentedDigest.Trim()));
    }

    /// <summary>
    /// Marks this invitation superseded by a replacement and records the bounded
    /// direct lineage in both directions.
    /// </summary>
    public void MarkSuperseded(Guid replacementInvitationId)
    {
        if (replacementInvitationId == Guid.Empty)
            throw new ArgumentException("Replacement invitation ID is required.", nameof(replacementInvitationId));

        if (IsUsed)
            throw new InvalidOperationException("Cannot supersede an accepted invitation.");

        if (IsSuperseded)
            throw new InvalidOperationException("Invitation is already superseded.");

        SupersededAt = DateTime.UtcNow;
        ReplacedByInvitationId = replacementInvitationId;
    }

    /// <summary>Records the direct predecessor this invitation replaced.</summary>
    public void RecordPredecessor(Guid predecessorInvitationId)
    {
        if (predecessorInvitationId == Guid.Empty)
            throw new ArgumentException("Predecessor invitation ID is required.", nameof(predecessorInvitationId));

        if (predecessorInvitationId == Id)
            throw new ArgumentException("An invitation cannot be its own predecessor.", nameof(predecessorInvitationId));

        PredecessorInvitationId = predecessorInvitationId;
    }

    /// <summary>
    /// Permanently clears the legacy raw credential. Used by the cutover migration
    /// so no reusable bootstrap secret survives at rest.
    /// </summary>
    public void ClearLegacyRawCredential() => Token = null;

    /// <summary>
    /// Creates an organization-bootstrap invitation. It deliberately carries no
    /// legacy raw token; the caller issues a selector plus digest credential.
    /// </summary>
    public static InviteToken CreateOrganizationBootstrap(
        string email,
        Guid tenantId,
        Guid createdByUserId,
        int expiryDays = 7,
        string? firstName = null,
        string? lastName = null)
    {
        ValidateEmail(email);
        ValidateTenantId(tenantId);
        ValidateCreatedBy(createdByUserId);
        ValidateExpiryDays(expiryDays);

        return new InviteToken
        {
            Id = Guid.NewGuid(),
            Token = null,
            Purpose = InvitationPurpose.OrganizationBootstrap,
            Email = email.Trim().ToLowerInvariant(),
            TenantId = tenantId,
            Role = PlatformRole.OrgAdmin,
            FirstName = NormalizeOptionalName(firstName),
            LastName = NormalizeOptionalName(lastName),
            ExpiresAt = DateTime.UtcNow.AddDays(expiryDays),
            CreatedAt = DateTime.UtcNow,
            CreatedByUserId = createdByUserId,
        };
    }

    /// <summary>
    /// Creates a recovery invitation for a tenant that is already active. Like bootstrap it carries no legacy raw token; the caller
    /// issues a selector plus digest credential.
    /// </summary>
    public static InviteToken CreateAdministrative(
        string email,
        Guid tenantId,
        Guid createdByUserId,
        InvitationPurpose purpose,
        int expiryDays = 7,
        string? firstName = null,
        string? lastName = null)
    {
        if (!InvitationPurposes.IsAdministrative(purpose))
            throw new ArgumentException(
                $"{purpose} is not an administrative invitation purpose.", nameof(purpose));

        ValidateEmail(email);
        ValidateTenantId(tenantId);
        ValidateCreatedBy(createdByUserId);
        ValidateExpiryDays(expiryDays);

        return new InviteToken
        {
            Id = Guid.NewGuid(),
            Token = null,
            Purpose = purpose,
            Email = email.Trim().ToLowerInvariant(),
            TenantId = tenantId,

            // Pre-filled onto the acceptance form; still editable by the recipient,
            // exactly as the platform first-administrator invitation captures them.
            FirstName = NormalizeOptionalName(firstName),
            LastName = NormalizeOptionalName(lastName),

            // Role is legacy compatibility data on this entity. Authority comes
            // from the canonical Tenant Administrator assignment created at
            // acceptance, never from this field.
            Role = PlatformRole.OrgAdmin,
            ExpiresAt = DateTime.UtcNow.AddDays(expiryDays),
            CreatedAt = DateTime.UtcNow,
            CreatedByUserId = createdByUserId,
        };
    }

    /// <summary>
    /// Creates a Workforce invitation on the hash-only credential scheme. Like the
    /// administrative factories it carries no legacy raw token; the caller issues a
    /// selector plus digest credential and keeps the raw secret only long enough to
    /// build the delivery link.
    /// </summary>
    public static InviteToken CreateWorkforce(
        string email,
        Guid tenantId,
        string role,
        Guid createdByUserId,
        string? firstName = null,
        string? lastName = null,
        Guid? employeeId = null,
        int expiryDays = 7)
    {
        ValidateEmail(email);
        ValidateTenantId(tenantId);
        ValidateRole(role);
        ValidateCreatedBy(createdByUserId);
        ValidateExpiryDays(expiryDays);
        ValidateEmployeeId(employeeId);

        return new InviteToken
        {
            Id = Guid.NewGuid(),
            Token = null,
            Purpose = InvitationPurpose.WorkforceAccount,
            Email = email.Trim().ToLowerInvariant(),
            TenantId = tenantId,
            Role = role,
            FirstName = NormalizeOptionalName(firstName),
            LastName = NormalizeOptionalName(lastName),
            EmployeeId = employeeId,
            ExpiresAt = DateTime.UtcNow.AddDays(expiryDays),
            CreatedAt = DateTime.UtcNow,
            CreatedByUserId = createdByUserId,
        };
    }

    /// <summary>
    /// Generates a cryptographically secure 32-byte token, base64url encoded.
    /// </summary>
    private static string GenerateSecureToken()
    {
        var bytes = new byte[32];
        RandomNumberGenerator.Fill(bytes);
        return Base64UrlEncode(bytes);
    }

    /// <summary>
    /// Encodes bytes as base64url (URL-safe, no padding).
    /// </summary>
    private static string Base64UrlEncode(byte[] bytes)
    {
        return Convert.ToBase64String(bytes)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }

    private static void ValidateEmail(string email)
    {
        if (string.IsNullOrWhiteSpace(email))
            throw new ArgumentException("Email is required.", nameof(email));

        // Basic email format check
        if (!email.Contains('@') || !email.Contains('.'))
            throw new ArgumentException("Invalid email format.", nameof(email));
    }

    private static void ValidateTenantId(Guid tenantId)
    {
        if (tenantId == Guid.Empty)
            throw new ArgumentException("Tenant ID is required.", nameof(tenantId));
    }

    private static void ValidateRole(string role)
    {
        if (string.IsNullOrWhiteSpace(role))
            throw new ArgumentException("Role is required.", nameof(role));

        if (!PlatformRole.All.Contains(role))
            throw new ArgumentException($"Invalid role: {role}", nameof(role));
    }

    private static void ValidateCreatedBy(Guid createdByUserId)
    {
        if (createdByUserId == Guid.Empty)
            throw new ArgumentException("Creator user ID is required.", nameof(createdByUserId));
    }

    private static void ValidateEmployeeId(Guid? employeeId)
    {
        if (employeeId == Guid.Empty)
            throw new ArgumentException("Employee ID cannot be empty.", nameof(employeeId));
    }

    private static void ValidateDeliveryStatus(string status)
    {
        if (string.IsNullOrWhiteSpace(status))
            throw new ArgumentException("Delivery status is required.", nameof(status));
    }

    private static string? NormalizeDeliveryMessage(string? message)
    {
        if (string.IsNullOrWhiteSpace(message))
            return null;

        return message.Trim();
    }

    private static void ValidateExpiryDays(int expiryDays)
    {
        if (expiryDays < 1)
            throw new ArgumentException("Expiry days must be at least 1.", nameof(expiryDays));

        if (expiryDays > 90)
            throw new ArgumentException("Expiry days cannot exceed 90.", nameof(expiryDays));
    }
}

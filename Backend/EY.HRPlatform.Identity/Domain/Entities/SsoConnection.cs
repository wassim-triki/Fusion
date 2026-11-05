using System.Security.Cryptography;
using System.Text;
using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.Identity.Domain.Entities;

public enum SsoConnectionKind
{
    MicrosoftEntra = 0,
    OpenIdConnect = 1,
}

public enum SsoConnectionStatus
{
    /// <summary>Saved, never signed anyone in successfully since its issuer or application last changed.</summary>
    Draft = 0,

    /// <summary>A test sign-in through it succeeded.</summary>
    Tested = 1,
}

/// <summary>
/// A company's own sign-in provider (B-191): its Microsoft Entra ID directory or any OpenID Connect issuer. One per
/// company. The client secret is stored only under Data Protection with the company as a sub-purpose, so it never
/// leaves Identity and ciphertext moved to another company's row does not decrypt.
/// </summary>
public class SsoConnection : ITenantEntity
{
    private SsoConnection() { }

    public Guid Id { get; private set; }
    public Guid TenantId { get; private set; }
    public SsoConnectionKind Kind { get; private set; }
    public string DisplayName { get; private set; } = string.Empty;

    /// <summary>The issuer every token must carry; for Entra it is built from the directory.</summary>
    public string Issuer { get; private set; } = string.Empty;

    public string? EntraTenantId { get; private set; }
    public string ClientId { get; private set; } = string.Empty;
    public string ProtectedClientSecret { get; private set; } = string.Empty;
    public DateTime SecretSetAt { get; private set; }
    public SsoConnectionStatus Status { get; private set; }

    public DateTime? LastTestAt { get; private set; }
    public Guid? LastTestByUserId { get; private set; }

    /// <summary><c>succeeded</c> or <c>failed</c>.</summary>
    public string? LastTestOutcome { get; private set; }

    public string? LastTestEmail { get; private set; }
    public string? LastTestMessage { get; private set; }

    /// <summary>When the company started requiring this provider for its proved domains; null when not required.</summary>
    public DateTime? RequiredAt { get; private set; }

    public Guid? RequiredByUserId { get; private set; }

    /// <summary>How many password sessions ended when the requirement turned on.</summary>
    public int? RequiredEndedSessions { get; private set; }

    public DateTime CreatedAt { get; private set; }
    public Guid CreatedByUserId { get; private set; }
    public DateTime UpdatedAt { get; private set; }
    public Guid UpdatedByUserId { get; private set; }
    public uint Version { get; private set; }

    public bool IsRequired => RequiredAt is not null;

    public const int DisplayNameMaxLength = 60;
    public const int IssuerMaxLength = 400;
    public const int ClientIdMaxLength = 200;

    /// <summary>
    /// A company has at most one connection, so its id is derived from the company: the redirect address shown before
    /// the first save is the one the provider will call, and stays the same if the connection is removed and re-added.
    /// </summary>
    public static Guid IdFor(Guid tenantId)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes($"fusion-sso-connection:{tenantId:N}"));
        var bytes = hash[..16];
        bytes[7] = (byte)((bytes[7] & 0x0F) | 0x50);
        bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80);
        return new Guid(bytes);
    }

    public static SsoConnection Create(
        Guid tenantId, SsoConnectionKind kind, string displayName, string issuer, string? entraTenantId,
        string clientId, string protectedSecret, Guid actorUserId, DateTime now)
        => new()
        {
            Id = IdFor(tenantId),
            TenantId = tenantId,
            Kind = kind,
            DisplayName = displayName,
            Issuer = issuer,
            EntraTenantId = entraTenantId,
            ClientId = clientId,
            ProtectedClientSecret = protectedSecret,
            SecretSetAt = now,
            Status = SsoConnectionStatus.Draft,
            CreatedAt = now,
            CreatedByUserId = actorUserId,
            UpdatedAt = now,
            UpdatedByUserId = actorUserId,
        };

    /// <summary>True when issuer, directory or application change; that resets the connection to Draft.</summary>
    public bool ChangesIdentity(SsoConnectionKind kind, string issuer, string? entraTenantId, string clientId)
        => kind != Kind
           || !string.Equals(issuer, Issuer, StringComparison.Ordinal)
           || !string.Equals(entraTenantId, EntraTenantId, StringComparison.OrdinalIgnoreCase)
           || !string.Equals(clientId, ClientId, StringComparison.Ordinal);

    public void Update(
        SsoConnectionKind kind, string displayName, string issuer, string? entraTenantId, string clientId,
        Guid actorUserId, DateTime now)
    {
        if (ChangesIdentity(kind, issuer, entraTenantId, clientId))
        {
            if (IsRequired)
                throw new InvalidOperationException("The provider is required; turn the requirement off first.");
            Status = SsoConnectionStatus.Draft;
        }

        Kind = kind;
        DisplayName = displayName;
        Issuer = issuer;
        EntraTenantId = entraTenantId;
        ClientId = clientId;
        UpdatedAt = now;
        UpdatedByUserId = actorUserId;
    }

    public void ReplaceSecret(string protectedSecret, Guid actorUserId, DateTime now)
    {
        ProtectedClientSecret = protectedSecret;
        SecretSetAt = now;
        UpdatedAt = now;
        UpdatedByUserId = actorUserId;
    }

    public void RecordTest(bool succeeded, string? email, string? message, Guid actorUserId, DateTime now)
    {
        LastTestAt = now;
        LastTestByUserId = actorUserId;
        LastTestOutcome = succeeded ? "succeeded" : "failed";
        LastTestEmail = email;
        LastTestMessage = message;
        if (succeeded)
            Status = SsoConnectionStatus.Tested;
    }

    public void Require(Guid actorUserId, DateTime now, int endedSessions)
    {
        RequiredAt = now;
        RequiredByUserId = actorUserId;
        RequiredEndedSessions = endedSessions;
    }

    public void StopRequiring()
    {
        RequiredAt = null;
        RequiredByUserId = null;
        RequiredEndedSessions = null;
    }
}

/// <summary>
/// An email domain a company claims for its provider. Unproved, it blocks nobody; it is proved by a successful test
/// sign-in through the company's connection that returns a trusted address in it, and only one company can prove it.
/// </summary>
public class SsoDomain : ITenantEntity
{
    private SsoDomain() { }

    public Guid Id { get; private set; }
    public Guid TenantId { get; private set; }
    public Guid ConnectionId { get; private set; }

    /// <summary>Lower case, internationalized names as punycode.</summary>
    public string Domain { get; private set; } = string.Empty;

    public DateTime AddedAt { get; private set; }
    public Guid AddedByUserId { get; private set; }
    public DateTime? ProvedAt { get; private set; }
    public Guid? ProvedByUserId { get; private set; }

    public bool IsProved => ProvedAt is not null;

    public const int DomainMaxLength = 253;

    public static SsoDomain Create(Guid tenantId, Guid connectionId, string domain, Guid actorUserId, DateTime now)
        => new()
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            ConnectionId = connectionId,
            Domain = domain,
            AddedAt = now,
            AddedByUserId = actorUserId,
        };

    public void Prove(Guid actorUserId, DateTime now)
    {
        ProvedAt = now;
        ProvedByUserId = actorUserId;
    }
}

/// <summary>
/// An account's link to a provider identity, keyed by provider, issuer and subject (Microsoft's <c>oid</c>, everyone
/// else's <c>sub</c>). A link wins over email: a changed address at the provider moves nothing.
/// </summary>
public class ExternalLogin
{
    private ExternalLogin() { }

    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }

    /// <summary><c>microsoft</c>, <c>google</c> or <c>company</c>.</summary>
    public string Provider { get; private set; } = string.Empty;

    /// <summary>The company connection, for <c>company</c> links only.</summary>
    public Guid? ConnectionId { get; private set; }

    public string Issuer { get; private set; } = string.Empty;
    public string Subject { get; private set; } = string.Empty;
    public string EmailAtLink { get; private set; } = string.Empty;
    public DateTime LinkedAt { get; private set; }
    public DateTime LastUsedAt { get; private set; }

    public ApplicationUser? User { get; private set; }

    public static ExternalLogin Create(
        Guid userId, string provider, Guid? connectionId, string issuer, string subject, string email, DateTime now)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Provider = provider,
            ConnectionId = connectionId,
            Issuer = issuer,
            Subject = subject,
            EmailAtLink = email,
            LinkedAt = now,
            LastUsedAt = now,
        };

    public void Use(DateTime now) => LastUsedAt = now;
}

public enum SsoFlowPurpose
{
    SignIn = 0,
    Invitation = 1,
    Test = 2,
    Confirm = 3,
}

/// <summary>
/// One round trip to a provider. Bound to the browser that started it by an httpOnly cookie whose SHA-256 is all
/// that is stored; state, nonce and the PKCE verifier live here, never in the browser. The callback stores its result
/// here and the starting page collects it once, so no token, code or id ever travels in a URL.
/// </summary>
public class SsoFlow
{
    private SsoFlow() { }

    public Guid Id { get; private set; }
    public string BindingHash { get; private set; } = string.Empty;
    public SsoFlowPurpose Purpose { get; private set; }
    public string Provider { get; private set; } = string.Empty;
    public Guid? ConnectionId { get; private set; }
    public string ExpectedIssuer { get; private set; } = string.Empty;
    public string State { get; private set; } = string.Empty;
    public string Nonce { get; private set; } = string.Empty;
    public string ProtectedCodeVerifier { get; private set; } = string.Empty;

    /// <summary><c>workforce</c>, <c>administrator</c> or <c>bootstrap</c>.</summary>
    public string? InvitationKind { get; private set; }

    public string? ProtectedInvitationCredential { get; private set; }
    public Guid? ActorUserId { get; private set; }
    public string? LoginHint { get; private set; }
    public string ReturnTo { get; private set; } = "/";
    public DateTime CreatedAt { get; private set; }
    public DateTime ExpiresAt { get; private set; }
    public DateTime? CompletedAt { get; private set; }
    public Guid? ResultUserId { get; private set; }
    public string? ResultCode { get; private set; }
    public string? ResultJson { get; private set; }

    /// <summary>How the session the flow hands over started, carried onto its refresh tokens.</summary>
    public string? ResultMethod { get; private set; }

    public DateTime? ConsumedAt { get; private set; }

    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);

    public static SsoFlow Start(
        string bindingHash, SsoFlowPurpose purpose, string provider, Guid? connectionId, string expectedIssuer,
        string state, string nonce, string protectedCodeVerifier, string? invitationKind,
        string? protectedInvitationCredential, Guid? actorUserId, string? loginHint, string returnTo, DateTime now)
        => new()
        {
            Id = Guid.NewGuid(),
            BindingHash = bindingHash,
            Purpose = purpose,
            Provider = provider,
            ConnectionId = connectionId,
            ExpectedIssuer = expectedIssuer,
            State = state,
            Nonce = nonce,
            ProtectedCodeVerifier = protectedCodeVerifier,
            InvitationKind = invitationKind,
            ProtectedInvitationCredential = protectedInvitationCredential,
            ActorUserId = actorUserId,
            LoginHint = loginHint,
            ReturnTo = returnTo,
            CreatedAt = now,
            ExpiresAt = now + Lifetime,
        };

    public bool IsExpired(DateTime now) => now >= ExpiresAt;

    public void Succeed(Guid userId, string? method, DateTime now, string? resultJson = null)
    {
        CompletedAt = now;
        ResultUserId = userId;
        ResultMethod = method;
        ResultJson = resultJson;
    }

    public void Refuse(string code, string? resultJson, DateTime now)
    {
        CompletedAt = now;
        ResultCode = code;
        ResultJson = resultJson;
    }

    public void Consume(DateTime now) => ConsumedAt = now;
}

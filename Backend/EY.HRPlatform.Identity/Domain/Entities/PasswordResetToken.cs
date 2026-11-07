using System.Security.Cryptography;

namespace EY.HRPlatform.Identity.Domain.Entities;

/// <summary>
/// A one-time link to choose a new password (B-295). Only the SHA-256 of the token is stored, so reading this table
/// gives nothing that resets a password. A link works once, for <see cref="Lifetime"/>, and a newer link or a finished
/// reset voids the others.
/// </summary>
public class PasswordResetToken
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(30);

    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid UserId { get; private set; }
    public string TokenHash { get; private set; } = string.Empty;
    public DateTime CreatedAt { get; private set; }
    public DateTime ExpiresAt { get; private set; }
    public DateTime? UsedAt { get; set; }
    public DateTime? VoidedAt { get; set; }

    public bool IsOpen(DateTime now) => UsedAt is null && VoidedAt is null && now < ExpiresAt;

    /// <summary>A new link for the account: the stored row and the token that goes only into the email.</summary>
    public static (PasswordResetToken Row, string Token) Issue(Guid userId, DateTime now)
    {
        var token = Base64UrlToken(RandomNumberGenerator.GetBytes(32));
        return (new PasswordResetToken
        {
            UserId = userId,
            TokenHash = RefreshToken.HashOf(token),
            CreatedAt = now,
            ExpiresAt = now + Lifetime,
        }, token);
    }

    private static string Base64UrlToken(byte[] bytes)
        => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

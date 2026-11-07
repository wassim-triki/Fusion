using System.Security.Cryptography;
using System.Text;

namespace EY.HRPlatform.Identity.Domain.Entities;

public class RefreshToken
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    /// <summary>
    /// SHA-256 hex of the token handed to the client (B-294). The token itself is never stored, so reading this
    /// table gives nothing that refreshes a session.
    /// </summary>
    public string TokenHash { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? RevokedAt { get; set; }

    /// <summary>
    /// How the session started (<c>password</c>, <c>sso:microsoft</c>, <c>sso:google</c>, <c>sso:company</c>), carried
    /// across rotation, so a company that starts requiring its provider can end password sessions only (B-191).
    /// </summary>
    public string Method { get; set; } = SessionMethods.Password;
    public bool IsExpired => DateTime.UtcNow >= ExpiresAt;
    public bool IsRevoked => RevokedAt is not null;
    public bool IsActive => !IsRevoked && !IsExpired;

    /// <summary>
    /// The stored form of a refresh token. A plain SHA-256 fits: the token is 64 random bytes, so there is nothing
    /// to brute-force and a slow hash would only cost every refresh.
    /// </summary>
    public static string HashOf(string token)
        => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}

public static class SessionMethods
{
    public const string Password = "password";

    public static string ForProvider(string provider) => $"sso:{provider}";

    public static bool IsPassword(string? method) => string.IsNullOrEmpty(method) || method == Password;
}

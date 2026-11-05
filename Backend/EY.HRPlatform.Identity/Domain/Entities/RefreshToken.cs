namespace EY.HRPlatform.Identity.Domain.Entities;

public class RefreshToken
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string Token { get; set; } = string.Empty;
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
}

public static class SessionMethods
{
    public const string Password = "password";

    public static string ForProvider(string provider) => $"sso:{provider}";

    public static bool IsPassword(string? method) => string.IsNullOrEmpty(method) || method == Password;
}

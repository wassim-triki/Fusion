using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace EY.HRPlatform.CoreHR.Infrastructure.Imports;

// Primitives of the import: who acted, and fingerprints of what was reviewed.

/// <summary>Who performed an import action, normalized for audit display.</summary>
public sealed record ImportActor(Guid UserId, string DisplayName)
{
    public ImportActor Normalize()
        => new(UserId, string.IsNullOrWhiteSpace(DisplayName)
            ? "Unknown"
            : DisplayName.Trim()[..Math.Min(DisplayName.Trim().Length, 256)]);
}

/// <summary>Deterministic hashing and comparison for source, plan and proposal fingerprints.</summary>
public static class ImportFingerprint
{
    private static readonly JsonSerializerOptions CanonicalJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    /// <summary>Lowercase hex SHA-256 of the UTF-8 value.</summary>
    public static string Hash(string value)
        => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    /// <summary>Hash of the value's camelCase JSON. Callers own ordering of any collections inside it.</summary>
    public static string HashCanonical<T>(T value)
        => Hash(JsonSerializer.Serialize(value, CanonicalJson));

    /// <summary>Constant-time comparison of two fingerprints; null/blank never matches.</summary>
    public static bool Matches(string? expected, string? actual)
    {
        if (string.IsNullOrWhiteSpace(expected) || string.IsNullOrWhiteSpace(actual)) return false;
        var left = Encoding.UTF8.GetBytes(expected.Trim());
        var right = Encoding.UTF8.GetBytes(actual.Trim());
        return left.Length == right.Length && CryptographicOperations.FixedTimeEquals(left, right);
    }
}

using System.Buffers.Binary;
using System.Security.Cryptography;

namespace EY.HRPlatform.Identity.Domain.Entities;

/// <summary>
/// A logo the studio may store: a PNG (checked by its signature and header, never by what the client says it is),
/// at most 512 KB and between 16 and 1024 pixels a side. The browser turns any other format into one before saving,
/// so Fusion serves and emails one format and never an SVG that could carry script.
/// </summary>
public sealed record BrandLogo(byte[] Content, string Version, int Width, int Height)
{
    public const int MaxBytes = 512 * 1024;
    public const int MinSide = 16;
    public const int MaxSide = 1024;

    private static ReadOnlySpan<byte> Signature => [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    /// <summary>The logo, or an <see cref="ArgumentException"/> saying in words why the file can't be one.</summary>
    public static BrandLogo Read(byte[] content)
    {
        ArgumentNullException.ThrowIfNull(content);
        if (content.Length > MaxBytes)
            throw new ArgumentException("The logo is larger than 512 KB.", nameof(content));
        // Signature (8), IHDR length (4), "IHDR" (4), width (4), height (4).
        if (content.Length < 24 || !content.AsSpan(0, 8).SequenceEqual(Signature)
            || !content.AsSpan(12, 4).SequenceEqual("IHDR"u8))
            throw new ArgumentException("The logo isn't a PNG image.", nameof(content));

        var width = BinaryPrimitives.ReadInt32BigEndian(content.AsSpan(16, 4));
        var height = BinaryPrimitives.ReadInt32BigEndian(content.AsSpan(20, 4));
        if (width < MinSide || height < MinSide || width > MaxSide || height > MaxSide)
            throw new ArgumentException("The logo must be between 16 and 1024 pixels a side.", nameof(content));

        var version = Convert.ToHexStringLower(SHA256.HashData(content))[..16];
        return new BrandLogo(content, version, width, height);
    }
}

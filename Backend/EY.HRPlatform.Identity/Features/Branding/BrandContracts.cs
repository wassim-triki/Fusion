using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.SharedKernel.Localization;

namespace EY.HRPlatform.Identity.Features.Branding;

/// <summary>What happens to the logo on save: kept as it is, replaced by the request's PNG, or removed.</summary>
public static class LogoChange
{
    public const string Keep = "keep";
    public const string Replace = "replace";
    public const string Remove = "remove";
}

/// <summary>
/// The brand studio's one save. <c>Color</c> is <c>#rrggbb</c> or null for Fusion's own; <c>Language</c> is en, fr or
/// ar; <c>Logo</c> is a <see cref="LogoChange"/>; <c>LogoPng</c> (base64) is read only when it is replace.
/// </summary>
public sealed record SaveBrandRequest(string Name, string? Color, string Language, string Logo, string? LogoPng);

/// <summary>Draft values the email preview renders, before anything is saved.</summary>
public sealed record BrandEmailPreviewRequest(string Name, string? Color, string Language, bool HasLogo);

public sealed record BrandEmailPreviewDto(string Subject, string Html, string LogoContentId);

/// <summary>
/// A company's brand as anyone may see it before signing in: what its sign-in page shows. Nothing else about the
/// company leaves through it.
/// </summary>
public sealed record PublicBrandDto(string Name, string Slug, string? Color, string? LogoUrl, string Language);

public static class BrandAddresses
{
    /// <summary>The logo's address through the gateway; the version makes a new logo a new address, cached for good.</summary>
    public static string? LogoUrl(Guid tenantId, string? version)
        => version is null ? null : $"/api/identity/brand/logos/{tenantId}/{version}.png";

    public static string LanguageOf(Tenant tenant) => FusionLanguages.FromLocale(tenant.Locale) ?? FusionLanguages.Default;
}

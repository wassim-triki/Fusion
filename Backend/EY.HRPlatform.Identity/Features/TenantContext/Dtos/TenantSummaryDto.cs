namespace EY.HRPlatform.Identity.Features.TenantContext.Dtos;

public sealed record TenantSummaryDto(
    Guid TenantId,
    string Name,
    string Slug,
    string OperationalStatus,
    bool IsActive,
    bool IsArchived,
    string? Industry = null,
    string? Locale = null,
    string? TimeZone = null,
    string? BrandColor = null,
    string? LogoUrl = null,
    string? Language = null);

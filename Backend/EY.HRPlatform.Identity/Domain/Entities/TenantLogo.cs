namespace EY.HRPlatform.Identity.Domain.Entities;

/// <summary>
/// A company's logo: one checked PNG per tenant, kept apart from <see cref="Tenant"/> so reading a tenant never loads
/// the image. <see cref="Version"/> is the content hash the tenant also holds, so a new logo gets a new address.
/// </summary>
public class TenantLogo
{
    private TenantLogo() { } // EF constructor

    public Guid TenantId { get; private set; }
    public byte[] Content { get; private set; } = [];
    public string Version { get; private set; } = string.Empty;
    public DateTime UpdatedAt { get; private set; }

    public static TenantLogo Create(Guid tenantId, BrandLogo logo)
        => new() { TenantId = tenantId, Content = logo.Content, Version = logo.Version, UpdatedAt = DateTime.UtcNow };

    public void Replace(BrandLogo logo)
    {
        Content = logo.Content;
        Version = logo.Version;
        UpdatedAt = DateTime.UtcNow;
    }
}

using EY.HRPlatform.SharedKernel.Domain;
using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.CoreHR.Domain.Entities;

/// <summary>Where people work, as the company names it, with an optional city and country.</summary>
public sealed class Place : BaseEntity, ITenantEntity
{
    public const int MaxNameLength = 100;
    public const int MaxDetailLength = 100;

    private Place() { }

    public Guid TenantId { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string NormalizedName { get; private set; } = string.Empty;
    public string? City { get; private set; }
    public string? Country { get; private set; }
    public bool IsRetired { get; private set; }

    public static Place Create(Guid tenantId, string name, string? city, string? country, string? actor)
    {
        if (tenantId == Guid.Empty)
            throw new ArgumentException("Tenant is required.", nameof(tenantId));

        var place = new Place { TenantId = tenantId, CreatedBy = actor };
        place.Set(name, city, country);
        return place;
    }

    public void Update(string name, string? city, string? country, string? actor)
    {
        Set(name, city, country);
        UpdatedAt = DateTime.UtcNow;
        UpdatedBy = actor;
    }

    public void Retire(string? actor) => SetRetired(true, actor);

    public void Restore(string? actor) => SetRetired(false, actor);

    private void SetRetired(bool retired, string? actor)
    {
        IsRetired = retired;
        UpdatedAt = DateTime.UtcNow;
        UpdatedBy = actor;
    }

    private void Set(string name, string? city, string? country)
    {
        var clean = CatalogName.Clean(name);
        if (clean.Length == 0 || clean.Length > MaxNameLength)
            throw new ArgumentException("A place name of at most 100 characters is required.", nameof(name));
        Name = clean;
        NormalizedName = CatalogName.Normalize(clean);
        City = Detail(city, nameof(city));
        Country = Detail(country, nameof(country));
    }

    private static string? Detail(string? value, string name)
    {
        var clean = CatalogName.Clean(value);
        if (clean.Length > MaxDetailLength)
            throw new ArgumentException("At most 100 characters.", name);
        return clean.Length == 0 ? null : clean;
    }
}

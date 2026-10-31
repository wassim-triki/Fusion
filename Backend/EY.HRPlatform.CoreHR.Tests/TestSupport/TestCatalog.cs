using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Tests.TestSupport;

/// <summary>
/// Jobs, places and list values for tests. <see cref="Job(Guid, string)"/> and friends make bare objects for rows
/// seeded straight into an in-memory context; the <c>CoreHRDbContext</c> extensions find or add the row, for paths
/// that look the catalogue up (services, relational tests with foreign keys).
/// </summary>
public static class TestCatalog
{
    public static Job Job(Guid tenantId, string title) => EY.HRPlatform.CoreHR.Domain.Entities.Job.Create(tenantId, title, null, null, "test");

    public static Place? Place(Guid tenantId, string? name)
        => string.IsNullOrWhiteSpace(name) ? null : EY.HRPlatform.CoreHR.Domain.Entities.Place.Create(tenantId, name, null, null, "test");

    public static CompanyListValue EmploymentType(Guid tenantId, string label)
        => CompanyListValue.Create(tenantId, CompanyList.EmploymentTypes, label, CatalogName.Slug(label), 0, "test");

    /// <summary>The tenant's job with this title, added to the context (unsaved) when it has none.</summary>
    public static Job Job(this CoreHRDbContext db, Guid tenantId, string title)
    {
        var normalized = CatalogName.Normalize(title);
        var job = db.Jobs.Local.FirstOrDefault(item => item.TenantId == tenantId && item.NormalizedTitle == normalized)
            ?? db.Jobs.IgnoreQueryFilters().FirstOrDefault(item => item.TenantId == tenantId && item.NormalizedTitle == normalized);
        if (job is not null) return job;
        job = Job(tenantId, title);
        db.Jobs.Add(job);
        return job;
    }

    /// <summary>The tenant's place with this name, added to the context (unsaved) when it has none; null for no name.</summary>
    public static Place? Place(this CoreHRDbContext db, Guid tenantId, string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        var normalized = CatalogName.Normalize(name);
        var place = db.Places.Local.FirstOrDefault(item => item.TenantId == tenantId && item.NormalizedName == normalized)
            ?? db.Places.IgnoreQueryFilters().FirstOrDefault(item => item.TenantId == tenantId && item.NormalizedName == normalized);
        if (place is not null) return place;
        place = Place(tenantId, name)!;
        db.Places.Add(place);
        return place;
    }

    public static Guid JobId(this CoreHRDbContext db, Guid tenantId, string title) => db.Job(tenantId, title).Id;

    public static Guid? PlaceId(this CoreHRDbContext db, Guid tenantId, string? name) => db.Place(tenantId, name)?.Id;

    /// <summary>The tenant's employment type with this label, added to the context (unsaved) when it has none.</summary>
    public static CompanyListValue EmploymentType(this CoreHRDbContext db, Guid tenantId, string label)
    {
        var normalized = CatalogName.Normalize(label);
        var value = db.CompanyListValues.Local.FirstOrDefault(item => item.TenantId == tenantId && item.List == CompanyList.EmploymentTypes && item.NormalizedLabel == normalized)
            ?? db.CompanyListValues.IgnoreQueryFilters().FirstOrDefault(item => item.TenantId == tenantId && item.List == CompanyList.EmploymentTypes && item.NormalizedLabel == normalized);
        if (value is not null) return value;
        value = EmploymentType(tenantId, label);
        db.CompanyListValues.Add(value);
        return value;
    }

    /// <summary>The tenant's change reason with this label, saved so the change flow can read it.</summary>
    public static Guid ChangeReasons(this CoreHRDbContext db, Guid tenantId, string label)
    {
        var normalized = CatalogName.Normalize(label);
        var value = db.CompanyListValues.IgnoreQueryFilters().FirstOrDefault(item => item.TenantId == tenantId && item.List == CompanyList.ChangeReasons && item.NormalizedLabel == normalized);
        if (value is not null) return value.Id;
        value = CompanyListValue.Create(tenantId, CompanyList.ChangeReasons, label, $"reason-{Guid.NewGuid():N}"[..20], 0, "test");
        db.CompanyListValues.Add(value);
        db.SaveChanges();
        return value.Id;
    }
}

using EY.HRPlatform.SharedKernel.Domain;
using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.CoreHR.Domain.Entities;

/// <summary>
/// A job in the company's catalogue: a title, with an optional family and level from the company's lists. Work
/// assignments and open roles point at it. Not effective-dated: the catalogue isn't history, people's changes are,
/// so a renamed job shows its new name everywhere it's held.
/// </summary>
public sealed class Job : BaseEntity, ITenantEntity
{
    public const int MaxTitleLength = 150;

    private Job() { }

    public Guid TenantId { get; private set; }
    public string Title { get; private set; } = string.Empty;
    public string NormalizedTitle { get; private set; } = string.Empty;
    public Guid? FamilyId { get; private set; }
    public Guid? LevelId { get; private set; }
    public bool IsRetired { get; private set; }

    public static Job Create(Guid tenantId, string title, CompanyListValue? family, CompanyListValue? level, string? actor)
    {
        if (tenantId == Guid.Empty)
            throw new ArgumentException("Tenant is required.", nameof(tenantId));

        var job = new Job { TenantId = tenantId, CreatedBy = actor };
        job.SetTitle(title);
        job.Classify(family, level);
        return job;
    }

    public void Update(string title, CompanyListValue? family, CompanyListValue? level, string? actor)
    {
        SetTitle(title);
        Classify(family, level);
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

    private void SetTitle(string title)
    {
        var clean = CatalogName.Clean(title);
        if (clean.Length == 0 || clean.Length > MaxTitleLength)
            throw new ArgumentException("A job title of at most 150 characters is required.", nameof(title));
        Title = clean;
        NormalizedTitle = CatalogName.Normalize(clean);
    }

    private void Classify(CompanyListValue? family, CompanyListValue? level)
    {
        if (family is not null && (family.TenantId != TenantId || family.List != CompanyList.JobFamilies))
            throw new ArgumentException("The family must be one of the company's job families.", nameof(family));
        if (level is not null && (level.TenantId != TenantId || level.List != CompanyList.Levels))
            throw new ArgumentException("The level must be one of the company's levels.", nameof(level));
        FamilyId = family?.Id;
        LevelId = level?.Id;
    }
}

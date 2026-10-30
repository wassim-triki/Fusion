using System.Text;
using System.Text.RegularExpressions;
using EY.HRPlatform.SharedKernel.Domain;
using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.CoreHR.Domain.Entities;

/// <summary>The company's lists. A fixed set: each list has a purpose in Core HR, the values are the company's own.</summary>
public enum CompanyList
{
    EmploymentTypes = 1,
    Levels = 2,
    JobFamilies = 3,
    ChangeReasons = 4,
    LeaveTypes = 5,
}

/// <summary>
/// One value of a company list. Its key never changes once made (imports and integrations can rely on it); its
/// label can. A value something uses is retired, never deleted: it leaves the pickers and stays where it was used.
/// </summary>
public sealed class CompanyListValue : BaseEntity, ITenantEntity
{
    public const int MaxLabelLength = 100;
    public const int MaxKeyLength = 60;

    private CompanyListValue() { }

    public Guid TenantId { get; private set; }
    public CompanyList List { get; private set; }
    public string Key { get; private set; } = string.Empty;
    public string Label { get; private set; } = string.Empty;
    public string NormalizedLabel { get; private set; } = string.Empty;
    public int SortOrder { get; private set; }
    public bool IsRetired { get; private set; }
    public DateTime? RetiredAt { get; private set; }

    public static CompanyListValue Create(Guid tenantId, CompanyList list, string label, string key, int sortOrder, string? actor)
    {
        if (tenantId == Guid.Empty)
            throw new ArgumentException("Tenant is required.", nameof(tenantId));
        if (!Enum.IsDefined(list))
            throw new ArgumentException("Unknown list.", nameof(list));
        if (string.IsNullOrWhiteSpace(key) || key.Length > MaxKeyLength)
            throw new ArgumentException("A key of at most 60 characters is required.", nameof(key));

        var value = new CompanyListValue { TenantId = tenantId, List = list, Key = key, SortOrder = sortOrder, CreatedBy = actor };
        value.SetLabel(label);
        return value;
    }

    public void Rename(string label, string? actor)
    {
        SetLabel(label);
        Touch(actor);
    }

    public void MoveTo(int sortOrder, string? actor)
    {
        SortOrder = sortOrder;
        Touch(actor);
    }

    public void Retire(string? actor)
    {
        if (IsRetired) return;
        IsRetired = true;
        RetiredAt = DateTime.UtcNow;
        Touch(actor);
    }

    public void Restore(string? actor)
    {
        if (!IsRetired) return;
        IsRetired = false;
        RetiredAt = null;
        Touch(actor);
    }

    private void SetLabel(string label)
    {
        var name = CatalogName.Clean(label);
        if (name.Length == 0 || name.Length > MaxLabelLength)
            throw new ArgumentException("A name of at most 100 characters is required.", nameof(label));
        Label = name;
        NormalizedLabel = CatalogName.Normalize(name);
    }

    private void Touch(string? actor)
    {
        UpdatedAt = DateTime.UtcNow;
        UpdatedBy = actor;
    }
}

/// <summary>Marks that a tenant's lists got their defaults once, so emptying a list never brings them back.</summary>
public sealed class CompanyListSeed : ITenantEntity
{
    private CompanyListSeed() { }

    public Guid TenantId { get; private set; }
    public DateTime SeededAt { get; private set; }

    public static CompanyListSeed For(Guid tenantId) => new() { TenantId = tenantId, SeededAt = DateTime.UtcNow };
}

/// <summary>How catalogue names (jobs, places, list values) are cleaned and compared.</summary>
public static partial class CatalogName
{
    /// <summary>Trimmed, with runs of whitespace as one space.</summary>
    public static string Clean(string? name)
        => string.IsNullOrWhiteSpace(name) ? string.Empty : Spaces().Replace(name.Trim(), " ");

    /// <summary>The form two names are the same in: cleaned, ignoring case. The migration groups titles the same way.</summary>
    public static string Normalize(string? name) => Clean(name).ToUpperInvariant();

    /// <summary>A stable key from a label: lower-case ASCII letters and digits joined by dashes ("Full-time" → "full-time").</summary>
    public static string Slug(string label)
    {
        var builder = new StringBuilder();
        foreach (var ch in Clean(label).Normalize(NormalizationForm.FormD).ToLowerInvariant())
        {
            if (ch is >= 'a' and <= 'z' or >= '0' and <= '9') builder.Append(ch);
            else if (builder.Length > 0 && builder[^1] != '-' && System.Globalization.CharUnicodeInfo.GetUnicodeCategory(ch)
                is not System.Globalization.UnicodeCategory.NonSpacingMark) builder.Append('-');
        }
        var slug = builder.ToString().Trim('-');
        if (slug.Length > 50) slug = slug[..50].Trim('-');
        return slug.Length == 0 ? "value" : slug;
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();
}

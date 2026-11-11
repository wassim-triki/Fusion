using EY.HRPlatform.Performance.Domain.Common;

namespace EY.HRPlatform.Performance.Domain.Conversations;

/// <summary>
/// One of the company's values, the short list praise names (D-36). It is its own list, not the competency catalogue,
/// and a company starts with <see cref="Starters"/> so praise never waits on Settings. A removed value leaves the list
/// but keeps its name on the praise that named it.
/// </summary>
public sealed class CompanyValue : PerformanceAggregate
{
    public const int MaxNameLength = 60;
    public const int MaxActive = 12;

    public static readonly IReadOnlyList<string> Starters = ["Own the outcome", "Clients first", "Learn out loud", "One team"];

    private CompanyValue() { }

    public string Name { get; private set; } = string.Empty;
    public string NameKey { get; private set; } = string.Empty;
    public int Position { get; private set; }
    public DateTime? RemovedAt { get; private set; }

    public bool IsActive => RemovedAt is null;

    public static CompanyValue Create(Guid tenantId, string name, int position)
    {
        if (tenantId == Guid.Empty) throw new ArgumentException("TenantId is required.", nameof(tenantId));
        var text = Clean(name);
        return new CompanyValue { Id = Guid.NewGuid(), TenantId = tenantId, Name = text, NameKey = Key(text), Position = position };
    }

    public void Rename(string name)
    {
        if (!IsActive) throw new InvalidOperationException("Removed values can't be renamed.");
        var text = Clean(name);
        Name = text;
        NameKey = Key(text);
        MarkUpdated();
    }

    /// <summary>Takes it off the list. False when it was already off.</summary>
    public bool Remove(DateTime now)
    {
        if (!IsActive) return false;
        RemovedAt = now;
        MarkUpdated();
        return true;
    }

    /// <summary>Brings a removed value back, at the end of the list.</summary>
    public void Restore(int position)
    {
        RemovedAt = null;
        Position = position;
        MarkUpdated();
    }

    public static string Key(string name) => name.Trim().ToUpperInvariant();

    private static string Clean(string name)
    {
        var text = name?.Trim() ?? string.Empty;
        if (text.Length == 0) throw new ArgumentException("Name the value.", nameof(name));
        if (text.Length > MaxNameLength) throw new ArgumentException($"Keep a value to {MaxNameLength} characters.", nameof(name));
        return text;
    }
}

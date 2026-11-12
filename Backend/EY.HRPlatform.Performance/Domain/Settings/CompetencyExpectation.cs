using EY.HRPlatform.Performance.Domain.Common;

namespace EY.HRPlatform.Performance.Domain.Settings;

/// <summary>Where an expectation's words came from: written here, drafted from the jobs, or read from the company's own file.</summary>
public enum ExpectationSource { Written, Drafted, File }

/// <summary>
/// What one competency asks of one level in one job family (D-41). The family and level are Core HR's company-list
/// values; a review reads the expectation at the person's level and the next one.
/// </summary>
public sealed class CompetencyExpectation : PerformanceAggregate
{
    public const int MaxTextLength = 500;

    private CompetencyExpectation() { }

    public Guid CompetencyId { get; private set; }
    public Guid FamilyId { get; private set; }
    public Guid LevelId { get; private set; }
    public string Text { get; private set; } = string.Empty;
    public ExpectationSource Source { get; private set; }

    public static CompetencyExpectation Create(Guid tenantId, Guid competencyId, Guid familyId, Guid levelId, string text, ExpectationSource source)
    {
        if (competencyId == Guid.Empty || familyId == Guid.Empty || levelId == Guid.Empty)
            throw new ArgumentException("A competency, a family and a level are required.");
        var expectation = new CompetencyExpectation { TenantId = tenantId, CompetencyId = competencyId, FamilyId = familyId, LevelId = levelId };
        expectation.Write(text, source);
        return expectation;
    }

    public void Write(string text, ExpectationSource source)
    {
        var clean = Clean(text);
        if (clean.Length == 0 || clean.Length > MaxTextLength)
            throw new ArgumentException($"Write what this level asks in {MaxTextLength} characters or fewer.", nameof(text));
        if (!Enum.IsDefined(source)) throw new ArgumentException("Unknown source.", nameof(source));
        if (clean == Text && source == Source) return;
        Text = clean;
        Source = source;
        MarkUpdated();
    }

    /// <summary>One line: inner whitespace collapsed, ends trimmed.</summary>
    public static string Clean(string? text) => string.Join(' ', (text ?? string.Empty).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
}

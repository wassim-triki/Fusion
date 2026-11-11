using EY.HRPlatform.Performance.Domain.Common;

namespace EY.HRPlatform.Performance.Domain.Reviews;

public enum ReviewQuestionAuthor { Self, Manager }

/// <summary>
/// One sentence of a drafted answer and the key of the source it was written from (<c>kind:id</c>, as the review's year
/// lists it). Kept only while the sentences, joined by spaces, are exactly the answer's text.
/// </summary>
public sealed partial record ReviewCitation(string Text, string Key)
{
    public const int MaxSentences = 8;
    public const int MaxKey = 80;

    [System.Text.RegularExpressions.GeneratedRegex("^[a-z-]{2,20}:[0-9a-f]{32}$")]
    private static partial System.Text.RegularExpressions.Regex KeyShape();

    internal static string? Serialize(string text, IReadOnlyList<ReviewCitation>? citations)
    {
        if (citations is null || citations.Count is 0 or > MaxSentences) return null;
        if (citations.Any(c => c.Key.Length > MaxKey || !KeyShape().IsMatch(c.Key) || string.IsNullOrWhiteSpace(c.Text))) return null;
        var joined = string.Join(" ", citations.Select(c => c.Text.Trim()));
        return joined == text ? System.Text.Json.JsonSerializer.Serialize(citations.Select(c => new ReviewCitation(c.Text.Trim(), c.Key))) : null;
    }

    internal static IReadOnlyList<ReviewCitation> Read(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try { return System.Text.Json.JsonSerializer.Deserialize<ReviewCitation[]>(json) ?? []; }
        catch (System.Text.Json.JsonException) { return []; }
    }
}

/// <summary>A free-text answer to one of the round's frozen questions, saved with its side's assessment (D2).</summary>
public sealed class ReviewQuestionAnswer : PerformanceChildEntity
{
    public const int MaxLength = 4000;

    private ReviewQuestionAnswer() { }

    public Guid ReviewId { get; private set; }
    public Guid QuestionSnapshotId { get; private set; }
    public ReviewQuestionAuthor Author { get; private set; }
    public string Text { get; private set; } = string.Empty;
    /// <summary>
    /// The draft's sentences with the source each was written from (H3), kept while the text is the draft as written;
    /// an edit drops them. JSON of <see cref="ReviewCitation"/>.
    /// </summary>
    public string? CitationsJson { get; private set; }

    internal static ReviewQuestionAnswer Create(Guid tenantId, Guid reviewId, Guid questionSnapshotId, ReviewQuestionAuthor author, string text,
        IReadOnlyList<ReviewCitation>? citations = null)
    {
        if (questionSnapshotId == Guid.Empty) throw new ArgumentException("An answer needs its question.", nameof(questionSnapshotId));
        var value = Normalize(text);
        return new ReviewQuestionAnswer
        {
            TenantId = tenantId, ReviewId = reviewId, QuestionSnapshotId = questionSnapshotId, Author = author, Text = value,
            CitationsJson = ReviewCitation.Serialize(value, citations),
        };
    }

    internal void Change(string text, IReadOnlyList<ReviewCitation>? citations = null)
    {
        var value = Normalize(text);
        var cited = ReviewCitation.Serialize(value, citations);
        if (value == Text && cited == CitationsJson) return;
        Text = value;
        CitationsJson = cited;
        MarkUpdated();
    }

    public IReadOnlyList<ReviewCitation> Citations => ReviewCitation.Read(CitationsJson);

    private static string Normalize(string text)
    {
        var value = text.Trim();
        if (value.Length > MaxLength) throw new ArgumentException($"An answer can be up to {MaxLength:N0} characters.", nameof(text));
        return value;
    }
}

/// <summary>Who put a colleague on the list: Fusion when the round opened (D-40), or the manager later.</summary>
public enum PeerNominationSource { Fusion, Reviewer }

/// <summary>A colleague asked for their view on a review: picked by Fusion, or added by the manager.</summary>
public sealed class PeerNomination : PerformanceChildEntity
{
    private PeerNomination() { }

    public Guid ReviewId { get; private set; }
    public Guid EmployeeId { get; private set; }
    public string DisplayName { get; private set; } = string.Empty;
    public PeerNominationSource Source { get; private set; }
    public DateTime NominatedAt { get; private set; }

    internal static PeerNomination Create(Guid tenantId, Guid reviewId, Guid employeeId, string displayName,
        PeerNominationSource source, DateTime at)
        => new()
        {
            TenantId = tenantId, ReviewId = reviewId, EmployeeId = employeeId, DisplayName = displayName.Trim(),
            Source = source, NominatedAt = at,
        };
}

/// <summary>What the manager changed: colleagues no longer asked and colleagues newly asked (a swap is one of each).</summary>
public sealed record PeerListDecision(IReadOnlyList<Guid> Removed, IReadOnlyList<Guid> Added);

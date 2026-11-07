using System.Globalization;
using System.Text;

namespace EY.HRPlatform.SharedKernel.Text;

/// <summary>
/// Forgiving text matching for the top bar search (B-211): accent- and case-insensitive, by word start, so "aic"
/// finds Aïcha and "eng" finds Software Engineer, but "ngin" finds nothing.
/// </summary>
public static class SearchText
{
    private static readonly char[] Separators = [' ', '-', ',', '&', '.', '@', '/', '(', ')', '_', '\'', '’'];

    /// <summary>Lower case without accents.</summary>
    public static string Fold(string? text)
    {
        if (string.IsNullOrEmpty(text)) return string.Empty;
        var builder = new StringBuilder(text.Length);
        foreach (var character in text.Normalize(NormalizationForm.FormD))
            if (CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark)
                builder.Append(char.ToLowerInvariant(character));
        return builder.ToString();
    }

    /// <summary>The query's words, folded.</summary>
    public static string[] Words(string? query)
        => Fold(query).Split(Separators, StringSplitOptions.RemoveEmptyEntries);

    /// <summary>
    /// How well one text answers the whole query: 100 when it starts with it, 80 when a word in it does, 0 otherwise.
    /// </summary>
    public static int Score(string? text, string? query)
    {
        var folded = Fold(text);
        var wanted = Fold(query).Trim();
        if (folded.Length == 0 || wanted.Length == 0) return 0;
        if (folded.StartsWith(wanted, StringComparison.Ordinal)) return 100;
        return folded.Split(Separators, StringSplitOptions.RemoveEmptyEntries).Any(word => word.StartsWith(wanted, StringComparison.Ordinal)) ? 80 : 0;
    }

    /// <summary>Every query word starts a word (or the whole) of one of the texts.</summary>
    public static bool MatchesAll(string[] words, params string?[] texts)
    {
        if (words.Length == 0) return false;
        var folded = texts.Select(Fold).Where(text => text.Length > 0).ToList();
        return words.All(word => folded.Any(text => text.StartsWith(word, StringComparison.Ordinal)
            || text.Split(Separators, StringSplitOptions.RemoveEmptyEntries).Any(part => part.StartsWith(word, StringComparison.Ordinal))));
    }
}

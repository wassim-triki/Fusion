using EY.HRPlatform.CoreHR.Domain.Entities;

namespace EY.HRPlatform.CoreHR.Features.CompanyImport;

/// <summary>A sentence read as a fix: whose field, the value Fusion would store, and what it shows before and after.</summary>
public sealed record CompanyImportSaid(string PersonKey, string PersonName, string Field, string Value, string? From, string To);

/// <summary>
/// "Houssem reports to Omar", "Rania is based in Tunis": a fix said in words, read by rules over the import's own
/// people, units, jobs and places. It reads; the person applies. Nothing it can't place is guessed.
/// </summary>
public static class CompanyImportSaying
{
    public const int MaxLength = 200;

    private static readonly (string Phrase, string Field)[] Phrases =
    [
        (" has no manager", "noManager"),
        (" reports to ", CompanyImportFields.Manager),
        (" report to ", CompanyImportFields.Manager),
        (" reports into ", CompanyImportFields.Manager),
        (" is managed by ", CompanyImportFields.Manager),
        (" works for ", CompanyImportFields.Manager),
        ("'s manager is ", CompanyImportFields.Manager),
        (" manager is ", CompanyImportFields.Manager),
        (" is based in ", CompanyImportFields.Place),
        (" based in ", CompanyImportFields.Place),
        (" works from ", CompanyImportFields.Place),
        (" is located in ", CompanyImportFields.Place),
        (" sits in ", CompanyImportFields.Place),
        (" belongs to ", CompanyImportFields.Unit),
        (" is part of ", CompanyImportFields.Unit),
        (" moves to ", CompanyImportFields.Unit),
        (" works in ", "in"),
        (" is in ", "in"),
        (" works as ", CompanyImportFields.JobTitle),
        ("'s title is ", CompanyImportFields.JobTitle),
        (" is an ", CompanyImportFields.JobTitle),
        (" is a ", CompanyImportFields.JobTitle),
    ];

    public static CompanyImportSaid? Read(string text, CompanyImportProposal proposal)
    {
        var sentence = " " + CatalogName.Clean(text).TrimEnd('.', '!', '?') + " ";
        if (sentence.Length > MaxLength + 2) return null;
        var lower = sentence.ToLowerInvariant();

        foreach (var (phrase, field) in Phrases)
        {
            var at = lower.IndexOf(phrase, StringComparison.Ordinal);
            if (at <= 0) continue;
            var subject = FindPerson(sentence[..at], proposal);
            if (subject is null) continue;
            var rest = sentence[(at + phrase.Length)..].Trim();
            var unitName = (string? key) => key is null ? null : proposal.Units.FirstOrDefault(unit => unit.Key == key)?.Name;
            var placeName = proposal.Places.FirstOrDefault(place => place.Key == subject.PlaceKey)?.Name;
            var jobTitle = proposal.Jobs.FirstOrDefault(job => job.Key == subject.JobKey)?.Title;
            var managerName = proposal.People.FirstOrDefault(person => person.Key == subject.ManagerKey)?.DisplayName;

            switch (field)
            {
                case "noManager":
                    return new(subject.Key, subject.DisplayName, CompanyImportFields.Manager, "none", managerName, "none");
                case CompanyImportFields.Manager:
                    var manager = FindPerson(rest, proposal, exact: true);
                    if (manager is null || manager.Key == subject.Key) return null;
                    return new(subject.Key, subject.DisplayName, field, manager.Key, managerName, manager.DisplayName);
                case CompanyImportFields.Place:
                    var place = Match(rest, proposal.Places.Select(p => (p.Key, p.Name)))?.Name ?? Title(rest);
                    return place.Length == 0 ? null : new(subject.Key, subject.DisplayName, field, place, placeName, place);
                case CompanyImportFields.Unit:
                    var unit = Match(rest, proposal.Units.Select(u => (u.Key, u.Name)));
                    return unit is null ? null : new(subject.Key, subject.DisplayName, field, unit.Value.Key, unitName(subject.UnitKey), unit.Value.Name);
                case "in":
                    if (Match(rest, proposal.Units.Select(u => (u.Key, u.Name))) is { } inUnit)
                        return new(subject.Key, subject.DisplayName, CompanyImportFields.Unit, inUnit.Key, unitName(subject.UnitKey), inUnit.Name);
                    if (Match(rest, proposal.Places.Select(p => (p.Key, p.Name))) is { } inPlace)
                        return new(subject.Key, subject.DisplayName, CompanyImportFields.Place, inPlace.Name, placeName, inPlace.Name);
                    return null;
                case CompanyImportFields.JobTitle:
                    var title = Match(rest, proposal.Jobs.Select(j => (j.Key, j.Title)))?.Name ?? Title(rest);
                    return title.Length is 0 or > 150 ? null : new(subject.Key, subject.DisplayName, field, title, jobTitle, title);
            }
        }
        return null;
    }

    /// <summary>The person named in the text: a full name, else a first name only one person has.</summary>
    private static ProposedPerson? FindPerson(string text, CompanyImportProposal proposal, bool exact = false)
    {
        var said = CatalogName.Normalize(text.Trim().TrimEnd('\'', 's').Trim());
        if (said.Length == 0) return null;
        var full = proposal.People.Where(person => said == CatalogName.Normalize($"{person.FirstName} {person.LastName}")
            || said == CatalogName.Normalize(person.DisplayName)
            || !exact && said.EndsWith(" " + CatalogName.Normalize($"{person.FirstName} {person.LastName}"), StringComparison.Ordinal)).ToList();
        if (full.Count == 1) return full[0];
        var first = proposal.People.Where(person => said == CatalogName.Normalize(person.FirstName)
            || person.PreferredName is not null && said == CatalogName.Normalize(person.PreferredName)).ToList();
        return first.Count == 1 ? first[0] : null;
    }

    private static (string Key, string Name)? Match(string text, IEnumerable<(string Key, string Name)> candidates)
    {
        var said = CatalogName.Normalize(text);
        (string Key, string Name)? best = null;
        var score = 0.0;
        foreach (var candidate in candidates)
        {
            var name = CatalogName.Normalize(candidate.Name);
            var similarity = name == said ? 1 : CompanyImportDerivation.Similarity(said, name);
            if (similarity > score) { score = similarity; best = candidate; }
        }
        return score >= 0.8 ? best : null;
    }

    private static string Title(string text)
    {
        var clean = CatalogName.Clean(text);
        return clean.Length == 0 ? clean : char.ToUpperInvariant(clean[0]) + clean[1..];
    }
}

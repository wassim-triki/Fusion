namespace EY.HRPlatform.CoreHR.Features.CompanyImport;

/// <summary>What the company already has in Fusion, read once per derivation.</summary>
public sealed record CompanyImportSnapshot(
    string CompanyName,
    DateOnly Today,
    Guid? RootUnitId,
    IReadOnlyList<CompanyImportSnapshot.Unit> Units,
    IReadOnlyList<CompanyImportSnapshot.Person> People,
    IReadOnlyList<CompanyImportSnapshot.Named> Jobs,
    IReadOnlyList<CompanyImportSnapshot.Named> Places,
    IReadOnlyList<CompanyImportSnapshot.Named> Levels,
    IReadOnlyList<CompanyImportSnapshot.Named> Families)
{
    public sealed record Unit(Guid Id, string Code, string Name, Guid? ParentId, DateOnly ActiveFrom);
    public sealed record Person(Guid Id, string? Number, string? Email, string Name, DateOnly? AssignedFrom);
    public sealed record Named(Guid Id, string Name);

    public static CompanyImportSnapshot Empty(string companyName, DateOnly today) => new(companyName, today, null, [], [], [], [], [], []);
}

/// <summary>Where a value came from: a file's sheet and row (row 1 is the header).</summary>
public sealed record CompanyImportOrigin(Guid FileId, string FileName, string Sheet, int Row);

public sealed record ProposedUnit(
    string Key, string Name, string? Code, string? Type, string? ParentKey, Guid? ExistingId, string? HeadKey,
    CompanyImportOrigin? Origin, bool Added);

public sealed record ProposedJob(
    string Key, string Title, Guid? ExistingId, string? Level, string? Family, IReadOnlyList<string> Titles, int Count);

public sealed record ProposedPlace(string Key, string Name, Guid? ExistingId, int Count);

/// <summary>A field the person changed in words: what the file said and what Fusion will use.</summary>
public sealed record ProposedFix(string Id, string Field, string? From, string To, string Text);

public sealed record ProposedPerson(
    string Key, string FirstName, string LastName, string? PreferredName, string? Number, string? Email,
    string JobKey, string UnitKey, string? PlaceKey, string? ManagerKey, Guid? ExistingManagerId,
    DateOnly StartDate, bool StartAssumed, CompanyImportOrigin Origin, IReadOnlyList<ProposedFix> Fixes)
{
    public string DisplayName => string.IsNullOrWhiteSpace(PreferredName) ? $"{FirstName} {LastName}" : $"{PreferredName} {LastName}";
}

public sealed record CheckOption(string Key, string Label, string? From, bool Lean);

/// <summary>Something only a person can settle. Kind names the question; Subject is who or what it is about.</summary>
public sealed record ProposedCheck(
    string Key, string Kind, string? Subject, string? Title, string? Detail, IReadOnlyList<CheckOption> Options, string? Answer, int Count = 1);

/// <summary>A column whose header Fusion only half-recognised, or dates that read two ways.</summary>
public sealed record ColumnQuestion(
    string Key, Guid FileId, string Sheet, int Index, string Header, string Kind, string Lean, IReadOnlyList<string> Values, int DistinctCount, string? Answer);

public sealed record LeftOutRows(string Reason, Guid FileId, string FileName, string Sheet, int Count, IReadOnlyList<string> Names);

public sealed record CompanyImportFact(string Kind, int Count, int Of, string? Detail, IReadOnlyList<string> Names);

/// <summary>A sheet with its effective kind and columns after the person's answers.</summary>
public sealed record ReadSheet(
    Guid FileId, string FileName, string Sheet, CompanyImportKind Kind, int Rows,
    IReadOnlyList<ReadColumn> Columns, int PeopleCount, int LeftCount);

public sealed record ReadColumn(int Index, string? Header, string? Field, string State, string? Lean);

public sealed record CompanyImportProposal(
    IReadOnlyList<ReadSheet> Sheets,
    IReadOnlyList<ColumnQuestion> Questions,
    IReadOnlyList<ProposedUnit> Units,
    IReadOnlyList<ProposedJob> Jobs,
    IReadOnlyList<ProposedPlace> Places,
    IReadOnlyList<ProposedPerson> People,
    IReadOnlyList<ProposedCheck> Checks,
    IReadOnlyList<LeftOutRows> LeftOut,
    IReadOnlyList<CompanyImportFact> Facts,
    string RootKey,
    DateOnly UnitsFrom,
    string Fingerprint)
{
    public int OpenCount => Questions.Count(question => question.Answer is null) + Checks.Count(check => check.Answer is null);
    public bool CanBringIn => OpenCount == 0 && (People.Count > 0 || Units.Any(unit => unit.ExistingId is null));
    public int NewUnits => Units.Count(unit => unit.ExistingId is null);
    public int ReportingLines => People.Count(person => person.ManagerKey is not null || person.ExistingManagerId is not null);
}

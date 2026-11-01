namespace EY.HRPlatform.CoreHR.Features.CompanyImport;

/// <summary>What the company already has in Fusion, read once per derivation.</summary>
public sealed record CompanyImportSnapshot(
    string CompanyName,
    DateOnly Today,
    Guid? RootUnitId,
    IReadOnlyList<CompanyImportSnapshot.Unit> Units,
    IReadOnlyList<CompanyImportSnapshot.Person> People,
    IReadOnlyList<CompanyImportSnapshot.Job> Jobs,
    IReadOnlyList<CompanyImportSnapshot.Named> Places,
    IReadOnlyList<CompanyImportSnapshot.Named> Levels,
    IReadOnlyList<CompanyImportSnapshot.Named> Families)
{
    public sealed record Unit(Guid Id, string Code, string Name, Guid? ParentId, DateOnly ActiveFrom);
    /// <summary>A person in Fusion with what they hold today; Employed is false once their employment has ended.</summary>
    public sealed record Person(
        Guid Id, string? Number, string? Email, string Name, DateOnly? AssignedFrom, bool Employed = false, DateOnly? EmployedFrom = null,
        Guid? UnitId = null, Guid? JobId = null, Guid? PlaceId = null, Guid? ManagerId = null, DateOnly? ManagerFrom = null);
    public sealed record Named(Guid Id, string Name);
    public sealed record Job(Guid Id, string Name, Guid? LevelId = null, Guid? FamilyId = null);

    public static CompanyImportSnapshot Empty(string companyName, DateOnly today) => new(companyName, today, null, [], [], [], [], [], []);
}

/// <summary>Where a value came from: a file's sheet and row (row 1 is the header).</summary>
public sealed record CompanyImportOrigin(Guid FileId, string FileName, string Sheet, int Row);

/// <summary>One thing an import changes on something already in Fusion: what Fusion has and what the file says.</summary>
public sealed record ProposedChange(string Field, string? From, string? To);

/// <summary>A unit; an existing one the units file renames or moves carries its changes (Name and ParentKey are the new ones).</summary>
public sealed record ProposedUnit(
    string Key, string Name, string? Code, string? Type, string? ParentKey, Guid? ExistingId, string? HeadKey,
    CompanyImportOrigin? Origin, bool Added, IReadOnlyList<ProposedChange>? Changes = null);

public sealed record ProposedJob(
    string Key, string Title, Guid? ExistingId, string? Level, string? Family, IReadOnlyList<string> Titles, int Count,
    IReadOnlyList<ProposedChange>? Changes = null);

/// <summary>Someone in Fusion the files don't list, whose employment the person chose to end: their last day.</summary>
public sealed record ProposedEnd(Guid EmployeeId, string Name, DateOnly LastDay);

public sealed record ProposedPlace(string Key, string Name, Guid? ExistingId, int Count);

/// <summary>A field the person changed in words: what the file said and what Fusion will use.</summary>
public sealed record ProposedFix(string Id, string Field, string? From, string To, string Text);

public sealed record ProposedPerson(
    string Key, string FirstName, string LastName, string? PreferredName, string? Number, string? Email,
    string JobKey, string UnitKey, string? PlaceKey, string? ManagerKey, Guid? ExistingManagerId,
    DateOnly StartDate, bool StartAssumed, CompanyImportOrigin Origin, IReadOnlyList<ProposedFix> Fixes,
    Guid? ExistingId = null, IReadOnlyList<ProposedChange>? Changes = null)
{
    public bool IsNew => ExistingId is null;
    public bool IsChanged => Changes is { Count: > 0 };

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
    string Fingerprint,
    DateOnly ApplyFrom,
    IReadOnlyList<ProposedEnd> Ends,
    bool Again)
{
    public int OpenCount => Questions.Count(question => question.Answer is null) + Checks.Count(check => check.Answer is null);
    public int NewPeople => People.Count(person => person.IsNew);
    public int ChangedPeople => People.Count(person => person.IsChanged);
    public int UnitChanges => Units.Count(unit => unit.Changes is { Count: > 0 });
    public int JobChanges => Jobs.Count(job => job.Changes is { Count: > 0 });
    public bool CanBringIn => OpenCount == 0
        && (NewPeople > 0 || ChangedPeople > 0 || Ends.Count > 0 || NewUnits > 0 || UnitChanges > 0 || JobChanges > 0);
    public int NewUnits => Units.Count(unit => unit.ExistingId is null);
    public int ReportingLines => People.Count(person => person.ManagerKey is not null || person.ExistingManagerId is not null);
}

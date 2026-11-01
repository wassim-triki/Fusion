namespace EY.HRPlatform.CoreHR.Features.CompanyImport;

/// <summary>`GET /api/corehr/imports/{id}`: the whole import as the screens draw it, from one derivation.</summary>
public sealed record CompanyImportDto(
    Guid Id,
    uint Version,
    string Status,
    string CompanyName,
    DateTime StartedAt,
    string StartedBy,
    IReadOnlyList<CompanyImportFileDto> Files,
    IReadOnlyList<ColumnQuestionDto> Questions,
    IReadOnlyList<CompanyImportFact> Facts,
    CompanyImportChartDto Chart,
    IReadOnlyList<CheckDto> Checks,
    IReadOnlyList<FixDto> Fixes,
    IReadOnlyList<LeftOutDto> LeftOut,
    CompanyImportCountsDto Counts,
    string Fingerprint,
    bool CanBringIn,
    int OpenCount,
    string? LastFailure,
    CompanyImportProgressDto? Progress,
    CompanyImportResultDto? Result,
    IReadOnlyList<WallGroupDto> Wall,
    CompanyImportAgainDto? Again = null,
    CompanyImportStoppedDto? Stopped = null);

/// <summary>
/// Importing again (D-22): who the files add, change and leave out against what's in Fusion, matched by employee
/// number or work email, all dated from ApplyFrom. NotInFile holds the questions about people the files don't list.
/// </summary>
public sealed record CompanyImportAgainDto(
    DateOnly ApplyFrom, string MatchedBy, IReadOnlyList<AgainPersonDto> New, IReadOnlyList<AgainChangeDto> Changed,
    IReadOnlyList<AgainGoneDto> NotInFile, int Unchanged, IReadOnlyList<AgainChangeDto> Units, IReadOnlyList<AgainChangeDto> Jobs);

public sealed record AgainPersonDto(string Key, string Name, string Title, string Unit, string? Manager, DateOnly Start);

/// <summary>Someone or something in Fusion the files change: each change with what Fusion has and what the file says.</summary>
public sealed record AgainChangeDto(string Key, string Name, IReadOnlyList<ProposedChange> Changes);

public sealed record AgainGoneDto(string Key, string Name, string? Detail, string? Answer);

/// <summary>Stopped partway (D-29): what's in, what isn't, and the row Try again starts from.</summary>
public sealed record CompanyImportStoppedDto(int Units, int Jobs, int People, int PeopleLeft, bool LinesLeft, int? Row, string? FileName);

/// <summary>The company's people by department, in the order they're brought in: the bring-in frame fills them in.</summary>
public sealed record WallGroupDto(string Name, int Count, IReadOnlyList<string> People);

/// <summary>A dropped file; Problem says why Fusion can't use it (format, unreadable, empty, tooBig, nothing, noNames, noUnitNames).</summary>
public sealed record CompanyImportFileDto(Guid Id, string Name, string Format, IReadOnlyList<CompanyImportSheetDto> Sheets, string? Problem = null);

public sealed record CompanyImportSheetDto(
    string Name, string Kind, int Rows, int Count, int LeftCount,
    IReadOnlyList<ReadColumn> Columns, IReadOnlyList<SheetRowDto> Preview);

/// <summary>A row of the labelled sheet; Me marks the viewer's own row.</summary>
public sealed record SheetRowDto(int Row, IReadOnlyList<string?> Cells, bool Me);

public sealed record ColumnQuestionDto(
    string Key, Guid FileId, string Sheet, int Index, string Header, string Kind, string Lean,
    IReadOnlyList<string> Values, int DistinctCount, string? Answer);

public sealed record CompanyImportChartDto(
    string RootKey,
    IReadOnlyList<ChartPersonDto> People,
    IReadOnlyList<ChartUnitDto> Units,
    IReadOnlyList<ChartJobDto> Jobs,
    IReadOnlyList<string> Places);

public sealed record ChartPersonDto(
    string Key, string Name, string Initials, string Title, string Unit, string UnitKey, string? Place, string? ManagerKey,
    int DirectCount, int TotalCount, bool You, IReadOnlyList<string> Checks, IReadOnlyList<string> Changed, bool StartAssumed,
    string From);

public sealed record ChartUnitDto(
    string Key, string Name, string? Type, string? ParentKey, bool Existing, bool Added, string? HeadName, int Count, IReadOnlyList<string> Checks);

public sealed record ChartJobDto(string Key, string Title, string? Level, string? Family, IReadOnlyList<string> Titles, int Count, bool Existing, IReadOnlyList<string> Checks);

public sealed record CheckDto(
    string Key, string Kind, string? Subject, string? Title, string? Detail, IReadOnlyList<CheckOption> Options, string? Answer, int Count);

public sealed record FixDto(string Id, string PersonKey, string PersonName, string Field, string? From, string To, string Text);

public sealed record LeftOutDto(string Kind, string? FileName, string? Sheet, string? What, int Count, IReadOnlyList<string> Names);

public sealed record CompanyImportCountsDto(
    int People, int Units, int NewUnits, int Jobs, int Places, int ReportingLines, int NewPeople = 0, int Changed = 0, int Ending = 0);

/// <summary>Bringing in, as it happens: what's created so far.</summary>
public sealed record CompanyImportProgressDto(string Phase, int Units, int Jobs, int People, int ReportingLines);

public sealed record CompanyImportResultDto(
    DateTime BroughtInAt, string BroughtInBy, int People, int Units, int Jobs, int Places, int ReportingLines,
    IReadOnlyList<string> FileNames, int Decided, IReadOnlyList<string> DecidedNames, int MissingEmail, int MissingPlace, int Changed, int Ended);

public sealed record CompanyImportActiveDto(Guid? Id);

public sealed record SetColumnRequest(Guid FileId, string Sheet, int Index, string? Field);
public sealed record AnswerRequest(string Key, string? Value);
public sealed record SayRequest(string Text);
public sealed record AddFixRequest(string PersonKey, string Field, string Value, string Text);
public sealed record BringInRequest(string Fingerprint);

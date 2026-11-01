namespace EY.HRPlatform.CoreHR.Features.CompanyImport;

/// <summary>The import as the screens draw it: the labelled sheets, the chart's three views, the checks and fixes.</summary>
public static class CompanyImportView
{
    private const int PreviewRows = 3;

    public static CompanyImportDto Build(CompanyImportSession session, CompanyImportProposal proposal, string? viewerEmail, CompanyImportProgressDto? progress)
    {
        var viewer = viewerEmail?.Trim().ToLowerInvariant();
        var sourceByKey = session.Sources.ToDictionary(source => (source.FileId, source.SheetName));
        var files = proposal.Sheets.GroupBy(sheet => sheet.FileId).Select(group =>
        {
            var first = sourceByKey[(group.Key, group.First().Sheet)];
            return new CompanyImportFileDto(group.Key, first.FileName, first.Format, group.Select(sheet =>
            {
                var rows = sourceByKey[(sheet.FileId, sheet.Sheet)].Rows;
                var emailColumn = sheet.Columns.FirstOrDefault(column => column.Field == CompanyImportFields.WorkEmail)?.Index;
                var preview = rows.Take(PreviewRows).Select((cells, i) => new SheetRowDto(i + 2, cells, IsViewer(cells, emailColumn, viewer))).ToList();
                var mine = viewer is null || emailColumn is null ? -1 : rows.ToList().FindIndex(cells => IsViewer(cells, emailColumn, viewer));
                if (mine >= PreviewRows) preview[^1] = new SheetRowDto(mine + 2, rows[mine], true);
                return new CompanyImportSheetDto(sheet.Sheet, sheet.Kind.ToString(), sheet.Rows, sheet.PeopleCount, sheet.LeftCount, sheet.Columns, preview);
            }).ToList());
        }).ToList();

        var checksBySubject = proposal.Checks.Where(check => check.Subject is not null && check.Answer is null)
            .GroupBy(check => check.Subject!).ToDictionary(group => group.Key, group => group.Select(check => check.Key).ToList());
        var byManager = proposal.People.Where(person => person.ManagerKey is not null).GroupBy(person => person.ManagerKey!)
            .ToDictionary(group => group.Key, group => group.Select(person => person.Key).ToList());
        var totals = new Dictionary<string, int>(StringComparer.Ordinal);
        int Total(string key, int depth = 0)
        {
            if (totals.TryGetValue(key, out var known)) return known;
            if (depth > 64) return 0;
            var count = (byManager.GetValueOrDefault(key) ?? []).Sum(report => 1 + Total(report, depth + 1));
            totals[key] = count;
            return count;
        }
        var unitName = proposal.Units.ToDictionary(unit => unit.Key, unit => unit.Name);
        var jobTitle = proposal.Jobs.ToDictionary(job => job.Key, job => job.Title);
        var placeName = proposal.Places.ToDictionary(place => place.Key, place => place.Name);
        var people = proposal.People.Select(person => new ChartPersonDto(
            person.Key, person.DisplayName, Initials(person), jobTitle[person.JobKey], unitName[person.UnitKey], person.UnitKey,
            person.PlaceKey is null ? null : placeName[person.PlaceKey], person.ManagerKey,
            byManager.GetValueOrDefault(person.Key)?.Count ?? 0, Total(person.Key),
            viewer is not null && person.Email == viewer, checksBySubject.GetValueOrDefault(person.Key) ?? [],
            person.Fixes.Select(fix => fix.Field).ToList(), person.StartAssumed,
            $"{person.Origin.FileName} · {person.Origin.Row}")).ToList();
        var inUnit = proposal.People.GroupBy(person => person.UnitKey).ToDictionary(group => group.Key, group => group.Count());
        var heads = proposal.People.ToDictionary(person => person.Key, person => person.DisplayName);
        var units = proposal.Units.Select(unit => new ChartUnitDto(unit.Key, unit.Name, unit.Type, unit.ParentKey, unit.ExistingId is not null, unit.Added,
            unit.HeadKey is null ? null : heads.GetValueOrDefault(unit.HeadKey), inUnit.GetValueOrDefault(unit.Key),
            proposal.Checks.Where(check => check.Answer is null && check.Subject == unit.Key).Select(check => check.Key).ToList())).ToList();
        var jobs = proposal.Jobs.Select(job => new ChartJobDto(job.Key, job.Title, job.Level, job.Family, job.Titles, job.Count, job.ExistingId is not null,
            proposal.Checks.Where(check => check.Kind == "sameJob" && check.Answer is null && check.Key == $"job|{CompanyImportDerivation.Loose(job.Titles[0])}")
                .Select(check => check.Key).ToList())).ToList();
        var fixes = proposal.People.SelectMany(person => person.Fixes.Select(fix =>
            new FixDto(fix.Id, person.Key, person.DisplayName, fix.Field, fix.From, fix.To, fix.Text))).ToList();

        var leftOut = LeftOut(proposal);

        return new CompanyImportDto(session.Id, session.Version, session.Status.ToString(), session.CompanyName, session.CreatedAt, session.StartedByDisplayName,
            files,
            proposal.Questions.Select(question => new ColumnQuestionDto(question.Key, question.FileId, question.Sheet, question.Index, question.Header,
                question.Kind, question.Lean, question.Values, question.DistinctCount, question.Answer)).ToList(),
            proposal.Facts,
            new CompanyImportChartDto(proposal.RootKey, people, units, jobs, proposal.Places.Select(place => place.Name).ToList()),
            proposal.Checks.Select(check => new CheckDto(check.Key, check.Kind, check.Subject, check.Title, check.Detail, check.Options, check.Answer, check.Count)).ToList(),
            fixes, leftOut,
            new CompanyImportCountsDto(proposal.People.Count, proposal.Units.Count, proposal.NewUnits, proposal.Jobs.Count, proposal.Places.Count, proposal.ReportingLines),
            proposal.Fingerprint, proposal.CanBringIn && session.Status == CompanyImportStatus.Open, proposal.OpenCount, session.LastFailure, progress, null,
            Wall(proposal));
    }

    /// <summary>Everything not brought in, with its reason: rows, sheets Fusion couldn't place, columns left out.</summary>
    public static IReadOnlyList<LeftOutDto> LeftOut(CompanyImportProposal proposal)
    {
        var leftOut = proposal.LeftOut.Select(item => new LeftOutDto(item.Reason, Blank(item.FileName), Blank(item.Sheet), null, item.Count, item.Names)).ToList();
        foreach (var sheet in proposal.Sheets)
        {
            if (sheet.Kind == CompanyImportKind.Unknown)
                leftOut.Add(new LeftOutDto("sheet", sheet.FileName, sheet.Sheet, null, sheet.Rows, []));
            else
                foreach (var column in sheet.Columns.Where(column => column.State == "out"))
                    leftOut.Add(new LeftOutDto("column", sheet.FileName, sheet.Sheet, column.Header, 1, []));
        }
        return leftOut;
    }

    public static IReadOnlyList<ProposedPerson> InWallOrder(CompanyImportProposal proposal)
    {
        var group = WallGroupOf(proposal);
        var order = proposal.People.Select(person => group(person.UnitKey)).Distinct().Select((key, i) => (key, i)).ToDictionary(x => x.key, x => x.i);
        return proposal.People.OrderBy(person => order[group(person.UnitKey)]).ToList();
    }

    private static Func<string, string> WallGroupOf(CompanyImportProposal proposal)
    {
        var parent = proposal.Units.ToDictionary(unit => unit.Key, unit => unit.ParentKey);
        return unitKey =>
        {
            var at = unitKey;
            for (var depth = 0; depth < 64 && parent.GetValueOrDefault(at) is { } up && up != proposal.RootKey && parent.ContainsKey(up); depth++) at = up;
            return at;
        };
    }

    private const int WallFaces = 36;

    /// <summary>People grouped under the unit just below the top, in bring-in order; a group shows its first faces.</summary>
    public static IReadOnlyList<WallGroupDto> Wall(CompanyImportProposal proposal)
    {
        var name = proposal.Units.ToDictionary(unit => unit.Key, unit => unit.Name);
        var group = WallGroupOf(proposal);
        return proposal.People.GroupBy(person => group(person.UnitKey))
            .Select(group => new WallGroupDto(name.GetValueOrDefault(group.Key) ?? group.Key, group.Count(), group.Take(WallFaces).Select(person => person.DisplayName).ToList()))
            .ToList();
    }

    /// <summary>A finished or discarded import: its files and what it brought in; the cells are gone.</summary>
    public static CompanyImportDto Closed(CompanyImportSession session)
    {
        var stored = CompanyImportJson.Read<CompanyImportResult>(session.ResultJson);
        var files = session.Sources.GroupBy(source => source.FileId).Select(group => new CompanyImportFileDto(group.Key, group.First().FileName, group.First().Format,
            group.Select(source => new CompanyImportSheetDto(source.SheetName, source.Kind.ToString(), source.RowCount, source.RowCount, 0, [], [])).ToList())).ToList();
        var result = stored is null || session.BroughtInAt is null ? null : new CompanyImportResultDto(session.BroughtInAt.Value, stored.BroughtInBy,
            stored.People, stored.Units, stored.Jobs, stored.Places, stored.ReportingLines, stored.FileNames, stored.Decided, stored.DecidedNames,
            stored.MissingEmail, stored.MissingPlace);
        return new CompanyImportDto(session.Id, session.Version, session.Status.ToString(), session.CompanyName, session.CreatedAt, session.StartedByDisplayName,
            files, [], [], new CompanyImportChartDto(string.Empty, [], [], [], []), [], [], stored?.LeftOut ?? [],
            new CompanyImportCountsDto(stored?.People ?? 0, stored?.Units ?? 0, stored?.Units ?? 0, stored?.Jobs ?? 0, stored?.Places ?? 0, stored?.ReportingLines ?? 0),
            string.Empty, false, 0, null, null, result, stored?.Wall ?? []);
    }

    private static bool IsViewer(IReadOnlyList<string?> cells, int? emailColumn, string? viewer)
        => viewer is not null && emailColumn is { } index && string.Equals(CompanyImportReader.Cell(cells, index)?.Trim(), viewer, StringComparison.OrdinalIgnoreCase);

    private static string Initials(ProposedPerson person)
        => $"{char.ToUpperInvariant((person.PreferredName ?? person.FirstName)[0])}{char.ToUpperInvariant(person.LastName[0])}";

    private static string? Blank(string value) => value.Length == 0 ? null : value;
}

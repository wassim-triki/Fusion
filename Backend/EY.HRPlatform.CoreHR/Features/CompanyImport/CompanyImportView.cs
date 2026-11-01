namespace EY.HRPlatform.CoreHR.Features.CompanyImport;

/// <summary>The import as the screens draw it: the labelled sheets, the chart's three views, the checks and fixes.</summary>
public static class CompanyImportView
{
    private const int PreviewRows = 3;

    public static CompanyImportDto Build(CompanyImportSession session, CompanyImportProposal proposal, string? viewerEmail, CompanyImportProgressDto? progress)
    {
        var viewer = viewerEmail?.Trim().ToLowerInvariant();
        var sourceByKey = session.Sources.Where(source => source.Problem is null).ToDictionary(source => (source.FileId, source.SheetName));
        var files = proposal.Sheets.GroupBy(sheet => sheet.FileId).Select(group =>
        {
            var first = sourceByKey[(group.Key, group.First().Sheet)];
            return (first.Order, File: new CompanyImportFileDto(group.Key, first.FileName, first.Format, group.Select(sheet =>
            {
                var rows = sourceByKey[(sheet.FileId, sheet.Sheet)].Rows;
                var emailColumn = sheet.Columns.FirstOrDefault(column => column.Field == CompanyImportFields.WorkEmail)?.Index;
                var preview = rows.Take(PreviewRows).Select((cells, i) => new SheetRowDto(i + 2, cells, IsViewer(cells, emailColumn, viewer))).ToList();
                var mine = viewer is null || emailColumn is null ? -1 : rows.ToList().FindIndex(cells => IsViewer(cells, emailColumn, viewer));
                if (mine >= PreviewRows) preview[^1] = new SheetRowDto(mine + 2, rows[mine], true);
                return new CompanyImportSheetDto(sheet.Sheet, sheet.Kind.ToString(), sheet.Rows, sheet.PeopleCount, sheet.LeftCount, sheet.Columns, preview);
            }).ToList(), Problem(group.ToList())));
        })
            .Concat(session.Sources.Where(source => source.Problem is not null)
                .Select(source => (source.Order, File: new CompanyImportFileDto(source.FileId, source.FileName, source.Format, [], source.Problem))))
            .OrderBy(item => item.Order).Select(item => item.File).ToList();

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
            new CompanyImportCountsDto(proposal.People.Count, proposal.Units.Count, proposal.NewUnits, proposal.Jobs.Count, proposal.Places.Count, proposal.ReportingLines,
                proposal.NewPeople, proposal.ChangedPeople, proposal.Ends.Count),
            proposal.Fingerprint, proposal.CanBringIn && session.Status == CompanyImportStatus.Open, proposal.OpenCount, session.LastFailure, progress, null,
            Wall(proposal), proposal.Again ? Again(proposal, jobTitle, unitName) : null);
    }

    /// <summary>Why a file that read gives nothing: no sheet of people or units, or the column that names them is missing.</summary>
    private static string? Problem(IReadOnlyList<ReadSheet> sheets)
    {
        if (sheets.All(sheet => sheet.Kind == CompanyImportKind.Unknown)) return "nothing";
        bool Has(ReadSheet sheet, params string[] fields) => sheet.Columns.Any(column => column.Field is { } field && fields.Contains(field));
        if (sheets.Any(sheet => sheet.Kind == CompanyImportKind.People && !Has(sheet, CompanyImportFields.FirstName, CompanyImportFields.LastName, CompanyImportFields.FullName)
                && !sheet.Columns.Any(column => column.State == "ask")))
            return "noNames";
        if (sheets.Any(sheet => sheet.Kind == CompanyImportKind.Units && !Has(sheet, CompanyImportFields.UnitName) && !sheet.Columns.Any(column => column.State == "ask")))
            return "noUnitNames";
        return null;
    }

    private static CompanyImportAgainDto Again(CompanyImportProposal proposal, Dictionary<string, string> jobTitle, Dictionary<string, string> unitName)
    {
        var name = proposal.People.ToDictionary(person => person.Key, person => person.DisplayName);
        return new CompanyImportAgainDto(proposal.ApplyFrom, proposal.Facts.FirstOrDefault(fact => fact.Kind == "matched")?.Detail ?? "number",
            proposal.People.Where(person => person.IsNew).Select(person => new AgainPersonDto(person.Key, person.DisplayName, jobTitle[person.JobKey],
                unitName[person.UnitKey], person.ManagerKey is null ? null : name.GetValueOrDefault(person.ManagerKey), person.StartDate)).ToList(),
            proposal.People.Where(person => person.IsChanged).Select(person => new AgainChangeDto(person.Key, person.DisplayName, person.Changes!)).ToList(),
            proposal.Checks.Where(check => check.Kind == "notInFile").Select(check => new AgainGoneDto(check.Key, check.Title ?? string.Empty, check.Detail, check.Answer)).ToList(),
            proposal.People.Count(person => !person.IsNew && !person.IsChanged),
            proposal.Units.Where(unit => unit.Changes is not null).Select(unit => new AgainChangeDto(unit.Key, unit.Name, unit.Changes!)).ToList(),
            proposal.Jobs.Where(job => job.Changes is not null).Select(job => new AgainChangeDto(job.Key, job.Title, job.Changes!)).ToList());
    }

    /// <summary>
    /// Bringing in once the first batch froze the plan, and Stopped partway: drawn from the plan and the run record,
    /// never from the files again (part of them is already in Fusion).
    /// </summary>
    public static CompanyImportDto Running(CompanyImportSession session)
    {
        var plan = CompanyImportJson.Read<CompanyImportPlan>(session.PlanJson)!;
        var run = CompanyImportJson.Read<CompanyImportRun>(session.RunJson) ?? new CompanyImportRun();
        var phase = !run.UnitChangesDone ? "units" : run.PeopleDone < plan.People.Count ? "people" : run.LinesDone < plan.Lines.Count ? "lines" : "saving";
        var progress = new CompanyImportProgressDto(phase, plan.Counts.NewUnits, plan.Counts.Jobs, run.PeopleDone, run.LinesDone);
        var next = plan.People.ElementAtOrDefault(run.PeopleDone);
        var stopped = session.Status == CompanyImportStatus.Stopped
            ? new CompanyImportStoppedDto(plan.Result.Units, plan.Result.Jobs, run.PeopleDone, plan.People.Count - run.PeopleDone,
                run.LinesDone < plan.Lines.Count, next?.Row, next?.FileName)
            : null;
        return new CompanyImportDto(session.Id, session.Version, session.Status.ToString(), session.CompanyName, session.CreatedAt, session.StartedByDisplayName,
            ClosedFiles(session), [], [], new CompanyImportChartDto(string.Empty, [], [], [], []), [], [], plan.Result.LeftOut, plan.Counts,
            session.RequestedFingerprint ?? string.Empty, false, 0, session.LastFailure, progress, null, plan.Result.Wall, null, stopped);
    }

    private static List<CompanyImportFileDto> ClosedFiles(CompanyImportSession session)
        => session.Sources.GroupBy(source => source.FileId).Select(group => new CompanyImportFileDto(group.Key, group.First().FileName, group.First().Format,
            group.Where(source => source.Problem is null).Select(source => new CompanyImportSheetDto(source.SheetName, source.Kind.ToString(), source.RowCount,
                source.RowCount, 0, [], [])).ToList(), group.First().Problem)).ToList();

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
        var files = ClosedFiles(session);
        var result = stored is null || session.BroughtInAt is null ? null : new CompanyImportResultDto(session.BroughtInAt.Value, stored.BroughtInBy,
            stored.People, stored.Units, stored.Jobs, stored.Places, stored.ReportingLines, stored.FileNames, stored.Decided, stored.DecidedNames,
            stored.MissingEmail, stored.MissingPlace, stored.Changed, stored.Ended);
        return new CompanyImportDto(session.Id, session.Version, session.Status.ToString(), session.CompanyName, session.CreatedAt, session.StartedByDisplayName,
            files, [], [], new CompanyImportChartDto(string.Empty, [], [], [], []), [], [], stored?.LeftOut ?? [],
            new CompanyImportCountsDto(stored?.People ?? 0, stored?.Units ?? 0, stored?.Units ?? 0, stored?.Jobs ?? 0, stored?.Places ?? 0, stored?.ReportingLines ?? 0,
                stored?.People ?? 0, stored?.Changed ?? 0, stored?.Ended ?? 0),
            string.Empty, false, 0, null, null, result, stored?.Wall ?? []);
    }

    private static bool IsViewer(IReadOnlyList<string?> cells, int? emailColumn, string? viewer)
        => viewer is not null && emailColumn is { } index && string.Equals(CompanyImportReader.Cell(cells, index)?.Trim(), viewer, StringComparison.OrdinalIgnoreCase);

    private static string Initials(ProposedPerson person)
        => $"{char.ToUpperInvariant((person.PreferredName ?? person.FirstName)[0])}{char.ToUpperInvariant(person.LastName[0])}";

    private static string? Blank(string value) => value.Length == 0 ? null : value;
}

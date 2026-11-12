using System.Globalization;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Infrastructure.Imports;
using EY.HRPlatform.SharedKernel.Imports;
using F = EY.HRPlatform.CoreHR.Features.CompanyImport.CompanyImportFields;

namespace EY.HRPlatform.CoreHR.Features.CompanyImport;

/// <summary>A source sheet as the derivation reads it.</summary>
public sealed record CompanyImportSheetInput(
    Guid FileId, string FileName, string Sheet, int Order, CompanyImportKind Kind,
    IReadOnlyList<CompanyImportColumnReading> Readings, IReadOnlyList<IReadOnlyList<string?>> Rows);

/// <summary>
/// Turns the files and the person's answers into one proposal, against what the company already has: units, jobs,
/// places and people resolved against each other across every file (D-23). Deterministic and pure, so the worker
/// derives it again inside the write transaction and brings in only the proposal whose fingerprint was reviewed.
/// Nothing is dropped silently: whatever isn't brought in is listed with its reason.
/// </summary>
public static class CompanyImportDerivation
{
    public const string RootAddedKey = "u:+root";
    public const string NoTitleJob = "Employee";
    /// <summary>The answer that dates an import's changes: they apply from this day (today unless the person says).</summary>
    public const string ApplyFromKey = "applyFrom";
    public const string NoManagersKey = "noManagers";

    public static CompanyImportProposal Derive(
        IReadOnlyList<CompanyImportSheetInput> inputs, CompanyImportDecisions decisions, CompanyImportSnapshot snapshot)
    {
        var context = new Context(decisions, snapshot);
        var sheets = inputs.OrderBy(input => input.Order).ThenBy(input => input.Sheet, StringComparer.Ordinal).Select(context.Effective).ToList();
        context.ReadUnits(sheets.Where(sheet => sheet.Kind == CompanyImportKind.Units));
        context.ReadPeople(sheets.Where(sheet => sheet.Kind == CompanyImportKind.People));
        context.ResolveUnits();
        context.ResolvePeople();
        return context.Result(sheets);
    }

    private sealed class EffectiveSheet(CompanyImportSheetInput input, CompanyImportKind kind, Dictionary<string, int> columns)
    {
        public CompanyImportSheetInput Input { get; } = input;
        public CompanyImportKind Kind { get; } = kind;
        public Dictionary<string, int> Columns { get; } = columns;
        /// <summary>How slashed dates read: day first unless the values or the person say month first.</summary>
        public string DateOrder { get; set; } = "dmy";
        public List<ReadColumn> Read { get; } = [];
        public int PeopleCount { get; set; }
        public int LeftCount { get; set; }

        public string? Value(IReadOnlyList<string?> row, string field)
            => Columns.TryGetValue(field, out var index) ? Clean(CompanyImportReader.Cell(row, index)) : null;

        public CompanyImportOrigin Origin(int rowIndex) => new(Input.FileId, Input.FileName, Input.Sheet, rowIndex + 2);
    }

    private sealed record UnitRow(string Name, string? Code, string? ParentRef, string? Type, string? HeadRef, CompanyImportOrigin Origin);

    private sealed class PersonRow
    {
        public required CompanyImportOrigin Origin { get; init; }
        public required EffectiveSheet Sheet { get; init; }
        public string First { get; set; } = string.Empty;
        public string Last { get; set; } = string.Empty;
        public string? Preferred { get; set; }
        public string? Number { get; set; }
        public string? PersonId { get; set; }
        public string? Email { get; set; }
        /// <summary>The person already in Fusion this row is, matched by employee number or work email.</summary>
        public CompanyImportSnapshot.Person? Existing { get; set; }
        public Dictionary<string, (string Value, CompanyImportOrigin Origin)> Values { get; } = new(StringComparer.Ordinal);
        public string Key => Number is not null ? $"p:n:{Number}" : Email is not null ? $"p:e:{Email}" : PersonId is not null ? $"p:i:{PersonId}" : $"p:r:{Origin.FileId:N}:{Origin.Sheet}:{Origin.Row}";
        public string FullName => $"{First} {Last}";
    }

    private sealed class Context(CompanyImportDecisions decisions, CompanyImportSnapshot snapshot)
    {
        private readonly List<ColumnQuestion> questions = [];
        private readonly List<ProposedCheck> checks = [];
        private readonly List<LeftOutRows> leftOut = [];
        private readonly List<CompanyImportFact> facts = [];
        private readonly List<UnitRow> unitRows = [];
        private readonly List<PersonRow> personRows = [];
        private readonly Dictionary<string, ProposedUnit> units = new(StringComparer.Ordinal);
        private readonly List<ProposedPerson> people = [];
        private readonly List<ProposedJob> jobs = [];
        private readonly List<ProposedPlace> places = [];
        private string rootKey = RootAddedKey;
        private bool unitsFromFiles;
        private string? unitsFileName;
        private readonly List<ProposedEnd> ends = [];
        private bool again;
        private bool peopleSheets;
        private bool managerColumn;
        private readonly DateOnly applyFrom = decisions.Answers.TryGetValue(ApplyFromKey, out var said)
            && DateOnly.TryParseExact(said, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) ? date : snapshot.Today;

        // ---------- sheets and columns ----------

        public EffectiveSheet Effective(CompanyImportSheetInput input)
        {
            var kindKey = $"kind|{input.FileId:N}|{input.Sheet}";
            var kind = decisions.Answers.TryGetValue(kindKey, out var said) && Enum.TryParse<CompanyImportKind>(said, out var parsed) ? parsed : input.Kind;
            var readings = kind == input.Kind
                ? input.Readings
                : CompanyImportReader.ReadByRules(kind, new TabularSourceTable(
                    input.Readings.Select(reading => new TabularSourceColumn(reading.Index, reading.Header)).ToList(), input.Rows), out _);

            var columns = new Dictionary<string, int>(StringComparer.Ordinal);
            var sheet = new EffectiveSheet(input, kind, columns);
            var read = new List<ReadColumn>();
            foreach (var reading in readings)
            {
                var columnKey = CompanyImportDecisions.ColumnKey(input.FileId, input.Sheet, reading.Index);
                string? field;
                string state;
                if (decisions.Columns.TryGetValue(columnKey, out var chosen))
                {
                    field = chosen == F.Out ? null : chosen;
                    state = field is null ? "out" : "person";
                }
                else if (reading.Origin == CompanyImportReadingOrigin.Weak && kind != CompanyImportKind.Unknown)
                {
                    var values = Distinct(input.Rows, reading.Index);
                    questions.Add(new ColumnQuestion(columnKey, input.FileId, input.Sheet, reading.Index, reading.Header ?? string.Empty,
                        "field", reading.Field!, values.Take(8).ToList(), values.Count, null));
                    field = null;
                    state = "ask";
                }
                else
                {
                    field = reading.Field == F.Out ? null : reading.Field;
                    state = reading.Origin switch
                    {
                        CompanyImportReadingOrigin.Empty => "empty",
                        _ when field is null => "out",
                        CompanyImportReadingOrigin.Ai => "ai",
                        _ => "rules",
                    };
                }
                // A field the person gave to two columns keeps the first.
                if (field is not null && !columns.TryAdd(field, reading.Index)) { field = null; state = "out"; }
                read.Add(new ReadColumn(reading.Index, reading.Header, field, state, reading.Origin == CompanyImportReadingOrigin.Weak ? reading.Field : null));
            }
            sheet.Read.AddRange(read);
            ReadDateOrder(sheet);
            return sheet;
        }

        private void ReadDateOrder(EffectiveSheet sheet)
        {
            foreach (var field in new[] { F.StartDate, F.EndDate })
            {
                if (!sheet.Columns.TryGetValue(field, out var index)) continue;
                var values = sheet.Input.Rows.Select(row => Clean(CompanyImportReader.Cell(row, index))).OfType<string>().ToList();
                var order = DateEvidence(values);
                if (order is not null) { sheet.DateOrder = order; return; }
                var key = $"dates|{sheet.Input.FileId:N}|{sheet.Input.Sheet}";
                if (values.Any(value => value.Contains('/') || value.Contains('.')) && !questions.Any(question => question.Key == key))
                {
                    decisions.Answers.TryGetValue(key, out var answer);
                    var header = sheet.Read.First(column => column.Index == index).Header ?? string.Empty;
                    questions.Add(new ColumnQuestion(key, sheet.Input.FileId, sheet.Input.Sheet, index, header, "dates", "dmy",
                        values.Take(3).ToList(), values.Count, answer));
                    if (answer is "dmy" or "mdy") sheet.DateOrder = answer;
                    return;
                }
            }
        }

        // ---------- units ----------

        public void ReadUnits(IEnumerable<EffectiveSheet> sheets)
        {
            foreach (var sheet in sheets)
            {
                unitsFromFiles = true;
                unitsFileName ??= sheet.Input.FileName;
                var nameless = 0;
                for (var i = 0; i < sheet.Input.Rows.Count; i++)
                {
                    var row = sheet.Input.Rows[i];
                    var name = sheet.Value(row, F.UnitName);
                    if (name is null) { nameless++; continue; }
                    unitRows.Add(new UnitRow(name, sheet.Value(row, F.UnitCode), sheet.Value(row, F.ParentUnit),
                        sheet.Value(row, F.UnitType), sheet.Value(row, F.UnitHead), sheet.Origin(i)));
                }
                sheet.PeopleCount = sheet.Input.Rows.Count - nameless;
                if (nameless > 0)
                {
                    sheet.LeftCount = nameless;
                    leftOut.Add(new LeftOutRows("unitNoName", sheet.Input.FileId, sheet.Input.FileName, sheet.Input.Sheet, nameless, []));
                }
            }
        }

        public void ResolveUnits()
        {
            var existingByCode = snapshot.Units.GroupBy(unit => unit.Code.ToUpperInvariant()).ToDictionary(group => group.Key, group => group.First());
            var existingByName = snapshot.Units.GroupBy(unit => CatalogName.Normalize(unit.Name)).ToDictionary(group => group.Key, group => group.First());
            foreach (var unit in snapshot.Units)
                units[$"x:{unit.Id:N}"] = new ProposedUnit($"x:{unit.Id:N}", unit.Name, unit.Code, null,
                    unit.ParentId is { } parent ? $"x:{parent:N}" : null, unit.Id, null, null, false);
            if (snapshot.RootUnitId is { } root) rootKey = $"x:{root:N}";

            // Rows to proposed units: one per code (or name), the first row wins and later duplicates are listed.
            var byRef = new Dictionary<string, string>(StringComparer.Ordinal);
            var rows = new List<(UnitRow Row, string Key)>();
            var duplicates = 0;
            foreach (var row in unitRows)
            {
                var existing = row.Code is not null && existingByCode.TryGetValue(row.Code.ToUpperInvariant(), out var byCode) ? byCode
                    : existingByName.GetValueOrDefault(CatalogName.Normalize(row.Name));
                var key = existing is not null ? $"x:{existing.Id:N}" : $"u:{(row.Code ?? row.Name).ToUpperInvariant()}";
                if (rows.Any(item => item.Key == key)) { duplicates++; continue; }
                rows.Add((row, key));
                if (row.Code is not null) byRef.TryAdd($"c:{row.Code.ToUpperInvariant()}", key);
                byRef.TryAdd($"n:{CatalogName.Normalize(row.Name)}", key);
            }
            if (duplicates > 0) facts.Add(new CompanyImportFact("unitDuplicates", duplicates, unitRows.Count, null, []));

            string? Find(string reference)
                => byRef.GetValueOrDefault($"c:{reference.ToUpperInvariant()}")
                    ?? byRef.GetValueOrDefault($"n:{CatalogName.Normalize(reference)}")
                    ?? (existingByCode.TryGetValue(reference.ToUpperInvariant(), out var code) ? $"x:{code.Id:N}" : null)
                    ?? (existingByName.TryGetValue(CatalogName.Normalize(reference), out var named) ? $"x:{named.Id:N}" : null);

            var parentless = new List<string>();
            foreach (var (row, key) in rows)
            {
                if (key.StartsWith("x:", StringComparison.Ordinal))
                {
                    UpdateUnit(row, key, rows, Find);
                    continue;
                }
                string? parent = null;
                if (row.ParentRef is not null)
                {
                    parent = Find(row.ParentRef);
                    if (parent is null)
                    {
                        var checkKey = $"parent|{key}";
                        var answer = decisions.Answers.GetValueOrDefault(checkKey);
                        var closest = Closest(row.ParentRef, rows.Select(item => (item.Key, item.Row.Name)));
                        var options = new List<CheckOption>();
                        if (closest is not null) options.Add(new(closest.Value.Key, closest.Value.Name, "closest", true));
                        options.Add(new("root", "root", null, closest is null));
                        checks.Add(new ProposedCheck(checkKey, "unitParent", key, row.Name, row.ParentRef, options, answer));
                        parent = answer is null or "root" ? null : answer;
                    }
                }
                if (parent == key) parent = null;
                if (parent is null) parentless.Add(key);
                units[key] = new ProposedUnit(key, row.Name, row.Code, row.Type, parent, null, null, row.Origin, false);
            }

            // One top: the company's own, the file's only parentless unit, or one Fusion adds above them.
            if (snapshot.RootUnitId is null)
            {
                if (parentless.Count == 1)
                {
                    rootKey = parentless[0];
                    parentless.Clear();
                }
                else if (parentless.Count > 1 || unitRows.Count == 0)
                {
                    units[RootAddedKey] = new ProposedUnit(RootAddedKey, snapshot.CompanyName, null, null, null, null, null, null, true);
                    if (parentless.Count > 1) facts.Add(new CompanyImportFact("rootAdded", parentless.Count, 0, snapshot.CompanyName, []));
                }
            }
            foreach (var key in parentless) units[key] = units[key] with { ParentKey = rootKey };
            BreakUnitLoops();
            unitHeadRefs = rows.Where(item => item.Row.HeadRef is not null).ToDictionary(item => item.Key, item => item.Row.HeadRef!);
            unitFind = Find;
        }

        /// <summary>A unit already in Fusion that the units file names differently or puts under another parent.</summary>
        private void UpdateUnit(UnitRow row, string key, List<(UnitRow Row, string Key)> rows, Func<string, string?> find)
        {
            var had = units[key];
            var changes = new List<ProposedChange>();
            var name = had.Name;
            if (!string.Equals(CatalogName.Normalize(row.Name), CatalogName.Normalize(had.Name), StringComparison.Ordinal))
            {
                changes.Add(new ProposedChange("name", had.Name, row.Name));
                name = row.Name;
            }
            var parent = had.ParentKey;
            if (row.ParentRef is not null && find(row.ParentRef) is { } found && found != key && found != had.ParentKey && had.ParentKey is not null)
            {
                string NameOf(string? unitKey) => rows.FirstOrDefault(item => item.Key == unitKey).Row?.Name ?? (unitKey is null ? null : units.GetValueOrDefault(unitKey)?.Name) ?? string.Empty;
                changes.Add(new ProposedChange("parent", NameOf(had.ParentKey), NameOf(found)));
                parent = found;
            }
            if (changes.Count > 0) units[key] = had with { Name = name, ParentKey = parent, Origin = row.Origin, Changes = changes };
        }

        private Dictionary<string, string> unitHeadRefs = [];
        private Func<string, string?> unitFind = _ => null;

        private void BreakUnitLoops()
        {
            foreach (var unit in units.Values.ToList())
            {
                var seen = new HashSet<string>(StringComparer.Ordinal);
                var at = unit.Key;
                while (units.TryGetValue(at, out var current) && current.ParentKey is { } parent)
                {
                    if (!seen.Add(at)) break;
                    if (parent == unit.Key)
                    {
                        units[unit.Key] = unit with { ParentKey = rootKey == unit.Key ? null : rootKey };
                        facts.Add(new CompanyImportFact("unitLoop", 1, 0, unit.Name, [unit.Name]));
                        break;
                    }
                    at = parent;
                }
            }
        }

        // ---------- people ----------

        public void ReadPeople(IEnumerable<EffectiveSheet> sheets)
        {
            foreach (var sheet in sheets)
            {
                peopleSheets = true;
                managerColumn |= sheet.Columns.ContainsKey(F.Manager);
                var nameless = 0;
                var oneName = new List<string>();
                var left = new List<string>();
                for (var i = 0; i < sheet.Input.Rows.Count; i++)
                {
                    var row = sheet.Input.Rows[i];
                    var (first, last) = Names(sheet.Value(row, F.FirstName), sheet.Value(row, F.LastName), sheet.Value(row, F.FullName));
                    if (first is null && last is null) { nameless++; continue; }
                    if (first is null || last is null) { oneName.Add(first ?? last!); continue; }
                    var end = ParseDate(sheet.Value(row, F.EndDate), sheet.DateOrder);
                    if (IsFormer(sheet.Value(row, F.Status)) || end is { } ended && ended <= snapshot.Today)
                    {
                        left.Add($"{first} {last}");
                        continue;
                    }
                    var person = new PersonRow
                    {
                        Origin = sheet.Origin(i),
                        Sheet = sheet,
                        First = first,
                        Last = last,
                        Preferred = sheet.Value(row, F.PreferredName),
                        Number = sheet.Value(row, F.EmployeeNumber)?.ToUpperInvariant(),
                        PersonId = sheet.Value(row, F.PersonId)?.ToUpperInvariant(),
                        Email = NormalizeEmail(sheet.Value(row, F.WorkEmail)),
                    };
                    foreach (var field in new[] { F.JobTitle, F.JobLevel, F.JobFamily, F.Unit, F.Manager, F.Place, F.StartDate })
                        if (sheet.Value(row, field) is { } value) person.Values[field] = (value, person.Origin);
                    personRows.Add(person);
                }
                sheet.PeopleCount = sheet.Input.Rows.Count - nameless - oneName.Count - left.Count;
                sheet.LeftCount = nameless + oneName.Count + left.Count;
                if (left.Count > 0) leftOut.Add(new LeftOutRows("left", sheet.Input.FileId, sheet.Input.FileName, sheet.Input.Sheet, left.Count, left.Take(5).ToList()));
                if (oneName.Count > 0) leftOut.Add(new LeftOutRows("oneName", sheet.Input.FileId, sheet.Input.FileName, sheet.Input.Sheet, oneName.Count, oneName.Take(5).ToList()));
                if (nameless > 0) leftOut.Add(new LeftOutRows("noName", sheet.Input.FileId, sheet.Input.FileName, sheet.Input.Sheet, nameless, []));
            }
        }

        public void ResolvePeople()
        {
            var merged = MergeRows();
            var former = new List<PersonRow>();
            var existingByNumber = snapshot.People.Where(p => p.Number is not null).GroupBy(p => p.Number!.ToUpperInvariant()).ToDictionary(g => g.Key, g => g.First());
            var existingByEmail = snapshot.People.Where(p => p.Email is not null).GroupBy(p => p.Email!.ToLowerInvariant()).ToDictionary(g => g.Key, g => g.First());
            var current = new List<PersonRow>();
            var matched = new Dictionary<Guid, string>();
            var matchedBy = new Dictionary<string, int>(StringComparer.Ordinal);
            // Someone already in Fusion is matched by employee number, else work email: updated, never added twice.
            foreach (var person in merged)
            {
                var by = person.Number is not null && existingByNumber.ContainsKey(person.Number) ? "number"
                    : person.Email is not null && existingByEmail.ContainsKey(person.Email) ? "email" : null;
                var hit = by == "number" ? existingByNumber[person.Number!] : by == "email" ? existingByEmail[person.Email!] : null;
                if (hit is null) { current.Add(person); continue; }
                if (!hit.Employed || matched.ContainsKey(hit.Id)) { former.Add(person); continue; }
                person.Existing = hit;
                person.Number ??= hit.Number?.ToUpperInvariant();
                matched[hit.Id] = person.Key;
                matchedBy[by!] = matchedBy.GetValueOrDefault(by!) + 1;
                current.Add(person);
            }
            if (former.Count > 0)
                leftOut.Add(new LeftOutRows("already", Guid.Empty, string.Empty, string.Empty, former.Count, former.Take(5).Select(p => p.FullName).ToList()));
            again = matched.Count > 0;
            if (again) facts.Add(new CompanyImportFact("matched", matched.Count, current.Count, matchedBy.OrderByDescending(item => item.Value).First().Key, []));

            // Units from the people's own unit column when no file lists units.
            if (!unitsFromFiles)
                foreach (var person in current)
                    if (person.Values.TryGetValue(F.Unit, out var unit) && unitFind(unit.Value) is null)
                    {
                        var key = $"u:{unit.Value.ToUpperInvariant()}";
                        if (!units.ContainsKey(key)) units[key] = new ProposedUnit(key, unit.Value, null, null, rootKey, null, null, unit.Origin, false);
                    }
            if (!units.ContainsKey(rootKey)) units[RootAddedKey] = new ProposedUnit(RootAddedKey, snapshot.CompanyName, null, null, null, null, null, null, true);

            // Who is who, for manager and head references: number, then reference, email and a unique full name.
            var index = new Dictionary<string, string>(StringComparer.Ordinal);
            var ambiguousNames = current.GroupBy(p => CatalogName.Normalize(p.FullName)).Where(g => g.Count() > 1).Select(g => g.Key).ToHashSet();
            foreach (var person in current)
            {
                if (person.Number is not null) index.TryAdd($"n:{person.Number}", person.Key);
                if (person.PersonId is not null) index.TryAdd($"i:{person.PersonId}", person.Key);
                if (person.Email is not null) index.TryAdd($"e:{person.Email}", person.Key);
                var name = CatalogName.Normalize(person.FullName);
                if (!ambiguousNames.Contains(name)) index.TryAdd($"f:{name}", person.Key);
            }
            var foundBy = new Dictionary<string, int>(StringComparer.Ordinal);
            (string? Key, Guid? Existing, string By)? FindPerson(string reference)
            {
                var upper = reference.ToUpperInvariant();
                if (index.TryGetValue($"n:{upper}", out var key)) return (key, null, "number");
                if (index.TryGetValue($"i:{upper}", out key)) return (key, null, "reference");
                if (NormalizeEmail(reference) is { } email && index.TryGetValue($"e:{email}", out key)) return (key, null, "email");
                if (index.TryGetValue($"f:{CatalogName.Normalize(reference)}", out key)) return (key, null, "name");
                if (existingByNumber.TryGetValue(upper, out var existing)) return (null, existing.Id, "number");
                if (NormalizeEmail(reference) is { } mail && existingByEmail.TryGetValue(mail, out existing)) return (null, existing.Id, "email");
                return null;
            }

            foreach (var (unitKey, headRef) in unitHeadRefs)
                if (FindPerson(headRef) is { Key: { } head } && units.TryGetValue(unitKey, out var unit))
                    units[unitKey] = unit with { HeadKey = head };

            var fixesByPerson = decisions.Fixes.GroupBy(fix => fix.PersonKey).ToDictionary(group => group.Key, group => group.ToList());
            var noStart = new List<PersonRow>();
            var noTitle = new List<PersonRow>();
            var resolved = new List<(PersonRow Row, string UnitKey, string Title, string? Place, string? ManagerKey, Guid? ExistingManager, DateOnly? Start, List<ProposedFix> Fixes)>();
            var unitMissing = new Dictionary<string, List<PersonRow>>(StringComparer.Ordinal);
            var managerMissing = new List<(PersonRow Row, string Reference)>();

            foreach (var person in current)
            {
                var fixes = new List<ProposedFix>();
                var personFixes = fixesByPerson.GetValueOrDefault(person.Key) ?? [];
                string? Said(string field) => personFixes.LastOrDefault(fix => fix.Field == field)?.Value;
                ProposedFix Fix(string field, string? from, string to)
                {
                    var said = personFixes.Last(fix => fix.Field == field);
                    return new ProposedFix(said.Id, field, from, to, said.Text);
                }

                // Unit
                string? unitKey = null;
                person.Values.TryGetValue(F.Unit, out var unitValue);
                if (Said(F.Unit) is { } saidUnit)
                {
                    unitKey = units.ContainsKey(saidUnit) ? saidUnit : unitFind(saidUnit) ?? AddUnit(saidUnit);
                    fixes.Add(Fix(F.Unit, unitValue.Value, units[unitKey].Name));
                }
                else if (unitValue.Value is not null)
                {
                    unitKey = unitFind(unitValue.Value) ?? (units.ContainsKey($"u:{unitValue.Value.ToUpperInvariant()}") ? $"u:{unitValue.Value.ToUpperInvariant()}" : null);
                    if (unitKey is null)
                    {
                        var missingKey = CatalogName.Normalize(unitValue.Value);
                        if (!unitMissing.TryGetValue(missingKey, out var list)) unitMissing[missingKey] = list = [];
                        list.Add(person);
                        var answer = decisions.Answers.GetValueOrDefault($"unit|{missingKey}");
                        unitKey = answer is null ? null : answer == "add" ? AddUnit(unitValue.Value) : units.ContainsKey(answer) ? answer : null;
                    }
                }
                var had = person.Existing;
                // What the file doesn't say about someone already in Fusion stays as it is.
                unitKey ??= had?.UnitId is { } heldUnit && units.ContainsKey($"x:{heldUnit:N}") ? $"x:{heldUnit:N}" : rootKey;

                // Job, place
                person.Values.TryGetValue(F.JobTitle, out var titleValue);
                var title = Said(F.JobTitle) ?? titleValue.Value ?? snapshot.Jobs.FirstOrDefault(job => job.Id == had?.JobId)?.Name;
                if (Said(F.JobTitle) is { } saidTitle) fixes.Add(Fix(F.JobTitle, titleValue.Value, saidTitle));
                if (title is null) noTitle.Add(person);
                person.Values.TryGetValue(F.Place, out var placeValue);
                var place = Said(F.Place) ?? placeValue.Value ?? snapshot.Places.FirstOrDefault(item => item.Id == had?.PlaceId)?.Name;
                if (Said(F.Place) is { } saidPlace) fixes.Add(Fix(F.Place, placeValue.Value, saidPlace));

                // Manager: the file's reference, else the head of the person's unit (or of the unit above when they head it).
                string? managerKey = null;
                Guid? existingManager = null;
                person.Values.TryGetValue(F.Manager, out var managerValue);
                if (Said(F.Manager) is { } saidManager)
                {
                    managerKey = saidManager == "none" ? null : saidManager;
                    var fromName = managerValue.Value is null ? null : FindPerson(managerValue.Value)?.Key is { } was ? NameOf(current, was) : managerValue.Value;
                    fixes.Add(Fix(F.Manager, fromName, managerKey is null ? "none" : NameOf(current, managerKey) ?? managerKey));
                }
                else if (managerValue.Value is not null)
                {
                    var found = FindPerson(managerValue.Value);
                    if (found is { } hit)
                    {
                        managerKey = hit.Key;
                        existingManager = hit.Existing;
                        foundBy[hit.By] = foundBy.GetValueOrDefault(hit.By) + 1;
                    }
                    else
                    {
                        managerMissing.Add((person, managerValue.Value));
                        var answer = decisions.Answers.GetValueOrDefault($"manager|{person.Key}");
                        managerKey = answer is null or "none" ? null : answer;
                    }
                }
                else if (had is not null)
                {
                    if (had.ManagerId is { } heldManager)
                    {
                        if (matched.TryGetValue(heldManager, out var managerRow)) managerKey = managerRow;
                        else existingManager = heldManager;
                    }
                }
                else if (!person.Sheet.Columns.ContainsKey(F.Manager))
                {
                    var at = unitKey;
                    while (at is not null && units.TryGetValue(at, out var unit))
                    {
                        if (unit.HeadKey is { } head && head != person.Key) { managerKey = head; foundBy["head"] = foundBy.GetValueOrDefault("head") + 1; break; }
                        at = unit.ParentKey;
                    }
                }
                if (managerKey == person.Key) managerKey = null;

                person.Values.TryGetValue(F.StartDate, out var startValue);
                var start = had is not null ? had.EmployedFrom ?? had.AssignedFrom ?? snapshot.Today : ParseDate(startValue.Value, person.Sheet.DateOrder);
                // This is a bounded, server-proven offer. An unanswered offer keeps the established start;
                // Take leans also keeps it. The file date is never an ordinary matched-person update.
                var fileStart = ParseDate(startValue.Value, person.Sheet.DateOrder);
                if (had is { UntouchedFirstPerson: true } && fileStart is { } earlier && earlier < start)
                {
                    var key = $"firstStart|{person.Key}";
                    var answer = decisions.Answers.GetValueOrDefault(key) ?? "keep";
                    checks.Add(new ProposedCheck(key, "firstPersonStart", person.Key, person.FullName, null,
                        [new("keep", start!.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), "current", true),
                         new("file", earlier.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), "file", false)], answer));
                    if (answer == "file") start = earlier;
                }
                if (start is null) noStart.Add(person);
                resolved.Add((person, unitKey, title ?? NoTitleJob, place, managerKey, existingManager, start, fixes));
            }

            // Checks for what the files couldn't settle.
            // The closest unit by name or by code; it's offered under its name.
            var unitChoices = units.Values.Where(unit => unit.Key != RootAddedKey)
                .SelectMany(unit => unit.Code is null ? [(unit.Key, unit.Name)] : new[] { (unit.Key, unit.Name), (unit.Key, unit.Code) }).ToList();
            foreach (var (missingKey, list) in unitMissing)
            {
                var raw = list[0].Values[F.Unit].Value;
                var closest = Closest(raw, unitChoices);
                var options = new List<CheckOption>();
                if (closest is not null) options.Add(new(closest.Value.Key, units[closest.Value.Key].Name, "closest", true));
                options.Add(new("add", raw, "new", closest is null));
                checks.Add(new ProposedCheck($"unit|{missingKey}", "unitMissing", list[0].Key, raw, unitsFileName,
                    options, decisions.Answers.GetValueOrDefault($"unit|{missingKey}"), list.Count));
            }
            var managerChoices = current.Select(p => (p.Key, p.FullName)).ToList();
            foreach (var (row, reference) in managerMissing)
            {
                var closest = Closest(reference, managerChoices);
                var options = new List<CheckOption>();
                if (closest is not null && closest.Value.Key != row.Key) options.Add(new(closest.Value.Key, closest.Value.Name, "closest", false));
                options.Add(new("none", "none", null, true));
                checks.Add(new ProposedCheck($"manager|{row.Key}", "managerMissing", row.Key, row.FullName, reference,
                    options, decisions.Answers.GetValueOrDefault($"manager|{row.Key}")));
            }
            var noStartAnswer = decisions.Answers.GetValueOrDefault("start");
            if (noStart.Count > 0)
                checks.Add(new ProposedCheck("start", "noStart", null, noStart.Count == 1 ? noStart[0].FullName : null, null,
                    [new("today", snapshot.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), null, true), new("out", "out", null, false)],
                    noStartAnswer, noStart.Count));
            var noTitleAnswer = decisions.Answers.GetValueOrDefault("title");
            if (noTitle.Count > 0)
                checks.Add(new ProposedCheck("title", "noTitle", null, noTitle.Count == 1 ? noTitle[0].FullName : null, null,
                    [new("employee", NoTitleJob, null, true), new("out", "out", null, false)], noTitleAnswer, noTitle.Count));

            // People left out by the person's own answers.
            var outKeys = new HashSet<string>(StringComparer.Ordinal);
            if (noStartAnswer == "out") foreach (var p in noStart) outKeys.Add(p.Key);
            if (noTitleAnswer == "out") foreach (var p in noTitle) outKeys.Add(p.Key);
            if (outKeys.Count > 0)
                leftOut.Add(new LeftOutRows("decided", Guid.Empty, string.Empty, string.Empty, outKeys.Count,
                    current.Where(p => outKeys.Contains(p.Key)).Take(5).Select(p => p.FullName).ToList()));

            BuildJobs(resolved.Where(r => !outKeys.Contains(r.Row.Key)).Select(r => (r.Row, r.Title)).ToList());
            BuildPlaces(resolved.Where(r => !outKeys.Contains(r.Row.Key)).Select(r => r.Place).ToList());
            var jobByTitle = jobs.SelectMany(job => job.Titles.Select(t => (Title: CatalogName.Normalize(t), job.Key))).GroupBy(x => x.Title).ToDictionary(g => g.Key, g => g.First().Key);
            var placeByName = places.ToDictionary(place => CatalogName.Normalize(place.Name), place => place.Key);

            foreach (var r in resolved)
            {
                if (outKeys.Contains(r.Row.Key)) continue;
                var managerKey = r.ManagerKey is not null && outKeys.Contains(r.ManagerKey) ? null : r.ManagerKey;
                people.Add(new ProposedPerson(r.Row.Key, r.Row.First, r.Row.Last, r.Row.Preferred, r.Row.Number, r.Row.Email,
                    jobByTitle[CatalogName.Normalize(r.Title)], r.UnitKey, r.Place is null ? null : placeByName[CatalogName.Normalize(r.Place)],
                    managerKey, r.ExistingManager, r.Start ?? snapshot.Today, r.Start is null, r.Row.Origin, r.Fixes, r.Row.Existing?.Id));
            }
            BreakManagerLoops();
            ManagerFacts(foundBy);
            Changes();
            NotInFile(matched);
            // No column for managers isn't needed to bring people in: one question, never a stop.
            if (peopleSheets && !again && !managerColumn && people.Count > 1 && people.All(person => person.ManagerKey is null)
                && personRows.FirstOrDefault()?.Sheet.Input is { } sheet)
                questions.Add(new ColumnQuestion(NoManagersKey, sheet.FileId, sheet.Sheet, -1, string.Empty, "noManagers", "without", [], 0,
                    decisions.Answers.GetValueOrDefault(NoManagersKey)));
        }

        /// <summary>For everyone already in Fusion: what the files change, each with what Fusion has and what the file says.</summary>
        private void Changes()
        {
            var byKey = people.ToDictionary(person => person.Key, StringComparer.Ordinal);
            var jobById = snapshot.Jobs.ToDictionary(job => job.Id);
            string? PersonName(Guid? id) => id is null ? null : snapshot.People.FirstOrDefault(person => person.Id == id)?.Name;
            for (var i = 0; i < people.Count; i++)
            {
                var person = people[i];
                if (person.ExistingId is not { } id) continue;
                var had = snapshot.People.First(item => item.Id == id);
                var changes = new List<ProposedChange>();
                if (had.UntouchedFirstPerson && person.StartDate < had.EmployedFrom)
                    changes.Add(new ProposedChange(F.StartDate, had.EmployedFrom?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                        person.StartDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)));
                // Day one gave the first person a generated number; the file's is hers (anyone else keeps theirs).
                if (had.UntouchedFirstPerson && person.Number is { } number && !string.Equals(number, had.Number, StringComparison.OrdinalIgnoreCase))
                    changes.Add(new ProposedChange(F.EmployeeNumber, had.Number, number));
                var job = jobs.First(item => item.Key == person.JobKey);
                if (job.ExistingId is null || job.ExistingId != had.JobId)
                    changes.Add(new ProposedChange(F.JobTitle, had.JobId is { } jobId && jobById.TryGetValue(jobId, out var held) ? held.Name : null, job.Title));
                if (had.UnitId is not { } unitId || person.UnitKey != $"x:{unitId:N}")
                    changes.Add(new ProposedChange(F.Unit, had.UnitId is { } heldUnit ? units.GetValueOrDefault($"x:{heldUnit:N}")?.Name : null, units[person.UnitKey].Name));
                var place = person.PlaceKey is null ? null : places.First(item => item.Key == person.PlaceKey);
                if (place is not null && place.ExistingId is null || place?.ExistingId != had.PlaceId)
                    changes.Add(new ProposedChange(F.Place, snapshot.Places.FirstOrDefault(item => item.Id == had.PlaceId)?.Name, place?.Name));
                Guid? managerId = person.ManagerKey is { } managerKey ? byKey[managerKey].ExistingId : person.ExistingManagerId;
                if (person.ManagerKey is not null && managerId is null || managerId != had.ManagerId)
                    changes.Add(new ProposedChange(F.Manager, PersonName(had.ManagerId),
                        person.ManagerKey is { } to ? byKey[to].DisplayName : PersonName(managerId)));
                if (changes.Count > 0) people[i] = person with { Changes = changes };
            }
        }

        /// <summary>Everyone employed in Fusion that the files don't list: a question, never an automatic leaver.</summary>
        private void NotInFile(Dictionary<Guid, string> matched)
        {
            if (!again) return;
            var jobName = snapshot.Jobs.ToDictionary(job => job.Id, job => job.Name);
            foreach (var person in snapshot.People.Where(person => person.Employed && !matched.ContainsKey(person.Id)).OrderBy(person => person.Name, StringComparer.Ordinal))
            {
                var key = $"gone|{person.Id:N}";
                var answer = decisions.Answers.GetValueOrDefault(key);
                var title = person.JobId is { } job ? jobName.GetValueOrDefault(job) : null;
                var since = person.EmployedFrom?.Year.ToString(CultureInfo.InvariantCulture);
                checks.Add(new ProposedCheck(key, "notInFile", $"x:{person.Id:N}", person.Name,
                    string.Join(" · ", new[] { title, since }.OfType<string>()),
                    [new("keep", "keep", null, true), new("end", "end", null, false)], answer));
                if (answer != "end") continue;
                // Employed through the day before the changes apply, never before they started.
                var last = applyFrom.AddDays(-1);
                if (person.EmployedFrom is { } from && last < from) last = from;
                ends.Add(new ProposedEnd(person.Id, person.Name, last));
            }
        }

        private List<PersonRow> MergeRows()
        {
            // The same person in two rows (two files, or twice in one) is one person; a field the rows disagree on is a check.
            var merged = new List<PersonRow>();
            var byKey = new Dictionary<string, PersonRow>(StringComparer.Ordinal);
            foreach (var row in personRows)
            {
                PersonRow? same = null;
                if (row.Number is not null) byKey.TryGetValue($"n:{row.Number}", out same);
                if (same is null && row.Email is not null) byKey.TryGetValue($"e:{row.Email}", out same);
                if (same is not null && same.Email is not null && row.Email is not null && same.Email != row.Email) same = null;
                if (same is null)
                {
                    merged.Add(row);
                    if (row.Number is not null) byKey.TryAdd($"n:{row.Number}", row);
                    if (row.Email is not null) byKey.TryAdd($"e:{row.Email}", row);
                    continue;
                }
                same.Preferred ??= row.Preferred;
                same.PersonId ??= row.PersonId;
                same.Email ??= row.Email;
                same.Number ??= row.Number;
                foreach (var (field, value) in row.Values)
                {
                    if (!same.Values.TryGetValue(field, out var had)) { same.Values[field] = value; continue; }
                    if (string.Equals(CatalogName.Normalize(had.Value), CatalogName.Normalize(value.Value), StringComparison.Ordinal)) continue;
                    var key = $"twice|{same.Key}|{field}";
                    var answer = decisions.Answers.GetValueOrDefault(key);
                    if (!checks.Any(check => check.Key == key))
                        checks.Add(new ProposedCheck(key, "twice", same.Key, same.FullName, field,
                            [new("a", had.Value, $"{had.Origin.FileName}", false), new("b", value.Value, $"{value.Origin.FileName}", false)], answer));
                    if (answer == "b") same.Values[field] = value;
                }
            }
            return merged;
        }

        private string AddUnit(string name)
        {
            var key = $"u:{name.ToUpperInvariant()}";
            if (!units.ContainsKey(key)) units[key] = new ProposedUnit(key, name, null, null, rootKey, null, null, null, true);
            return key;
        }

        private void BuildJobs(List<(PersonRow Row, string Title)> holders)
        {
            var existing = snapshot.Jobs.GroupBy(job => CatalogName.Normalize(job.Name)).ToDictionary(g => g.Key, g => g.First());
            var byTitle = holders.GroupBy(h => CatalogName.Normalize(h.Title)).ToList();
            // Titles that look like one job ("QA Automation Eng." and "QA Automation Engineer") are a check, merged by default lean.
            var groups = byTitle.GroupBy(g => Loose(g.First().Title)).ToList();
            foreach (var loose in groups)
            {
                var titleGroups = loose.ToList();
                var key = $"job|{loose.Key}";
                var answer = decisions.Answers.GetValueOrDefault(key);
                if (titleGroups.Count > 1)
                {
                    var named = titleGroups.OrderByDescending(g => g.Count()).Select(g => $"{g.First().Title} ({g.Count()})").ToList();
                    checks.Add(new ProposedCheck(key, "sameJob", key, string.Join(" · ", named), null,
                        [new("merge", "merge", null, true), new("keep", "keep", null, false)], answer));
                }
                var sets = titleGroups.Count > 1 && answer == "merge" ? [titleGroups.SelectMany(g => g).ToList()] : titleGroups.Select(g => g.ToList()).ToList();
                foreach (var set in sets)
                {
                    // The most held title names the job; on a tie the fuller one ("Engineer" over "Eng.").
                    var title = set.GroupBy(h => h.Title).OrderByDescending(g => g.Count()).ThenByDescending(g => g.Key.Length)
                        .ThenBy(g => g.Key, StringComparer.Ordinal).First().Key;
                    var hit = existing.GetValueOrDefault(CatalogName.Normalize(title));
                    var level = MostCommon(set.Select(h => h.Row.Values.GetValueOrDefault(F.JobLevel).Value));
                    var family = MostCommon(set.Select(h => h.Row.Values.GetValueOrDefault(F.JobFamily).Value));
                    // A job already in Fusion takes the level and family the files give it, where they give one.
                    var changes = new List<ProposedChange>();
                    if (hit is not null)
                    {
                        var heldLevel = snapshot.Levels.FirstOrDefault(value => value.Id == hit.LevelId)?.Name;
                        var heldFamily = snapshot.Families.FirstOrDefault(value => value.Id == hit.FamilyId)?.Name;
                        if (level is not null && CatalogName.Normalize(level) != CatalogName.Normalize(heldLevel)) changes.Add(new(F.JobLevel, heldLevel, level));
                        else level = heldLevel;
                        if (family is not null && CatalogName.Normalize(family) != CatalogName.Normalize(heldFamily)) changes.Add(new(F.JobFamily, heldFamily, family));
                        else family = heldFamily;
                    }
                    jobs.Add(new ProposedJob($"j:{CatalogName.Normalize(title)}", hit?.Name ?? title, hit?.Id, level, family,
                        set.Select(h => h.Title).Distinct(StringComparer.Ordinal).ToList(), set.Count, changes.Count > 0 ? changes : null));
                }
            }
        }

        private void BuildPlaces(List<string?> values)
        {
            var existing = snapshot.Places.GroupBy(place => CatalogName.Normalize(place.Name)).ToDictionary(g => g.Key, g => g.First());
            foreach (var group in values.OfType<string>().GroupBy(CatalogName.Normalize))
            {
                var name = group.GroupBy(v => v).OrderByDescending(g => g.Count()).First().Key;
                var hit = existing.GetValueOrDefault(group.Key);
                places.Add(new ProposedPlace($"l:{group.Key}", hit?.Name ?? name, hit?.Id, group.Count()));
            }
        }

        private void BreakManagerLoops()
        {
            var byKey = people.Select((person, i) => (person, i)).ToDictionary(x => x.person.Key, x => x.i);
            foreach (var start in people.ToList())
            {
                var seen = new List<string>();
                var at = start.Key;
                while (byKey.TryGetValue(at, out var i) && people[i].ManagerKey is { } manager)
                {
                    if (seen.Contains(at)) break;
                    seen.Add(at);
                    if (manager != start.Key) { at = manager; continue; }
                    var loop = seen.ToList();
                    var key = $"loop|{string.Join(",", loop.OrderBy(k => k, StringComparer.Ordinal))}";
                    if (checks.Any(check => check.Key == key)) break;
                    var answer = decisions.Answers.GetValueOrDefault(key);
                    checks.Add(new ProposedCheck(key, "managerLoop", loop[0], string.Join(" · ", loop.Select(k => people[byKey[k]].DisplayName)), null,
                        loop.Select((k, n) => new CheckOption(k, people[byKey[k]].DisplayName, null, n == 0)).ToList(), answer));
                    var cut = answer is not null && byKey.ContainsKey(answer) ? answer : loop[0];
                    people[byKey[cut]] = people[byKey[cut]] with { ManagerKey = null };
                    break;
                }
            }
        }

        private void ManagerFacts(Dictionary<string, int> foundBy)
        {
            if (people.Count == 0) return;
            var tops = people.Where(person => person.ManagerKey is null && person.ExistingManagerId is null).ToList();
            var by = foundBy.Count == 0 ? null : foundBy.OrderByDescending(item => item.Value).First().Key;
            facts.Add(new CompanyImportFact("managers", people.Count - tops.Count, people.Count, by, tops.Take(3).Select(p => p.DisplayName).ToList()));
        }

        // ---------- result ----------

        public CompanyImportProposal Result(List<EffectiveSheet> sheets)
        {
            var unitList = OrderUnits();
            var unitsMissing = checks.Where(check => check.Kind == "unitMissing").Sum(check => check.Count);
            if (unitsFromFiles && people.Count > 0)
                facts.Add(new CompanyImportFact("units", people.Count - unitsMissing, people.Count, unitsFileName,
                    checks.Where(check => check.Kind == "unitMissing").Select(check => check.Title).OfType<string>().Take(3).ToList()));
            else if (people.Count > 0)
                facts.Add(new CompanyImportFact("unitsFromPeople", unitList.Count(unit => unit.ExistingId is null && !unit.Added && unit.Key != RootAddedKey), 0, null, []));
            var titles = jobs.Sum(job => job.Titles.Count);
            var families = jobs.Select(job => job.Family).OfType<string>().Distinct(StringComparer.OrdinalIgnoreCase).Count();
            if (jobs.Count > 0) facts.Add(new CompanyImportFact("jobs", jobs.Count, titles, families > 0 ? families.ToString(CultureInfo.InvariantCulture) : null, []));
            if (places.Count > 0) facts.Add(new CompanyImportFact("places", places.Count, 0, null, places.OrderByDescending(p => p.Count).Select(p => p.Name).ToList()));

            var unitsFrom = people.Count == 0 ? snapshot.Today : people.Min(person => person.StartDate);
            var plan = new
            {
                units = unitList.Where(unit => unit.ExistingId is null).Select(unit => new { unit.Key, unit.Name, unit.Code, unit.Type, unit.ParentKey }),
                jobs = jobs.Select(job => new { job.Key, job.Title, job.ExistingId, job.Level, job.Family }),
                places = places.Select(place => new { place.Key, place.Name, place.ExistingId }),
                people = people.Select(person => new
                {
                    person.Key, person.FirstName, person.LastName, person.PreferredName, person.Number, person.Email, person.JobKey,
                    person.UnitKey, person.PlaceKey, person.ManagerKey, person.ExistingManagerId, person.StartDate, person.ExistingId, person.Changes,
                }),
                existing = snapshot.Units.Select(unit => unit.Id).Concat(snapshot.People.Select(person => person.Id)).Order(),
                changedUnits = unitList.Where(unit => unit.Changes is not null).Select(unit => new { unit.Key, unit.Changes }),
                changedJobs = jobs.Where(job => job.Changes is not null).Select(job => new { job.Key, job.Changes }),
                ends,
                applyFrom,
                unitsFrom,
                firstPersonOffers = checks.Where(check => check.Kind == "firstPersonStart")
                    .Select(check => new { check.Key, check.Answer, check.Options }),
            };
            var readSheets = sheets.Select(sheet => new ReadSheet(sheet.Input.FileId, sheet.Input.FileName, sheet.Input.Sheet, sheet.Kind,
                sheet.Input.Rows.Count, sheet.Read, sheet.PeopleCount, sheet.LeftCount)).ToList();
            return new CompanyImportProposal(readSheets, questions, unitList, jobs, places, people, checks, leftOut, facts,
                units.ContainsKey(rootKey) ? rootKey : RootAddedKey, unitsFrom, ImportFingerprint.HashCanonical(plan), applyFrom, ends, again);
        }

        /// <summary>Parents before children; units nobody is in and nothing hangs under are still brought in from a units file.</summary>
        private List<ProposedUnit> OrderUnits()
        {
            var ordered = new List<ProposedUnit>();
            var done = new HashSet<string>(StringComparer.Ordinal);
            var children = units.Values.Where(unit => unit.ParentKey is not null).GroupBy(unit => unit.ParentKey!).ToDictionary(g => g.Key, g => g.OrderBy(u => u.Origin?.Row ?? int.MaxValue).ThenBy(u => u.Name, StringComparer.Ordinal).ToList());
            void Walk(ProposedUnit unit)
            {
                if (!done.Add(unit.Key)) return;
                ordered.Add(unit);
                foreach (var child in children.GetValueOrDefault(unit.Key) ?? []) Walk(child);
            }
            foreach (var top in units.Values.Where(unit => unit.ParentKey is null || !units.ContainsKey(unit.ParentKey)).OrderBy(unit => unit.ExistingId is null ? 1 : 0)) Walk(top);
            return ordered;
        }
    }

    // ---------- helpers ----------

    private static string? NameOf(List<PersonRow> people, string key) => people.FirstOrDefault(p => p.Key == key)?.FullName;

    public static string? Clean(string? value)
    {
        var clean = CatalogName.Clean(value);
        return clean.Length == 0 ? null : clean;
    }

    private static List<string> Distinct(IReadOnlyList<IReadOnlyList<string?>> rows, int index)
        => rows.Select(row => Clean(CompanyImportReader.Cell(row, index))).OfType<string>()
            .GroupBy(value => value, StringComparer.OrdinalIgnoreCase).OrderByDescending(g => g.Count()).Select(g => g.Key).ToList();

    private static (string? First, string? Last) Names(string? first, string? last, string? full)
    {
        if (first is not null || last is not null) return (first, last);
        if (full is null) return (null, null);
        if (full.Contains(','))
        {
            var parts = full.Split(',', 2, StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
            return parts.Length == 2 ? (parts[1], parts[0]) : (parts.FirstOrDefault(), null);
        }
        var words = full.Split(' ', 2, StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        return words.Length == 2 ? (words[0], words[1]) : (words.FirstOrDefault(), null);
    }

    private static bool IsFormer(string? status)
        => status is not null && CompanyImportFields.Key(status) is "former" or "left" or "inactive" or "terminated" or "ended" or "departed" or "resigned" or "parti" or "sorti";

    private static string? NormalizeEmail(string? value)
    {
        if (value is null) return null;
        var email = value.Trim().ToLowerInvariant();
        var at = email.IndexOf('@');
        return at > 0 && at < email.Length - 1 && !email.Contains(' ') ? email : null;
    }

    private static string? MostCommon(IEnumerable<string?> values)
        => values.OfType<string>().GroupBy(CatalogName.Normalize).OrderByDescending(g => g.Count()).ThenBy(g => g.Key, StringComparer.Ordinal).FirstOrDefault()?.First();

    /// <summary>Day first ("dmy") unless the values show month first; null when they settle nothing.</summary>
    private static string? DateEvidence(IReadOnlyList<string> values)
    {
        foreach (var value in values)
        {
            var parts = value.Split('/', '.', '-');
            if (parts.Length != 3 || parts[0].Length == 4) continue;
            if (int.TryParse(parts[0], out var a) && a > 12) return "dmy";
            if (int.TryParse(parts[1], out var b) && b > 12) return "mdy";
        }
        return values.All(value => value.Length >= 8 && value[4] == '-') ? "dmy" : null;
    }

    public static DateOnly? ParseDate(string? value, string order)
    {
        if (value is null) return null;
        if (DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var iso)) return iso;
        if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var serial) && serial is > 10000 and < 80000)
            return DateOnly.FromDateTime(DateTime.FromOADate(serial));
        var formats = order == "mdy" ? new[] { "M/d/yyyy", "M.d.yyyy", "M-d-yyyy", "M/d/yy" } : ["d/M/yyyy", "d.M.yyyy", "d-M-yyyy", "d/M/yy"];
        if (DateOnly.TryParseExact(value, formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)) return date;
        return DateOnly.TryParse(value, CultureInfo.InvariantCulture, out date) ? date : null;
    }

    /// <summary>A title's loose form: punctuation gone and common short forms written out.</summary>
    internal static string Loose(string title)
    {
        var words = CatalogName.Normalize(title).ToLowerInvariant()
            .Split([' ', '.', ',', '-', '/', '&', '(', ')'], StringSplitOptions.RemoveEmptyEntries)
            .Select(word => word switch
            {
                "eng" or "engr" => "engineer",
                "sr" or "snr" => "senior",
                "jr" or "jnr" => "junior",
                "mgr" => "manager",
                "dev" => "developer",
                "assoc" => "associate",
                "asst" => "assistant",
                "dir" => "director",
                "spec" => "specialist",
                "admin" => "administrator",
                "ops" => "operations",
                _ => word,
            })
            .Where(word => word is not ("of" or "the" or "and"));
        return string.Join(' ', words);
    }

    private static (string Key, string Name)? Closest(string reference, IEnumerable<(string Key, string Name)> candidates)
    {
        var target = CatalogName.Normalize(reference);
        (string Key, string Name)? best = null;
        var bestScore = 0.0;
        foreach (var candidate in candidates)
        {
            var score = Similarity(target, CatalogName.Normalize(candidate.Name));
            if (score > bestScore) { bestScore = score; best = candidate; }
        }
        return bestScore >= 0.6 ? best : null;
    }

    internal static double Similarity(string a, string b)
    {
        if (a.Length == 0 || b.Length == 0) return 0;
        var d = new int[a.Length + 1, b.Length + 1];
        for (var i = 0; i <= a.Length; i++) d[i, 0] = i;
        for (var j = 0; j <= b.Length; j++) d[0, j] = j;
        for (var i = 1; i <= a.Length; i++)
            for (var j = 1; j <= b.Length; j++)
                d[i, j] = Math.Min(Math.Min(d[i - 1, j] + 1, d[i, j - 1] + 1), d[i - 1, j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
        return 1.0 - (double)d[a.Length, b.Length] / Math.Max(a.Length, b.Length);
    }
}

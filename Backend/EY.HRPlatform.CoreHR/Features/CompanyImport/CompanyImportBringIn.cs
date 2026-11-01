using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Imports;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.CompanyImport;

/// <summary>The import changed between review and bring-in; nothing was written.</summary>
public sealed class CompanyImportChangedException() : Exception("The files or the company changed since the chart was shown.");

/// <summary>What a bring-in created and changed, kept on the import.</summary>
public sealed record CompanyImportResult(
    int People, int Units, int Jobs, int Places, int ReportingLines, IReadOnlyList<string> FileNames,
    int Decided, IReadOnlyList<string> DecidedNames, int MissingEmail, int MissingPlace, string BroughtInBy,
    IReadOnlyList<WallGroupDto> Wall, IReadOnlyList<LeftOutDto> LeftOut, int Changed = 0, int Ended = 0);

/// <summary>A person the bring-in creates (no ExistingId) or moves to a new job, unit or place on On.</summary>
public sealed record PlanPerson(
    string Key, string FirstName, string LastName, string? PreferredName, string Number, string? Email, Guid? ExistingId,
    string JobKey, string UnitKey, string? PlaceKey, DateOnly Start, DateOnly On, string FileName, int Row);

/// <summary>A reporting line to write on On; no manager means the person's line ends.</summary>
public sealed record PlanLine(string PersonKey, string? ManagerKey, Guid? ManagerId, DateOnly On);

public sealed record PlanUnitChange(Guid UnitId, string? Name, string? ParentKey, DateOnly On);

/// <summary>What the bring-in writes, frozen by its first batch so a resumed run never derives again from the files.</summary>
public sealed record CompanyImportPlan(
    IReadOnlyList<PlanPerson> People,
    IReadOnlyList<PlanLine> Lines,
    IReadOnlyList<PlanUnitChange> UnitChanges,
    IReadOnlyList<ProposedEnd> Ends,
    Dictionary<string, Guid> Existing,
    CompanyImportResult Result,
    CompanyImportCountsDto Counts);

/// <summary>What's written so far. Saved with each batch, in that batch's transaction, so a batch is in once or not at all.</summary>
public sealed class CompanyImportRun
{
    public Dictionary<string, Guid> Units { get; set; } = [];
    public Dictionary<string, Guid> Jobs { get; set; } = [];
    public Dictionary<string, Guid> Places { get; set; } = [];
    public bool UnitChangesDone { get; set; }
    public int PeopleDone { get; set; }
    public Dictionary<string, Guid> Employees { get; set; } = [];
    public int LinesDone { get; set; }
    public bool EndsDone { get; set; }
}

/// <summary>
/// Brings one reviewed import in, in batches. The first derives the proposal again under the organization's write
/// lock, refuses it unless its fingerprint is the one the person reviewed, writes units, jobs and places and freezes
/// the plan; then unit changes, people a batch at a time, reporting lines and ends, each batch in its own transaction
/// with the run record. A run cut off anywhere picks up at the next batch: nobody is created or changed twice.
/// </summary>
public sealed class CompanyImportBringIn(
    CoreHRDbContext db,
    ITenantContext tenant,
    IOrganizationService organization,
    IWorkforceMutationService mutation,
    IEmployeeNumberAllocator allocator)
{
    public const int PeoplePerBatch = 25;
    public const int LinesPerBatch = 100;

    private Guid TenantId => tenant.TenantId;

    /// <summary>Runs batches until the import is in (true), or until <paramref name="batches"/> have run (false).</summary>
    public async Task<bool> ExecuteAsync(Guid sessionId, CancellationToken cancellationToken, int? batches = null)
    {
        for (var n = 0; batches is null || n < batches; n++)
        {
            // A service stopping ends the run between batches; the next worker picks it up at the next one.
            cancellationToken.ThrowIfCancellationRequested();
            if (!await NextBatchAsync(sessionId, cancellationToken)) return true;
        }
        return false;
    }

    /// <summary>One batch; false once there's nothing left to do.</summary>
    private async Task<bool> NextBatchAsync(Guid sessionId, CancellationToken cancellationToken)
    {
        db.ChangeTracker.Clear();
        var session = await db.CompanyImportSessions.SingleAsync(item => item.Id == sessionId, cancellationToken);
        if (session.Status != CompanyImportStatus.BringingIn) return false;
        if (session.PlanJson is null)
        {
            await PlanAsync(session, cancellationToken);
            return true;
        }
        var plan = CompanyImportJson.Read<CompanyImportPlan>(session.PlanJson)!;
        var run = CompanyImportJson.Read<CompanyImportRun>(session.RunJson) ?? new CompanyImportRun();
        var actor = session.BringInByDisplayName ?? session.StartedByDisplayName;
        if (!run.UnitChangesDone) await UnitChangesAsync(session, plan, run, cancellationToken);
        else if (run.PeopleDone < plan.People.Count) await PeopleAsync(session, plan, run, actor, cancellationToken);
        else if (run.LinesDone < plan.Lines.Count) await LinesAsync(session, plan, run, actor, cancellationToken);
        else if (!run.EndsDone) await EndsAsync(session, plan, run, actor, cancellationToken);
        else
        {
            await CompleteAsync(session, plan, run, cancellationToken);
            return false;
        }
        return true;
    }

    // ---------- batch 0: the plan, units, jobs, places ----------

    private async Task PlanAsync(CompanyImportSession session, CancellationToken cancellationToken)
    {
        await using var transaction = await OrganizationWriteTransaction.BeginAsync(db, TenantId, cancellationToken);
        await db.Entry(session).Collection(item => item.Sources).LoadAsync(cancellationToken);
        var snapshot = await CompanyImportSnapshotLoader.LoadAsync(db, session.CompanyName, cancellationToken);
        var proposal = CompanyImportDerivation.Derive(CompanyImportSnapshotLoader.Inputs(session), session.Decisions, snapshot);
        if (!proposal.CanBringIn || !ImportFingerprint.Matches(proposal.Fingerprint, session.RequestedFingerprint))
            throw new CompanyImportChangedException();
        // A root made on day one (the administrator's own record) opens when the company's history starts.
        if (snapshot.RootUnitId is { } rootId && await organization.OpenRootFromInCurrentTransactionAsync(proposal.UnitsFrom, cancellationToken))
            snapshot = snapshot with { Units = snapshot.Units.Select(unit => unit.Id == rootId ? unit with { ActiveFrom = proposal.UnitsFrom } : unit).ToList() };

        var actor = session.BringInByDisplayName ?? session.StartedByDisplayName;
        var run = new CompanyImportRun
        {
            Units = await BringUnitsAsync(proposal, snapshot, cancellationToken),
            Jobs = await BringJobsAsync(proposal, actor, cancellationToken),
        };
        var places = BringPlaces(proposal, actor);
        run.Places = places.ToDictionary(item => item.Key, item => item.Value.Id);
        await db.SaveChangesAsync(cancellationToken);

        var plan = Plan(proposal, snapshot, run, places.Values.Count(place => place.New), session, actor,
            await allocator.AllocateManyAsync(proposal.People.Count(person => person.IsNew && person.Number is null),
                proposal.People.Where(person => person.Number is not null).Select(person => person.Number!).ToHashSet(StringComparer.Ordinal), cancellationToken));
        run.UnitChangesDone = plan.UnitChanges.Count == 0;
        session.StartRun(CompanyImportJson.Write(plan), CompanyImportJson.Write(run));
        await db.SaveChangesAsync(cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
    }

    private static CompanyImportPlan Plan(
        CompanyImportProposal proposal, CompanyImportSnapshot snapshot, CompanyImportRun run, int newPlaces, CompanyImportSession session,
        string actor, IReadOnlyList<string> numbers)
    {
        var held = snapshot.People.ToDictionary(person => person.Id);
        var unitFrom = snapshot.Units.ToDictionary(unit => unit.Id, unit => unit.ActiveFrom);
        var unitsDate = UnitsDate(proposal, snapshot);
        var generated = new Queue<string>(numbers);
        var people = new List<PlanPerson>();
        var assignedOn = new Dictionary<string, DateOnly>(StringComparer.Ordinal);

        // Department by department, the order the bring-in frame fills its faces in.
        foreach (var person in CompanyImportView.InWallOrder(proposal))
        {
            DateOnly on;
            if (person.ExistingId is { } id)
            {
                var had = held[id];
                if (had.AssignedFrom is { } from) assignedOn[person.Key] = from;
                if (person.Changes?.Any(change => change.Field is CompanyImportFields.JobTitle or CompanyImportFields.Unit or CompanyImportFields.Place) != true) continue;
                // A change is dated from the day the person chose, never on or before what it replaces.
                on = Later(proposal.ApplyFrom, had.AssignedFrom?.AddDays(1));
            }
            else
            {
                var opens = unitFrom.TryGetValue(run.Units[person.UnitKey], out var from) ? from : unitsDate;
                on = person.StartDate > opens ? person.StartDate : opens;
            }
            assignedOn[person.Key] = on;
            people.Add(new PlanPerson(person.Key, person.FirstName, person.LastName, person.PreferredName, person.Number ?? generated.Dequeue(),
                person.Email, person.ExistingId, person.JobKey, person.UnitKey, person.PlaceKey, person.StartDate, on, person.Origin.FileName, person.Origin.Row));
        }

        var byKey = proposal.People.ToDictionary(person => person.Key, StringComparer.Ordinal);
        var lines = new List<PlanLine>();
        foreach (var person in proposal.People)
        {
            var managerKey = person.ManagerKey;
            var managerId = managerKey is null ? person.ExistingManagerId : null;
            DateOnly on;
            if (person.ExistingId is { } id)
            {
                if (person.Changes?.Any(change => change.Field == CompanyImportFields.Manager) != true) continue;
                on = Later(Later(proposal.ApplyFrom, held[id].ManagerFrom?.AddDays(1)), assignedOn.GetValueOrDefault(person.Key));
            }
            else
            {
                if (managerKey is null && managerId is null) continue;
                on = assignedOn[person.Key];
            }
            // Never before the manager holds a job here.
            if (managerKey is not null && assignedOn.TryGetValue(managerKey, out var managerOn)) on = Later(on, managerOn);
            else if (managerId is { } existingManager && held.GetValueOrDefault(existingManager)?.AssignedFrom is { } managerFrom) on = Later(on, managerFrom);
            lines.Add(new PlanLine(person.Key, managerKey, managerId, on));
        }

        var unitChanges = proposal.Units.Where(unit => unit.ExistingId is not null && unit.Changes is { Count: > 0 })
            .Select(unit => new PlanUnitChange(unit.ExistingId!.Value,
                unit.Changes!.Any(change => change.Field == "name") ? unit.Name : null,
                unit.Changes!.Any(change => change.Field == "parent") ? unit.ParentKey : null,
                Later(proposal.ApplyFrom, snapshot.Units.First(item => item.Id == unit.ExistingId).ActiveFrom.AddDays(1))))
            .ToList();

        var touched = proposal with { People = proposal.People.Where(person => people.Any(item => item.Key == person.Key)).ToList() };
        var decided = proposal.People.Where(person => person.Fixes.Count > 0).Select(person => person.DisplayName).ToList();
        var answered = proposal.Checks.Count(check => check.Kind != "notInFile") + session.Decisions.Columns.Count;
        var newPeople = proposal.People.Where(person => person.IsNew).ToList();
        var result = new CompanyImportResult(newPeople.Count, proposal.NewUnits, proposal.Jobs.Count(job => job.ExistingId is null), newPlaces,
            lines.Count(line => line.ManagerKey is not null || line.ManagerId is not null),
            session.Sources.Where(source => source.Problem is null).Select(source => source.FileName).Distinct().ToList(), answered + decided.Count, decided.Take(3).ToList(),
            newPeople.Count(person => person.Email is null), newPeople.Count(person => person.PlaceKey is null), actor,
            CompanyImportView.Wall(touched), CompanyImportView.LeftOut(proposal), proposal.ChangedPeople, proposal.Ends.Count);
        var counts = new CompanyImportCountsDto(people.Count, proposal.Units.Count, proposal.NewUnits, proposal.Jobs.Count, proposal.Places.Count, lines.Count,
            proposal.NewPeople, proposal.ChangedPeople, proposal.Ends.Count);
        var existing = proposal.People.Where(person => person.ExistingId is not null).ToDictionary(person => person.Key, person => person.ExistingId!.Value, StringComparer.Ordinal);
        return new CompanyImportPlan(people, lines, unitChanges, proposal.Ends, existing, result, counts);
    }

    // ---------- unit changes: the organization's own dated changes, each checked before it's made ----------

    private async Task UnitChangesAsync(CompanyImportSession session, CompanyImportPlan plan, CompanyImportRun run, CancellationToken cancellationToken)
    {
        foreach (var change in plan.UnitChanges)
        {
            var at = await StateOnAsync(change.UnitId, change.On, cancellationToken);
            if (change.Name is not null && at?.Name != change.Name)
                await organization.ChangeAsync(change.UnitId, await VersionAsync(change.UnitId, cancellationToken),
                    new ChangeOrganizationUnitRequest(change.Name, null, change.On, "Import"), cancellationToken);
            if (change.ParentKey is not null && run.Units.TryGetValue(change.ParentKey, out var parent) && at?.ParentOrgUnitId != parent)
                await organization.MoveAsync(change.UnitId, await VersionAsync(change.UnitId, cancellationToken),
                    new MoveOrganizationUnitRequest(parent, change.On, "Import"), cancellationToken);
        }
        db.ChangeTracker.Clear();
        session = await db.CompanyImportSessions.SingleAsync(item => item.Id == session.Id, cancellationToken);
        run.UnitChangesDone = true;
        session.RecordBatch(CompanyImportJson.Write(run));
        await db.SaveChangesAsync(cancellationToken);
    }

    private Task<OrgUnitEffectiveState?> StateOnAsync(Guid unitId, DateOnly on, CancellationToken cancellationToken)
        => db.OrgUnitEffectiveStates.AsNoTracking()
            .Where(state => state.OrgUnitId == unitId && state.EffectiveFrom <= on && (state.EffectiveTo == null || state.EffectiveTo > on))
            .FirstOrDefaultAsync(cancellationToken);

    private async Task<uint> VersionAsync(Guid unitId, CancellationToken cancellationToken)
        => await db.OrgUnits.AsNoTracking().Where(unit => unit.Id == unitId).Select(unit => unit.Version).SingleAsync(cancellationToken);

    // ---------- people, lines, ends: a batch each ----------

    private async Task PeopleAsync(CompanyImportSession session, CompanyImportPlan plan, CompanyImportRun run, string actor, CancellationToken cancellationToken)
    {
        await using var transaction = await OrganizationWriteTransaction.BeginAsync(db, TenantId, cancellationToken);
        var sourceRef = $"CompanyImport:{session.Id}";
        var autoDetect = db.ChangeTracker.AutoDetectChangesEnabled;
        db.ChangeTracker.AutoDetectChangesEnabled = false;
        try
        {
            foreach (var person in plan.People.Skip(run.PeopleDone).Take(PeoplePerBatch))
            {
                var employeeId = person.ExistingId ?? Guid.Empty;
                if (person.ExistingId is null)
                {
                    var employee = Employee.Create(TenantId, person.FirstName, person.LastName, person.Email, employeeNumber: person.Number);
                    if (person.PreferredName is not null) employee.UpdatePreferredName(person.PreferredName);
                    db.Employees.Add(employee);
                    employeeId = employee.Id;
                    run.Employees[person.Key] = employee.Id;
                    Ok(await mutation.StartEmploymentAsync(employee.Id,
                        new StartEmploymentInput(Utc(person.Start), null, WorkforceSourceType.Import, sourceRef, session.Id), actor, cancellationToken));
                }
                Ok(await mutation.ChangeWorkAssignmentAsync(employeeId,
                    new ChangeWorkAssignmentInput(run.Units[person.UnitKey], run.Jobs[person.JobKey], person.PlaceKey is null ? null : run.Places[person.PlaceKey],
                        Utc(person.On), WorkforceSourceType.Import, sourceRef, session.Id), actor, cancellationToken));
                run.PeopleDone++;
            }
        }
        finally
        {
            db.ChangeTracker.AutoDetectChangesEnabled = autoDetect;
        }
        session.RecordBatch(CompanyImportJson.Write(run));
        await db.SaveChangesAsync(cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
    }

    private async Task LinesAsync(CompanyImportSession session, CompanyImportPlan plan, CompanyImportRun run, string actor, CancellationToken cancellationToken)
    {
        await using var transaction = await OrganizationWriteTransaction.BeginAsync(db, TenantId, cancellationToken);
        var sourceRef = $"CompanyImport:{session.Id}";
        Guid IdOf(string key) => plan.Existing.TryGetValue(key, out var id) ? id : run.Employees[key];
        foreach (var line in plan.Lines.Skip(run.LinesDone).Take(LinesPerBatch))
        {
            var managerId = line.ManagerKey is not null ? IdOf(line.ManagerKey) : line.ManagerId;
            if (managerId is { } manager)
                Ok(await mutation.ChangeManagerAsync(IdOf(line.PersonKey),
                    new ChangeManagerInput(manager, Utc(line.On), WorkforceSourceType.Import, sourceRef, session.Id), actor, cancellationToken));
            else
                Ok(await mutation.RemovePrimaryManagerAsync(IdOf(line.PersonKey), Utc(line.On), WorkforceSourceType.Import, sourceRef, session.Id, actor, cancellationToken));
            // Each line is saved before the next reads the chain, so cycle checks see it.
            await db.SaveChangesAsync(cancellationToken);
            run.LinesDone++;
        }
        session.RecordBatch(CompanyImportJson.Write(run));
        await db.SaveChangesAsync(cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
    }

    private async Task EndsAsync(CompanyImportSession session, CompanyImportPlan plan, CompanyImportRun run, string actor, CancellationToken cancellationToken)
    {
        await using var transaction = await OrganizationWriteTransaction.BeginAsync(db, TenantId, cancellationToken);
        foreach (var end in plan.Ends)
            Ok(await mutation.EndEmploymentReleasingReportsAsync(end.EmployeeId,
                new EndEmploymentInput(Utc(end.LastDay), "Not in the import's files", WorkforceSourceType.Import, $"CompanyImport:{session.Id}", session.Id),
                actor, cancellationToken));
        run.EndsDone = true;
        session.RecordBatch(CompanyImportJson.Write(run));
        await db.SaveChangesAsync(cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
    }

    private async Task CompleteAsync(CompanyImportSession session, CompanyImportPlan plan, CompanyImportRun run, CancellationToken cancellationToken)
    {
        await db.Entry(session).Collection(item => item.Sources).LoadAsync(cancellationToken);
        var provenance = new
        {
            fingerprint = session.RequestedFingerprint,
            files = session.Sources.GroupBy(source => source.FileId).Select(group => new { name = group.First().FileName, sha256 = group.First().Sha256 }),
            decisions = session.Decisions,
            units = run.Units,
            employees = run.Employees,
            changed = plan.People.Where(person => person.ExistingId is not null).Select(person => person.ExistingId),
            ended = plan.Ends.Select(end => end.EmployeeId),
        };
        session.CompleteBringIn(CompanyImportJson.Write(plan.Result), CompanyImportJson.Write(provenance));
        await db.SaveChangesAsync(cancellationToken);
    }

    // ---------- batch 0's writes ----------

    private static DateOnly UnitsDate(CompanyImportProposal proposal, CompanyImportSnapshot snapshot)
    {
        // New units start with the earliest person, but never before an existing unit they hang under.
        var parents = proposal.Units.Where(unit => unit.ExistingId is null && unit.ParentKey is not null)
            .Select(unit => proposal.Units.FirstOrDefault(parent => parent.Key == unit.ParentKey)?.ExistingId).OfType<Guid>().ToHashSet();
        var latest = snapshot.Units.Where(unit => parents.Contains(unit.Id)).Select(unit => unit.ActiveFrom).DefaultIfEmpty(proposal.UnitsFrom).Max();
        var from = latest > proposal.UnitsFrom ? latest : proposal.UnitsFrom;
        // In a company already in Fusion, a new unit opens when the changes apply, unless someone starts in it earlier.
        return proposal.Again && proposal.People.All(person => !person.IsNew) ? Later(from, proposal.ApplyFrom) : from;
    }

    private async Task<Dictionary<string, Guid>> BringUnitsAsync(CompanyImportProposal proposal, CompanyImportSnapshot snapshot, CancellationToken cancellationToken)
    {
        var ids = proposal.Units.Where(unit => unit.ExistingId is not null).ToDictionary(unit => unit.Key, unit => unit.ExistingId!.Value, StringComparer.Ordinal);
        var created = proposal.Units.Where(unit => unit.ExistingId is null).ToList();
        if (created.Count == 0) return ids;

        // Types by name: Fusion's own, the company's, or a new one the file names.
        await organization.GetTypesAsync(cancellationToken);
        var types = await db.OrganizationalUnitTypes.Where(type => type.IsBuiltIn || type.TenantId == TenantId).ToListAsync(cancellationToken);
        var typeByName = types.GroupBy(type => type.NormalizedName).ToDictionary(group => group.Key, group => group.First().Id);
        foreach (var name in created.Select(unit => unit.Type).OfType<string>().Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (typeByName.ContainsKey(name.Trim().ToUpperInvariant()) || name.Trim().Length > 100) continue;
            var type = OrganizationalUnitType.CreateCustom(TenantId, name);
            db.OrganizationalUnitTypes.Add(type);
            typeByName[type.NormalizedName] = type.Id;
        }
        await db.SaveChangesAsync(cancellationToken);

        var taken = (await db.OrgUnitCodeReservations.Select(reservation => reservation.NormalizedCode).ToListAsync(cancellationToken))
            .Concat(snapshot.Units.Select(unit => unit.Code.ToUpperInvariant())).ToHashSet(StringComparer.Ordinal);
        string Code(ProposedUnit unit)
        {
            var wanted = unit.Code?.Trim().ToUpperInvariant();
            if (wanted is { Length: > 0 and <= 50 } && taken.Add(wanted)) return wanted;
            var stem = CatalogName.Slug(unit.Name).ToUpperInvariant();
            if (stem.Length == 0) stem = "UNIT";
            if (stem.Length > 40) stem = stem[..40].Trim('-');
            var code = stem;
            for (var n = 2; !taken.Add(code); n++) code = $"{stem}-{n}";
            return code;
        }
        Guid TypeOf(ProposedUnit unit)
        {
            if (unit.Key == proposal.RootKey && snapshot.RootUnitId is null) return OrganizationalUnitTypeCatalog.OrganizationId;
            if (unit.Type is not null && typeByName.TryGetValue(unit.Type.Trim().ToUpperInvariant(), out var id)) return id;
            // A unit the person added from a check is a team; any other unit the files don't type is a department.
            return unit.Added ? OrganizationalUnitTypeCatalog.TeamId : OrganizationalUnitTypeCatalog.DepartmentId;
        }

        var newKeys = created.Select(unit => unit.Key).ToHashSet(StringComparer.Ordinal);
        var nodes = created.Select(unit => new OrganizationBatchCreateNode(unit.Key, Code(unit), unit.Name, TypeOf(unit),
            unit.ParentKey is not null && newKeys.Contains(unit.ParentKey) ? unit.ParentKey : null,
            unit.ParentKey is not null && !newKeys.Contains(unit.ParentKey) ? ids[unit.ParentKey] : null,
            unit.ParentKey is null && snapshot.RootUnitId is null)).ToList();
        var made = await organization.CreateBatchInCurrentTransactionAsync(UnitsDate(proposal, snapshot), nodes, cancellationToken);
        foreach (var node in made) ids[node.ProposalNodeId] = node.OrgUnitId;
        return ids;
    }

    private async Task<Dictionary<string, Guid>> BringJobsAsync(CompanyImportProposal proposal, string actor, CancellationToken cancellationToken)
    {
        var touched = proposal.Jobs.Where(job => job.ExistingId is null || job.Changes is not null).ToList();
        var levels = await ListValuesAsync(CompanyList.Levels, touched.Select(job => job.Level), actor, cancellationToken);
        var families = await ListValuesAsync(CompanyList.JobFamilies, touched.Select(job => job.Family), actor, cancellationToken);
        CompanyListValue? Value(Dictionary<string, CompanyListValue> values, string? label) => label is null ? null : values[CatalogName.Normalize(label)];
        var ids = new Dictionary<string, Guid>(StringComparer.Ordinal);
        var existing = await db.Jobs.Where(job => proposal.Jobs.Select(item => item.ExistingId).Contains(job.Id)).ToListAsync(cancellationToken);
        foreach (var job in proposal.Jobs)
        {
            if (job.ExistingId is { } id)
            {
                var held = existing.First(item => item.Id == id);
                if (held.IsRetired) held.Restore(actor);
                if (job.Changes is not null) held.Update(held.Title, Value(families, job.Family), Value(levels, job.Level), actor);
                ids[job.Key] = id;
                continue;
            }
            var made = Job.Create(TenantId, job.Title, Value(families, job.Family), Value(levels, job.Level), actor);
            db.Jobs.Add(made);
            ids[job.Key] = made.Id;
        }
        await db.SaveChangesAsync(cancellationToken);
        return ids;
    }

    private async Task<Dictionary<string, CompanyListValue>> ListValuesAsync(CompanyList list, IEnumerable<string?> labels, string actor, CancellationToken cancellationToken)
    {
        var values = await db.CompanyListValues.Where(value => value.List == list).ToListAsync(cancellationToken);
        var byLabel = values.GroupBy(value => value.NormalizedLabel).ToDictionary(group => group.Key, group => group.First());
        var keys = values.Select(value => value.Key).ToHashSet(StringComparer.Ordinal);
        var order = values.Count == 0 ? 0 : values.Max(value => value.SortOrder);
        foreach (var label in labels.OfType<string>().Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var normalized = CatalogName.Normalize(label);
            if (byLabel.TryGetValue(normalized, out var had))
            {
                if (had.IsRetired) had.Restore(actor);
                continue;
            }
            var stem = CatalogName.Slug(label);
            if (stem.Length == 0) stem = "value";
            var key = stem;
            for (var n = 2; !keys.Add(key); n++) key = $"{stem}-{n}";
            var value = CompanyListValue.Create(TenantId, list, label, key, ++order, actor);
            db.CompanyListValues.Add(value);
            byLabel[normalized] = value;
        }
        return byLabel;
    }

    private Dictionary<string, (Guid Id, bool New)> BringPlaces(CompanyImportProposal proposal, string actor)
    {
        var ids = new Dictionary<string, (Guid, bool)>(StringComparer.Ordinal);
        foreach (var place in proposal.Places)
        {
            if (place.ExistingId is { } id) { ids[place.Key] = (id, false); continue; }
            var made = Place.Create(TenantId, place.Name, null, null, actor);
            db.Places.Add(made);
            ids[place.Key] = (made.Id, true);
        }
        return ids;
    }

    private static void Ok<T>(EY.HRPlatform.SharedKernel.Results.Result<T> result)
    {
        if (result.IsFailure) throw new InvalidOperationException(result.Error.Code);
    }

    private static DateOnly Later(DateOnly a, DateOnly? b) => b is { } other && other > a ? other : a;

    private static DateTime Utc(DateOnly date) => date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
}

/// <summary>
/// Picks up imports asked to be brought in, one at a time, and runs their batches under the tenant. Each batch renews
/// the lock; a run whose lock went quiet (the service stopped) is picked up again and resumes at its next batch.
/// </summary>
public sealed class CompanyImportWorker(IServiceProvider services, ILogger<CompanyImportWorker> logger) : BackgroundService
{
    private static readonly TimeSpan Stale = TimeSpan.FromMinutes(1);
    private static readonly TimeSpan Interval = TimeSpan.FromMilliseconds(700);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromMilliseconds(300), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            var worked = false;
            try { worked = await ProcessNextAsync(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception exception) { logger.LogError(exception, "The company import worker failed unexpectedly."); }
            if (!worked) await Task.Delay(Interval, stoppingToken);
        }
    }

    public async Task<bool> ProcessNextAsync(CancellationToken cancellationToken)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CoreHRDbContext>();
        var instance = Guid.NewGuid().ToString("N")[..8];
        var stale = DateTime.UtcNow - Stale;
        var next = await db.CompanyImportSessions.IgnoreQueryFilters()
            .Where(session => session.Status == CompanyImportStatus.BringingIn && (session.LockedAt == null || session.LockedAt < stale))
            .OrderBy(session => session.BringInRequestedAt)
            .Select(session => new { session.Id, session.TenantId })
            .FirstOrDefaultAsync(cancellationToken);
        if (next is null) return false;
        var claimed = await db.CompanyImportSessions.IgnoreQueryFilters()
            .Where(session => session.Id == next.Id && session.Status == CompanyImportStatus.BringingIn && (session.LockedAt == null || session.LockedAt < stale))
            .ExecuteUpdateAsync(set => set.SetProperty(session => session.LockedAt, DateTime.UtcNow).SetProperty(session => session.LockedBy, instance), cancellationToken);
        if (claimed == 0) return true;

        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(next.TenantId);
        await BringInAsync(scope.ServiceProvider, next.Id, cancellationToken);
        return true;
    }

    /// <summary>
    /// Runs one bring-in. A failure before anything was written opens the import again with the reason; a failure
    /// after stops it partway, with what's in kept and the rest waiting for Try again.
    /// </summary>
    public static async Task BringInAsync(IServiceProvider scoped, Guid sessionId, CancellationToken cancellationToken)
    {
        var db = scoped.GetRequiredService<CoreHRDbContext>();
        string? failure = null;
        try { await scoped.GetRequiredService<CompanyImportBringIn>().ExecuteAsync(sessionId, cancellationToken); }
        catch (CompanyImportChangedException) { failure = "changed"; }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            scoped.GetRequiredService<ILogger<CompanyImportWorker>>().LogError(exception, "Bringing in company import {SessionId} failed.", sessionId);
            failure = "failed";
        }
        if (failure is null) return;
        db.ChangeTracker.Clear();
        var session = await db.CompanyImportSessions.SingleAsync(item => item.Id == sessionId, cancellationToken);
        if (session.PlanJson is null) session.FailBringIn(failure);
        else session.StopBringIn(failure);
        await db.SaveChangesAsync(cancellationToken);
    }
}

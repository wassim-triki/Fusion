using System.Collections.Concurrent;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Imports;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.CompanyImport;

/// <summary>What's been created so far while an import is brought in; shown live, never the record of what happened.</summary>
public sealed class CompanyImportProgress
{
    private readonly ConcurrentDictionary<Guid, CompanyImportProgressDto> running = new();

    public void Set(Guid sessionId, CompanyImportProgressDto progress) => running[sessionId] = progress;
    public CompanyImportProgressDto? Get(Guid sessionId) => running.GetValueOrDefault(sessionId);
    public void Clear(Guid sessionId) => running.TryRemove(sessionId, out _);
}

/// <summary>The import changed between review and bring-in; nothing was written.</summary>
public sealed class CompanyImportChangedException() : Exception("The files or the company changed since the chart was shown.");

/// <summary>What a bring-in created, kept on the import.</summary>
public sealed record CompanyImportResult(
    int People, int Units, int Jobs, int Places, int ReportingLines, IReadOnlyList<string> FileNames,
    int Decided, IReadOnlyList<string> DecidedNames, int MissingEmail, int MissingPlace, string BroughtInBy,
    IReadOnlyList<WallGroupDto> Wall, IReadOnlyList<LeftOutDto> LeftOut);

/// <summary>
/// Brings one reviewed import in, in one transaction: derived again from the files under the organization's write
/// lock, refused unless its fingerprint is the one the person reviewed, then written through the organization and
/// workforce services as dated history (units from the earliest start, each person from their own start). All or
/// nothing: a failure leaves the company as it was.
/// </summary>
public sealed class CompanyImportBringIn(
    CoreHRDbContext db,
    ITenantContext tenant,
    IOrganizationService organization,
    IWorkforceMutationService mutation,
    IEmployeeNumberAllocator allocator,
    CompanyImportProgress progress)
{
    private Guid TenantId => tenant.TenantId;

    public async Task ExecuteAsync(Guid sessionId, CancellationToken cancellationToken)
    {
        await using var transaction = await OrganizationWriteTransaction.BeginAsync(db, TenantId, cancellationToken);
        var session = await db.CompanyImportSessions.Include(item => item.Sources).SingleAsync(item => item.Id == sessionId, cancellationToken);
        if (session.Status != CompanyImportStatus.BringingIn) return;

        var snapshot = await CompanyImportSnapshotLoader.LoadAsync(db, session.CompanyName, cancellationToken);
        var proposal = CompanyImportDerivation.Derive(CompanyImportSnapshotLoader.Inputs(session), session.Decisions, snapshot);
        if (!proposal.CanBringIn || !ImportFingerprint.Matches(proposal.Fingerprint, session.RequestedFingerprint))
            throw new CompanyImportChangedException();

        var actor = session.BringInByDisplayName ?? session.StartedByDisplayName;
        var sourceRef = $"CompanyImport:{session.Id}";
        var counts = new int[4];
        void Report(string phase) => progress.Set(session.Id, new CompanyImportProgressDto(phase, counts[0], counts[1], counts[2], counts[3]));

        Report("units");
        var unitIds = await BringUnitsAsync(proposal, snapshot, cancellationToken);
        counts[0] = proposal.NewUnits;
        Report("jobs");
        var jobIds = await BringJobsAsync(proposal, actor, cancellationToken);
        var placeIds = BringPlaces(proposal, actor);
        counts[1] = proposal.Jobs.Count;
        Report("people");

        var unitFrom = snapshot.Units.ToDictionary(unit => unit.Id, unit => unit.ActiveFrom);
        DateOnly AssignedOn(ProposedPerson person)
        {
            var unitId = unitIds[person.UnitKey];
            var opens = unitFrom.TryGetValue(unitId, out var from) ? from : UnitsDate(proposal, snapshot);
            return person.StartDate > opens ? person.StartDate : opens;
        }

        var manual = proposal.People.Where(person => person.Number is not null).Select(person => person.Number!).ToHashSet(StringComparer.Ordinal);
        var generated = new Queue<string>(await allocator.AllocateManyAsync(proposal.People.Count(person => person.Number is null), manual, cancellationToken));
        var employeeIds = new Dictionary<string, Guid>(StringComparer.Ordinal);
        var assignedOn = new Dictionary<string, DateOnly>(StringComparer.Ordinal);
        var autoDetect = db.ChangeTracker.AutoDetectChangesEnabled;
        db.ChangeTracker.AutoDetectChangesEnabled = false;
        try
        {
            // Department by department, the order the bring-in frame fills its faces in.
            foreach (var person in CompanyImportView.InWallOrder(proposal))
            {
                var employee = Employee.Create(TenantId, person.FirstName, person.LastName, person.Email, employeeNumber: person.Number ?? generated.Dequeue());
                if (person.PreferredName is not null) employee.UpdatePreferredName(person.PreferredName);
                db.Employees.Add(employee);
                employeeIds[person.Key] = employee.Id;
                var started = await mutation.StartEmploymentAsync(employee.Id,
                    new StartEmploymentInput(Utc(person.StartDate), null, WorkforceSourceType.Import, sourceRef, session.Id), actor, cancellationToken);
                if (started.IsFailure) throw new InvalidOperationException(started.Error.Code);
                var on = AssignedOn(person);
                assignedOn[person.Key] = on;
                var assigned = await mutation.ChangeWorkAssignmentAsync(employee.Id,
                    new ChangeWorkAssignmentInput(unitIds[person.UnitKey], jobIds[person.JobKey], person.PlaceKey is null ? null : placeIds[person.PlaceKey].Id,
                        Utc(on), WorkforceSourceType.Import, sourceRef, session.Id), actor, cancellationToken);
                if (assigned.IsFailure) throw new InvalidOperationException(assigned.Error.Code);
                counts[2]++;
                if (counts[2] % 10 == 0 || counts[2] == proposal.People.Count) Report("people");
            }

            Report("lines");
            var existingFrom = snapshot.People.Where(person => person.AssignedFrom is not null).ToDictionary(person => person.Id, person => person.AssignedFrom!.Value);
            foreach (var person in proposal.People)
            {
                Guid? managerId = person.ManagerKey is not null ? employeeIds[person.ManagerKey] : person.ExistingManagerId;
                if (managerId is null) continue;
                var managerFrom = person.ManagerKey is not null ? assignedOn[person.ManagerKey] : existingFrom.GetValueOrDefault(managerId.Value, assignedOn[person.Key]);
                var on = assignedOn[person.Key] > managerFrom ? assignedOn[person.Key] : managerFrom;
                var line = await mutation.ChangeManagerAsync(employeeIds[person.Key],
                    new ChangeManagerInput(managerId.Value, Utc(on), WorkforceSourceType.Import, sourceRef, session.Id), actor, cancellationToken);
                if (line.IsFailure) throw new InvalidOperationException(line.Error.Code);
                counts[3]++;
                if (counts[3] % 10 == 0) Report("lines");
            }
        }
        finally
        {
            db.ChangeTracker.AutoDetectChangesEnabled = autoDetect;
        }

        Report("saving");
        var decided = proposal.People.Where(person => person.Fixes.Count > 0).Select(person => person.DisplayName).ToList();
        var answered = proposal.Checks.Count + session.Decisions.Columns.Count;
        var result = new CompanyImportResult(proposal.People.Count, proposal.NewUnits, proposal.Jobs.Count(job => job.ExistingId is null), placeIds.Values.Count(place => place.New),
            proposal.ReportingLines, session.Sources.Select(source => source.FileName).Distinct().ToList(),
            answered + decided.Count, decided.Take(3).ToList(), proposal.People.Count(person => person.Email is null),
            proposal.People.Count(person => person.PlaceKey is null), actor, CompanyImportView.Wall(proposal),
            CompanyImportView.LeftOut(proposal));
        var provenance = new
        {
            fingerprint = proposal.Fingerprint,
            files = session.Sources.GroupBy(source => source.FileId).Select(group => new { name = group.First().FileName, sha256 = group.First().Sha256 }),
            decisions = session.Decisions,
            units = unitIds.Where(item => proposal.Units.Any(unit => unit.Key == item.Key && unit.ExistingId is null)).ToDictionary(),
            employees = employeeIds,
        };
        session.CompleteBringIn(CompanyImportJson.Write(result), CompanyImportJson.Write(provenance));
        await db.SaveChangesAsync(cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        progress.Clear(session.Id);
    }

    private static DateOnly UnitsDate(CompanyImportProposal proposal, CompanyImportSnapshot snapshot)
    {
        // New units start with the earliest person, but never before an existing unit they hang under.
        var parents = proposal.Units.Where(unit => unit.ExistingId is null && unit.ParentKey is not null)
            .Select(unit => proposal.Units.FirstOrDefault(parent => parent.Key == unit.ParentKey)?.ExistingId).OfType<Guid>().ToHashSet();
        var latest = snapshot.Units.Where(unit => parents.Contains(unit.Id)).Select(unit => unit.ActiveFrom).DefaultIfEmpty(proposal.UnitsFrom).Max();
        return latest > proposal.UnitsFrom ? latest : proposal.UnitsFrom;
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
        var levels = await ListValuesAsync(CompanyList.Levels, proposal.Jobs.Where(job => job.ExistingId is null).Select(job => job.Level), actor, cancellationToken);
        var families = await ListValuesAsync(CompanyList.JobFamilies, proposal.Jobs.Where(job => job.ExistingId is null).Select(job => job.Family), actor, cancellationToken);
        var ids = new Dictionary<string, Guid>(StringComparer.Ordinal);
        var existing = await db.Jobs.Where(job => proposal.Jobs.Select(item => item.ExistingId).Contains(job.Id)).ToListAsync(cancellationToken);
        foreach (var job in proposal.Jobs)
        {
            if (job.ExistingId is { } id)
            {
                var held = existing.First(item => item.Id == id);
                if (held.IsRetired) held.Restore(actor);
                ids[job.Key] = id;
                continue;
            }
            var made = Job.Create(TenantId, job.Title,
                job.Family is null ? null : families[CatalogName.Normalize(job.Family)],
                job.Level is null ? null : levels[CatalogName.Normalize(job.Level)], actor);
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

    private static DateTime Utc(DateOnly date) => date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
}

/// <summary>
/// Picks up imports asked to be brought in, one at a time, and brings each in under its tenant. An import whose
/// bring-in was cut off (the service stopped) is picked up again after a while: nothing of it was written.
/// </summary>
public sealed class CompanyImportWorker(IServiceProvider services, ILogger<CompanyImportWorker> logger) : BackgroundService
{
    private static readonly TimeSpan Stale = TimeSpan.FromMinutes(10);
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

    /// <summary>Runs one bring-in; on failure the import opens again with the reason and nothing written.</summary>
    public static async Task BringInAsync(IServiceProvider scoped, Guid sessionId, CancellationToken cancellationToken)
    {
        var db = scoped.GetRequiredService<CoreHRDbContext>();
        var progress = scoped.GetRequiredService<CompanyImportProgress>();
        string? failure = null;
        try { await scoped.GetRequiredService<CompanyImportBringIn>().ExecuteAsync(sessionId, cancellationToken); }
        catch (CompanyImportChangedException) { failure = "changed"; }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            scoped.GetRequiredService<ILogger<CompanyImportWorker>>().LogError(exception, "Bringing in company import {SessionId} failed.", sessionId);
            failure = "failed";
        }
        if (failure is null) return;
        progress.Clear(sessionId);
        db.ChangeTracker.Clear();
        var session = await db.CompanyImportSessions.SingleAsync(item => item.Id == sessionId, cancellationToken);
        session.FailBringIn(failure);
        await db.SaveChangesAsync(cancellationToken);
    }
}

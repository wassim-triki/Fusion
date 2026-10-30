using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.People.Changes;

/// <summary>
/// Scheduled changes written before change records existed (old change pages, scripts) are only rows, so nothing
/// shows them as coming or can cancel them. This adopts each into a record, the way it would have been recorded:
/// a future employment is a join, a future end of employment an end (with the lines it closed and the reports it
/// re-pointed), and a future primary assignment or manager line a job change. A row can be created by one change
/// and ended by a later one, as when recorded live. It only adds records; rows already in a record are left alone,
/// so running it again changes nothing.
/// </summary>
public sealed class WorkforceChangeBackfill(CoreHRDbContext dbContext, ITenantContext tenantContext, IOrganizationService organizations)
{
    private const string Actor = "system|Fusion";

    public async Task<int> RunForTenantAsync(CancellationToken cancellationToken)
    {
        var now = DateTime.SpecifyKind(DateTime.UtcNow.Date, DateTimeKind.Utc);
        var covered = (await dbContext.WorkforceChangeEffects.AsNoTracking().Select(effect => effect.EntityId).ToListAsync(cancellationToken)).ToHashSet();
        var employments = (await dbContext.Employments.AsNoTracking().ToListAsync(cancellationToken)).Where(item => !covered.Contains(item.Id)).ToList();
        var assignments = (await dbContext.WorkAssignments.AsNoTracking().Where(item => item.IsPrimary).ToListAsync(cancellationToken))
            .Where(item => !covered.Contains(item.Id)).ToList();
        var lines = (await dbContext.ManagerRelationships.AsNoTracking().ToListAsync(cancellationToken)).Where(item => !covered.Contains(item.Id)).ToList();
        var primary = lines.Where(item => item.Type == ReportingRelationshipType.PrimaryManager).ToList();
        var people = await dbContext.Employees.AsNoTracking().ToDictionaryAsync(item => item.Id, cancellationToken);
        ChangePersonRef? Person(Guid? id) => id is { } key && people.TryGetValue(key, out var employee) ? WorkforceChangeService.Ref(employee) : null;
        var unitNames = new Dictionary<Guid, string?>();
        async Task<string?> Unit(Guid id, DateOnly asOf)
        {
            if (unitNames.TryGetValue(id, out var known)) return known;
            try { known = (await organizations.GetUnitAsync(id, asOf, cancellationToken)).Name; }
            catch (Exceptions.EntityNotFoundException) { known = null; }
            return unitNames[id] = known;
        }

        // 1. What each kind of change would have touched.
        var joins = employments.Where(item => item.EffectiveFrom > now).Select(employment => (
            Employment: employment,
            Work: assignments.FirstOrDefault(item => item.EmploymentId == employment.Id && item.EffectiveFrom == employment.EffectiveFrom),
            Line: primary.FirstOrDefault(item => item.SubjectEmployeeId == employment.EmployeeId && item.EffectiveFrom == employment.EffectiveFrom)))
            .ToList();
        var ends = employments.Where(item => item.EffectiveTo > now).Select(employment =>
        {
            var boundary = employment.EffectiveTo!.Value;
            var leaver = employment.EmployeeId;
            var closedLines = lines.Where(item => (item.SubjectEmployeeId == leaver || item.ManagerEmployeeId == leaver) && item.EffectiveTo == boundary).ToList();
            var reassigned = closedLines
                .Where(item => item.ManagerEmployeeId == leaver && item.Type == ReportingRelationshipType.PrimaryManager)
                .Select(released => (Released: released, Next: primary.FirstOrDefault(item => item.SubjectEmployeeId == released.SubjectEmployeeId && item.EffectiveFrom == boundary)))
                .ToList();
            return (Employment: employment, Boundary: boundary,
                Work: assignments.Where(item => item.EmployeeId == leaver && item.EffectiveTo == boundary).ToList(),
                Lines: closedLines, Reassigned: reassigned);
        }).ToList();
        var startedByOthers = joins.SelectMany(join => new[] { join.Work?.Id, join.Line?.Id })
            .Concat(ends.SelectMany(end => end.Reassigned.Select(item => item.Next?.Id)))
            .OfType<Guid>().ToHashSet();
        var jobs = assignments.Where(item => item.EffectiveFrom > now && !startedByOthers.Contains(item.Id)).Select(item => (item.EmployeeId, item.EffectiveFrom))
            .Concat(primary.Where(item => item.EffectiveFrom > now && !startedByOthers.Contains(item.Id)).Select(item => (EmployeeId: item.SubjectEmployeeId, item.EffectiveFrom)))
            .Distinct()
            .Select(start => (
                Employee: start.EmployeeId, At: start.EffectiveFrom,
                NewWork: assignments.FirstOrDefault(item => item.EmployeeId == start.EmployeeId && item.EffectiveFrom == start.EffectiveFrom && !startedByOthers.Contains(item.Id)),
                OldWork: assignments.FirstOrDefault(item => item.EmployeeId == start.EmployeeId && item.EffectiveTo == start.EffectiveFrom),
                NewLine: primary.FirstOrDefault(item => item.SubjectEmployeeId == start.EmployeeId && item.EffectiveFrom == start.EffectiveFrom && !startedByOthers.Contains(item.Id)),
                OldLine: primary.FirstOrDefault(item => item.SubjectEmployeeId == start.EmployeeId && item.EffectiveTo == start.EffectiveFrom)))
            .ToList();

        // 2. A row a later change ended was open when it was made: that is the end its maker left it with.
        var endedLater = ends.SelectMany(end => end.Work.Select(item => item.Id).Concat(end.Lines.Select(item => item.Id)).Append(end.Employment.Id))
            .Concat(jobs.SelectMany(job => new[] { job.OldWork?.Id, job.NewWork is not null || job.NewLine is null ? job.OldLine?.Id : null }.OfType<Guid>()))
            .ToHashSet();
        DateTime? Left(Guid id, DateTime? to) => endedLater.Contains(id) ? null : to;
        WorkforceChangeEffect Created(Guid subject, string type, Guid id, DateTime? to)
            => WorkforceChangeEffect.Record(tenantContext.TenantId, subject, type, id, WorkforceChangeEffectAction.Created, null, Left(id, to));
        WorkforceChangeEffect Ended(Guid subject, string type, Guid id, DateTime? previous, DateTime applied)
            => WorkforceChangeEffect.Record(tenantContext.TenantId, subject, type, id, WorkforceChangeEffectAction.Ended, previous, applied);

        var records = new List<(DateTime At, Guid Employee, WorkforceChangeKind Kind, WorkforceChangeDetails Details, List<WorkforceChangeEffect> Effects)>();

        foreach (var (employment, work, line) in joins)
        {
            var at = employment.EffectiveFrom;
            var isHire = !employments.Any(item => item.EmployeeId == employment.EmployeeId && item.Id != employment.Id)
                && !covered.Contains(employment.EmployeeId);
            var effects = new List<WorkforceChangeEffect> { Created(employment.EmployeeId, WorkforceChangeEffect.EmploymentEntity, employment.Id, employment.EffectiveTo) };
            if (isHire) effects.Add(WorkforceChangeEffect.Record(tenantContext.TenantId, employment.EmployeeId, WorkforceChangeEffect.EmployeeEntity,
                employment.EmployeeId, WorkforceChangeEffectAction.Created, null, null));
            if (work is not null) effects.Add(Created(employment.EmployeeId, WorkforceChangeEffect.WorkAssignmentEntity, work.Id, work.EffectiveTo));
            if (line is not null) effects.Add(Created(employment.EmployeeId, WorkforceChangeEffect.ManagerRelationshipEntity, line.Id, line.EffectiveTo));
            records.Add((at, employment.EmployeeId, WorkforceChangeKind.Join, WorkforceChangeService.JoinDetails(
                Person(line?.ManagerEmployeeId), work?.OrgUnitId ?? Guid.Empty,
                work is null ? null : await Unit(work.OrgUnitId, DateOnly.FromDateTime(at)),
                work, employment, isHire), effects));
        }

        foreach (var end in ends)
        {
            var leaver = end.Employment.EmployeeId;
            var effects = new List<WorkforceChangeEffect> { Ended(leaver, WorkforceChangeEffect.EmploymentEntity, end.Employment.Id, null, end.Boundary) };
            effects.AddRange(end.Work.Select(item => Ended(leaver, WorkforceChangeEffect.WorkAssignmentEntity, item.Id, null, end.Boundary)));
            effects.AddRange(end.Lines.Select(item => Ended(item.SubjectEmployeeId, WorkforceChangeEffect.ManagerRelationshipEntity, item.Id, null, end.Boundary)));
            effects.AddRange(end.Reassigned.Where(item => item.Next is not null)
                .Select(item => Created(item.Next!.SubjectEmployeeId, WorkforceChangeEffect.ManagerRelationshipEntity, item.Next.Id, item.Next.EffectiveTo)));
            var own = end.Lines.FirstOrDefault(item => item.SubjectEmployeeId == leaver && item.Type == ReportingRelationshipType.PrimaryManager);
            records.Add((end.Boundary, leaver, WorkforceChangeKind.EndEmployment, new WorkforceChangeDetails(
                ManagerFrom: Person(own?.ManagerEmployeeId),
                Reassigned: end.Reassigned.Select(item => new ReassignedReport(Person(item.Released.SubjectEmployeeId)!, Person(item.Next?.ManagerEmployeeId))).ToList(),
                DottedLinesEnded: end.Lines.Where(item => item.Type == ReportingRelationshipType.SecondaryManager)
                    .Select(item => new EndedDottedLine(Person(item.SubjectEmployeeId)!, Person(item.ManagerEmployeeId)!)).ToList(),
                LastDay: DateOnly.FromDateTime(end.Boundary).AddDays(-1)), effects));
        }

        foreach (var job in jobs)
        {
            var effects = new List<WorkforceChangeEffect>();
            if (job.NewWork is not null)
            {
                effects.Add(Created(job.Employee, WorkforceChangeEffect.WorkAssignmentEntity, job.NewWork.Id, job.NewWork.EffectiveTo));
                if (job.OldWork is not null)
                    effects.Add(Ended(job.Employee, WorkforceChangeEffect.WorkAssignmentEntity, job.OldWork.Id, Left(job.NewWork.Id, job.NewWork.EffectiveTo), job.At));
            }
            if (job.NewLine is not null)
                effects.Add(Created(job.Employee, WorkforceChangeEffect.ManagerRelationshipEntity, job.NewLine.Id, job.NewLine.EffectiveTo));
            if (job.OldLine is not null && (job.NewLine is not null || job.NewWork is null))
                effects.Add(Ended(job.Employee, WorkforceChangeEffect.ManagerRelationshipEntity, job.OldLine.Id,
                    job.NewLine is null ? null : Left(job.NewLine.Id, job.NewLine.EffectiveTo), job.At));
            if (effects.Count == 0)
                continue;

            var asOf = DateOnly.FromDateTime(job.At);
            var (oldWork, newWork) = (job.OldWork, job.NewWork);
            var unitChanged = newWork is not null && oldWork is not null && newWork.OrgUnitId != oldWork.OrgUnitId;
            var titleChanged = newWork is not null && oldWork is not null && newWork.JobTitle != oldWork.JobTitle;
            var locationChanged = newWork is not null && oldWork is not null && newWork.WorkLocation != oldWork.WorkLocation;
            records.Add((job.At, job.Employee, WorkforceChangeKind.JobChange, new WorkforceChangeDetails(
                ManagerFrom: Person(job.OldLine?.ManagerEmployeeId),
                ManagerTo: Person(job.NewLine?.ManagerEmployeeId),
                ManagerChanged: (job.NewLine is not null || job.NewWork is null) && job.NewLine?.ManagerEmployeeId != job.OldLine?.ManagerEmployeeId,
                UnitFromId: oldWork?.OrgUnitId,
                UnitFrom: oldWork is null ? null : await Unit(oldWork.OrgUnitId, asOf),
                UnitToId: newWork?.OrgUnitId ?? oldWork?.OrgUnitId,
                UnitTo: unitChanged ? await Unit(newWork!.OrgUnitId, asOf) : null,
                TitleFrom: oldWork?.JobTitle,
                TitleTo: titleChanged ? newWork!.JobTitle : null,
                LocationFrom: oldWork?.WorkLocation,
                LocationTo: locationChanged ? newWork!.WorkLocation : null,
                UnitChanged: unitChanged,
                TitleChanged: titleChanged,
                LocationChanged: locationChanged), effects));
        }

        // Created in date order, as they would have been made.
        var created = DateTime.UtcNow;
        foreach (var (record, index) in records.OrderBy(item => item.At).Select((item, index) => (item, index)))
        {
            var change = WorkforceChange.Create(
                tenantContext.TenantId, record.Employee, record.Kind, DateOnly.FromDateTime(record.At), null,
                System.Text.Json.JsonSerializer.Serialize(record.Details, WorkforceChangeRecorder.Json), Actor, record.Effects);
            dbContext.Entry(change).Property(item => item.CreatedAt).CurrentValue = created.AddMilliseconds(index);
            dbContext.WorkforceChanges.Add(change);
        }
        await dbContext.SaveChangesAsync(cancellationToken);
        return records.Count;
    }
}

/// <summary>Runs the backfill once for every tenant when Core HR starts.</summary>
public sealed class WorkforceChangeBackfillService(IServiceScopeFactory scopes, ILogger<WorkforceChangeBackfillService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            List<Guid> tenants;
            await using (var discovery = scopes.CreateAsyncScope())
            {
                var db = discovery.ServiceProvider.GetRequiredService<CoreHRDbContext>();
                if (!db.Database.IsRelational()) return;
                // Discovery reads tenant identifiers only; every read and write after it is tenant-filtered.
                tenants = await db.Database.SqlQuery<Guid>($"""
                    SELECT DISTINCT e."TenantId" AS "Value" FROM corehr."Employments" e
                    WHERE e."EffectiveFrom" > now() OR e."EffectiveTo" > now()
                    UNION SELECT DISTINCT w."TenantId" FROM corehr."WorkAssignments" w WHERE w."EffectiveFrom" > now()
                    UNION SELECT DISTINCT m."TenantId" FROM corehr."ManagerRelationships" m WHERE m."EffectiveFrom" > now()
                    """).ToListAsync(stoppingToken);
            }
            foreach (var tenantId in tenants)
            {
                await using var scope = scopes.CreateAsyncScope();
                scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(tenantId);
                var adopted = await scope.ServiceProvider.GetRequiredService<WorkforceChangeBackfill>().RunForTenantAsync(stoppingToken);
                if (adopted > 0)
                    logger.LogInformation("Adopted {Count} scheduled workforce changes into change records for tenant {TenantId}.", adopted, tenantId);
            }
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogError(exception, "Adopting scheduled workforce changes into change records failed.");
        }
    }
}

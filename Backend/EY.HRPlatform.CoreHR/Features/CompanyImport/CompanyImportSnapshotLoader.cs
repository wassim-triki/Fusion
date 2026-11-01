using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.CompanyImport;

/// <summary>What the company already has, for the derivation. Tenant-scoped by the context's filters.</summary>
public static class CompanyImportSnapshotLoader
{
    public static async Task<CompanyImportSnapshot> LoadAsync(CoreHRDbContext db, string companyName, CancellationToken cancellationToken)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var root = await db.OrgUnits.AsNoTracking().Where(unit => unit.IsRoot).Select(unit => (Guid?)unit.Id).FirstOrDefaultAsync(cancellationToken);
        var states = await db.OrgUnitEffectiveStates.AsNoTracking()
            .Where(state => state.LifecycleState == OrgUnitLifecycleState.Active)
            .Select(state => new { state.OrgUnitId, state.Name, state.ParentOrgUnitId, state.EffectiveFrom, state.EffectiveTo, state.OrgUnit.Code })
            .ToListAsync(cancellationToken);
        var units = states.GroupBy(state => state.OrgUnitId)
            .Select(group =>
            {
                var current = group.FirstOrDefault(state => state.EffectiveFrom <= today && (state.EffectiveTo is null || state.EffectiveTo > today));
                return current is null ? null : new CompanyImportSnapshot.Unit(group.Key, current.Code, current.Name, current.ParentOrgUnitId, group.Min(state => state.EffectiveFrom));
            })
            .OfType<CompanyImportSnapshot.Unit>()
            .ToList();
        var now = today.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var assigned = (await db.WorkAssignments.AsNoTracking().Where(work => work.IsPrimary && work.EffectiveTo == null)
                .Select(work => new { work.EmployeeId, work.EffectiveFrom, work.OrgUnitId, work.JobId, work.PlaceId }).ToListAsync(cancellationToken))
            .GroupBy(work => work.EmployeeId).ToDictionary(group => group.Key, group => group.OrderByDescending(work => work.EffectiveFrom).First());
        var employed = (await db.Employments.AsNoTracking().Where(employment => employment.EffectiveTo == null || employment.EffectiveTo > now)
                .Select(employment => new { employment.EmployeeId, employment.EffectiveFrom }).ToListAsync(cancellationToken))
            .GroupBy(employment => employment.EmployeeId).ToDictionary(group => group.Key, group => DateOnly.FromDateTime(group.Min(employment => employment.EffectiveFrom)));
        var managers = (await db.ManagerRelationships.AsNoTracking()
                .Where(line => line.Type == ReportingRelationshipType.PrimaryManager && line.EffectiveTo == null)
                .Select(line => new { line.SubjectEmployeeId, line.ManagerEmployeeId, line.EffectiveFrom }).ToListAsync(cancellationToken))
            .GroupBy(line => line.SubjectEmployeeId).ToDictionary(group => group.Key, group => group.OrderByDescending(line => line.EffectiveFrom).First());
        var people = (await db.Employees.AsNoTracking()
                .Select(employee => new { employee.Id, employee.EmployeeNumber, employee.Email, employee.FirstName, employee.LastName })
                .ToListAsync(cancellationToken))
            .Select(employee =>
            {
                var work = assigned.GetValueOrDefault(employee.Id);
                var line = managers.GetValueOrDefault(employee.Id);
                return new CompanyImportSnapshot.Person(employee.Id, employee.EmployeeNumber, employee.Email, $"{employee.FirstName} {employee.LastName}",
                    work is null ? null : DateOnly.FromDateTime(work.EffectiveFrom), employed.ContainsKey(employee.Id),
                    employed.TryGetValue(employee.Id, out var from) ? from : null, work?.OrgUnitId, work?.JobId, work?.PlaceId,
                    line?.ManagerEmployeeId, line is null ? null : DateOnly.FromDateTime(line.EffectiveFrom));
            })
            .ToList();
        var jobs = await db.Jobs.AsNoTracking().Select(job => new CompanyImportSnapshot.Job(job.Id, job.Title, job.LevelId, job.FamilyId)).ToListAsync(cancellationToken);
        var places = await db.Places.AsNoTracking().Select(place => new CompanyImportSnapshot.Named(place.Id, place.Name)).ToListAsync(cancellationToken);
        var lists = await db.CompanyListValues.AsNoTracking()
            .Where(value => value.List == CompanyList.Levels || value.List == CompanyList.JobFamilies)
            .Select(value => new { value.Id, value.List, value.Label }).ToListAsync(cancellationToken);
        return new CompanyImportSnapshot(companyName, today, root, units, people, jobs, places,
            lists.Where(value => value.List == CompanyList.Levels).Select(value => new CompanyImportSnapshot.Named(value.Id, value.Label)).ToList(),
            lists.Where(value => value.List == CompanyList.JobFamilies).Select(value => new CompanyImportSnapshot.Named(value.Id, value.Label)).ToList());
    }

    public static IReadOnlyList<CompanyImportSheetInput> Inputs(CompanyImportSession session)
        => session.Sources.Where(source => source.Problem is null).Select(source => new CompanyImportSheetInput(source.FileId, source.FileName, source.SheetName, source.Order,
            source.Kind, source.Readings, source.Rows)).ToList();
}

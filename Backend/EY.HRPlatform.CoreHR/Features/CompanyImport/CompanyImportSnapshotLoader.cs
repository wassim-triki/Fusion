using EY.HRPlatform.CoreHR.Domain.Entities;
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
        var assigned = await db.WorkAssignments.AsNoTracking().Where(work => work.IsPrimary && work.EffectiveTo == null)
            .Select(work => new { work.EmployeeId, work.EffectiveFrom }).ToListAsync(cancellationToken);
        var assignedFrom = assigned.GroupBy(work => work.EmployeeId).ToDictionary(group => group.Key, group => DateOnly.FromDateTime(group.Max(work => work.EffectiveFrom)));
        var people = (await db.Employees.AsNoTracking()
                .Select(employee => new { employee.Id, employee.EmployeeNumber, employee.Email, employee.FirstName, employee.LastName })
                .ToListAsync(cancellationToken))
            .Select(employee => new CompanyImportSnapshot.Person(employee.Id, employee.EmployeeNumber, employee.Email,
                $"{employee.FirstName} {employee.LastName}", assignedFrom.TryGetValue(employee.Id, out var from) ? from : null))
            .ToList();
        var jobs = await db.Jobs.AsNoTracking().Select(job => new CompanyImportSnapshot.Named(job.Id, job.Title)).ToListAsync(cancellationToken);
        var places = await db.Places.AsNoTracking().Select(place => new CompanyImportSnapshot.Named(place.Id, place.Name)).ToListAsync(cancellationToken);
        var lists = await db.CompanyListValues.AsNoTracking()
            .Where(value => value.List == CompanyList.Levels || value.List == CompanyList.JobFamilies)
            .Select(value => new { value.Id, value.List, value.Label }).ToListAsync(cancellationToken);
        return new CompanyImportSnapshot(companyName, today, root, units, people, jobs, places,
            lists.Where(value => value.List == CompanyList.Levels).Select(value => new CompanyImportSnapshot.Named(value.Id, value.Label)).ToList(),
            lists.Where(value => value.List == CompanyList.JobFamilies).Select(value => new CompanyImportSnapshot.Named(value.Id, value.Label)).ToList());
    }

    public static IReadOnlyList<CompanyImportSheetInput> Inputs(CompanyImportSession session)
        => session.Sources.Select(source => new CompanyImportSheetInput(source.FileId, source.FileName, source.SheetName, source.Order,
            source.Kind, source.Readings, source.Rows)).ToList();
}

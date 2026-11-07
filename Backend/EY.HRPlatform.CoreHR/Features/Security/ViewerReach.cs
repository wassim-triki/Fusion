using EY.HRPlatform.CoreHR.Features.People.Changes;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Security;

/// <summary>The units "their unit" covers for one person today, and how many people work in them besides that person.</summary>
public sealed record ViewerUnitReachDto(IReadOnlyList<ViewerUnitDto> Units, int People);

/// <param name="Depth">0 for the unit they work in, 1 for a unit under it, and so on.</param>
public sealed record ViewerUnitDto(Guid OrgUnitId, string Name, int Depth, int People);

/// <summary>
/// Whose records a viewer reaches beyond their own, for one grant's scope (B-212). A team is everyone below them
/// through primary lines; a unit adds everyone whose primary assignment today is in the unit the viewer works in or a
/// unit under it, so it follows the organization as people and units move. Every read is the caller's tenant through
/// the query filters; the viewer themselves is never in the set (their own record is read as their own).
/// </summary>
public static class ViewerReach
{
    public static async Task<HashSet<Guid>> PeopleAsync(CoreHRDbContext db, Guid viewerId, string scope, CancellationToken ct)
    {
        var people = await ChangeSupport.BranchAsync(db, viewerId, ct);
        if (scope == PermissionScopes.OrgUnit)
        {
            var units = (await UnitsAsync(db, viewerId, ct)).Select(unit => unit.OrgUnitId).ToHashSet();
            var at = Today();
            people.UnionWith(await db.WorkAssignments.AsNoTracking()
                .Where(w => w.IsPrimary && units.Contains(w.OrgUnitId) && w.EffectiveFrom <= at && (w.EffectiveTo == null || at < w.EffectiveTo))
                .Select(w => w.EmployeeId)
                .ToListAsync(ct));
        }

        people.Remove(viewerId);
        return people;
    }

    /// <summary>For the role page's preview: the viewer's unit, the units under it in tree order, and the people in each.</summary>
    public static async Task<ViewerUnitReachDto> DescribeAsync(CoreHRDbContext db, Guid viewerId, CancellationToken ct)
    {
        var units = await UnitsAsync(db, viewerId, ct);
        var at = Today();
        var ids = units.Select(unit => unit.OrgUnitId).ToList();
        var members = await db.WorkAssignments.AsNoTracking()
            .Where(w => w.IsPrimary && ids.Contains(w.OrgUnitId) && w.EffectiveFrom <= at && (w.EffectiveTo == null || at < w.EffectiveTo))
            .Select(w => new { w.EmployeeId, w.OrgUnitId })
            .ToListAsync(ct);
        var byUnit = members.GroupBy(m => m.OrgUnitId).ToDictionary(g => g.Key, g => g.Select(m => m.EmployeeId).Distinct().Count());
        var people = await PeopleAsync(db, viewerId, PermissionScopes.OrgUnit, ct);
        return new(units.Select(unit => unit with { People = byUnit.GetValueOrDefault(unit.OrgUnitId) }).ToList(), people.Count);
    }

    /// <summary>The unit the viewer works in today and every unit under it, depth first; empty without a primary assignment.</summary>
    private static async Task<IReadOnlyList<ViewerUnitDto>> UnitsAsync(CoreHRDbContext db, Guid viewerId, CancellationToken ct)
    {
        var at = Today();
        var own = await db.WorkAssignments.AsNoTracking()
            .Where(w => w.EmployeeId == viewerId && w.IsPrimary && w.EffectiveFrom <= at && (w.EffectiveTo == null || at < w.EffectiveTo))
            .OrderByDescending(w => w.EffectiveFrom)
            .Select(w => (Guid?)w.OrgUnitId)
            .FirstOrDefaultAsync(ct);
        if (own is not { } root) return [];

        var day = DateOnly.FromDateTime(at);
        var states = (await db.OrgUnitEffectiveStates.AsNoTracking()
                .Where(s => s.EffectiveFrom <= day && (s.EffectiveTo == null || day < s.EffectiveTo))
                .Select(s => new { s.OrgUnitId, s.ParentOrgUnitId, s.Name })
                .ToListAsync(ct))
            .GroupBy(s => s.OrgUnitId)
            .Select(g => g.First())
            .ToList();
        var names = states.ToDictionary(s => s.OrgUnitId, s => s.Name);
        var children = states.Where(s => s.ParentOrgUnitId is not null)
            .ToLookup(s => s.ParentOrgUnitId!.Value, s => s.OrgUnitId);

        var result = new List<ViewerUnitDto>();
        var seen = new HashSet<Guid>();
        void Walk(Guid unit, int depth)
        {
            if (!seen.Add(unit)) return;
            result.Add(new(unit, names.GetValueOrDefault(unit) ?? "", depth, 0));
            foreach (var child in children[unit].OrderBy(id => names.GetValueOrDefault(id), StringComparer.CurrentCultureIgnoreCase))
                Walk(child, depth + 1);
        }

        Walk(root, 0);
        return result;
    }

    private static DateTime Today() => DateTime.SpecifyKind(DateTime.UtcNow.Date, DateTimeKind.Utc);
}

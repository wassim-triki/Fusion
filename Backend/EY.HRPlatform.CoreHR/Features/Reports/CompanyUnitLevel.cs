using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Reports;

/// <summary>What a company calls its top-level groups: the word the front page, org chart and Reports show.</summary>
public static class CompanyUnitLevel
{
    public const string Division = "Division";
    public const string Department = "Department";
    public const string Unit = "Unit";

    public static string Of(IEnumerable<Guid?> unitTypes)
    {
        var types = unitTypes.ToHashSet();
        return types.Contains(OrganizationalUnitTypeCatalog.DivisionId) ? Division
            : types.Contains(OrganizationalUnitTypeCatalog.DepartmentId) ? Department
            : Unit;
    }

    public static async Task<string> ReadAsync(CoreHRDbContext db, CancellationToken ct)
        => Of(await db.OrgUnitEffectiveStates.AsNoTracking()
            .Select(state => (Guid?)state.OrganizationalUnitTypeId).Distinct().ToListAsync(ct));
}

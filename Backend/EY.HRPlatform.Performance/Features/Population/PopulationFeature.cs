using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Population;

/// <summary>Who a year is for: everyone active in Core HR on its first day (D-91), resolved when it launches.</summary>
public static class YearPopulation
{
    public static async Task<PopulationDefinition> LoadOrCreateDefinitionAsync(
        PerformanceDbContext db, ITenantContext tenant, PerformanceCycle cycle, CancellationToken cancellationToken)
    {
        var definition = await db.PopulationDefinitions
            .Include(d => d.OrgUnitSelections)
            .Include(d => d.Inclusions)
            .Include(d => d.Exclusions)
            .FirstOrDefaultAsync(d => d.CycleId == cycle.Id, cancellationToken);
        if (definition is null)
        {
            definition = PopulationDefinition.Create(tenant.TenantId, cycle.Id, cycle.StartDate);
            db.PopulationDefinitions.Add(definition);
        }
        return definition;
    }
}

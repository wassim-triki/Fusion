using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>Every tenant-owned table is filtered to the caller's tenant (owned types follow their owner); a new one without a filter fails here.</summary>
public sealed class TenantFilterTests
{
    [Fact]
    public void Every_tenant_entity_has_a_query_filter()
    {
        using var db = TestStore.ForNewTenant().NewContext();
        var unfiltered = db.Model.GetEntityTypes()
            .Where(type => typeof(ITenantEntity).IsAssignableFrom(type.ClrType) && type.BaseType is null && !type.IsOwned())
            .Where(type => !type.GetDeclaredQueryFilters().Any())
            .Select(type => type.ClrType.Name)
            .ToList();
        Assert.Empty(unfiltered);
    }
}

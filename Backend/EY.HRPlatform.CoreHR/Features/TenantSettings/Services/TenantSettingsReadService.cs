using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.EmployeeFields;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.TenantSettings.Services;

public interface ITenantSettingsReadService
{
    Task<TenantSettingsDto> GetCurrentAsync(CancellationToken cancellationToken);
}

public sealed class TenantSettingsReadService(CoreHRDbContext dbContext, EmployeeFieldService? employeeFields = null) : ITenantSettingsReadService
{
    public async Task<TenantSettingsDto> GetCurrentAsync(CancellationToken cancellationToken)
    {
        var settings = await dbContext.TenantSettings
            .AsNoTracking()
            .FirstOrDefaultAsync(cancellationToken);

        var merged = TenantSettingsMerger.Merge(settings?.SettingsOverrides, settings?.Version);
        var stored = employeeFields is null ? null : await employeeFields.StoredPolicyAsync(cancellationToken);
        return stored is null ? merged : merged with { EmployeeFieldConfig = stored };
    }
}

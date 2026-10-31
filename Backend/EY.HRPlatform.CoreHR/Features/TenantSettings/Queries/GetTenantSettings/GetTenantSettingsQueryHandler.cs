using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.SharedKernel.CQRS;

namespace EY.HRPlatform.CoreHR.Features.TenantSettings.Queries.GetTenantSettings;

public sealed class GetTenantSettingsQueryHandler(
    ITenantSettingsReadService settings) : IQueryHandler<GetTenantSettingsQuery, TenantSettingsDto>
{
    public async Task<TenantSettingsDto> Handle(
        GetTenantSettingsQuery request,
        CancellationToken cancellationToken)
    {
        return await settings.GetCurrentAsync(cancellationToken);
    }
}

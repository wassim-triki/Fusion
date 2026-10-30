using EY.HRPlatform.Identity.Features.Invitations;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Localization;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Features.Branding;

/// <summary>What an invitation from a company needs of its brand: the language to write in and the colour and logo.</summary>
public sealed record InvitationBranding(string Language, InvitationBrand Brand);

/// <summary>Reads a company's brand for the emails it sends. Tenant rows are read by id, past the tenant filter.</summary>
public static class CompanyBrandReader
{
    public static async Task<InvitationBranding> ForInvitationAsync(
        AppIdentityDbContext dbContext, Guid tenantId, CancellationToken cancellationToken)
    {
        var tenant = await dbContext.Tenants
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item => item.Id == tenantId)
            .Select(item => new { item.Locale, item.BrandColor, item.LogoVersion })
            .FirstOrDefaultAsync(cancellationToken);
        if (tenant is null)
            return new InvitationBranding(FusionLanguages.Default, new InvitationBrand(null, null));

        var logo = tenant.LogoVersion is null
            ? null
            : await dbContext.TenantLogos
                .AsNoTracking()
                .Where(item => item.TenantId == tenantId)
                .Select(item => item.Content)
                .FirstOrDefaultAsync(cancellationToken);

        return new InvitationBranding(
            FusionLanguages.FromLocale(tenant.Locale) ?? FusionLanguages.Default,
            new InvitationBrand(tenant.BrandColor, logo));
    }
}

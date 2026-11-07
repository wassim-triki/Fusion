using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Localization;
using EY.HRPlatform.SharedKernel.Notifications;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Features.Notifications;

/// <summary>
/// What a module needs to write someone an email: their account language, and the company's name, time zone and brand.
/// Reads only within the named tenant, through that tenant's memberships.
/// </summary>
public sealed class NotificationAudienceReader(AppIdentityDbContext db)
{
    public async Task<NotificationAudience?> ReadAsync(NotificationAudienceRequest request, CancellationToken cancellationToken)
    {
        var tenant = await db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(candidate => candidate.Id == request.TenantId)
            .Select(candidate => new { candidate.Name, candidate.Locale, candidate.TimeZone, candidate.BrandColor, candidate.LogoVersion })
            .FirstOrDefaultAsync(cancellationToken);
        if (tenant is null) return null;

        var employeeIds = request.EmployeeIds.Where(id => id != Guid.Empty).Distinct().ToArray();
        var chosen = employeeIds.Length == 0 ? [] : await db.TenantMemberships.IgnoreQueryFilters().AsNoTracking()
            .Where(membership => membership.TenantId == request.TenantId && membership.EmployeeId != null
                && employeeIds.Contains(membership.EmployeeId.Value))
            .Select(membership => new { EmployeeId = membership.EmployeeId!.Value, membership.User!.PreferredLanguage })
            .ToListAsync(cancellationToken);

        var company = FusionLanguages.Resolve(null, tenant.Locale);
        var recipients = chosen.GroupBy(row => row.EmployeeId)
            .Select(group => new NotificationRecipientLanguage(group.Key,
                FusionLanguages.Resolve(group.Select(row => row.PreferredLanguage).FirstOrDefault(FusionLanguages.IsSupported), tenant.Locale)))
            .ToList();
        var logo = tenant.LogoVersion is null ? null : await db.TenantLogos.IgnoreQueryFilters().AsNoTracking()
            .Where(item => item.TenantId == request.TenantId).Select(item => item.Content).FirstOrDefaultAsync(cancellationToken);
        return new NotificationAudience(tenant.Name, tenant.TimeZone, company, recipients, tenant.BrandColor, logo);
    }
}

using EY.HRPlatform.CoreHR.Exceptions;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.TenantSettings.Commands.UpdateTenantSettings;

public sealed partial class UpdateTenantSettingsCommandHandler(
    CoreHRDbContext dbContext,
    ITenantContext tenantContext) : ICommandHandler<UpdateTenantSettingsCommand, Result<TenantSettingsDto>>
{
    private static readonly HashSet<string> KnownFieldNames = TenantSettingsDto.DefaultEmployeeFieldConfig.Keys.ToHashSet();
    private static readonly HashSet<string> CoreIdentityFields = ["firstName", "lastName", "email"];
    private static readonly HashSet<string> OperationallyRequiredFields = ["firstName", "lastName", "hireDate"];

    public async Task<Result<TenantSettingsDto>> Handle(UpdateTenantSettingsCommand request, CancellationToken cancellationToken)
    {
        if (!tenantContext.IsResolved || tenantContext.TenantId == Guid.Empty)
            throw new UnauthorizedAccessException("A company is required.");
        ValidateRequest(request);
        var settings = await dbContext.TenantSettings.FirstOrDefaultAsync(cancellationToken);
        if (settings is null)
        {
            var overrides = TenantSettingsOverrideBuilder.Build(null, request.EmployeeFieldConfig, request.Branding, request.SelfService, request.Provisioning,
                request.OrgChart, request.WorkingDays);
            settings = Domain.Entities.TenantSettings.Create(tenantContext.TenantId, overrides);
            dbContext.TenantSettings.Add(settings);
        }
        else
        {
            if (!request.ExpectedVersion.HasValue || settings.Version != request.ExpectedVersion.Value)
                throw new ConcurrencyException("TenantSettings", settings.Id);
            settings.UpdateOverrides(TenantSettingsOverrideBuilder.Build(
                settings.SettingsOverrides,
                request.EmployeeFieldConfig,
                request.Branding,
                request.SelfService,
                request.Provisioning,
                request.OrgChart, request.WorkingDays));
        }

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            throw new ConcurrencyException("TenantSettings", settings.Id);
        }
        return Result.Success(TenantSettingsMerger.Merge(settings.SettingsOverrides, settings.Version));
    }

    private static void ValidateRequest(UpdateTenantSettingsCommand request)
    {
        if (request.WorkingDays is { } days && (days.Length == 0 || days.Length > 7
            || days.Any(day => day is < 1 or > 7) || days.Distinct().Count() != days.Length))
            throw new ArgumentException("Choose at least one working day, with each day listed once (Monday = 1 through Sunday = 7).");
        if (request.EmployeeFieldConfig is not null)
        {
            var unknown = request.EmployeeFieldConfig.Keys.Where(key => !KnownFieldNames.Contains(key)).ToList();
            if (unknown.Count > 0) throw new ArgumentException($"Unknown field names: {string.Join(", ", unknown)}");
            foreach (var (fieldName, config) in request.EmployeeFieldConfig)
            {
                if (CoreIdentityFields.Contains(fieldName)
                    && ((config.Visible.HasValue && !config.Visible.Value)
                        || (config.VisibleToEmployee.HasValue && !config.VisibleToEmployee.Value)
                        || (config.VisibleToManager.HasValue && !config.VisibleToManager.Value)))
                    throw new ArgumentException($"'{fieldName}' is a core field and cannot be hidden.");
                if (OperationallyRequiredFields.Contains(fieldName) && config.Required is false)
                    throw new ArgumentException($"'{fieldName}' is operationally required and cannot be made optional.");
            }
        }
        if (request.Branding?.LogoUrl is not null && !Uri.TryCreate(request.Branding.LogoUrl, UriKind.Absolute, out _))
            throw new ArgumentException("LogoUrl must be a valid absolute URL.");
        if (request.OrgChart?.Audience is { } audience && !OrgChartAudiences.All.Contains(audience))
            throw new ArgumentException($"Org chart audience must be one of: {string.Join(", ", OrgChartAudiences.All)}.");
        if (request.Provisioning?.InviteExpiryDays is < 1 or > 90)
            throw new ArgumentException("InviteExpiryDays must be between 1 and 90.");
        if (request.Provisioning?.ResendCooldownHours is < 0 or > 720)
            throw new ArgumentException("ResendCooldownHours must be between 0 and 720.");
        if (request.Provisioning?.RemindAfterDays is < 0 or > 30)
            throw new ArgumentException("RemindAfterDays must be between 0 and 30.");
    }
}

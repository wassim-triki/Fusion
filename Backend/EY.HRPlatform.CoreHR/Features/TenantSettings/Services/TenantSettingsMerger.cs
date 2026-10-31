using System.Text.Json;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;

namespace EY.HRPlatform.CoreHR.Features.TenantSettings.Services;

public static class TenantSettingsMerger
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static TenantSettingsDto Merge(string? overridesJson, uint? version = null)
    {
        if (string.IsNullOrWhiteSpace(overridesJson))
            return TenantSettingsDto.Defaults with { Version = version };

        var overrides = JsonSerializer.Deserialize<TenantSettingsOverrides>(overridesJson, JsonOptions);
        if (overrides is null)
            return TenantSettingsDto.Defaults with { Version = version };

        var defaults = TenantSettingsDto.Defaults;
        return new TenantSettingsDto
        {
            Version = version,
            EmployeeFieldConfig = MergeFieldConfig(defaults.EmployeeFieldConfig, overrides.EmployeeFieldConfig),
            Branding = new BrandingSettings
            {
                LogoUrl = overrides.Branding?.LogoUrl ?? defaults.Branding.LogoUrl,
            },
            SelfService = new SelfServiceSettings(
                overrides.SelfService?.CanEditPreferredName ?? defaults.SelfService.CanEditPreferredName,
                overrides.SelfService?.CanEditPhone ?? defaults.SelfService.CanEditPhone),
            Provisioning = new ProvisioningSettings(
                overrides.Provisioning?.DefaultAccessProfileId ?? defaults.Provisioning.DefaultAccessProfileId,
                overrides.Provisioning?.InviteExpiryDays ?? defaults.Provisioning.InviteExpiryDays,
                overrides.Provisioning?.ResendCooldownHours ?? defaults.Provisioning.ResendCooldownHours,
                overrides.Provisioning?.PendingInviteBehavior ?? defaults.Provisioning.PendingInviteBehavior,
                overrides.Provisioning?.RemindAfterDays ?? defaults.Provisioning.RemindAfterDays,
                overrides.Provisioning?.InviteJoinersOnFirstDay ?? defaults.Provisioning.InviteJoinersOnFirstDay),
            OrgChart = new OrgChartSettings(overrides.OrgChart?.Audience ?? defaults.OrgChart.Audience),
        };
    }

    private static Dictionary<string, FieldConfig> MergeFieldConfig(
        Dictionary<string, FieldConfig> defaults,
        Dictionary<string, FieldConfigOverrides>? overrides)
    {
        if (overrides is null || overrides.Count == 0) return defaults;
        var merged = new Dictionary<string, FieldConfig>(defaults);
        foreach (var (key, value) in overrides)
        {
            var baseline = defaults.TryGetValue(key, out var existing)
                ? existing
                : new FieldConfig(false, false);
            merged[key] = new FieldConfig(
                value.Visible ?? baseline.Visible,
                value.Required ?? baseline.Required,
                value.VisibleToEmployee ?? baseline.VisibleToEmployee,
                value.VisibleToManager ?? baseline.VisibleToManager);
        }
        return merged;
    }

    private sealed record TenantSettingsOverrides
    {
        public Dictionary<string, FieldConfigOverrides>? EmployeeFieldConfig { get; init; }
        public BrandingSettingsOverrides? Branding { get; init; }
        public SelfServiceSettingsOverrides? SelfService { get; init; }
        public ProvisioningSettingsOverrides? Provisioning { get; init; }
        public OrgChartSettingsOverrides? OrgChart { get; init; }
    }

    private sealed record FieldConfigOverrides(bool? Visible, bool? Required, bool? VisibleToEmployee, bool? VisibleToManager);
    private sealed record BrandingSettingsOverrides(string? LogoUrl);
    private sealed record SelfServiceSettingsOverrides(bool? CanEditPreferredName, bool? CanEditPhone);
    private sealed record OrgChartSettingsOverrides(string? Audience);
    private sealed record ProvisioningSettingsOverrides(Guid? DefaultAccessProfileId, int? InviteExpiryDays, int? ResendCooldownHours, string? PendingInviteBehavior,
        int? RemindAfterDays = null, bool? InviteJoinersOnFirstDay = null);
}

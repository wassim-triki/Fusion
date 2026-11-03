namespace EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;

/// <summary>
/// Request payload for partial tenant settings updates.
/// All properties are nullable to support true partial updates.
/// </summary>
public sealed record UpdateTenantSettingsRequest(
    Dictionary<string, FieldConfigInput>? EmployeeFieldConfig,
    BrandingSettingsInput? Branding,
    SelfServiceSettingsInput? SelfService,
    ProvisioningSettingsInput? Provisioning,
    OrgChartSettingsInput? OrgChart = null,
    int[]? WorkingDays = null
);

/// <summary>
/// Input type for field configuration with nullable properties for partial updates.
/// </summary>
public sealed record FieldConfigInput(
    bool? Visible,
    bool? Required,
    bool? VisibleToEmployee,
    bool? VisibleToManager
);

/// <summary>
/// Input type for branding settings with nullable properties for partial updates. There is no brand colour
/// (B-071 D9): a colour an older client sends is dropped by the JSON reader.
/// </summary>
public sealed record BrandingSettingsInput(string? LogoUrl);

public sealed record SelfServiceSettingsInput(
    bool? CanEditPreferredName,
    bool? CanEditPhone);

/// <summary>Who sees the org chart: one of <see cref="OrgChartAudiences"/>.</summary>
public sealed record OrgChartSettingsInput(string? Audience);

public sealed record ProvisioningSettingsInput(
    Guid? DefaultAccessProfileId,
    int? InviteExpiryDays,
    int? ResendCooldownHours,
    string? PendingInviteBehavior,
    int? RemindAfterDays = null,
    bool? InviteJoinersOnFirstDay = null);

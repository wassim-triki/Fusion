namespace EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;

/// <summary>Core HR's section ids in Fusion Settings, which are also their page addresses under `/core/settings`.</summary>
public static class CoreSettingsSectionIds
{
    /// <summary>The company's brand: name, logo, colour, default language (B-176); stored in Identity.</summary>
    public const string Brand = "brand";
    /// <summary>The company's remaining facts: workspace, industry, time zone, modules.</summary>
    public const string Details = "details";
    public const string EmployeeFields = "employee-fields";
    public const string Lists = "lists";
    public const string Roles = "roles";
    public const string Invitations = "invitations";
    public const string ChangeHistory = "change-history";
    public const string Notifications = "notifications";
}

/// <summary>The section ids recorded on <c>SettingsAuditEvent</c>, kept so existing history still attributes.</summary>
public static class SettingsSectionIds
{
    public const string Overview = "overview";
    public const string Organization = "organization";
    public const string PeopleData = "people-data";
    public const string Structure = "structure";
    public const string AccessPermissions = "access-permissions";
    public const string Provisioning = "provisioning";
    public const string Governance = "governance";
    public const string Notifications = "notifications";
    public const string Lists = "lists";
}

public sealed record OrganizationSettingsDto(
    uint? Version,
    string DisplayName,
    string Locale,
    string TimeZone,
    BrandingSettings Branding,
    bool UsesDefaultBranding);

public sealed record PeopleDataSettingsDto(
    uint? Version,
    Dictionary<string, FieldConfig> EmployeeFieldConfig,
    SelfServiceSettings SelfService,
    IReadOnlyList<string> DownstreamConsumers,
    OrgChartSettings OrgChart);

public sealed record ProvisioningSettingsDto(
    uint? Version,
    ProvisioningSettings Provisioning,
    IReadOnlyList<string> DownstreamConsumers);

public sealed record SettingsAuditEventDto(
    Guid Id,
    DateTime OccurredAt,
    string ActorName,
    string ActorRole,
    string SectionId,
    string Action,
    string ResourceType,
    string? ResourceId,
    string Summary,
    string? BeforeJson,
    string? AfterJson,
    string? CorrelationId);

/// <summary>How one employee field is treated on profiles. HR always sees every field.</summary>
public sealed record FieldVisibilityRuleDto(bool Required, bool VisibleToEmployee, bool VisibleToManager);

/// <summary>
/// The field policy profiles read (B-071 D9): per-field visibility, what employees edit themselves, and who sees the
/// org chart (so every surface can hide what leads to it).
/// </summary>
public sealed record FieldVisibilityDto(
    IReadOnlyDictionary<string, FieldVisibilityRuleDto> Fields,
    SelfServiceSettings SelfService,
    OrgChartSettings OrgChart);

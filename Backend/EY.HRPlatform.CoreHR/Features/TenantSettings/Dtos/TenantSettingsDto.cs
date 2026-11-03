namespace EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;

/// <summary>
/// Tenant-level configuration settings.
/// Used as the response shape and to define defaults.
/// </summary>
public sealed record TenantSettingsDto
{
    /// <summary>
    /// Row version for optimistic concurrency (used in ETag).
    /// Null when returning defaults (no database row exists).
    /// </summary>
    public uint? Version { get; init; }

    /// <summary>ISO weekdays, Monday = 1 through Sunday = 7. Default: Monday–Friday.</summary>
    public int[] WorkingDays { get; init; } = [1, 2, 3, 4, 5];

    /// <summary>
    /// Field visibility and requirement configuration for employee records.
    /// </summary>
    public Dictionary<string, FieldConfig> EmployeeFieldConfig { get; init; } = DefaultEmployeeFieldConfig;

    /// <summary>
    /// Tenant branding configuration.
    /// </summary>
    public BrandingSettings Branding { get; init; } = new();

    /// <summary>
    /// Employee self-service editing policies.
    /// </summary>
    public SelfServiceSettings SelfService { get; init; } = new();

    /// <summary>
    /// Workforce account provisioning and invitation defaults.
    /// </summary>
    public ProvisioningSettings Provisioning { get; init; } = new();

    /// <summary>
    /// Who sees the org chart (B-152): everyone, or only managers (their own line) and people who read the whole workforce.
    /// </summary>
    public OrgChartSettings OrgChart { get; init; } = new();

    /// <summary>
    /// Default field configuration for employee records.
    /// All fields default to visible for all roles.
    /// </summary>
    public static Dictionary<string, FieldConfig> DefaultEmployeeFieldConfig => new()
    {
        ["firstName"] = new(Visible: true, Required: true, VisibleToEmployee: true, VisibleToManager: true),
        ["lastName"] = new(Visible: true, Required: true, VisibleToEmployee: true, VisibleToManager: true),
        ["email"] = new(Visible: true, Required: false, VisibleToEmployee: true, VisibleToManager: true),
        ["hireDate"] = new(Visible: true, Required: true, VisibleToEmployee: true, VisibleToManager: true),
        ["phone"] = new(Visible: true, Required: false, VisibleToEmployee: true, VisibleToManager: true),
        ["jobTitle"] = new(Visible: true, Required: false, VisibleToEmployee: true, VisibleToManager: true),
        ["workLocation"] = new(Visible: true, Required: false, VisibleToEmployee: true, VisibleToManager: true),
        ["employmentType"] = new(Visible: true, Required: false, VisibleToEmployee: true, VisibleToManager: true)
    };

    /// <summary>
    /// Creates a new instance with all default values.
    /// </summary>
    public static TenantSettingsDto Defaults => new();
}

public sealed record SelfServiceSettings(
    bool CanEditPreferredName = true,
    bool CanEditPhone = true);

/// <summary>Who sees the org chart: <see cref="OrgChartAudiences"/>.</summary>
public sealed record OrgChartSettings(string Audience = OrgChartAudiences.Everyone);

public static class OrgChartAudiences
{
    /// <summary>Everyone with the org chart permission sees it as their grant allows (the default).</summary>
    public const string Everyone = "Everyone";

    /// <summary>
    /// People who read the whole workforce see it as before; managers see their own chain and branch; nobody else sees it.
    /// </summary>
    public const string ManagersAndHr = "ManagersAndHr";

    public static readonly IReadOnlySet<string> All = new HashSet<string>([Everyone, ManagersAndHr]);
}

public sealed record ProvisioningSettings(
    Guid? DefaultAccessProfileId = null,
    int InviteExpiryDays = 14,
    int ResendCooldownHours = 24,
    string PendingInviteBehavior = "RefreshExisting",
    /// <summary>Days after an invitation before Fusion sends one reminder; 0 sends none.</summary>
    int RemindAfterDays = 3,
    /// <summary>Joiners added before their first day get their invitation that morning.</summary>
    bool InviteJoinersOnFirstDay = true);

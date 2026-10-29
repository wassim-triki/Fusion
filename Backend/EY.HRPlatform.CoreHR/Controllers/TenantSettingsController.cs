using EY.HRPlatform.CoreHR.Features.Notifications;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Commands.UpdateTenantSettings;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Queries.GetTenantSettings;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Notifications;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.CoreHR.Controllers;

[ApiController]
[Route("api/corehr/settings")]
[Authorize]
public class TenantSettingsController(
    ISender sender,
    ICoreAccessPolicyService accessPolicy,
    ISettingsSectionRegistry sectionRegistry,
    ISettingsAuditService auditService,
    ITenantContext tenantContext) : ControllerBase
{
    /// <summary>The caller's Core HR settings sections (B-071 D1): empty when they can view none.</summary>
    [HttpGet("sections")]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<FusionSettingsSectionDto>>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<FusionSettingsSectionDto>>>> GetSections(CancellationToken cancellationToken)
    {
        var sections = await sectionRegistry.GetSectionsAsync(User, cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<FusionSettingsSectionDto>>.Success(sections));
    }

    /// <summary>
    /// The field policy every profile applies (B-071 D9): who sees each employee field and what employees edit
    /// themselves. Any signed-in member of the tenant may read it; nothing else from settings is included.
    /// </summary>
    [HttpGet("field-visibility")]
    [ProducesResponseType(typeof(ApiResponse<FieldVisibilityDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetFieldVisibility(CancellationToken cancellationToken)
    {
        if (!tenantContext.IsResolved || tenantContext.TenantId == Guid.Empty)
        {
            return Forbid();
        }

        var settings = await GetSettingsAsync(cancellationToken);
        var fields = settings.EmployeeFieldConfig.ToDictionary(
            field => field.Key,
            field => new FieldVisibilityRuleDto(field.Value.Required, field.Value.VisibleToEmployee, field.Value.VisibleToManager));
        return Ok(ApiResponse<FieldVisibilityDto>.Success(new FieldVisibilityDto(fields, settings.SelfService, settings.OrgChart)));
    }

    /// <summary>
    /// Get tenant settings for the current tenant.
    /// Returns merged platform defaults with tenant-specific overrides.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(ApiResponse<TenantSettingsDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewSettings(User))
        {
            return Forbid();
        }

        var settings = await sender.Send(new GetTenantSettingsQuery(), cancellationToken);

        if (settings.Version.HasValue)
            Response.Headers.ETag = $"\"{settings.Version}\"";

        return Ok(ApiResponse<TenantSettingsDto>.Success(settings));
    }

    [HttpGet("organization")]
    [ProducesResponseType(typeof(ApiResponse<OrganizationSettingsDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetOrganization(CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewOrganizationSettings(User))
        {
            return Forbid();
        }

        var settings = await GetSettingsAsync(cancellationToken);
        SetEtag(settings.Version);
        return Ok(ApiResponse<OrganizationSettingsDto>.Success(MapOrganization(settings)));
    }

    [HttpPatch("organization")]
    [ProducesResponseType(typeof(ApiResponse<OrganizationSettingsDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> PatchOrganization(
        [FromBody] UpdateOrganizationSettingsRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageOrganizationSettings(User))
        {
            return Forbid();
        }

        var before = await GetSettingsAsync(cancellationToken);
        var updated = await UpdateSettingsAsync(
            ifMatch,
            new UpdateTenantSettingsRequest(null, request.Branding, null, null),
            cancellationToken);

        await auditService.RecordAsync(
            SettingsSectionIds.Organization,
            "settings.organization.updated",
            "TenantSettings",
            null,
            "Organization settings updated.",
            MapOrganization(before),
            MapOrganization(updated),
            User,
            cancellationToken);

        SetEtag(updated.Version);
        return Ok(ApiResponse<OrganizationSettingsDto>.Success(MapOrganization(updated)));
    }

    /// <summary>The company's email mode per Core HR notification group (B-002 N7).</summary>
    [HttpGet("notifications")]
    [ProducesResponseType(typeof(ApiResponse<NotificationDefaultsDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetNotificationDefaults(
        [FromServices] CoreNotificationDefaultsService notificationDefaults, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewOrganizationSettings(User))
        {
            return Forbid();
        }

        return Ok(ApiResponse<NotificationDefaultsDto>.Success(await notificationDefaults.GetAsync(cancellationToken)));
    }

    [HttpPut("notifications")]
    [ProducesResponseType(typeof(ApiResponse<NotificationDefaultsDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> UpdateNotificationDefaults(
        [FromBody] UpdateNotificationDefaultsRequest request,
        [FromServices] CoreNotificationDefaultsService notificationDefaults,
        CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageOrganizationSettings(User))
        {
            return Forbid();
        }

        var (value, refusal) = await notificationDefaults.UpdateAsync(request, User, cancellationToken);
        return refusal switch
        {
            PreferencesRefusal.Changed => Conflict(ApiResponse<NotificationDefaultsDto>.Failure(
                "Someone else changed notification settings. Reload and try again.")),
            PreferencesRefusal.Invalid => BadRequest(ApiResponse<NotificationDefaultsDto>.Failure(
                "Each Core HR notification group is required, on or off.")),
            _ => Ok(ApiResponse<NotificationDefaultsDto>.Success(value!)),
        };
    }

    [HttpGet("people-data")]
    [ProducesResponseType(typeof(ApiResponse<PeopleDataSettingsDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetPeopleData(CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewPeopleDataSettings(User))
        {
            return Forbid();
        }

        var settings = await GetSettingsAsync(cancellationToken);
        SetEtag(settings.Version);
        return Ok(ApiResponse<PeopleDataSettingsDto>.Success(MapPeopleData(settings)));
    }

    [HttpPatch("people-data")]
    [ProducesResponseType(typeof(ApiResponse<PeopleDataSettingsDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> PatchPeopleData(
        [FromBody] UpdatePeopleDataSettingsRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManagePeopleDataSettings(User))
        {
            return Forbid();
        }

        var before = await GetSettingsAsync(cancellationToken);
        var updated = await UpdateSettingsAsync(
            ifMatch,
            new UpdateTenantSettingsRequest(request.EmployeeFieldConfig, null, request.SelfService, null, request.OrgChart),
            cancellationToken);

        await auditService.RecordAsync(
            SettingsSectionIds.PeopleData,
            "settings.peopleData.updated",
            "TenantSettings",
            null,
            "People data settings updated.",
            MapPeopleData(before),
            MapPeopleData(updated),
            User,
            cancellationToken);

        SetEtag(updated.Version);
        return Ok(ApiResponse<PeopleDataSettingsDto>.Success(MapPeopleData(updated)));
    }

    [HttpGet("provisioning")]
    [ProducesResponseType(typeof(ApiResponse<ProvisioningSettingsDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetProvisioning(CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewProvisioningSettings(User))
        {
            return Forbid();
        }

        var settings = await GetSettingsAsync(cancellationToken);
        SetEtag(settings.Version);
        return Ok(ApiResponse<ProvisioningSettingsDto>.Success(MapProvisioning(settings)));
    }

    [HttpPatch("provisioning")]
    [ProducesResponseType(typeof(ApiResponse<ProvisioningSettingsDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> PatchProvisioning(
        [FromBody] UpdateProvisioningSettingsRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageProvisioningSettings(User))
        {
            return Forbid();
        }

        var before = await GetSettingsAsync(cancellationToken);
        var updated = await UpdateSettingsAsync(
            ifMatch,
            new UpdateTenantSettingsRequest(null, null, null, request.Provisioning),
            cancellationToken);

        await auditService.RecordAsync(
            SettingsSectionIds.Provisioning,
            "settings.provisioning.updated",
            "TenantSettings",
            null,
            "Provisioning settings updated.",
            MapProvisioning(before),
            MapProvisioning(updated),
            User,
            cancellationToken);

        SetEtag(updated.Version);
        return Ok(ApiResponse<ProvisioningSettingsDto>.Success(MapProvisioning(updated)));
    }

    [HttpGet("governance/audit")]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<SettingsAuditEventDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetAudit([FromQuery] int take = 50, CancellationToken cancellationToken = default)
    {
        if (!accessPolicy.CanViewGovernanceSettings(User))
        {
            return Forbid();
        }

        var auditEvents = await auditService.GetRecentAsync(take, cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<SettingsAuditEventDto>>.Success(auditEvents));
    }

    /// <summary>
    /// Partial update of tenant settings.
    /// Creates settings if none exist (If-Match optional for creation).
    /// Updates existing settings (If-Match required, returns 409 if missing or mismatched).
    /// </summary>
    [HttpPatch]
    [ProducesResponseType(typeof(ApiResponse<TenantSettingsDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Patch(
        [FromBody] UpdateTenantSettingsRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageSettings(User))
        {
            return Forbid();
        }

        // Parse If-Match header (optional for creation, required for updates)
        uint? expectedVersion = TryParseVersion(ifMatch, out var version) ? version : null;

        var command = new UpdateTenantSettingsCommand(
            expectedVersion,
            request.EmployeeFieldConfig,
            request.Branding,
            request.SelfService,
            request.Provisioning,
            request.OrgChart);

        var before = await sender.Send(new GetTenantSettingsQuery(), cancellationToken);
        var result = await sender.Send(command, cancellationToken);

        if (result.Value.Version.HasValue)
            Response.Headers.ETag = $"\"{result.Value.Version}\"";

        foreach (var sectionId in ResolveMutatedSections(request))
        {
            await auditService.RecordAsync(
                sectionId,
                $"settings.{sectionId}.updated",
                "TenantSettings",
                null,
                $"{sectionId} settings updated.",
                before,
                result.Value,
                User,
                cancellationToken);
        }

        return Ok(ApiResponse<TenantSettingsDto>.Success(result.Value));
    }

    private async Task<TenantSettingsDto> GetSettingsAsync(CancellationToken cancellationToken)
        => await sender.Send(new GetTenantSettingsQuery(), cancellationToken);

    private async Task<TenantSettingsDto> UpdateSettingsAsync(
        string? ifMatch,
        UpdateTenantSettingsRequest request,
        CancellationToken cancellationToken)
    {
        uint? expectedVersion = TryParseVersion(ifMatch, out var version) ? version : null;
        var result = await sender.Send(new UpdateTenantSettingsCommand(
            expectedVersion,
            request.EmployeeFieldConfig,
            request.Branding,
            request.SelfService,
            request.Provisioning,
            request.OrgChart), cancellationToken);

        return result.Value;
    }

    private static OrganizationSettingsDto MapOrganization(TenantSettingsDto settings)
        => new(
            settings.Version,
            "Current organization",
            "en-US",
            "UTC",
            settings.Branding,
            settings.Branding.LogoUrl is null);

    private static PeopleDataSettingsDto MapPeopleData(TenantSettingsDto settings)
        => new(
            settings.Version,
            settings.EmployeeFieldConfig,
            settings.SelfService,
            ["Employee profiles", "Employee import validation", "Self-service profile forms", "Org chart"],
            settings.OrgChart);

    private static ProvisioningSettingsDto MapProvisioning(TenantSettingsDto settings)
        => new(
            settings.Version,
            settings.Provisioning,
            ["Access bulk invitations", "Pending invite refresh", "Default profile selection"]);

    private static IEnumerable<string> ResolveMutatedSections(UpdateTenantSettingsRequest request)
    {
        if (request.Branding is not null)
            yield return SettingsSectionIds.Organization;
        if (request.EmployeeFieldConfig is not null || request.SelfService is not null || request.OrgChart is not null)
            yield return SettingsSectionIds.PeopleData;
        if (request.Provisioning is not null)
            yield return SettingsSectionIds.Provisioning;
    }

    private void SetEtag(uint? version)
    {
        if (version.HasValue)
            Response.Headers.ETag = $"\"{version}\"";
    }

    private static bool TryParseVersion(string? ifMatch, out uint version)
    {
        version = 0;

        if (string.IsNullOrWhiteSpace(ifMatch))
            return false;

        // Remove surrounding quotes if present: "123" -> 123
        var trimmed = ifMatch.Trim().Trim('"');

        return uint.TryParse(trimmed, out version);
    }
}

public sealed record UpdateOrganizationSettingsRequest(BrandingSettingsInput? Branding);

public sealed record UpdatePeopleDataSettingsRequest(
    Dictionary<string, FieldConfigInput>? EmployeeFieldConfig,
    SelfServiceSettingsInput? SelfService,
    OrgChartSettingsInput? OrgChart = null);


public sealed record UpdateProvisioningSettingsRequest(ProvisioningSettingsInput? Provisioning);

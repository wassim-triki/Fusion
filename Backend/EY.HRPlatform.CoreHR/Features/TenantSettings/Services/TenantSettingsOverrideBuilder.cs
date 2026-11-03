using System.Text.Json;
using System.Text.Json.Nodes;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;

namespace EY.HRPlatform.CoreHR.Features.TenantSettings.Services;

public static class TenantSettingsOverrideBuilder
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    public static string? Build(
        string? existingOverridesJson,
        Dictionary<string, FieldConfigInput>? employeeFieldConfig,
        BrandingSettingsInput? branding,
        SelfServiceSettingsInput? selfService = null,
        ProvisioningSettingsInput? provisioning = null,
        OrgChartSettingsInput? orgChart = null,
        int[]? workingDays = null)
    {
        var root = string.IsNullOrWhiteSpace(existingOverridesJson)
            ? new JsonObject()
            : JsonNode.Parse(existingOverridesJson)?.AsObject() ?? new JsonObject();

        // Retired Organization setup keys are never carried forward by an active settings write.
        root.Remove("draftStructureSchema");
        root.Remove("orgUnitTypes");

        if (employeeFieldConfig is not null)
        {
            var existing = root["employeeFieldConfig"]?.AsObject() ?? new JsonObject();
            foreach (var (key, value) in employeeFieldConfig)
            {
                if (!value.Visible.HasValue && !value.Required.HasValue
                    && !value.VisibleToEmployee.HasValue && !value.VisibleToManager.HasValue)
                    continue;

                var field = existing[key]?.AsObject() ?? new JsonObject();
                if (value.Visible.HasValue) field["visible"] = value.Visible.Value;
                if (value.Required.HasValue) field["required"] = value.Required.Value;
                if (value.VisibleToEmployee.HasValue) field["visibleToEmployee"] = value.VisibleToEmployee.Value;
                if (value.VisibleToManager.HasValue) field["visibleToManager"] = value.VisibleToManager.Value;
                existing[key] = field;
            }
            if (existing.Count > 0) root["employeeFieldConfig"] = existing;
        }

        if (branding is not null)
        {
            var existing = root["branding"]?.AsObject() ?? new JsonObject();
            if (branding.LogoUrl is not null) existing["logoUrl"] = branding.LogoUrl;
            if (existing.Count > 0) root["branding"] = existing;
        }

        if (selfService is not null)
        {
            var existing = root["selfService"]?.AsObject() ?? new JsonObject();
            if (selfService.CanEditPreferredName.HasValue) existing["canEditPreferredName"] = selfService.CanEditPreferredName.Value;
            if (selfService.CanEditPhone.HasValue) existing["canEditPhone"] = selfService.CanEditPhone.Value;
            if (existing.Count > 0) root["selfService"] = existing;
        }

        if (provisioning is not null)
        {
            var existing = root["provisioning"]?.AsObject() ?? new JsonObject();
            if (provisioning.DefaultAccessProfileId.HasValue) existing["defaultAccessProfileId"] = provisioning.DefaultAccessProfileId.Value;
            if (provisioning.InviteExpiryDays.HasValue) existing["inviteExpiryDays"] = provisioning.InviteExpiryDays.Value;
            if (provisioning.ResendCooldownHours.HasValue) existing["resendCooldownHours"] = provisioning.ResendCooldownHours.Value;
            if (provisioning.PendingInviteBehavior is not null) existing["pendingInviteBehavior"] = provisioning.PendingInviteBehavior;
            if (provisioning.RemindAfterDays.HasValue) existing["remindAfterDays"] = provisioning.RemindAfterDays.Value;
            if (provisioning.InviteJoinersOnFirstDay.HasValue) existing["inviteJoinersOnFirstDay"] = provisioning.InviteJoinersOnFirstDay.Value;
            if (existing.Count > 0) root["provisioning"] = existing;
        }

        if (orgChart?.Audience is not null)
        {
            var existing = root["orgChart"]?.AsObject() ?? new JsonObject();
            existing["audience"] = orgChart.Audience;
            root["orgChart"] = existing;
        }

        if (workingDays is not null)
            root["workingDays"] = JsonSerializer.SerializeToNode(workingDays.Order().ToArray());

        return root.Count == 0 ? null : root.ToJsonString(JsonOptions);
    }
}

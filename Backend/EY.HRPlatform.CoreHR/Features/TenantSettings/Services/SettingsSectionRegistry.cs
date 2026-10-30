using System.Security.Claims;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Api;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.TenantSettings.Services;

/// <summary>
/// Core HR's settings sections in Fusion Settings (B-071 D1): what the caller may open, with each section's last
/// change. The list is advisory; every read and write re-checks its own permission.
/// </summary>
public interface ISettingsSectionRegistry
{
    /// <summary>The sections the caller can view, in order, without last changes.</summary>
    IReadOnlyList<FusionSettingsSectionDto> GetVisibleSections(ClaimsPrincipal user);

    Task<IReadOnlyList<FusionSettingsSectionDto>> GetSectionsAsync(ClaimsPrincipal user, CancellationToken cancellationToken);
}

public sealed class SettingsSectionRegistry(
    ICoreAccessPolicyService accessPolicy, CoreHRDbContext dbContext, IWorkforceAccessIdentityClient identity) : ISettingsSectionRegistry
{
    private const string Someone = "Someone";

    /// <summary>
    /// One section: its audit section id (null when Core records no settings changes for it), and how its view and
    /// manage access are decided. A section with no manage rule is read-only for everyone.
    /// </summary>
    private sealed record Section(
        string Id,
        string Label,
        string? AuditSectionId,
        Func<ICoreAccessPolicyService, ClaimsPrincipal, bool> CanView,
        Func<ICoreAccessPolicyService, ClaimsPrincipal, bool>? CanManage);

    private static readonly IReadOnlyList<Section> All =
    [
        new(CoreSettingsSectionIds.Company, "Company", SettingsSectionIds.Organization,
            (policy, user) => policy.CanViewOrganizationSettings(user), (policy, user) => policy.CanManageOrganizationSettings(user)),
        new(CoreSettingsSectionIds.EmployeeFields, "Employee fields", SettingsSectionIds.PeopleData,
            (policy, user) => policy.CanViewPeopleDataSettings(user), (policy, user) => policy.CanManagePeopleDataSettings(user)),
        new(CoreSettingsSectionIds.Lists, "Lists", SettingsSectionIds.Lists,
            (policy, user) => policy.CanViewPeopleDataSettings(user), (policy, user) => policy.CanManageLists(user)),
        new(CoreSettingsSectionIds.Roles, "Roles", SettingsSectionIds.AccessPermissions,
            (policy, user) => policy.CanViewAccessProfiles(user), (policy, user) => policy.CanManageAccessProfiles(user)),
        new(CoreSettingsSectionIds.Invitations, "Invitations", SettingsSectionIds.Provisioning,
            (policy, user) => policy.CanViewProvisioningSettings(user), (policy, user) => policy.CanManageProvisioningSettings(user)),
        new(CoreSettingsSectionIds.Notifications, "Notifications", SettingsSectionIds.Notifications,
            (policy, user) => policy.CanViewOrganizationSettings(user), (policy, user) => policy.CanManageOrganizationSettings(user)),
        new(CoreSettingsSectionIds.ChangeHistory, "Change history", null,
            (policy, user) => policy.CanViewGovernanceSettings(user), null),
    ];

    public IReadOnlyList<FusionSettingsSectionDto> GetVisibleSections(ClaimsPrincipal user)
        => All
            .Select((section, index) => (section, index))
            .Where(item => item.section.CanView(accessPolicy, user))
            .Select(item => new FusionSettingsSectionDto(
                item.section.Id,
                item.section.Label,
                item.index + 1,
                $"/core/settings/{item.section.Id}",
                item.section.CanManage?.Invoke(accessPolicy, user) == true ? FusionSettingsSectionDto.Manage : FusionSettingsSectionDto.View,
                null))
            .ToList();

    public async Task<IReadOnlyList<FusionSettingsSectionDto>> GetSectionsAsync(ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        var visible = GetVisibleSections(user);
        if (visible.Count == 0) return visible;

        var auditIds = All.Select(section => section.AuditSectionId).OfType<string>().ToArray();
        var latest = (await dbContext.SettingsAuditEvents.AsNoTracking()
                .Where(auditEvent => auditIds.Contains(auditEvent.SectionId))
                .GroupBy(auditEvent => auditEvent.SectionId)
                .Select(group => group.OrderByDescending(auditEvent => auditEvent.OccurredAt)
                    .Select(auditEvent => new { auditEvent.SectionId, auditEvent.OccurredAt, auditEvent.ActorName })
                    .First())
                .ToListAsync(cancellationToken))
            .ToDictionary(change => change.SectionId);
        // Roles live in Identity, which keeps their audit; the list is advisory, so Identity being down shows no change.
        var roleChange = visible.Any(section => section.Id == CoreSettingsSectionIds.Roles) ? await RoleChangeAsync(cancellationToken) : null;
        var setUpAt = await dbContext.TenantSettings.AsNoTracking()
            .Select(settings => (DateTime?)settings.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);
        var notificationsSetUpAt = visible.Any(section => section.Id == CoreSettingsSectionIds.Notifications)
            ? await dbContext.NotificationDefaults.AsNoTracking().Select(defaults => (DateTime?)defaults.CreatedAt).FirstOrDefaultAsync(cancellationToken)
            : null;

        return visible.Select(section =>
        {
            var auditId = All.Single(item => item.Id == section.Id).AuditSectionId;
            var change = auditId is not null && latest.TryGetValue(auditId, out var found)
                ? new FusionSettingsLastChangeDto(found.OccurredAt, ActorName(found.ActorName))
                : null;
            if (section.Id == CoreSettingsSectionIds.Roles && roleChange is not null && (change is null || roleChange.OccurredAt > change.At))
                change = new FusionSettingsLastChangeDto(roleChange.OccurredAt, ActorName(roleChange.ActorName));
            return section with
            {
                LastChange = change,
                SetUpAt = auditId switch
                {
                    null or SettingsSectionIds.AccessPermissions => null,
                    SettingsSectionIds.Notifications => notificationsSetUpAt,
                    SettingsSectionIds.Lists => null,
                    _ => setUpAt,
                },
            };
        }).ToList();
    }

    private async Task<IdentityRoleChange?> RoleChangeAsync(CancellationToken cancellationToken)
    {
        try { return await identity.GetLatestRoleChangeAsync(cancellationToken); }
        catch (HttpRequestException) { return null; }
    }

    private static string ActorName(string recorded)
        => string.IsNullOrWhiteSpace(recorded) || recorded == "Unknown" || recorded.Contains('@') ? Someone : recorded;
}

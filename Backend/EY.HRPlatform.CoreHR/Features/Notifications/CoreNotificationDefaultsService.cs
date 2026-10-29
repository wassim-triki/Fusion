using System.Security.Claims;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Notifications;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Notifications;

/// <summary>
/// The company's email mode per Core HR group (B-002 N7), in Settings › Core HR › Notifications. People's own choices
/// are kept and read against the new modes. The caller's permission is checked by the controller.
/// </summary>
public sealed class CoreNotificationDefaultsService(CoreHRDbContext db, ITenantContext tenant, ISettingsAuditService audit)
{
    public const string Label = "Team and job changes";
    public const string Summary = "Your manager, your job, your team";

    public async Task<NotificationDefaultsDto> GetAsync(CancellationToken cancellationToken)
        => ToDto(await db.NotificationDefaults.AsNoTracking().FirstOrDefaultAsync(cancellationToken));

    public async Task<(NotificationDefaultsDto? Value, PreferencesRefusal Refusal)> UpdateAsync(UpdateNotificationDefaultsRequest request,
        ClaimsPrincipal actor, CancellationToken cancellationToken)
    {
        var modes = new Dictionary<string, NotificationEmailMode>(StringComparer.Ordinal);
        foreach (var (group, value) in request.Modes ?? new Dictionary<string, string>())
        {
            if (!CoreNotificationPreference.Groups.Contains(group) || NotificationEmailModes.Parse(value) is not { } mode)
                return (null, PreferencesRefusal.Invalid);
            modes[group] = mode;
        }

        var defaults = await db.NotificationDefaults.FirstOrDefaultAsync(cancellationToken);
        if (defaults is null)
        {
            if (request.ExpectedVersion != 0) return (null, PreferencesRefusal.Changed);
            defaults = CoreNotificationDefaults.For(tenant.TenantId);
            db.NotificationDefaults.Add(defaults);
        }
        else if (defaults.Version != request.ExpectedVersion)
        {
            return (null, PreferencesRefusal.Changed);
        }

        var before = ToDto(defaults);
        defaults.Set(modes);
        var after = ToDto(defaults);
        try
        {
            if (before.Groups.SequenceEqual(after.Groups))
                await db.SaveChangesAsync(cancellationToken);
            else
                await audit.RecordAsync(SettingsSectionIds.Notifications, "settings.notifications.updated", "NotificationDefaults",
                    defaults.Id.ToString(), "Notification email settings updated.",
                    before.Groups.ToDictionary(group => group.Key, group => group.Mode),
                    after.Groups.ToDictionary(group => group.Key, group => group.Mode), actor, cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Another save won the race (version or the one-row-per-tenant index).
            return (null, PreferencesRefusal.Changed);
        }
        return (ToDto(defaults), PreferencesRefusal.None);
    }

    private static NotificationDefaultsDto ToDto(CoreNotificationDefaults? defaults)
        => new(CoreNotificationPreference.Groups.Select(group => new NotificationDefaultGroupDto(group, Label, Summary,
            NotificationEmailModes.Name(CoreNotificationDefaults.ModeOf(defaults, group)),
            NotificationEmailModes.Name(CoreNotificationPreference.FusionDefault(group)))).ToList(), defaults?.Version ?? 0);
}

using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.SharedKernel.Notifications;

namespace EY.HRPlatform.Performance.Domain.Notifications;

/// <summary>
/// The company's email mode per Performance group (B-002 N7). No row means Fusion's defaults; a group not listed is On.
/// </summary>
public sealed class NotificationDefaults : PerformanceAggregate
{
    private NotificationDefaults() { }

    public List<string> Required { get; private set; } = [];
    public List<string> Off { get; private set; } = [];

    public static NotificationDefaults For(Guid tenantId)
    {
        if (tenantId == Guid.Empty) throw new ArgumentException("TenantId is required.", nameof(tenantId));
        var defaults = new NotificationDefaults { TenantId = tenantId };
        defaults.Required = NotificationGroups.All.Where(group => NotificationGroups.FusionDefault(group) == NotificationEmailMode.Required).ToList();
        defaults.Off = NotificationGroups.All.Where(group => NotificationGroups.FusionDefault(group) == NotificationEmailMode.Off).ToList();
        return defaults;
    }

    /// <summary>A group's mode, from the company's row or, without one, Fusion's default.</summary>
    public static NotificationEmailMode ModeOf(NotificationDefaults? defaults, string group)
        => defaults is null ? NotificationGroups.FusionDefault(group)
            : defaults.Required.Contains(group) ? NotificationEmailMode.Required
            : defaults.Off.Contains(group) ? NotificationEmailMode.Off
            : NotificationEmailMode.On;

    /// <summary>Sets the modes named; groups left out keep theirs. Unknown groups are refused.</summary>
    public void Set(IReadOnlyDictionary<string, NotificationEmailMode> modes)
    {
        if (modes.Keys.Any(group => !NotificationGroups.All.Contains(group)))
            throw new ArgumentException("Only Performance notification groups can be set.", nameof(modes));
        var next = NotificationGroups.All.ToDictionary(group => group, group => modes.TryGetValue(group, out var mode) ? mode : ModeOf(this, group));
        var required = NotificationGroups.All.Where(group => next[group] == NotificationEmailMode.Required).ToList();
        var off = NotificationGroups.All.Where(group => next[group] == NotificationEmailMode.Off).ToList();
        if (required.SequenceEqual(Required) && off.SequenceEqual(Off)) return;
        Required = required;
        Off = off;
        MarkUpdated();
    }
}

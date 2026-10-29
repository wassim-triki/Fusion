using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.SharedKernel.Notifications;

namespace EY.HRPlatform.Performance.Domain.Notifications;

/// <summary>
/// One person's email choices for Performance notifications (B-071 D8), kept for the recipient the feed uses: their
/// employee record or, without one, their account. Choices are stored against the company's modes (B-002 N7): no row
/// means the person follows the company.
/// </summary>
public sealed class NotificationPreference : PerformanceAggregate
{
    private NotificationPreference() { }

    public Guid? RecipientEmployeeId { get; private set; }
    public Guid? RecipientUserId { get; private set; }

    /// <summary>The groups the company has On that the person turned off.</summary>
    public List<string> EmailOff { get; private set; } = [];

    /// <summary>The groups the company has Off that the person turned on.</summary>
    public List<string> EmailOn { get; private set; } = [];

    public static NotificationPreference For(Guid tenantId, Guid? employeeId, Guid? userId)
    {
        if (tenantId == Guid.Empty) throw new ArgumentException("TenantId is required.", nameof(tenantId));
        if (employeeId is null && userId is null) throw new ArgumentException("A preference needs a recipient.");
        return new NotificationPreference { TenantId = tenantId, RecipientEmployeeId = employeeId, RecipientUserId = employeeId is null ? userId : null };
    }

    public static bool EmailsGroup(NotificationPreference? preference, NotificationDefaults? defaults, string group)
        => NotificationEmailModes.Sends(NotificationDefaults.ModeOf(defaults, group), group, preference?.EmailOn ?? [], preference?.EmailOff ?? []);

    /// <summary>
    /// Replaces the person's choices: <paramref name="wantedOff"/> names every group they want no email for. Groups the
    /// company requires and unknown groups can't be turned off.
    /// </summary>
    public void SetEmailOff(IReadOnlyCollection<string> wantedOff, NotificationDefaults? defaults)
    {
        if (wantedOff.Any(group => !NotificationGroups.All.Contains(group)))
            throw new ArgumentException("Only Performance notification groups can be turned off.", nameof(wantedOff));
        if (wantedOff.Any(group => NotificationDefaults.ModeOf(defaults, group) == NotificationEmailMode.Required))
            throw new ArgumentException("Your company requires this email.", nameof(wantedOff));
        var (on, off) = NotificationEmailModes.Overrides(
            NotificationGroups.All.Select(group => (group, NotificationDefaults.ModeOf(defaults, group))), wantedOff);
        if (on.SequenceEqual(EmailOn) && off.SequenceEqual(EmailOff)) return;
        EmailOn = on;
        EmailOff = off;
        MarkUpdated();
    }

    /// <summary>Turns one group's email off from an email's unsubscribe link; a group the company requires stays on.</summary>
    public void TurnOff(string group, NotificationDefaults? defaults)
    {
        var wantedOff = NotificationGroups.All
            .Where(item => item == group || !EmailsGroup(this, defaults, item))
            .Where(item => NotificationDefaults.ModeOf(defaults, item) != NotificationEmailMode.Required)
            .ToList();
        SetEmailOff(wantedOff, defaults);
    }
}

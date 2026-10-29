using System.Text.Json.Serialization;

namespace EY.HRPlatform.SharedKernel.Notifications;

/// <summary>
/// How a company emails one notification group (B-002 N7): always, on unless the person turns it off, or off unless
/// they turn it on. The bell is never affected. Each module keeps its own company modes and its people's choices.
/// </summary>
public enum NotificationEmailMode { Required, On, Off }

public static class NotificationEmailModes
{
    public const string Required = "required";
    public const string On = "on";
    public const string Off = "off";

    public static string Name(NotificationEmailMode mode) => mode switch
    {
        NotificationEmailMode.Required => Required,
        NotificationEmailMode.Off => Off,
        _ => On,
    };

    public static NotificationEmailMode? Parse(string? value) => value switch
    {
        Required => NotificationEmailMode.Required,
        On => NotificationEmailMode.On,
        Off => NotificationEmailMode.Off,
        _ => null,
    };

    /// <summary>
    /// Whether a person is emailed for a group: always when the company requires it, else their own choice when they
    /// made one against the company's mode, else the company's mode.
    /// </summary>
    public static bool Sends(NotificationEmailMode mode, string group, IReadOnlyCollection<string> emailOn, IReadOnlyCollection<string> emailOff)
        => mode == NotificationEmailMode.Required || emailOn.Contains(group) || (mode == NotificationEmailMode.On && !emailOff.Contains(group));

    /// <summary>
    /// A person's choices stored as what differs from the company: <c>Off</c> lists On groups they turned off, <c>On</c>
    /// lists Off groups they turned on. Required groups store nothing. <paramref name="wantedOff"/> names every
    /// switchable group the person wants no email for.
    /// </summary>
    public static (List<string> On, List<string> Off) Overrides(IEnumerable<(string Group, NotificationEmailMode Mode)> groups,
        IReadOnlyCollection<string> wantedOff)
    {
        var on = new List<string>();
        var off = new List<string>();
        foreach (var (group, mode) in groups)
        {
            if (mode == NotificationEmailMode.On && wantedOff.Contains(group)) off.Add(group);
            else if (mode == NotificationEmailMode.Off && !wantedOff.Contains(group)) on.Add(group);
        }
        return (on, off);
    }
}

/// <summary>One group's company mode in Settings › Notifications. <paramref name="Mode"/> and <paramref name="FusionDefault"/>
/// are <c>required</c>, <c>on</c> or <c>off</c>; the default is where a new company starts.</summary>
public sealed record NotificationDefaultGroupDto(string Key, string Label, string Summary, string Mode, string FusionDefault);

/// <summary>A module's company email modes. <paramref name="Version"/> is 0 before the company first saved.</summary>
public sealed record NotificationDefaultsDto(IReadOnlyList<NotificationDefaultGroupDto> Groups, uint Version);

/// <summary>Every group's mode by key; a group left out keeps its current mode.</summary>
public sealed record UpdateNotificationDefaultsRequest(
    [property: JsonRequired] uint ExpectedVersion,
    IReadOnlyDictionary<string, string>? Modes);

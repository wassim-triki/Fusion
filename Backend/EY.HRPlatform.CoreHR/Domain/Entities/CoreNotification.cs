using System.Text.Json;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Notifications;

namespace EY.HRPlatform.CoreHR.Domain.Entities;

/// <summary>The moments Core HR tells people about (B-002 N8), all in the "Team and job changes" group.</summary>
public enum CoreNotificationKind
{
    /// <summary>To the person: who they report to changes.</summary>
    ManagerChanged = 1,
    /// <summary>To the person: their title, unit or location changes (with the manager, when that changes too).</summary>
    JobChanged = 2,
    /// <summary>To a manager: one or more people start reporting to them.</summary>
    TeamJoining = 3,
    /// <summary>To a manager: one or more people stop reporting to them (moving away, or leaving the company).</summary>
    TeamLeaving = 4,
    /// <summary>To everyone a change told: it was cancelled before its date.</summary>
    ChangeCancelled = 5,
    /// <summary>To whoever approves changes: a change waits for their answer (<see cref="ChangeId"/> is the request).</summary>
    ChangeRequested = 6,
    /// <summary>To whoever asked: their request was approved.</summary>
    ChangeApproved = 7,
    /// <summary>To whoever asked: their request was declined, with the reason.</summary>
    ChangeDeclined = 8,
}

/// <summary>
/// Something a workforce change told one person: stored as catalogue keys and the values they need (names as written,
/// ISO dates, counts), frozen when the change was recorded, and worded in the reader's language when read (B-153). Staged
/// on the change's own unit of work, so it commits or rolls back with it. The row also carries its email's delivery,
/// since Core HR has no older outbox to stay compatible with. Adding or reading one nudges the recipient's open tabs.
/// </summary>
public sealed class CoreNotification : ITenantEntity, IFeedNudgeRecipient
{
    public const int RetentionDays = 180;
    public const int MaxEmailAttempts = 8;

    private CoreNotification() { }

    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid TenantId { get; private set; }
    public Guid RecipientEmployeeId { get; private set; }
    Guid? IFeedNudgeRecipient.RecipientEmployeeId => RecipientEmployeeId;
    Guid? IFeedNudgeRecipient.RecipientUserId => null;
    public CoreNotificationKind Kind { get; private set; }
    /// <summary>The workforce change that raised it, or the change request for the request kinds.</summary>
    public Guid ChangeId { get; private set; }
    public string TitleKey { get; private set; } = string.Empty;
    public string? ContextKey { get; private set; }
    public string ValuesJson { get; private set; } = "{}";
    public IReadOnlyDictionary<string, string> Values
        => JsonSerializer.Deserialize<Dictionary<string, string>>(ValuesJson) ?? [];
    public string? ActorName { get; private set; }
    public Guid? ActorEmployeeId { get; private set; }
    public string Href { get; private set; } = string.Empty;
    public DateTime OccurredAt { get; private set; }
    public DateTime? ReadAt { get; private set; }
    /// <summary>One notification per change, kind and recipient.</summary>
    public string DedupeKey { get; private set; } = string.Empty;

    public int EmailAttempts { get; private set; }
    public DateTime EmailNextAttemptAt { get; private set; }
    public DateTime? EmailSentAt { get; private set; }
    public string? EmailSkippedReason { get; private set; }
    public string? EmailLastError { get; private set; }
    public bool EmailPending => EmailSentAt is null && EmailSkippedReason is null && EmailAttempts < MaxEmailAttempts;

    public static CoreNotification For(Guid tenantId, Guid recipientEmployeeId, CoreNotificationKind kind, Guid changeId,
        CoreNotificationMessage text, DateTime occurredAt)
    {
        if (tenantId == Guid.Empty || recipientEmployeeId == Guid.Empty || changeId == Guid.Empty)
            throw new ArgumentException("A notification needs a tenant, a recipient and the change that raised it.");
        if (!Enum.IsDefined(kind) || string.IsNullOrWhiteSpace(text.TitleKey) || !text.Href.StartsWith("/core/", StringComparison.Ordinal))
            throw new ArgumentException("A notification needs a kind, a title and an in-app Core HR path.");
        return new CoreNotification
        {
            TenantId = tenantId,
            RecipientEmployeeId = recipientEmployeeId,
            Kind = kind,
            ChangeId = changeId,
            TitleKey = text.TitleKey,
            ContextKey = text.ContextKey,
            ValuesJson = JsonSerializer.Serialize(text.Values),
            ActorName = text.ActorName,
            ActorEmployeeId = text.ActorName is null ? null : text.ActorEmployeeId,
            Href = text.Href,
            OccurredAt = occurredAt,
            DedupeKey = $"{kind}:{changeId:N}:{recipientEmployeeId:N}",
            EmailNextAttemptAt = occurredAt,
        };
    }

    /// <summary>Tells someone a change they heard about was cancelled: one per notification it answers.</summary>
    public static CoreNotification CancellationOf(CoreNotification told, CoreNotificationMessage text, DateTime occurredAt)
    {
        if (told.Kind == CoreNotificationKind.ChangeCancelled)
            throw new ArgumentException("A cancellation answers what the change told.", nameof(told));
        var notification = For(told.TenantId, told.RecipientEmployeeId, CoreNotificationKind.ChangeCancelled, told.ChangeId, text, occurredAt);
        notification.DedupeKey = $"{CoreNotificationKind.ChangeCancelled}:{told.Kind}:{told.ChangeId:N}:{told.RecipientEmployeeId:N}";
        return notification;
    }

    public void MarkRead(DateTime now)
    {
        if (ReadAt is null) ReadAt = now;
    }

    public void MarkEmailSent(DateTime now)
    {
        RequireEmailPending();
        EmailAttempts++;
        EmailSentAt = now;
        EmailLastError = null;
    }

    public void SkipEmail(string reason)
    {
        RequireEmailPending();
        if (string.IsNullOrWhiteSpace(reason)) throw new ArgumentException("A skip reason is required.");
        EmailSkippedReason = reason;
    }

    /// <summary>Backs off 15 s, 30 s, 1 min… and gives up after <see cref="MaxEmailAttempts"/>.</summary>
    public void FailEmail(DateTime now, string errorCode)
    {
        RequireEmailPending();
        EmailAttempts++;
        EmailLastError = errorCode;
        if (EmailAttempts >= MaxEmailAttempts) EmailSkippedReason = "dead-letter";
        else EmailNextAttemptAt = now.AddSeconds(15 * Math.Pow(2, EmailAttempts - 1));
    }

    private void RequireEmailPending()
    {
        if (!EmailPending) throw new InvalidOperationException("This notification's email is already resolved.");
    }
}

/// <summary>
/// What a notification says, as catalogue keys and values, plus who acted and where it opens. Values hold names as
/// written, unit names, titles, locations, ISO dates (<c>yyyy-MM-dd</c>) and counts.
/// </summary>
public sealed record CoreNotificationMessage(string TitleKey, string? ContextKey, IReadOnlyDictionary<string, string> Values,
    string? ActorName, string Href, Guid? ActorEmployeeId = null);

/// <summary>
/// One person's email choice for Core HR notifications, stored against the company's modes (B-002 N7): <c>EmailOff</c>
/// lists On groups they turned off, <c>EmailOn</c> Off groups they turned on. No row means the person follows the company.
/// </summary>
public sealed class CoreNotificationPreference : ITenantEntity
{
    public const string TeamAndJobChanges = "team-and-job-changes";

    /// <summary>Every group, in display order.</summary>
    public static readonly IReadOnlyList<string> Groups = [TeamAndJobChanges];

    /// <summary>Where a new company starts: "Team and job changes" on (B-002 N8).</summary>
    public static NotificationEmailMode FusionDefault(string group) => NotificationEmailMode.On;

    private CoreNotificationPreference() { }

    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid TenantId { get; private set; }
    public Guid RecipientEmployeeId { get; private set; }
    public List<string> EmailOff { get; private set; } = [];
    public List<string> EmailOn { get; private set; } = [];
    public uint Version { get; private set; }

    public static CoreNotificationPreference For(Guid tenantId, Guid employeeId)
    {
        if (tenantId == Guid.Empty || employeeId == Guid.Empty) throw new ArgumentException("A preference needs a tenant and a person.");
        return new CoreNotificationPreference { TenantId = tenantId, RecipientEmployeeId = employeeId };
    }

    public static bool EmailsGroup(CoreNotificationPreference? preference, CoreNotificationDefaults? defaults, string group)
        => NotificationEmailModes.Sends(CoreNotificationDefaults.ModeOf(defaults, group), group, preference?.EmailOn ?? [], preference?.EmailOff ?? []);

    /// <summary>
    /// Replaces the person's choices: <paramref name="wantedOff"/> names every group they want no email for. Groups the
    /// company requires and unknown groups are refused.
    /// </summary>
    public void SetEmailOff(IReadOnlyCollection<string> wantedOff, CoreNotificationDefaults? defaults)
    {
        if (wantedOff.Any(group => !Groups.Contains(group)))
            throw new ArgumentException("Only team and job change email can be turned off.", nameof(wantedOff));
        if (wantedOff.Any(group => CoreNotificationDefaults.ModeOf(defaults, group) == NotificationEmailMode.Required))
            throw new ArgumentException("Your company requires this email.", nameof(wantedOff));
        var (on, off) = NotificationEmailModes.Overrides(Groups.Select(group => (group, CoreNotificationDefaults.ModeOf(defaults, group))), wantedOff);
        if (on.SequenceEqual(EmailOn) && off.SequenceEqual(EmailOff)) return;
        EmailOn = on;
        EmailOff = off;
        Version++;
    }

    /// <summary>Turns one group's email off from an email's unsubscribe link. The caller refuses groups the company requires.</summary>
    public void TurnOff(string group, CoreNotificationDefaults? defaults)
        => SetEmailOff(Groups.Where(item => item == group || !EmailsGroup(this, defaults, item))
            .Where(item => CoreNotificationDefaults.ModeOf(defaults, item) != NotificationEmailMode.Required).ToList(), defaults);
}

/// <summary>The company's email mode per Core HR group (B-002 N7). No row means Fusion's defaults; a group not listed is On.</summary>
public sealed class CoreNotificationDefaults : ITenantEntity
{
    private CoreNotificationDefaults() { }

    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid TenantId { get; private set; }
    public List<string> Required { get; private set; } = [];
    public List<string> Off { get; private set; } = [];
    public DateTime CreatedAt { get; private set; } = DateTime.UtcNow;
    public uint Version { get; private set; }

    public static CoreNotificationDefaults For(Guid tenantId)
    {
        if (tenantId == Guid.Empty) throw new ArgumentException("TenantId is required.", nameof(tenantId));
        var groups = CoreNotificationPreference.Groups;
        return new CoreNotificationDefaults
        {
            TenantId = tenantId,
            Required = groups.Where(group => CoreNotificationPreference.FusionDefault(group) == NotificationEmailMode.Required).ToList(),
            Off = groups.Where(group => CoreNotificationPreference.FusionDefault(group) == NotificationEmailMode.Off).ToList(),
        };
    }

    public static NotificationEmailMode ModeOf(CoreNotificationDefaults? defaults, string group)
        => defaults is null ? CoreNotificationPreference.FusionDefault(group)
            : defaults.Required.Contains(group) ? NotificationEmailMode.Required
            : defaults.Off.Contains(group) ? NotificationEmailMode.Off
            : NotificationEmailMode.On;

    /// <summary>Sets the modes named; groups left out keep theirs. Unknown groups are refused.</summary>
    public void Set(IReadOnlyDictionary<string, NotificationEmailMode> modes)
    {
        var groups = CoreNotificationPreference.Groups;
        if (modes.Keys.Any(group => !groups.Contains(group)))
            throw new ArgumentException("Only Core HR notification groups can be set.", nameof(modes));
        var next = groups.ToDictionary(group => group, group => modes.TryGetValue(group, out var mode) ? mode : ModeOf(this, group));
        var required = groups.Where(group => next[group] == NotificationEmailMode.Required).ToList();
        var off = groups.Where(group => next[group] == NotificationEmailMode.Off).ToList();
        if (required.SequenceEqual(Required) && off.SequenceEqual(Off)) return;
        Required = required;
        Off = off;
        Version++;
    }
}

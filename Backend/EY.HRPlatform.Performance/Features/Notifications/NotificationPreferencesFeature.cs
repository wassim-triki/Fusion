using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Notifications;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Kind = EY.HRPlatform.Performance.Domain.Notifications.PerformanceNotificationKind;

namespace EY.HRPlatform.Performance.Features.Notifications;

/// <summary>One line of a group, covering one or more kinds. <paramref name="Team"/> marks work about the caller's team.</summary>
public sealed record NotificationPreferenceItemDto(string Label, bool Team, bool Always, int Count);

/// <summary>A group with the caller's email choice. <paramref name="Locked"/> groups are required by the company.</summary>
public sealed record NotificationPreferenceGroupDto(string Key, string Label, string Summary, bool Email, bool Locked, int Count,
    IReadOnlyList<NotificationPreferenceItemDto> Items);

/// <summary>The caller's Performance notification choices. <paramref name="Version"/> is 0 before they first saved.</summary>
public sealed record NotificationPreferencesDto(string? EmailAddress, IReadOnlyList<NotificationPreferenceGroupDto> Groups, uint Version);

public sealed record UpdateNotificationPreferencesRequest(
    [property: System.Text.Json.Serialization.JsonRequired] uint ExpectedVersion,
    IReadOnlyList<string>? EmailOff);

/// <summary>Which lines apply to the caller: a people leader sees their team's work, a calibrator sees calibration.</summary>
public sealed record NotificationAudience(bool LeadsPeople, bool Calibrates);

public sealed record GetNotificationPreferencesQuery(NotificationRecipient Recipient, NotificationAudience Audience, string? AccountEmail)
    : IQuery<Result<NotificationPreferencesDto>>;

public sealed record UpdateNotificationPreferencesCommand(NotificationRecipient Recipient, NotificationAudience Audience, string? AccountEmail,
    UpdateNotificationPreferencesRequest Request) : ICommand<Result<NotificationPreferencesDto>>;

/// <summary>The groups and their lines, in English, for one caller.</summary>
public static class NotificationPreferenceCatalog
{
    private enum Reader { Everyone, Leader, Calibrator }

    private sealed record Line(string Label, Reader Audience, Kind[] Kinds);

    private sealed record Group(string Key, string Label, string Summary, string LeaderSummary, Line[] Lines);

    private static readonly Line Reminder = new("A review of yours is due tomorrow or late", Reader.Everyone, [Kind.ReviewReminder]);

    private static readonly Group[] Groups =
    [
        new(NotificationGroups.PlansAndGoals, "Plans and goals",
            "Your plan approved or returned, updates asked of you, development goals added",
            "Plans waiting for your decision, your plan approved or returned, objectives at risk on your team",
            [
                new("Plans waiting for your decision", Reader.Leader, [Kind.PlanSubmitted]),
                new("Objectives at risk on your team", Reader.Leader, [Kind.ObjectiveAtRisk]),
                new("Answers to the updates you asked for", Reader.Leader, [Kind.UpdateRequestAnswered]),
                new("Your plan approved or returned", Reader.Everyone, [Kind.PlanApproved, Kind.PlanReturned]),
                new("Updates asked of you", Reader.Everyone, [Kind.UpdateRequested]),
                new("Development goals added to your plan", Reader.Everyone, [Kind.DevelopmentGoalAdded]),
            ]),
        new(NotificationGroups.ReviewsAndCalibration, "Reviews and calibration",
            "Your self-assessment opens, peer input asked of you, your review released",
            "Reviews to write, peers to approve, your own review",
            [
                new("A review to write opens", Reader.Leader, [Kind.ManagerAssessmentOpened]),
                new("Someone submitted their self-assessment", Reader.Leader, [Kind.SelfAssessmentSubmitted]),
                new("Peers to approve", Reader.Leader, [Kind.PeersNominated]),
                new("Someone acknowledged their review", Reader.Leader, [Kind.ReviewAcknowledged]),
                new("Calibration ready, calibration finalized", Reader.Calibrator, [Kind.CalibrationReady, Kind.CalibrationFinalized]),
                new("Your self-assessment opens, your peers approved, your review released", Reader.Everyone,
                    [Kind.SelfAssessmentOpened, Kind.PeerListApproved, Kind.ReviewFinalized]),
                new("Peer input asked of you, a peer declined, a due date moved", Reader.Everyone,
                    [Kind.PeerInputRequested, Kind.PeerDeclined, Kind.ReviewDueDateMoved]),
                Reminder,
            ]),
        new(NotificationGroups.OneOnOnes, "1:1s",
            "A 1:1 started or moved, actions assigned to you",
            "A 1:1 started or moved, actions assigned to you",
            [
                new("A 1:1 started or moved", Reader.Everyone, [Kind.OneOnOneStarted, Kind.OneOnOneRescheduled]),
                new("Actions assigned to you", Reader.Everyone, [Kind.OneOnOneActionAssigned]),
            ]),
        new(NotificationGroups.FeedbackAndPraise, "Feedback and praise",
            "Feedback and praise you receive, requests for your feedback",
            "Feedback and praise for you and your team, requests and answers",
            [
                new("Feedback and praise for your team", Reader.Leader, [Kind.FeedbackForReport, Kind.PraiseForReport]),
                new("Feedback and praise you receive", Reader.Everyone, [Kind.FeedbackReceived, Kind.PraiseReceived]),
                new("Requests for your feedback", Reader.Everyone, [Kind.FeedbackRequested]),
                new("Answers to your requests", Reader.Everyone, [Kind.FeedbackRequestResponded]),
            ]),
        new(NotificationGroups.DeadlineReminders, "Deadline reminders",
            "Something of yours is due soon or late",
            "Something of yours is due soon or late",
            [Reminder]),
    ];

    /// <summary>Every kind the catalogue lists, for the test that keeps it in step with the group map.</summary>
    public static IEnumerable<(string Group, Kind Kind)> Listed()
        => Groups.SelectMany(group => group.Lines.SelectMany(line => line.Kinds.Select(kind => (group.Key, kind))));

    /// <summary>A group's English name and the summary everyone reads, for the company's settings page.</summary>
    public static (string Label, string Summary) Describe(string key)
        => Groups.Single(group => group.Key == key) is var group ? (group.Label, group.Summary) : default;

    public static IReadOnlyList<NotificationPreferenceGroupDto> For(NotificationAudience audience, NotificationPreference? preference,
        NotificationDefaults? defaults)
        => Groups.Select(group =>
        {
            var items = group.Lines
                .Where(line => line.Audience switch
                {
                    Reader.Leader => audience.LeadsPeople,
                    Reader.Calibrator => audience.Calibrates,
                    _ => true,
                })
                .Select(line => new NotificationPreferenceItemDto(line.Label, line.Audience != Reader.Everyone,
                    line.Kinds.All(kind => Required(NotificationGroups.Of(kind))), line.Kinds.Length))
                .ToList();
            return new NotificationPreferenceGroupDto(group.Key, group.Label,
                audience.LeadsPeople ? group.LeaderSummary : group.Summary,
                NotificationPreference.EmailsGroup(preference, defaults, group.Key), Required(group.Key), items.Sum(item => item.Count), items);

            bool Required(string key) => NotificationDefaults.ModeOf(defaults, key) == NotificationEmailMode.Required;
        }).ToList();
}

internal static class NotificationPreferences
{
    /// <summary>The caller's row: by employee record, or by account for someone without one (as the feed resolves them).</summary>
    public static Task<NotificationPreference?> FindAsync(PerformanceDbContext db, NotificationRecipient recipient, CancellationToken token)
        => recipient.EmployeeId is Guid employeeId
            ? db.NotificationPreferences.FirstOrDefaultAsync(row => row.RecipientEmployeeId == employeeId, token)
            : recipient.UserId is Guid userId
                ? db.NotificationPreferences.FirstOrDefaultAsync(row => row.RecipientUserId == userId, token)
                : Task.FromResult<NotificationPreference?>(null);

    public static async Task<NotificationPreferencesDto> ProjectAsync(ICoreWorkforceClient workforce, NotificationRecipient recipient,
        NotificationAudience audience, string? accountEmail, NotificationPreference? preference, NotificationDefaults? defaults,
        CancellationToken token)
        => new(await EmailAddressAsync(workforce, recipient, accountEmail, token),
            NotificationPreferenceCatalog.For(audience, preference, defaults), preference?.Version ?? 0);

    /// <summary>Where Performance emails go: the Core work email for an employee (as dispatch resolves it), else the account.</summary>
    private static async Task<string?> EmailAddressAsync(ICoreWorkforceClient workforce, NotificationRecipient recipient,
        string? accountEmail, CancellationToken token)
    {
        if (recipient.EmployeeId is not Guid employeeId) return accountEmail;
        try
        {
            var snapshots = await workforce.ResolveAsync(PerformanceClock.UtcNow, [employeeId], token);
            return snapshots.SingleOrDefault(snapshot => snapshot.EmployeeId == employeeId)?.WorkEmail;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !token.IsCancellationRequested)
        {
            return null;
        }
    }
}

public sealed class GetNotificationPreferencesHandler(PerformanceDbContext db, ICoreWorkforceClient workforce)
    : IQueryHandler<GetNotificationPreferencesQuery, Result<NotificationPreferencesDto>>
{
    public async Task<Result<NotificationPreferencesDto>> Handle(GetNotificationPreferencesQuery query, CancellationToken token)
    {
        var preference = await NotificationPreferences.FindAsync(db, query.Recipient, token);
        var defaults = await db.NotificationDefaults.AsNoTracking().FirstOrDefaultAsync(token);
        return await NotificationPreferences.ProjectAsync(workforce, query.Recipient, query.Audience, query.AccountEmail, preference, defaults, token);
    }
}

public sealed class UpdateNotificationPreferencesHandler(PerformanceDbContext db, ITenantContext tenant, ICoreWorkforceClient workforce)
    : ICommandHandler<UpdateNotificationPreferencesCommand, Result<NotificationPreferencesDto>>
{
    public async Task<Result<NotificationPreferencesDto>> Handle(UpdateNotificationPreferencesCommand command, CancellationToken token)
    {
        var recipient = command.Recipient;
        if (recipient.EmployeeId is null && recipient.UserId is null)
            return Result.Failure<NotificationPreferencesDto>(PerformanceErrors.Forbidden(
                "Performance.CapabilityForbidden", "You do not have permission to do this."));

        var preference = await NotificationPreferences.FindAsync(db, recipient, token);
        var defaults = await db.NotificationDefaults.AsNoTracking().FirstOrDefaultAsync(token);
        if (preference is null)
        {
            if (command.Request.ExpectedVersion != 0) return Result.Failure<NotificationPreferencesDto>(PerformanceErrors.Changed());
            preference = NotificationPreference.For(tenant.TenantId, recipient.EmployeeId, recipient.UserId);
            db.NotificationPreferences.Add(preference);
        }
        else if (VersionGuard.Check(preference, command.Request.ExpectedVersion) is { } stale)
        {
            return Result.Failure<NotificationPreferencesDto>(stale);
        }

        try
        {
            preference.SetEmailOff(command.Request.EmailOff ?? [], defaults);
        }
        catch (ArgumentException ex)
        {
            return Result.Failure<NotificationPreferencesDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.NotificationPreferencesInvalid, ex.Message));
        }

        await db.SaveChangesAsync(token);
        return await NotificationPreferences.ProjectAsync(workforce, recipient, command.Audience, command.AccountEmail, preference, defaults, token);
    }
}

/// <summary>A one-click unsubscribe from an email's List-Unsubscribe header (B-002 N6).</summary>
public sealed record UnsubscribeFromEmailGroupCommand(string? Token) : ICommand<Result<bool>>;

/// <summary>
/// Turns off the one email group the signed link names, for the person it was sent to. No sign-in: the token's
/// signature is the authority, and it can only ever turn email off, never on or anything else. A group the company
/// requires (now, or since the email was sent) can't be turned off.
/// </summary>
public sealed class UnsubscribeFromEmailGroupHandler(PerformanceDbContext db, TenantContext tenant,
    IOptions<PerformanceNotificationOptions> options) : ICommandHandler<UnsubscribeFromEmailGroupCommand, Result<bool>>
{
    public async Task<Result<bool>> Handle(UnsubscribeFromEmailGroupCommand command, CancellationToken token)
    {
        var key = options.Value.UnsubscribeKey;
        var claim = string.IsNullOrWhiteSpace(key) ? null : UnsubscribeToken.Read(command.Token, key);
        if (claim is null || !NotificationGroups.All.Contains(claim.Group)
            || (tenant.IsResolved && tenant.TenantId != claim.TenantId))
            return Result.Failure<bool>(PerformanceErrors.Validation(PerformanceErrors.Codes.NotificationPreferencesInvalid,
                "This unsubscribe link isn't valid."));
        if (!tenant.IsResolved) tenant.SetTenant(claim.TenantId);

        var defaults = await db.NotificationDefaults.AsNoTracking().FirstOrDefaultAsync(token);
        if (NotificationDefaults.ModeOf(defaults, claim.Group) == NotificationEmailMode.Required)
            return Result.Failure<bool>(PerformanceErrors.Validation(PerformanceErrors.Codes.NotificationPreferencesInvalid,
                "Your company requires this email."));
        var preference = await db.NotificationPreferences.FirstOrDefaultAsync(row => row.RecipientEmployeeId == claim.RecipientEmployeeId, token);
        if (preference is null)
        {
            preference = NotificationPreference.For(claim.TenantId, claim.RecipientEmployeeId, null);
            db.NotificationPreferences.Add(preference);
        }
        preference.TurnOff(claim.Group, defaults);
        await db.SaveChangesAsync(token);
        return Result.Success(true);
    }
}

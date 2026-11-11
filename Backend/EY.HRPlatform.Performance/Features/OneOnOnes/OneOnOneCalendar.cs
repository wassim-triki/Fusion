using System.Globalization;
using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Notifications;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace EY.HRPlatform.Performance.Features.OneOnOnes;

/// <summary>1:1s in people's calendars (D-39): an emailed invite per meeting change, and a personal feed link.</summary>
public static class OneOnOneCalendar
{
    /// <summary>How far back a feed lists meetings that were held.</summary>
    public static readonly TimeSpan FeedLookBack = TimeSpan.FromDays(90);

    public static CalendarEvent EventFor(OneOnOneMeeting meeting, string withName, string shellBaseUrl)
    {
        var changed = (meeting.UpdatedAt ?? meeting.CreatedAt) - meeting.CreatedAt;
        return new CalendarEvent(meeting.Id, meeting.ScheduledAt, meeting.EndsAt, $"1:1 with {withName}",
            $"{shellBaseUrl.TrimEnd('/')}{PerformanceNotificationTemplates.OneOnOnePath(meeting.SeriesId)}",
            (int)Math.Clamp(changed.TotalSeconds, 0, int.MaxValue), meeting.State == OneOnOneMeetingState.NotHeld);
    }

    /// <summary>The invite email for one of the two people, worded from the meeting as it stands now.</summary>
    public static async Task<FusionOutgoingEmail?> InviteAsync(PerformanceDbContext db, ICoreWorkforceClient workforce,
        PerformanceOutboxMessage message, string to, NotificationAudience reader, PerformanceNotificationOptions config,
        NotificationDefaults? defaults, CancellationToken token)
    {
        var payload = System.Text.Json.JsonSerializer.Deserialize<OneOnOneInvitePayload>(message.Payload);
        var meeting = payload is null ? null : await db.OneOnOneMeetings.AsNoTracking().FirstOrDefaultAsync(m => m.Id == payload.MeetingId, token);
        var series = meeting is null ? null : await db.OneOnOneSeries.AsNoTracking().FirstOrDefaultAsync(s => s.Id == meeting.SeriesId, token);
        if (meeting is null || series is null || !series.Involves(message.RecipientEmployeeId)) return null;

        var otherId = series.OtherThan(message.RecipientEmployeeId);
        var other = (await workforce.ResolveAsync(PerformanceClock.UtcNow, [otherId], token)).FirstOrDefault(p => p.EmployeeId == otherId);
        var withName = other?.DisplayName ?? (otherId == series.ManagerEmployeeId ? series.ManagerName : series.ReportName);
        var e = EventFor(meeting, withName, config.ShellBaseUrl);
        var language = reader.LanguageOf(message.RecipientEmployeeId);
        var values = new Dictionary<string, string> { ["subject"] = withName, ["due"] = When(meeting, language, reader.TimeZone) };
        var key = e.Cancelled ? "OneOnOneInvite.cancelled" : "OneOnOneInvite";
        var catalog = PerformanceNotificationRenderer.Catalog;
        var group = NotificationGroups.OneOnOnes;
        var content = FusionNotificationEmail.Render(language,
            new NotificationEmailText(catalog.Text(language, $"{key}.subject", values) ?? e.Title,
                catalog.Text(language, $"{key}.lead", values) ?? e.Title,
                catalog.Text(language, "OneOnOneInvite.action", values) ?? "Open"),
            e.Url,
            new NotificationEmailGroup(catalog.Text(language, $"group.{group}") ?? group,
                NotificationDefaults.ModeOf(defaults, group) != NotificationEmailMode.Required),
            reader.Company(), config.ShellBaseUrl);
        return new FusionOutgoingEmail(to, content, $"<{message.Id:N}@fusion-performance>",
            PerformanceNotificationRenderer.UnsubscribeUrl(message, config.ShellBaseUrl, config.UnsubscribeKey, defaults),
            new FusionCalendarPart(ICalendar.Invite(e, config.Smtp.From), e.Cancelled ? "CANCEL" : "REQUEST"));
    }

    /// <summary>"Tuesday 10 November, 11:00 to 11:30" in the reader's language and the company's time zone.</summary>
    private static string When(OneOnOneMeeting meeting, string language, string timeZone)
    {
        TimeZoneInfo zone;
        try { zone = TimeZoneInfo.FindSystemTimeZoneById(timeZone); }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException) { zone = TimeZoneInfo.Utc; }
        CultureInfo culture;
        try { culture = CultureInfo.GetCultureInfo(language); }
        catch (CultureNotFoundException) { culture = CultureInfo.InvariantCulture; }
        var start = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(meeting.ScheduledAt, DateTimeKind.Utc), zone);
        var end = start + OneOnOneSchedule.Length;
        return $"{start.ToString("dddd d MMMM, HH:mm", culture)} – {end.ToString("HH:mm", culture)}";
    }
}

// ── The feed link ────────────────────────────────────────────────────────────

/// <summary>Whether the caller has a feed; the link itself is only ever shown when it's made.</summary>
public sealed record CalendarFeedDto(bool On, DateTime? Since, string? Url);

public sealed record GetCalendarFeedQuery(Guid EmployeeId) : IQuery<Result<CalendarFeedDto>>;
/// <summary>Makes the caller's feed link, replacing any earlier one (which stops working).</summary>
public sealed record CreateCalendarFeedCommand(Guid EmployeeId) : ICommand<Result<CalendarFeedDto>>;
public sealed record RevokeCalendarFeedCommand(Guid EmployeeId) : ICommand<Result<CalendarFeedDto>>;
/// <summary>The feed itself, read by a calendar app with the token alone; null when the token isn't a live feed.</summary>
public sealed record ReadCalendarFeedQuery(string? Token) : IQuery<string?>;

public sealed class GetCalendarFeedHandler(PerformanceDbContext db) : IQueryHandler<GetCalendarFeedQuery, Result<CalendarFeedDto>>
{
    public async Task<Result<CalendarFeedDto>> Handle(GetCalendarFeedQuery query, CancellationToken token)
    {
        var feed = await db.CalendarFeeds.AsNoTracking().FirstOrDefaultAsync(f => f.EmployeeId == query.EmployeeId, token);
        return Result.Success(new CalendarFeedDto(feed is not null, feed?.CreatedAt, null));
    }
}

public sealed class CreateCalendarFeedHandler(PerformanceDbContext db, ITenantContext tenant, IOptions<PerformanceNotificationOptions> options)
    : ICommandHandler<CreateCalendarFeedCommand, Result<CalendarFeedDto>>
{
    public async Task<Result<CalendarFeedDto>> Handle(CreateCalendarFeedCommand command, CancellationToken token)
    {
        if (!Uri.TryCreate(options.Value.ShellBaseUrl, UriKind.Absolute, out _))
            return Result.Failure<CalendarFeedDto>(PerformanceErrors.Validation("CalendarFeed.Unavailable", "Calendar links aren't set up here."));
        db.CalendarFeeds.RemoveRange(await db.CalendarFeeds.Where(f => f.EmployeeId == command.EmployeeId).ToListAsync(token));
        var (feed, secret) = CalendarFeed.Create(tenant.TenantId, command.EmployeeId);
        db.CalendarFeeds.Add(feed);
        await db.SaveChangesAsync(token);
        return Result.Success(new CalendarFeedDto(true, feed.CreatedAt,
            $"{options.Value.ShellBaseUrl.TrimEnd('/')}/api/performance/calendar/{secret}.ics"));
    }
}

public sealed class RevokeCalendarFeedHandler(PerformanceDbContext db) : ICommandHandler<RevokeCalendarFeedCommand, Result<CalendarFeedDto>>
{
    public async Task<Result<CalendarFeedDto>> Handle(RevokeCalendarFeedCommand command, CancellationToken token)
    {
        db.CalendarFeeds.RemoveRange(await db.CalendarFeeds.Where(f => f.EmployeeId == command.EmployeeId).ToListAsync(token));
        await db.SaveChangesAsync(token);
        return Result.Success(new CalendarFeedDto(false, null, null));
    }
}

/// <summary>
/// Anonymous: the token is the credential. The tenant it names scopes the lookup; its hash must match a live feed in
/// that tenant, so a token from another tenant, a revoked one or a guess reads nothing. The feed lists only the
/// owner's own 1:1s, by time and the other person's name: no agenda, notes or actions.
/// </summary>
public sealed class ReadCalendarFeedHandler(PerformanceDbContext db, TenantContext tenant, ICoreWorkforceClient workforce,
    IOptions<PerformanceNotificationOptions> options) : IQueryHandler<ReadCalendarFeedQuery, string?>
{
    public async Task<string?> Handle(ReadCalendarFeedQuery query, CancellationToken token)
    {
        if (CalendarFeed.TenantOf(query.Token) is not Guid tenantId) return null;
        if (tenant.IsResolved && tenant.TenantId != tenantId) return null;
        if (!tenant.IsResolved) tenant.SetTenant(tenantId);
        var hash = CalendarFeed.Hash(query.Token!);
        var feed = await db.CalendarFeeds.AsNoTracking().FirstOrDefaultAsync(f => f.TokenHash == hash, token);
        if (feed is null) return null;

        var me = feed.EmployeeId;
        var series = await OneOnOnePolicy.Readable(db.OneOnOneSeries.AsNoTracking(), me).ToListAsync(token);
        var ids = series.Select(s => s.Id).ToList();
        var since = PerformanceClock.UtcNow - OneOnOneCalendar.FeedLookBack;
        var meetings = await db.OneOnOneMeetings.AsNoTracking()
            .Where(m => ids.Contains(m.SeriesId) && m.State != OneOnOneMeetingState.NotHeld && m.ScheduledAt >= since)
            .OrderBy(m => m.ScheduledAt).ToListAsync(token);
        var others = series.Select(s => s.OtherThan(me)).Distinct().ToList();
        IReadOnlyList<WorkforceSnapshot> people = [];
        try { people = await workforce.ResolveAsync(PerformanceClock.UtcNow, others, token); }
        catch (HttpRequestException) { /* Stored names stand in. */ }
        var bySeries = series.ToDictionary(s => s.Id);
        string NameFor(OneOnOneSeries s)
        {
            var other = s.OtherThan(me);
            return people.FirstOrDefault(p => p.EmployeeId == other)?.DisplayName
                ?? (other == s.ManagerEmployeeId ? s.ManagerName : s.ReportName);
        }
        return ICalendar.Feed("Fusion 1:1s",
            meetings.Select(m => OneOnOneCalendar.EventFor(m, NameFor(bySeries[m.SeriesId]), options.Value.ShellBaseUrl)));
    }
}

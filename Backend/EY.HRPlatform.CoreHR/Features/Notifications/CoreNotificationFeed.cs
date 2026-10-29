using System.Globalization;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.People.Changes;
using EY.HRPlatform.CoreHR.Infrastructure.Notifications;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Notifications;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace EY.HRPlatform.CoreHR.Features.Notifications;

/// <summary>One line of a group. <paramref name="Team"/> marks news about the caller's team.</summary>
public sealed record NotificationPreferenceItemDto(string Label, bool Team, bool Always, int Count);

/// <summary>A group with the caller's email choice (the same shape Performance serves). <paramref name="Locked"/> groups are required by the company.</summary>
public sealed record NotificationPreferenceGroupDto(string Key, string Label, string Summary, bool Email, bool Locked, int Count,
    IReadOnlyList<NotificationPreferenceItemDto> Items);

/// <summary>The caller's Core HR notification choices. <paramref name="Version"/> is 0 before they first saved.</summary>
public sealed record NotificationPreferencesDto(string? EmailAddress, IReadOnlyList<NotificationPreferenceGroupDto> Groups, uint Version);

public sealed record UpdateNotificationPreferencesRequest(
    [property: System.Text.Json.Serialization.JsonRequired] uint ExpectedVersion,
    IReadOnlyList<string>? EmailOff);

/// <summary>Why a preferences save was refused.</summary>
public enum PreferencesRefusal { None, Changed, Invalid }

/// <summary>
/// The caller's own Core HR notifications, upcoming team and job changes, and email choice. Every read and write is the
/// caller's own employee record inside the tenant filter; there is no address for anyone else's.
/// </summary>
public sealed class CoreNotificationFeed(CoreHRDbContext db, TenantContext tenant, IOptions<CoreNotificationOptions> options)
{
    public const string Module = "core";
    /// <summary>The PostgreSQL channel Core HR nudges open tabs on.</summary>
    public const string Channel = "corehr_feed";
    public const int MaxPageSize = 20;
    public const int MaxIdsPerRead = 100;
    public const int MaxUpcomingDays = 31;

    private IQueryable<CoreNotification> Own(Guid employeeId, DateTime now)
    {
        var retainedFrom = now.AddDays(-CoreNotification.RetentionDays);
        return db.Notifications.Where(item => item.RecipientEmployeeId == employeeId && item.OccurredAt >= retainedFrom);
    }

    public async Task<FusionNotificationPageDto> PageAsync(Guid employeeId, string? cursor, int? limit, string language,
        CancellationToken cancellationToken)
    {
        var own = Own(employeeId, DateTime.UtcNow).AsNoTracking();
        var take = Math.Clamp(limit ?? MaxPageSize, 1, MaxPageSize);
        var page = own;
        if (long.TryParse(cursor, NumberStyles.None, CultureInfo.InvariantCulture, out var ticks) && ticks > 0 && ticks <= DateTime.MaxValue.Ticks)
        {
            var before = new DateTime(ticks, DateTimeKind.Utc);
            page = page.Where(item => item.OccurredAt < before);
        }
        var rows = await page.OrderByDescending(item => item.OccurredAt).ThenByDescending(item => item.Id)
            .Take(take + 1).ToListAsync(cancellationToken);
        var unread = await own.CountAsync(item => item.ReadAt == null, cancellationToken);
        var items = rows.Take(take).Select(item =>
        {
            var (title, context) = CoreNotificationRenderer.InApp(item, language);
            return new FusionNotificationDto(item.Id.ToString(), Module, item.Kind.ToString(), title, context, item.ActorName,
                item.ActorEmployeeId, "team", item.OccurredAt, item.Href, item.ReadAt);
        }).ToList();
        var next = rows.Count > take ? rows[take - 1].OccurredAt.Ticks.ToString(CultureInfo.InvariantCulture) : null;
        return new FusionNotificationPageDto(items, unread, next);
    }

    /// <summary>Ids that aren't the caller's simply don't match: the answer never reveals whether they exist.</summary>
    public async Task<MarkNotificationsReadResultDto> MarkReadAsync(Guid employeeId, IReadOnlyList<Guid> ids, bool all,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var own = Own(employeeId, now);
        var targets = all ? own.Where(item => item.ReadAt == null) : own.Where(item => item.ReadAt == null && ids.Contains(item.Id));
        foreach (var notification in await targets.ToListAsync(cancellationToken)) notification.MarkRead(now);
        await db.SaveChangesAsync(cancellationToken);
        return new MarkNotificationsReadResultDto(await own.CountAsync(item => item.ReadAt == null, cancellationToken));
    }

    /// <summary>
    /// The caller's team and job changes from today through <paramref name="days"/> ahead: what was announced when it was
    /// recorded, shown again on its date (B-002 N8). Read from the live change records, so a cancelled change drops out.
    /// </summary>
    public async Task<IReadOnlyList<FusionUpcomingDto>> UpcomingAsync(Guid employeeId, int days, string language,
        CancellationToken cancellationToken)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var horizon = today.AddDays(days);
        // An end of employment is dated the day after the last day, which is the day shown.
        var changes = await db.WorkforceChanges.AsNoTracking().Include(change => change.Effects)
            .Where(change => !change.IsCancelled && change.EffectiveDate >= today && change.EffectiveDate <= horizon.AddDays(1))
            .OrderBy(change => change.EffectiveDate).ThenBy(change => change.CreatedAt)
            .Take(500)
            .ToListAsync(cancellationToken);
        if (changes.Count == 0) return [];
        var peopleIds = changes.Select(change => change.EmployeeId).Distinct().ToList();
        var people = await db.Employees.AsNoTracking().Where(employee => peopleIds.Contains(employee.Id))
            .ToDictionaryAsync(employee => employee.Id, cancellationToken);

        var items = new List<FusionUpcomingDto>();
        foreach (var change in changes)
        {
            if (!people.TryGetValue(change.EmployeeId, out var employee)) continue;
            var details = WorkforceChangeService.ReadDetails(change);
            var teamStaying = await CoreChangeMoments.TeamStayingAsync(db, change, details, cancellationToken);
            foreach (var moment in CoreChangeMoments.Of(change, details, WorkforceChangeService.Ref(employee), teamStaying))
            {
                if (moment.RecipientEmployeeId != employeeId || moment.Date < today || moment.Date > horizon) continue;
                var words = CoreChangeMoments.Words(moment, CoreMomentTense.Upcoming, today);
                items.Add(new FusionUpcomingDto($"{Module}:{moment.Kind}:{change.Id:N}", Module, moment.Kind.ToString(),
                    CoreNotificationRenderer.Catalog.Text(language, words.TitleKey, words.Values) ?? words.TitleKey,
                    words.ContextKey is null ? null : CoreNotificationRenderer.Catalog.Text(language, words.ContextKey, words.Values),
                    moment.Date, null, words.Href));
            }
        }
        return items.OrderBy(item => item.Date).ThenBy(item => item.Title, StringComparer.Ordinal).ToList();
    }

    public async Task<NotificationPreferencesDto> PreferencesAsync(Guid employeeId, bool leadsPeople, CancellationToken cancellationToken)
    {
        var preference = await db.NotificationPreferences.AsNoTracking()
            .FirstOrDefaultAsync(item => item.RecipientEmployeeId == employeeId, cancellationToken);
        var defaults = await db.NotificationDefaults.AsNoTracking().FirstOrDefaultAsync(cancellationToken);
        return await ProjectAsync(employeeId, leadsPeople, preference, defaults, cancellationToken);
    }

    public async Task<(NotificationPreferencesDto? Value, PreferencesRefusal Refusal)> UpdatePreferencesAsync(Guid employeeId,
        bool leadsPeople, UpdateNotificationPreferencesRequest request, CancellationToken cancellationToken)
    {
        var emailOff = request.EmailOff ?? [];
        var defaults = await db.NotificationDefaults.AsNoTracking().FirstOrDefaultAsync(cancellationToken);
        if (emailOff.Any(group => !CoreNotificationPreference.Groups.Contains(group)
                || CoreNotificationDefaults.ModeOf(defaults, group) == NotificationEmailMode.Required))
            return (null, PreferencesRefusal.Invalid);
        var preference = await db.NotificationPreferences.FirstOrDefaultAsync(item => item.RecipientEmployeeId == employeeId, cancellationToken);
        if (preference is null)
        {
            if (request.ExpectedVersion != 0) return (null, PreferencesRefusal.Changed);
            preference = CoreNotificationPreference.For(tenant.TenantId, employeeId);
            db.NotificationPreferences.Add(preference);
        }
        else if (preference.Version != request.ExpectedVersion)
        {
            return (null, PreferencesRefusal.Changed);
        }
        preference.SetEmailOff(emailOff, defaults);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Another save of the same person's choice won the race (version or the one-row-per-person index).
            return (null, PreferencesRefusal.Changed);
        }
        return (await ProjectAsync(employeeId, leadsPeople, preference, defaults, cancellationToken), PreferencesRefusal.None);
    }

    /// <summary>
    /// A one-click unsubscribe from an email's List-Unsubscribe header (B-002 N6). No sign-in: the token's signature is
    /// the authority, and it can only turn the one named group off, never one the company requires.
    /// </summary>
    public async Task<bool> UnsubscribeAsync(string? token, CancellationToken cancellationToken)
    {
        var key = options.Value.UnsubscribeKey;
        var claim = string.IsNullOrWhiteSpace(key) ? null : UnsubscribeToken.Read(token, key);
        if (claim is null || !CoreNotificationPreference.Groups.Contains(claim.Group)
            || (tenant.IsResolved && tenant.TenantId != claim.TenantId))
            return false;
        if (!tenant.IsResolved) tenant.SetTenant(claim.TenantId);

        var defaults = await db.NotificationDefaults.AsNoTracking().FirstOrDefaultAsync(cancellationToken);
        if (CoreNotificationDefaults.ModeOf(defaults, claim.Group) == NotificationEmailMode.Required) return false;
        var preference = await db.NotificationPreferences.FirstOrDefaultAsync(item => item.RecipientEmployeeId == claim.RecipientEmployeeId, cancellationToken);
        if (preference is null)
        {
            preference = CoreNotificationPreference.For(claim.TenantId, claim.RecipientEmployeeId);
            db.NotificationPreferences.Add(preference);
        }
        preference.TurnOff(claim.Group, defaults);
        await db.SaveChangesAsync(cancellationToken);
        return true;
    }

    private async Task<NotificationPreferencesDto> ProjectAsync(Guid employeeId, bool leadsPeople, CoreNotificationPreference? preference,
        CoreNotificationDefaults? defaults, CancellationToken cancellationToken)
    {
        var email = await db.Employees.AsNoTracking().Where(employee => employee.Id == employeeId)
            .Select(employee => employee.Email).FirstOrDefaultAsync(cancellationToken);
        List<NotificationPreferenceItemDto> items =
        [
            new("Your manager changes", false, false, 1),
            new("A change to your job", false, false, 1),
        ];
        if (leadsPeople) items.Add(new("Someone joins or leaves your team", true, false, 2));
        const string key = CoreNotificationPreference.TeamAndJobChanges;
        var group = new NotificationPreferenceGroupDto(key, CoreNotificationDefaultsService.Label, CoreNotificationDefaultsService.Summary,
            CoreNotificationPreference.EmailsGroup(preference, defaults, key),
            CoreNotificationDefaults.ModeOf(defaults, key) == NotificationEmailMode.Required, items.Sum(item => item.Count), items);
        return new NotificationPreferencesDto(string.IsNullOrWhiteSpace(email) ? null : email, [group], preference?.Version ?? 0);
    }
}

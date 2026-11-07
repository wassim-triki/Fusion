using System.Globalization;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.People.Changes;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Notifications;

/// <summary>
/// One thing a workforce change means for one person (B-002 N8): the person hears that their manager or job changes, a
/// manager hears who joins or leaves their team. <paramref name="People"/> are the people joining or leaving (one
/// notification per manager, however many move); <paramref name="Manager"/> is the person's manager after the change.
/// <paramref name="Date"/> is the day it happens (an end of employment: the last day). For leave, <paramref name="Summary"/>
/// is its type, <paramref name="Back"/> the first working day after it and <paramref name="Occasion"/> names a change in
/// place ("changed", "endedEarly").
/// </summary>
public sealed record CoreChangeMoment(
    Guid RecipientEmployeeId,
    CoreNotificationKind Kind,
    DateOnly Date,
    IReadOnlyList<ChangePersonRef> People,
    ChangePersonRef? Manager = null,
    bool LastDay = false,
    string? Summary = null,
    string? HireTitle = null,
    DateOnly? Back = null,
    string? Occasion = null);

/// <summary>How a moment is worded: when it's recorded ahead or on the day, and under Upcoming on its date.</summary>
public enum CoreMomentTense { Recorded, Upcoming }

public static class CoreChangeMoments
{
    public const string ProfilePath = "/core/profile";
    public const string TeamPath = "/core/team";

    /// <summary>
    /// Everyone a change tells, read from the record's own account of what it did. <paramref name="teamStaying"/> are the
    /// reports who stay behind when a manager moves (the lines the change created for people other than the person).
    /// </summary>
    public static IReadOnlyList<CoreChangeMoment> Of(WorkforceChange change, WorkforceChangeDetails details, ChangePersonRef person,
        IReadOnlyList<ChangePersonRef> teamStaying)
    {
        var moments = new List<CoreChangeMoment>();
        var joining = new Dictionary<Guid, List<ChangePersonRef>>();
        var leaving = new Dictionary<Guid, List<ChangePersonRef>>();
        void Add(Dictionary<Guid, List<ChangePersonRef>> side, ChangePersonRef? manager, ChangePersonRef who)
        {
            if (manager is null) return;
            if (!side.TryGetValue(manager.EmployeeId, out var people)) side[manager.EmployeeId] = people = [];
            if (people.All(item => item.EmployeeId != who.EmployeeId)) people.Add(who);
        }
        var date = change.EffectiveDate;

        switch (change.Kind)
        {
            case WorkforceChangeKind.JobChange:
            {
                var parts = new[]
                {
                    details.TitleChanged ? details.TitleTo : null,
                    details.UnitChanged ? details.UnitTo : null,
                    details.LocationChanged ? details.LocationTo : null,
                }.Where(part => !string.IsNullOrWhiteSpace(part)).ToList();
                if (details.UnitChanged || details.TitleChanged || details.LocationChanged)
                    moments.Add(new CoreChangeMoment(person.EmployeeId, CoreNotificationKind.JobChanged, date, [],
                        details.ManagerChanged ? details.ManagerTo : null, Summary: parts.Count == 0 ? null : string.Join(" · ", parts)));
                else if (details.ManagerChanged)
                    moments.Add(new CoreChangeMoment(person.EmployeeId, CoreNotificationKind.ManagerChanged, date, [], details.ManagerTo));

                if (details.ManagerChanged)
                {
                    Add(leaving, details.ManagerFrom, person);
                    Add(joining, details.ManagerTo, person);
                }
                if (details.TeamOutcome == "Stays" && details.TeamManager is { } teamManager)
                {
                    foreach (var report in teamStaying)
                    {
                        moments.Add(new CoreChangeMoment(report.EmployeeId, CoreNotificationKind.ManagerChanged, date, [], teamManager));
                        Add(joining, teamManager, report);
                        Add(leaving, person, report);
                    }
                }
                break;
            }
            case WorkforceChangeKind.EndEmployment:
            {
                var lastDay = details.LastDay ?? date.AddDays(-1);
                if (details.ManagerFrom is { } manager)
                    moments.Add(new CoreChangeMoment(manager.EmployeeId, CoreNotificationKind.TeamLeaving, lastDay, [person], LastDay: true));
                foreach (var report in details.Reassigned ?? [])
                {
                    moments.Add(new CoreChangeMoment(report.Person.EmployeeId, CoreNotificationKind.ManagerChanged, date, [], report.Manager));
                    Add(joining, report.Manager, report.Person);
                }
                break;
            }
            case WorkforceChangeKind.Join:
                if (details.ManagerTo is { } newManager)
                    moments.Add(new CoreChangeMoment(newManager.EmployeeId, CoreNotificationKind.TeamJoining, date, [person],
                        HireTitle: details.IsHire ? details.TitleTo : null));
                break;
        }

        moments.AddRange(joining.Select(item => new CoreChangeMoment(item.Key, CoreNotificationKind.TeamJoining, date, item.Value)));
        moments.AddRange(leaving.Select(item => new CoreChangeMoment(item.Key, CoreNotificationKind.TeamLeaving, date, item.Value)));
        // Nobody hears about themselves.
        return moments
            .Where(moment => moment.RecipientEmployeeId != Guid.Empty
                && moment.People.All(who => who.EmployeeId != moment.RecipientEmployeeId))
            .ToList();
    }

    /// <summary>The reports a job change left behind with someone else: the primary lines it created for other people.</summary>
    public static async Task<IReadOnlyList<ChangePersonRef>> TeamStayingAsync(CoreHRDbContext db, WorkforceChange change,
        WorkforceChangeDetails details, CancellationToken cancellationToken)
    {
        if (change.Kind != WorkforceChangeKind.JobChange || details.TeamOutcome != "Stays") return [];
        var ids = change.Effects
            .Where(effect => effect.EntityType == WorkforceChangeEffect.ManagerRelationshipEntity
                && effect.Action == WorkforceChangeEffectAction.Created && effect.SubjectEmployeeId != change.EmployeeId)
            .Select(effect => effect.SubjectEmployeeId)
            .Distinct()
            .ToList();
        if (ids.Count == 0) return [];
        var people = await db.Employees.AsNoTracking().Where(employee => ids.Contains(employee.Id)).ToListAsync(cancellationToken);
        return people.Select(WorkforceChangeService.Ref).OrderBy(item => item.DisplayName, StringComparer.OrdinalIgnoreCase).ToList();
    }

    /// <summary>
    /// The catalogue keys and values for a moment. Recorded ahead, it names the date; on the day, it says it happened;
    /// under Upcoming the date is shown beside it, so the words leave it out.
    /// </summary>
    public static CoreNotificationMessage Words(CoreChangeMoment moment, CoreMomentTense tense, DateOnly today,
        string? actorName = null, Guid? actorEmployeeId = null)
    {
        var suffix = tense == CoreMomentTense.Upcoming ? ".upcoming" : moment.Date <= today ? ".now" : "";
        var values = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["date"] = moment.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        };
        var actor = string.IsNullOrWhiteSpace(actorName) ? null : actorName.Trim();
        if (actor is not null) values["actor"] = actor;
        string title;
        string? context = actor is null || tense == CoreMomentTense.Upcoming ? null : "Context.recordedBy";
        string href;
        switch (moment.Kind)
        {
            case CoreNotificationKind.ManagerChanged:
                if (moment.Manager is { } manager) values["manager"] = manager.DisplayName;
                title = (moment.Manager is null ? "ManagerChanged.none" : "ManagerChanged") + suffix;
                href = ProfilePath;
                break;
            case CoreNotificationKind.JobChanged:
                title = "JobChanged" + suffix;
                if (moment.Summary is { } summary)
                {
                    values["summary"] = summary;
                    if (moment.Manager is { } next) values["manager"] = next.DisplayName;
                    context = moment.Manager is null ? "JobChanged.context" : "JobChanged.context.manager";
                }
                href = ProfilePath;
                break;
            case CoreNotificationKind.TeamJoining:
            case CoreNotificationKind.TeamLeaving:
                values["name"] = moment.People[0].DisplayName;
                if (moment.LastDay)
                {
                    title = "TeamLeaving.lastDay" + suffix;
                }
                else
                {
                    values["count"] = moment.People.Count.ToString(CultureInfo.InvariantCulture);
                    title = moment.Kind + suffix;
                }
                if (moment.HireTitle is { } hireTitle && tense == CoreMomentTense.Recorded)
                {
                    values["title"] = hireTitle;
                    context = "TeamJoining.context.hire";
                }
                href = TeamPath;
                break;
            case CoreNotificationKind.TeamLeave:
                values["name"] = moment.People[0].DisplayName;
                values["type"] = moment.Summary ?? "";
                title = moment.Occasion is { } occasion ? $"TeamLeave.{occasion}" : "TeamLeave" + suffix;
                if (moment.Back is { } back) values["back"] = back.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                context = moment.Back is null ? "TeamLeave.context" : "TeamLeave.context.back";
                href = TeamPath;
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(moment), moment.Kind, "Choose a Core HR moment.");
        }
        return new CoreNotificationMessage(title, context, values, actor, href, actor is null ? null : actorEmployeeId);
    }

    /// <summary>What a cancellation says to someone the change told, from that notification's frozen values.</summary>
    public static CoreNotificationMessage CancelledWords(CoreNotification told, string? actorName = null, Guid? actorEmployeeId = null)
    {
        var values = told.Values.Where(item => item.Key != "actor").ToDictionary(item => item.Key, item => item.Value, StringComparer.Ordinal);
        var actor = string.IsNullOrWhiteSpace(actorName) ? null : actorName.Trim();
        if (actor is not null) values["actor"] = actor;
        var title = told.Kind switch
        {
            CoreNotificationKind.TeamJoining when told.ContextKey == "TeamJoining.context.hire" => "TeamJoining.hire.cancelled",
            CoreNotificationKind.TeamLeaving when told.TitleKey.StartsWith("TeamLeaving.lastDay", StringComparison.Ordinal) => "TeamLeaving.lastDay.cancelled",
            CoreNotificationKind.ManagerChanged or CoreNotificationKind.JobChanged or CoreNotificationKind.TeamJoining
                or CoreNotificationKind.TeamLeaving or CoreNotificationKind.TeamLeave => $"{told.Kind}.cancelled",
            _ => throw new ArgumentOutOfRangeException(nameof(told), told.Kind, "A cancellation answers what the change told."),
        };
        return new CoreNotificationMessage(title, actor is null ? null : "Context.cancelledBy", values, actor, told.Href,
            actor is null ? null : actorEmployeeId);
    }
}
